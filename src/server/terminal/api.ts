/**
 * Terminal + Test Lab HTTP API (Node server only — process execution, which
 * serverless hosting doesn't have).
 *
 *   POST   /api/terminal/sessions                 {repo, label?} → create
 *   GET    /api/terminal/sessions                 → list summaries
 *   GET    /api/terminal/sessions/:id/output?since=N → new lines + state
 *   POST   /api/terminal/sessions/:id/input       {data} → run cmd / stdin
 *   POST   /api/terminal/sessions/:id/kill        → SIGKILL current process
 *   DELETE /api/terminal/sessions/:id             → kill + remove
 *   GET    /api/terminal/sessions/:id/result      → exit + parsed test verdict
 *   GET    /api/terminal/test-command?repo=       → detected test command
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { detectTestCommand } from "../agent/tools";
import { listWorkspaceRepos } from "../demo";
import { parseTestOutput, verdictOf } from "./parsers";
import { TerminalHttpError, TerminalSessionManager } from "./sessions";

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/* Per-IP rate limit on session creation (same pattern as the agent API). */
const buckets = new Map<string, { count: number; reset: number }>();
const CREATE_LIMIT = 30;
const CREATE_WINDOW_MS = 3_600_000;
export function terminalCreateRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = buckets.get(ip);
  if (!entry || now > entry.reset) {
    buckets.set(ip, { count: 1, reset: now + CREATE_WINDOW_MS });
    if (buckets.size > 10_000) buckets.clear();
    return false;
  }
  entry.count++;
  return entry.count > CREATE_LIMIT;
}
export function resetTerminalRateLimit(): void {
  buckets.clear();
}

let manager: TerminalSessionManager | null = null;
export function getTerminalManager(workspace: string): TerminalSessionManager {
  if (!manager || manager.root !== workspace) {
    manager = new TerminalSessionManager(workspace);
  }
  return manager;
}
/** Test hook — replace the singleton (tests restore it afterwards). */
export function setTerminalManager(m: TerminalSessionManager | null): void {
  manager = m;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
    if (chunks.reduce((n, b) => n + b.length, 0) > 1_000_000) {
      throw new TerminalHttpError(413, "Request body too large.");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new TerminalHttpError(400, "Invalid JSON body.");
  }
}

export async function handleTerminalApi(
  workspace: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const mgr = getTerminalManager(workspace);
  const path = url.pathname;
  const sub = path.slice("/api/terminal".length); // "" | "/sessions" | "/sessions/…"
  const seg = sub.split("/").filter(Boolean);
  try {
    /* GET /api/terminal/test-command?repo= */
    if (req.method === "GET" && seg.length === 1 && seg[0] === "test-command") {
      const repo = url.searchParams.get("repo") ?? "";
      const root = join(workspace, repo);
      // Validate against the workspace allow-list the same way sessions do.
      if (!listWorkspaceRepos(workspace).some((r) => r.name === repo)) {
        throw new TerminalHttpError(400, "Unknown repository.");
      }
      const detected = detectTestCommand(root);
      sendJson(res, 200, {
        ok: true,
        command: detected ? detected.command : null,
        kind: detected ? detected.kind : null,
      });
      return;
    }
    if (seg.length === 1 && seg[0] === "sessions") {
      if (req.method === "POST") {
        const ip = req.socket.remoteAddress ?? "unknown";
        if (terminalCreateRateLimited(ip)) {
          sendJson(res, 429, { ok: false, error: "Too many terminal sessions created. Please slow down." });
          return;
        }
        const body = (await readJsonBody(req)) as { repo?: unknown; label?: unknown };
        const s = mgr.create(
          typeof body.repo === "string" ? body.repo : "",
          typeof body.label === "string" ? body.label : undefined,
        );
        sendJson(res, 201, { ok: true, session: s });
        return;
      }
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, sessions: mgr.list() });
        return;
      }
    }
    if (seg.length >= 2 && seg[0] === "sessions") {
      const id = (() => {
        try { return decodeURIComponent(seg[1] as string); } catch { return ""; }
      })();
      if (!id || !SESSION_ID_RE.test(id)) throw new TerminalHttpError(400, "Invalid session id.");
      if (req.method === "GET" && seg.length === 3 && seg[2] === "output") {
        const sinceRaw = url.searchParams.get("since");
        const since = sinceRaw == null || sinceRaw === "" ? 0 : Number(sinceRaw);
        if (!Number.isFinite(since) || since < 0) throw new TerminalHttpError(400, "Invalid since parameter.");
        sendJson(res, 200, { ok: true, ...mgr.output(id, since) });
        return;
      }
      if (req.method === "POST" && seg.length === 3 && seg[2] === "input") {
        const body = (await readJsonBody(req)) as { data?: unknown };
        sendJson(res, 200, { ok: true, ...mgr.input(id, body.data) });
        return;
      }
      if (req.method === "POST" && seg.length === 3 && seg[2] === "kill") {
        sendJson(res, 200, { ok: true, ...mgr.kill(id) });
        return;
      }
      if (req.method === "DELETE" && seg.length === 2) {
        mgr.remove(id);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && seg.length === 3 && seg[2] === "result") {
        const exit = mgr.lastExit(id);
        const running = mgr.isRunning(id);
        const text = mgr.fullText(id);
        const parsed = parseTestOutput(text);
        sendJson(res, 200, {
          ok: true,
          running,
          exitCode: exit?.code ?? null,
          timedOut: exit?.timedOut ?? false,
          verdict: running ? "running" : verdictOf(parsed, exit?.code ?? null),
          parsed,
        });
        return;
      }
    }
    sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${path}` });
  } catch (e) {
    if (e instanceof TerminalHttpError) {
      sendJson(res, e.status, { ok: false, error: e.message });
      return;
    }
    throw e;
  }
}
