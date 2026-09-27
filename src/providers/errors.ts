/**
 * Human-readable classification of provider request failures.
 *
 * `fetch()` failures surface as a bare `TypeError: fetch failed`; the real
 * reason (DNS, refused, timeout, TLS, …) hides in `error.cause`. This module
 * unwraps it and converts every failure mode into a structured, sanitized
 * description that tells the user WHAT failed and WHAT to do about it —
 * without ever including secrets.
 */

export type FailureKind =
  | "dns"
  | "connection-refused"
  | "connection-reset"
  | "timeout"
  | "tls"
  | "network"
  | "http"
  | "invalid-json"
  | "config";

export interface ClassifiedError extends Error {
  kind: FailureKind;
  /** Always set for HTTP failures. */
  status?: number;
  /** True when retrying the same request could plausibly succeed. */
  retryable: boolean;
  /** Short human-readable reason, e.g. "authentication failed (HTTP 401)". */
  reason: string;
  /** Actionable next step, e.g. "check AGENTROUTER_API_KEY". Never a secret. */
  suggestion?: string;
  provider: string;
  endpoint?: string;
  model?: string;
}

interface Ctx {
  provider: string;
  endpoint?: string;
  model?: string;
  /** Env var holding the key, used in suggestions (e.g. "AGENTROUTER_API_KEY"). */
  keyEnv?: string;
}

function base(ctx: Ctx, kind: FailureKind, reason: string, retryable: boolean, suggestion?: string): ClassifiedError {
  const err = new Error(`${ctx.provider}: ${reason}`) as ClassifiedError;
  err.kind = kind;
  err.retryable = retryable;
  err.reason = reason;
  err.suggestion = suggestion;
  err.provider = ctx.provider;
  err.endpoint = ctx.endpoint;
  err.model = ctx.model;
  return err;
}

function keySuggestion(ctx: Ctx, fallback: string): string {
  return ctx.keyEnv ? `check ${ctx.keyEnv}` : fallback;
}

import { envPrefixesFor, getCatalogEntry } from "./catalog";

/**
 * The env var that holds this provider's key (e.g. "AGENTROUTER_API_KEY").
 * Used only in suggestion text — the value is never read or printed here.
 */
