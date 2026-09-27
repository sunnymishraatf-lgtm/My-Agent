/**
 * Shared helpers for the Vercel serverless API (api/*).
 *
 * Design notes (serverless reality):
 * - Functions are stateless: there is NO in-memory analysis/approval/job store
 *   here (unlike the persistent Node server in src/server/). Each invocation
 *   builds a fresh DemoManager and only uses its stateless operations
 *   (prepare / analyze / status). Long-running agent execution is honestly
 *   unsupported on serverless — see api/demo/execute.ts.
 * - Plan approval is a signed HMAC token (SERVER_SECRET) instead of the
 *   server-memory gate, so it survives across invocations without a session
 *   store. The token binds an approval to one analysis id and expires.
 * - Every route calls the SAME real NEUTRON functions as the CLI and the
 *   Node server (src/neutron/* via src/server/demo.ts). No duplicated logic.
 * - Secrets never leave the server: error mapping below never forwards raw
 *   error messages to the client.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  DemoManager,
  DemoError,
  resolveDemoWorkspace,
} from "../src/server/demo";

/* ------------------------------------------------------------------ */
/* Minimal Vercel handler types (no @vercel/node dependency needed)     */
/* ------------------------------------------------------------------ */

export interface VercelRequest {
  method?: string;
  /** Already-parsed JSON body (Vercel parses it) or a raw string in tests. */
  body?: unknown;
  /** Route/query params, e.g. { id: "..." } for api/demo/jobs/[id].ts */
  query?: Record<string, string | string[] | undefined>;
}

export interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
}

export function sendJson(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function requireMethod(req: VercelRequest, res: VercelResponse, method: string): boolean {
  if (req.method !== method) {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return false;
  }
  return true;
}

/** Parse the request body as a JSON object. Vercel pre-parses JSON bodies. */
export function readJsonBody(req: VercelRequest): Record<string, unknown> {
  const raw = req.body;
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* fall through to the error below */
    }
    throw new DemoError("Invalid JSON body", 400);
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  throw new DemoError("Invalid JSON body", 400);
}

/* ------------------------------------------------------------------ */
/* Validation (same semantics as the persistent Node server)            */
/* ------------------------------------------------------------------ */

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Ids are `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`; anything else is a 400. */
export function parseId(value: unknown, what: string): string {
  if (typeof value === "string" && SESSION_ID_RE.test(value)) return value;
  throw new DemoError(`Invalid ${what}`, 400);
}

const RISK_TOLERANCES = new Set(["safe", "balanced", "aggressive"]);

export function parseRiskTolerance(value: unknown): "safe" | "balanced" | "aggressive" {
  if (value === undefined) return "balanced";
  if (typeof value === "string" && RISK_TOLERANCES.has(value)) {
    return value as "safe" | "balanced" | "aggressive";
  }
  throw new DemoError(
    `Invalid riskTolerance ${JSON.stringify(value) ?? "null"}; expected one of: safe, balanced, aggressive.`,
    400,
  );
}

/* ------------------------------------------------------------------ */
/* Workspace + manager (fresh per invocation — stateless)              */
/* ------------------------------------------------------------------ */

/**
 * Demo workspace for serverless: /tmp is the only writable directory.
 * NEUTRON_DEMO_WORKSPACE overrides it (set it to /tmp/neutron-demo on Vercel).
 */
export function demoWorkspace(): string {
  return resolveDemoWorkspace(process.env.NEUTRON_DEMO_WORKSPACE?.trim() || "/tmp/neutron-demo");
}

/** A fresh DemoManager per invocation. Only its stateless methods are used. */
export function newDemoManager(): DemoManager {
  return new DemoManager(demoWorkspace());
}

/* ------------------------------------------------------------------ */
/* Stateless approval tokens (HMAC, SERVER_SECRET)                      */
/* ------------------------------------------------------------------ */

const TOKEN_PREFIX = "v1";
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function serverSecret(): string {
  const s = process.env.SERVER_SECRET?.trim();
  if (!s) throw new DemoError("SERVER_SECRET is not configured on this deployment.", 500);
  return s;
}

/**
 * Issue a single-approval token bound to one analysis id. The UI sends it
 * back with /api/demo/execute; execute validates it before responding.
 */
export function issueApprovalToken(analysisId: string): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${TOKEN_PREFIX}.${analysisId}.${exp}`;
  const sig = createHmac("sha256", serverSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** True only when the token is well-formed, unexpired, signed, and bound to analysisId. */
export function verifyApprovalToken(token: unknown, analysisId: string): boolean {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX || parts[1] !== analysisId) return false;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  let secret: string;
  try {
    secret = serverSecret();
  } catch {
    return false;
  }
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(parts[3] ?? "", "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Error mapping — never leak raw error text (may contain paths)        */
/* ------------------------------------------------------------------ */

export function handleApiError(res: VercelResponse, err: unknown): void {
  if (err instanceof DemoError) {
    sendJson(res, err.status, { ok: false, error: err.message });
    return;
  }
  sendJson(res, 500, { ok: false, error: "Internal server error" });
}
