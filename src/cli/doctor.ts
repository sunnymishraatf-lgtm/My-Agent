import { readGlobalProviders, registerSecrets, redact, envConfiguredIds, type ProviderResolved } from "../config";
import { createRegistryProvider } from "../providers/registry";
import { listCatalog, envPrefixesFor, type ProviderCatalogEntry } from "../providers/catalog";
import { summarizeError, isClassified } from "../providers/errors";
import { loadDotEnvFiles, loadedEnvFiles } from "../env";

export interface ChatProbe {
  ok: boolean;
  model?: string;
  reply?: string;
  error?: string;
}

export interface ProviderDiagnosis {
  id: string;
  displayName: string;
  /** YES when the provider is configured (config file or environment). */
  configured: boolean;
  /** Where the configuration came from. */
  source: "config" | "env" | "none";
  /** PRESENT / MISSING — the key value is never shown. */
  apiKey: boolean;
  /** Base URL with any embedded secrets stripped. */
  baseUrl: string;
  /** First configured model, or "(auto)" when discovery will pick one. */
  model: string;
  /** YES when the endpoint answered (any HTTP status), NO on network failure. */
  reachable: boolean;
  latencyMs?: number;
  /** PASS / FAIL / UNKNOWN (unreachable) / NA (local, keyless). */
  auth: "PASS" | "FAIL" | "UNKNOWN" | "NA";
  chat?: ChatProbe;
  /** Sanitized, human-readable error. Never contains secrets. */
  error?: string;
}

export interface DoctorReport {
  node: { version: string; ok: boolean };
  npm: { version: string; ok: boolean };
  git: { installed: boolean; ok: boolean };
  config: { path: string; ok: boolean };
  envFiles: string[];
  providers: ProviderDiagnosis[];
  /** Catalog providers with no configuration at all (compact list). */
  unconfigured: Array<{ id: string; displayName: string; keyEnv: string }>;
  platform: string;
}

/** Strip anything that looks like an embedded credential from a URL. */
function safeUrl(url: string): string {
  return url
    .replace(/([?&](?:key|api_key|apikey|token|auth)[^=]*=)[^&]*/gi, "$1***")
    .replace(/(\/\/[^/:@\s]+:)[^@\s]+@/g, "$1***@");
}

function keyEnvForEntry(entry: ProviderCatalogEntry): string {
  const prefixes = envPrefixesFor(entry);
  return prefixes.length > 0 ? `${prefixes[0]}_API_KEY` : "API_KEY";
}

function resolveSource(id: string, fromEnv: Set<string>): "config" | "env" {
  // Env wins over the file, so an id configured in both reports as "env".
  return fromEnv.has(id) ? "env" : "config";
}

async function diagnoseProvider(p: ProviderResolved, source: "config" | "env", opts?: { chat?: boolean }): Promise<ProviderDiagnosis> {
  const entry = listCatalog().find((e) => e.id === p.id);
  const displayName = entry?.displayName ?? p.id;
  const local = entry?.local === true || /^(http:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(p.baseUrl);

  const diag: ProviderDiagnosis = {
    id: p.id,
    displayName,
    configured: true,
    source,
    apiKey: !!p.apiKey,
    baseUrl: safeUrl(p.baseUrl),
    model: p.models[0] ?? "(auto)",
    reachable: false,
    auth: "UNKNOWN",
  };

  if (!p.baseUrl) {
    diag.error = "no base URL configured";
    return diag;
  }

  const provider = createRegistryProvider(p);

  // 1. Endpoint reachability (+ implicit auth signal) via GET /models.
  let modelsError: unknown;
  try {
    const health = await provider.healthCheck();
    diag.latencyMs = health.latencyMs;
    diag.reachable = health.ok;
    if (health.ok) {
      diag.auth = "PASS";
    } else {
      // healthCheck swallows the status; probe /models directly for the code.
      try {
        await provider.models();
        diag.auth = "PASS";
        diag.reachable = true;
      } catch (err) {
        modelsError = err;
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
          diag.reachable = true; // the endpoint answered — the key is the problem
          diag.auth = local || !p.apiKey ? "NA" : "FAIL";
        } else if (isClassified(err) && (err.kind === "dns" || err.kind === "connection-refused" || err.kind === "timeout" || err.kind === "tls" || err.kind === "network")) {
          diag.reachable = false;
          diag.auth = "UNKNOWN";
        } else {
          diag.reachable = true;
          diag.auth = "UNKNOWN";
        }
      }
    }
  } catch (err) {
    modelsError = err;
    diag.reachable = false;
    diag.auth = "UNKNOWN";
  }

  if (local && !p.apiKey) diag.auth = "NA";

  if (modelsError && !diag.error) {
    diag.error = summarizeError(modelsError);
  }

  // 2. Model request probe (only with --chat): proves the key + model actually work.
  if (opts?.chat) {
    const modelId = p.models[0];
    if (!modelId) {
      diag.chat = { ok: false, error: "no model configured (set <PROVIDER>_MODELS or add --models) and discovery returned none" };
    } else if (!diag.reachable) {
      diag.chat = { ok: false, model: modelId, error: "skipped: endpoint unreachable" };
    } else {
      try {
        const res = await provider.chat({
          model: modelId,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          maxTokens: 8,
        });
        diag.chat = { ok: true, model: modelId, reply: res.text.trim().slice(0, 60) };
      } catch (err) {
        diag.chat = { ok: false, model: modelId, error: summarizeError(err) };
      }
    }
  }

  if (diag.error) diag.error = redact(diag.error);
  if (diag.chat?.error) diag.chat.error = redact(diag.chat.error);
  return diag;
}