export function keyEnvVar(providerId: string): string | undefined {
  const entry = getCatalogEntry(providerId);
  if (!entry) return `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const prefixes = envPrefixesFor(entry);
  return prefixes.length > 0 ? `${prefixes[0]}_API_KEY` : undefined;
}

/** Walk the `cause` chain to find the deepest useful error. */
function rootCause(err: unknown): { code?: string; message: string; name: string } {
  let current = err as { cause?: unknown; code?: string; message?: string; name?: string } | undefined;
  let depth = 0;
  let last = { code: undefined as string | undefined, message: "", name: "" };
  while (current && depth < 6) {
    last = {
      code: typeof current.code === "string" ? current.code : last.code,
      message: typeof current.message === "string" ? current.message : last.message,
      name: typeof current.name === "string" ? current.name : last.name,
    };
    const next = current.cause;
    if (!next || typeof next !== "object") break;
    current = next as typeof current;
    depth++;
  }
  return last;
}

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_ALTNAME_FORMAT_INVALID",
]);

/**
 * Convert any thrown fetch/network failure into a ClassifiedError.
 * HTTP-status errors should go through {@link classifyHttpError} instead.
 */
export function classifyNetworkError(err: unknown, ctx: Ctx): ClassifiedError {
  const { code, message, name } = rootCause(err);
  const msg = `${name}: ${message}`.toLowerCase();

  const timeout =
    name === "TimeoutError" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    msg.includes("aborted due to timeout") ||
    msg.includes("timeout");
  if (timeout) {
    return base(
      ctx,
      "timeout",
      "request timed out",
      true,
      "the provider may be slow or unreachable; try again, or run `neutron doctor`",
    );
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || msg.includes("getaddrinfo")) {
    const host = safeHost(ctx.endpoint);
    return base(
      ctx,
      "dns",
      `could not resolve host${host ? ` "${host}"` : ""} (DNS failure)`,
      true,
      "check the base URL and your network/DNS settings",
    );
  }

  if (code === "ECONNREFUSED") {
    return base(
      ctx,
      "connection-refused",
      "connection refused — nothing is listening at that address",
      false,
      "check the base URL (host/port); for local providers make sure the server is running",
    );
  }

  if (code === "ECONNRESET" || code === "EPIPE" || msg.includes("socket hang up") || msg.includes("other side closed")) {
    return base(
      ctx,
      "connection-reset",
      "connection reset by the server",
      true,
      "transient network issue; try again",
    );
  }

  if ((code && TLS_CODES.has(code)) || msg.includes("certificate") || msg.includes("ssl")) {
    return base(
      ctx,
      "tls",
      `TLS/SSL failure (${code ?? "certificate error"})`,
      false,
      "check for a proxy/MITM, VPN, or an expired certificate; do not disable TLS verification",
    );
  }

  if (!ctx.endpoint) {
    return base(ctx, "config", "provider has no base URL configured", false, "run `neutron config` or set <PROVIDER>_BASE_URL");
  }

  return base(
    ctx,
    "network",
    `network error${code ? ` (${code})` : ""}${message ? `: ${truncate(message, 120)}` : ""}`,
    true,
    "check your network connection, then run `neutron doctor`",
  );
}

/** Classify an HTTP error status into a human-readable, actionable error. */
export function classifyHttpError(status: number, detail: string, ctx: Ctx): ClassifiedError {
  const err = classifyHttp(status, detail, ctx);
  err.status = status;
  return err;
}

function classifyHttp(status: number, detail: string, ctx: Ctx): ClassifiedError {
  const clean = truncate(detail, 200);
  const withDetail = clean ? `: ${clean}` : "";
  switch (status) {
    case 400:
      return base(ctx, "http", `invalid request (HTTP 400)${withDetail}`, false,
        "check the model id and request parameters");
    case 401:
      return base(ctx, "http", `authentication failed (HTTP 401)${withDetail}`, false,
        keySuggestion(ctx, "check the provider API key"));
    case 403:
      return base(ctx, "http", `forbidden (HTTP 403)${withDetail}`, false,
        "the key may lack access to this model or endpoint");
    case 404:
      return base(ctx, "http", `not found (HTTP 404)${withDetail}`, false,
        "check the base URL (a wrong /v1 prefix is a common cause) and the model id");
    case 408:
      return base(ctx, "http", "request timeout (HTTP 408)", true, "try again");
    case 429:
      return base(ctx, "http", `rate limited (HTTP 429)${withDetail}`, true,
        "slow down or wait before retrying");
    default:
      if (status >= 500) {
        return base(ctx, "http", `provider server error (HTTP ${status})${withDetail}`, true,
          "the provider is having issues; try again later");
      }
      return base(ctx, "http", `request failed (HTTP ${status})${withDetail}`, false,
        "run `neutron doctor` for details");
  }
}

export function classifyInvalidJson(ctx: Ctx, snippet: string): ClassifiedError {
  return base(
    ctx,
    "invalid-json",
    `provider returned invalid JSON${snippet ? `: ${truncate(snippet, 120)}` : ""}`,
    false,
    "the endpoint may not be an LLM API; check the base URL",
  );
}

/** True when the error was produced by (or wrapped by) this module. */
export function isClassified(err: unknown): err is ClassifiedError {
  return (
    !!err &&
    typeof err === "object" &&
    typeof (err as { kind?: unknown }).kind === "string" &&
    typeof (err as { retryable?: unknown }).retryable === "boolean"
  );
}

/** Retry policy: only transient failures are retried. Auth/config errors never are. */
export function isRetryable(err: unknown): boolean {
  if (isClassified(err)) return err.retryable;
  const e = err as { retryable?: boolean; status?: number } | null;
  if (typeof e?.retryable === "boolean") return e.retryable;
  if (typeof e?.status === "number") return e.status === 408 || e.status === 429 || e.status >= 500;
  // Unknown errors: retry once-ish is safer than dropping (matches old behavior).
  return true;
}

/** One-line summary used in per-provider failure lists. Never includes secrets. */
export function summarizeError(err: unknown): string {
  if (isClassified(err)) {
    return err.suggestion ? `${err.reason} — ${err.suggestion}` : err.reason;
  }
  const e = err as { status?: number } | null;
  if (typeof e?.status === "number") return `HTTP ${e.status} — ${truncate(err instanceof Error ? err.message : String(err), 160)}`;
  return truncate(err instanceof Error ? err.message : String(err), 160);
}

/**
 * Format the final failover error listing every provider that failed and why,
 * instead of only showing the last error.
 */
export function formatFailoverError(failures: Array<{ id: string; error: unknown }>): Error {
  const lines = ["All LLM providers failed after retries and failover.", "", "Provider failures:"];
  for (const f of failures) {
    lines.push(`- ${f.id}: ${summarizeError(f.error)}`);
  }
  lines.push("", "Suggestion: run `neutron doctor` to diagnose each provider.");
  const err = new Error(lines.join("\n"));
  (err as { failures?: Array<{ id: string; error: unknown }> }).failures = failures;
  return err;
}

/**
 * Render a provider failure the way the CLI should show it:
 *
 *   AgentRouter request failed
 *   Reason: authentication failed (HTTP 401)
 *   Provider: agentrouter
 *   Model: claude-opus-5
 *   Endpoint: https://agentrouter.org/v1
 *   Suggestion: run `neutron doctor`
 */
export function formatCliError(err: unknown, fallbackProvider?: string, fallbackModel?: string): string {
  const lines: string[] = [];
  if (isClassified(err)) {
    const display = displayName(err.provider);
    lines.push(`${display} request failed`);
    lines.push(`Reason: ${err.reason}`);
    lines.push(`Provider: ${err.provider}`);
    if (err.model ?? fallbackModel) lines.push(`Model: ${err.model ?? fallbackModel}`);
    if (err.endpoint) lines.push(`Endpoint: ${err.endpoint}`);
    const suggestion = err.suggestion ?? "run `neutron doctor`";
    lines.push(
      `Suggestion: ${/doctor/.test(suggestion) ? suggestion : `${suggestion}; run \`neutron doctor\` for a full diagnosis`}`,
    );
    return lines.join("\n");
  }
  const msg = truncate(err instanceof Error ? err.message : String(err), 300);
  lines.push(msg);
  if (fallbackProvider) lines.push(`Provider: ${fallbackProvider}`);
  if (fallbackModel) lines.push(`Model: ${fallbackModel}`);
  lines.push("Suggestion: run `neutron doctor`");
  return lines.join("\n");
}

function displayName(providerId: string): string {
  if (!providerId) return "Provider";
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

function safeHost(endpoint?: string): string {
  if (!endpoint) return "";
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