export async function runDoctor(opts?: { chat?: boolean }): Promise<DoctorReport> {
  loadDotEnvFiles();
  const { execSync } = await import("node:child_process");
  const { existsSync } = await import("node:fs");
  const { globalConfigPath } = await import("../config");

  let nodeVersion = "";
  let npmVersion = "";
  let gitOk = false;

  try {
    nodeVersion = execSync("node --version", { encoding: "utf8" }).toString().trim();
  } catch {}
  try {
    // `npm.cmd` resolution via PATHEXT makes this work on Windows CMD too.
    npmVersion = execSync("npm --version", { encoding: "utf8" }).toString().trim();
  } catch {}
  try {
    execSync("git --version", { encoding: "utf8" });
    gitOk = true;
  } catch {}

  const cfgFile = globalConfigPath();
  const cfgOk = existsSync(cfgFile);

  const configured = readGlobalProviders();
  const envIds = envConfiguredIds();
  registerSecrets(configured.map((p) => p.apiKey).filter((k): k is string => !!k));

  const providers: ProviderDiagnosis[] = [];
  for (const p of configured) {
    providers.push(await diagnoseProvider(p, resolveSource(p.id, envIds), opts));
  }

  const configuredIds = new Set(configured.map((p) => p.id));
  const unconfigured = listCatalog()
    .filter((e) => !configuredIds.has(e.id))
    .map((e) => ({ id: e.id, displayName: e.displayName, keyEnv: keyEnvForEntry(e) }));

  return {
    node: { version: nodeVersion, ok: /v\d+/.test(nodeVersion) && Number(nodeVersion.slice(1).split(".")[0]) >= 20 },
    npm: { version: npmVersion, ok: !!npmVersion },
    git: { installed: gitOk, ok: gitOk },
    config: { path: cfgFile, ok: cfgOk },
    envFiles: [...loadedEnvFiles],
    providers,
    unconfigured,
    platform: process.platform,
  };
}

export function formatDoctor(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("NEUTRON DOCTOR");
  lines.push("");
  lines.push(`Platform: ${report.platform}`);
  lines.push(`Node: ${report.node.ok ? "OK" : "MISSING"} ${report.node.version || "not found"}${report.node.ok ? "" : " (need Node 20+)"}`);
  lines.push(`NPM: ${report.npm.ok ? "OK" : "MISSING"} ${report.npm.version || "not found"}`);
  lines.push(`Git: ${report.git.ok ? "OK" : "MISSING"} ${report.git.installed ? "found" : "not found"}`);
  lines.push(`Config: ${report.config.ok ? "OK" : "MISSING"} ${report.config.path}`);
  lines.push(`Env files: ${report.envFiles.length > 0 ? report.envFiles.join(", ") : "none found"}`);
  lines.push("");

  if (report.providers.length === 0) {
    lines.push("No providers configured.");
    lines.push("  - Run `neutron config` / `neutron auth login <provider>` to add one, or");
    lines.push("  - set e.g. AGENTROUTER_API_KEY (+ optional AGENTROUTER_BASE_URL, AGENTROUTER_MODELS) in your environment or a .env file.");
  } else {
    for (const p of report.providers) {
      lines.push(`Provider: ${p.displayName} (${p.id})`);
      lines.push(`  Configured: YES (source: ${p.source})`);
      lines.push(`  API Key: ${p.apiKey ? "PRESENT" : "MISSING"}`);
      lines.push(`  Base URL: ${p.baseUrl || "(none)"}`);
      lines.push(`  Model: ${p.model}`);
      lines.push(`  Endpoint reachable: ${p.reachable ? `YES${p.latencyMs !== undefined ? ` (${p.latencyMs}ms)` : ""}` : "NO"}`);
      lines.push(`  Authentication: ${p.auth}`);
      if (p.chat) {
        lines.push(
          p.chat.ok
            ? `  Model request: PASS (${p.chat.model}) -> "${p.chat.reply ?? ""}"`
            : `  Model request: FAIL${p.chat.model ? ` (${p.chat.model})` : ""} — ${(p.chat.error ?? "unknown").slice(0, 200)}`,
        );
      }
      if (p.error) lines.push(`  Error: ${p.error.slice(0, 300)}`);
      lines.push("");
    }
  }

  if (report.unconfigured.length > 0) {
    lines.push(`Not configured (${report.unconfigured.length}): ` +
      report.unconfigured.map((u) => u.id).join(", "));
    lines.push("  (set <PROVIDER>_API_KEY, e.g. " +
      report.unconfigured.slice(0, 3).map((u) => u.keyEnv).join(", ") + ", …)");
  }

  if (!report.node.ok) {
    lines.push("");
    lines.push("Node 20+ is required. Install via https://nodejs.org");
  }
  return lines.join("\n");
}
