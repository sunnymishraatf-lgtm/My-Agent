import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ApiSystem } from "../api/api-manager";
import { ChatAgent } from "../chat/agent";
import { SessionStore, type ChatSession } from "../chat/session";
import { findAgent, loadAgents } from "../chat/agent-config";
import { getVersion } from "../version";
import { createNeutronWorkflow, runFullWorkflow, type NeutronWorkflowOptions, type NeutronResult } from "../neutron/workflow";
import { NeutronStore } from "../neutron/store";
import { RunArchive } from "../neutron/record";
import { analyzeRepository } from "../neutron/analyzer";
import { analyzeImpact } from "../neutron/impact";
import { buildPlan } from "../neutron/planner";
import { formatImpactGraph } from "../neutron/impact";
import type { RepoAnalysis, ImpactGraph, NeutronPlan, MaintenanceRequest } from "../neutron/model";
import type { ChatMessage } from "../types";
import { extractRequestKey, extractRequestProvider, configForRequest } from "./byok";
import { applyAttachmentsToMessages, AttachmentError } from "./chat-attachments";
import { searchMusic } from "./music-search";
import { extractArtifacts, ARTIFACT_SYSTEM_NUDGE } from "./chat-artifacts";
import { listCatalog, defaultModelsFor } from "../providers/catalog";
import { existsSync, readFileSync, createReadStream } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomManager } from "./collab/room-manager";
import { CollabServer, COLLAB_WS_PATH, type IceServerConfig } from "./collab/collab-server";
import {
  getAgentManager,
  serializeRun,
  restoreRunCheckpoint,
  AgentHttpError,
  type AgentManager,
} from "./agent/loop";
import {
  CHECKPOINT_ID_RE,
  compareCheckpoints,
  createManualCheckpoint,
  deleteCheckpoint,
  getCheckpoint,
  listCheckpoints,
  restoreCheckpointFile,
  safeRestoreCheckpoint,
} from "./agent/checkpoints";
import { resolveSafePath, ToolError } from "./agent/tools";
import {
  GitError,
  assertGitRepo,
  gitStatus,
  gitStage,
  gitBranches,
  createBranch,
  switchBranch,
  gitCommit,
  gitLog,
  gitDiff,
  discardFile,
  stashList,
  stashPush,
  stashPop,
  gitMerge,
  gitPull,
  gitPush,
  cloneWithToken,
} from "./git/git-service";
import { handleInsightsApi } from "./insights";
import { handleTerminalApi } from "./terminal/api";
import { handleAuthApi } from "./auth/api";
import {
  getDemoManager,
  prepareDemoRepo,
  getDemoStatus,
  serializeAnalysis,
  serializeJob,
  cloneRepo,
  listWorkspaceRepos,
  listRepoFiles,
  DemoError,
  type DemoManager,
} from "./demo";

/** Locate the dashboard assets shipped with NEUTRON itself (never the user's target repo). */
function resolveWebDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "web"), join(here, "..", "web"), join(here, "..", "src", "web"), join(here, "..", "..", "src", "web")];
  return candidates.find((d) => existsSync(join(d, "index.html")));
}

const WEB_MIME: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Serves a single static file from inside webDir, with path containment.
 * Shared by the /src/web/ and /app/ routes below.
 */
function serveWebFile(
  res: ServerResponse,
  webDir: string,
  rel: string,
): boolean {
  const filePath = rel ? normalize(join(webDir, rel)) : "";
  // Containment: never serve anything outside the dashboard directory.
  if (!filePath.startsWith(webDir + sep) || !existsSync(filePath)) return false;
  res.writeHead(200, { "content-type": WEB_MIME[extname(filePath)] ?? "text/plain; charset=utf-8" });
  const stream = createReadStream(filePath);
  stream.on("error", (err) => {
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: `Failed to read file: ${err.message}` });
    else res.destroy();
  });
  stream.pipe(res);
  return true;
}


function makeMaintenanceRequest(request: string, repository: string, branch: string, riskTolerance: "safe" | "balanced" | "aggressive", execution: "plan-only" | "implement-and-test"): MaintenanceRequest {
  return { request, repository, branch, riskTolerance, execution };
}

export interface ServeOptions {
  root: string;
  port: number;
  host?: string;
  password?: string;
  username?: string;
  web?: boolean;
  /** Directory that contains the demo workspace (NEUTRON web demo repositories). */
  demoWorkspace?: string;
  /** Collaboration room manager. Created by startServer; tests may inject one. */
  collabManager?: RoomManager;
}

/** Fallback dashboard page (used when no shipped web assets are found). Exported for tests. */
export const WEB_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NEUTRON — Autonomous Software Maintenance Intelligence</title>
<style>
  :root { color-scheme: dark; --bg:#0b0d10; --panel:#111419; --line:#23262d; --fg:#e6e6e6; --muted:#8b93a1; --accent:#6ea8fe; }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; display:flex; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); color:var(--fg); }
  aside { width:260px; border-right:1px solid var(--line); display:flex; flex-direction:column; background:var(--panel); }
  aside h1 { font-size:15px; margin:0; padding:14px 16px; border-bottom:1px solid var(--line); letter-spacing:.04em; }
  aside h1 span { color:var(--accent); }
  .toolbar { padding:10px 12px; display:flex; flex-direction:column; gap:8px; border-bottom:1px solid var(--line); }
  select, .toolbar input { background:#14171c; border:1px solid var(--line); color:var(--fg); padding:8px; border-radius:6px; font:inherit; }
  #sessions { overflow-y:auto; flex:1; padding:8px; }
  .session { padding:8px 10px; border-radius:6px; cursor:pointer; color:var(--muted); font-size:12px; line-height:1.4; }
  .session:hover { background:#181c22; color:var(--fg); }
  .session.active { background:#1b2333; color:var(--fg); }
  .session .t { display:block; color:var(--fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  main { flex:1; display:flex; flex-direction:column; min-width:0; }
  header { padding:12px 18px; border-bottom:1px solid var(--line); color:var(--muted); font-size:12px; display:flex; justify-content:space-between; }
  #log { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:14px; }
  .msg { max-width:min(760px,86%); padding:10px 14px; border-radius:12px; white-space:pre-wrap; word-wrap:break-word; line-height:1.5; }
  .user { align-self:flex-end; background:#1d4ed8; color:#fff; border-bottom-right-radius:3px; }
  .agent { align-self:flex-start; background:#161a20; border:1px solid var(--line); border-bottom-left-radius:3px; }
  .err { align-self:flex-start; background:#2a1416; border:1px solid #5b2226; color:#ff9a9a; }
  .tool { align-self:flex-start; color:var(--muted); font-size:12px; background:transparent; border:1px dashed var(--line); }
  form { display:flex; gap:10px; padding:14px 18px; border-top:1px solid var(--line); }
  form input { flex:1; background:#14171c; border:1px solid var(--line); color:var(--fg); padding:12px; border-radius:10px; font:inherit; }
  form button { background:var(--accent); color:#04122b; border:0; padding:12px 20px; border-radius:10px; cursor:pointer; font-weight:600; }
  form button:disabled { opacity:.5; cursor:default; }
</style>
</head>
<body>
<aside>
  <h1>NEUTRON<span>.</span></h1>
  <div class="toolbar">
    <select id="agent" title="Agent"></select>
    <input id="model" placeholder="model (optional)" />
    <button id="new" style="background:#1b2333;color:var(--fg);border:1px solid var(--line);padding:8px;border-radius:6px;cursor:pointer">+ New chat</button>
  </div>
  <div id="sessions"></div>
</aside>
<main>
  <header><span id="title">New chat</span><span id="status">ready</span></header>
  <div id="log"></div>
  <form id="f"><input id="m" placeholder="Ask NEUTRON..." autocomplete="off" autofocus /><button id="send">Send</button></form>
</main>
<script>
  const log = document.getElementById("log");
  const sessionsEl = document.getElementById("sessions");
  const agentSel = document.getElementById("agent");
  const modelInput = document.getElementById("model");
  const statusEl = document.getElementById("status");
  const titleEl = document.getElementById("title");
  let sessionId = null;
  let streamingEl = null;

  function bubble(cls, text) {
    const div = document.createElement("div");
    div.className = "msg " + cls;
    if (text !== undefined) div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  function setStatus(s) { statusEl.textContent = s; }

  async function loadAgents() {
    try {
      const res = await fetch("/v1/agents");
      const data = await res.json();
      for (const a of data.agents || []) {
        if (a.mode === "subagent" && a.hidden) continue;
        const opt = document.createElement("option");
        opt.value = a.name; opt.textContent = a.name;
        agentSel.appendChild(opt);
      }
    } catch {}
  }
  async function loadSessions() {
    try {
      const res = await fetch("/v1/sessions");
      const data = await res.json();
      sessionsEl.innerHTML = "";
      for (const s of data.sessions || []) {
        const el = document.createElement("div");
        el.className = "session" + (s.id === sessionId ? " active" : "");
        el.innerHTML = '<span class="t"></span><span></span>';
        el.querySelector(".t").textContent = s.title;
        el.querySelector("span:last-child").textContent = s.messageCount + " msgs";
        el.onclick = () => openSession(s.id);
        sessionsEl.appendChild(el);
      }
    } catch {}
  }
  async function openSession(id) {
    try {
      const res = await fetch("/v1/sessions/" + encodeURIComponent(id));
      const data = await res.json();
      if (!data.session) return;
      sessionId = id;
      log.innerHTML = "";
      titleEl.textContent = data.session.title;
      for (const m of data.session.messages) bubble(m.role === "user" ? "user" : "agent", m.content);
      loadSessions();
    } catch {}
  }

  document.getElementById("new").onclick = () => {
    sessionId = null; log.innerHTML = ""; titleEl.textContent = "New chat"; setStatus("ready");
  };

  async function sendMessage(message) {
    bubble("user", message);
    setStatus("streaming");
    document.getElementById("send").disabled = true;
    const body = { message, sessionId, agent: agentSel.value || undefined };
    if (modelInput.value.trim()) body.model = modelInput.value.trim();
    streamingEl = bubble("agent", "");
    try {
      const res = await fetch("/v1/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "delta") {
            streamingEl.textContent += ev.text;
            log.scrollTop = log.scrollHeight;
          } else if (ev.type === "assistant") {
            streamingEl.textContent = ev.text;
          } else if (ev.type === "tool-call") {
            bubble("tool", "\\u2699 " + ev.name);
            streamingEl = bubble("agent", "");
          } else if (ev.type === "done") {
            if (ev.sessionId) sessionId = ev.sessionId;
            if (ev.text) streamingEl.textContent = ev.text;
            if (ev.error) bubble("err", ev.error);
          }
        }
      }
    } catch (err) {
      streamingEl.classList.remove("agent");
      streamingEl.classList.add("err");
      streamingEl.textContent = String(err);
    } finally {
      setStatus("ready");
      document.getElementById("send").disabled = false;
      loadSessions();
    }
  }

  document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("m");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    sendMessage(message);
  });

  loadAgents();
  loadSessions();
</script>
</body>
</html>`;

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

export interface RunningServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Thrown for malformed request bodies or invalid enum values; the request handler maps it to HTTP 400. */
export class BadRequestError extends Error {}

const MAX_JSON_BODY = 5_000_000;

/**
 * Read and parse a JSON request body. Throws BadRequestError (→ HTTP 400) when the
 * body is not valid JSON or exceeds the size limit, instead of surfacing a 500.
 */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      data += chunk.toString();
      if (data.length > MAX_JSON_BODY) {
        rejected = true;
        // Drain — never destroy — the socket: destroying it ECONNRESETs the
        // client before the 400 response can be written. Resuming discards the
        // rest of the body while keeping the connection usable for the reply.
        req.resume();
        reject(new BadRequestError("Request body too large"));
      }
    });
    req.on("end", () => {
      if (rejected) return;
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new BadRequestError("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const RISK_TOLERANCES = new Set(["safe", "balanced", "aggressive"]);
const EXECUTION_MODES = new Set(["plan-only", "implement-and-test"]);

/** Validate the riskTolerance enum; unknown values are a 400, not a silent cast. */
function parseRiskTolerance(value: unknown): "safe" | "balanced" | "aggressive" {
  if (value === undefined) return "balanced";
  if (typeof value === "string" && RISK_TOLERANCES.has(value)) {
    return value as "safe" | "balanced" | "aggressive";
  }
  throw new BadRequestError(
    `Invalid riskTolerance ${JSON.stringify(value) ?? "null"}; expected one of: safe, balanced, aggressive.`
  );
}

/** Validate the execution enum; unknown values are a 400, not a silent cast. */
function parseExecution(value: unknown, fallback: "plan-only" | "implement-and-test"): "plan-only" | "implement-and-test" {
  if (value === undefined) return fallback;
  if (typeof value === "string" && EXECUTION_MODES.has(value)) {
    return value as "plan-only" | "implement-and-test";
  }
  throw new BadRequestError(
    `Invalid execution ${JSON.stringify(value) ?? "null"}; expected one of: plan-only, implement-and-test.`
  );
}

/** True when a chat body carries attachments — an attachment-only request
    (no text message) is valid; the merger synthesizes a user turn. */
function hasChatAttachments(b: { attachments?: unknown }): boolean {
  return Array.isArray(b.attachments) && (b.attachments as unknown[]).length > 0;
}

/** Session/snapshot ids are `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`; anything else is a 400, never a filesystem path. */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function parseSessionId(value: unknown): string {
  if (typeof value === "string" && SESSION_ID_RE.test(value)) return value;
  throw new BadRequestError("Invalid session id");
}

/**
 * Server-side plan approvals, keyed by workspace root. An approval is recorded only via
 * POST /api/neutron/approve, is single-use (consumed before execution), and is never taken
 * from client request flags. Approvals live only in memory: a server restart invalidates
 * pending approvals (fail-closed).
 */
const planApprovals = new Map<string, { request: string; approvedAt: string }>();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

/* ------------------------------------------------------------------ */
/* NEUTRON web demo API (/api/demo/*)                                   */
/* ------------------------------------------------------------------ */

/** Simple per-IP rate limiter for the demo API (bounded, in-memory). */
const demoRateBuckets = new Map<string, { count: number; reset: number }>();
function demoRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = demoRateBuckets.get(ip);
  if (!entry || now > entry.reset) {
    demoRateBuckets.set(ip, { count: 1, reset: now + 60_000 });
    if (demoRateBuckets.size > 10_000) demoRateBuckets.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > 120;
}

function parseAnalysisId(value: unknown): string {
  if (typeof value === "string" && SESSION_ID_RE.test(value)) return value;
  throw new BadRequestError("Invalid analysis id");
}

async function handleDemoApi(manager: DemoManager, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (demoRateLimited(ip)) {
    sendJson(res, 429, { ok: false, error: "Rate limit exceeded. Please slow down." });
    return;
  }
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/api/demo/status") {
      sendJson(res, 200,
        getDemoStatus(manager, {
          apiKey: extractRequestKey(req),
          providerId: extractRequestProvider(req),
        }));
      return;
    }
    if (req.method === "POST" && path === "/api/demo/prepare") {
      sendJson(res, 200, { ok: true, ...prepareDemoRepo(manager.workspace) });
      return;
    }
    if (req.method === "POST" && path === "/api/demo/analyze") {
      const body = (await readJsonBody(req)) as { repo?: string; request?: string; riskTolerance?: unknown };
      const record = manager.analyze(
        typeof body.repo === "string" ? body.repo : "demo",
        typeof body.request === "string" ? body.request : "",
        parseRiskTolerance(body.riskTolerance),
      );
      sendJson(res, 200, { ok: true, ...serializeAnalysis(record) });
      return;
    }
    if (req.method === "POST" && path === "/api/demo/approve") {
      const body = (await readJsonBody(req)) as { analysisId?: unknown };
      sendJson(res, 200, { ok: true, ...manager.approve(parseAnalysisId(body.analysisId)) });
      return;
    }
    if (req.method === "POST" && path === "/api/demo/reject") {
      const body = (await readJsonBody(req)) as { analysisId?: unknown };
      sendJson(res, 200, { ok: true, ...manager.reject(parseAnalysisId(body.analysisId)) });
      return;
    }
    if (req.method === "POST" && path === "/api/demo/execute") {
      const body = (await readJsonBody(req)) as { analysisId?: unknown; apiKey?: unknown; provider?: unknown };
      // BYOK: the request key (x-api-key header or apiKey body field) and the
      // provider choice (x-provider header or provider body field) are passed
      // as call parameters only — never stored on the manager.
      const job = manager.execute(
        parseAnalysisId(body.analysisId),
        extractRequestKey(req, body),
        extractRequestProvider(req, body),
      );
      sendJson(res, 202, { ok: true, ...serializeJob(job) });
      return;
    }
    // Workspace repositories (Node mirrors the single Vercel function
    // api/demo/repos.js: GET lists, POST clones).
    if (path === "/api/demo/repos") {
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, repos: listWorkspaceRepos(manager.workspace) });
        return;
      }
      if (req.method === "POST") {
        const body = (await readJsonBody(req)) as { url?: unknown };
        if (typeof body.url !== "string" || !body.url.trim()) throw new BadRequestError("url is required");
        const repo = await cloneRepo(manager.workspace, body.url);
        sendJson(res, 200, { ok: true, repository: repo.name, isDemo: repo.isDemo });
        return;
      }
    }
    /* Lightweight file listing + manifests for project auto-detect (Node
       only — serverless has no persistent workspace). The repo name is
       validated against the workspace listing; only relative paths and
       capped manifest text are returned, never absolute server paths. */
    if (req.method === "GET" && path === "/api/demo/repo-files") {
      const repo = url.searchParams.get("repo") || "";
      const known = listWorkspaceRepos(manager.workspace).some((r) => r.name === repo);
      if (!known) throw new BadRequestError("Unknown repository.");
      sendJson(res, 200, { ok: true, ...listRepoFiles(manager.workspace, repo) });
      return;
    }
    if (req.method === "GET" && path.startsWith("/api/demo/jobs/")) {
      const rest = path.slice("/api/demo/jobs/".length);
      const slash = rest.indexOf("/");
      const rawId = slash === -1 ? rest : rest.slice(0, slash);
      const sub = slash === -1 ? "" : rest.slice(slash + 1);
      let id: string;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        throw new BadRequestError("Invalid job id");
      }
      if (!SESSION_ID_RE.test(id)) throw new BadRequestError("Invalid job id");
      const job = manager.getJob(id);
      if (sub === "result") {
        if (job.status !== "completed" && job.status !== "failed" && job.status !== "denied") {
          sendJson(res, 409, { ok: false, error: "Job is still running.", status: job.status });
          return;
        }
        sendJson(res, 200, { ok: true, job: serializeJob(job), result: job.result ?? null });
        return;
      }
      if (sub !== "") {
        sendJson(res, 404, { ok: false, error: "Not found" });
        return;
      }
      sendJson(res, 200, { ok: true, job: serializeJob(job) });
      return;
    }
    sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${path}` });
  } catch (e) {
    if (e instanceof DemoError) {
      sendJson(res, e.status, {
        ok: false,
        error: e.message,
        ...(e.status === 409 ? { requiresApproval: true } : {}),
      });
      return;
    }
    throw e;
  }
}

/**
 * Autonomous AI agent API (Node only). Per-IP rate limit, bounded runs.
 * The request key is request-scoped — runs hold it in memory only.
 */
const agentBuckets = new Map<string, { count: number; reset: number }>();
const AGENT_CREATE_LIMIT = 10;
const AGENT_CREATE_WINDOW_MS = 3_600_000;
function agentCreateRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = agentBuckets.get(ip);
  if (!entry || now > entry.reset) {
    agentBuckets.set(ip, { count: 1, reset: now + AGENT_CREATE_WINDOW_MS });
    if (agentBuckets.size > 10_000) agentBuckets.clear();
    return false;
  }
  entry.count++;
  return entry.count > AGENT_CREATE_LIMIT;
}

async function handleAgentApi(
  manager: AgentManager,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const path = url.pathname;
  const sub = path.slice("/api/agent/".length);
  const seg = sub.split("/");
  try {
    /* Newest-first run summaries (Node only — runs live in server memory).
       Powers the universal search palette's agent-run results. */
    if (req.method === "GET" && sub === "runs") {
      sendJson(res, 200, { ok: true, runs: manager.list() });
      return;
    }
    if (req.method === "POST" && sub === "runs") {
      const ip = req.socket.remoteAddress ?? "unknown";
      if (agentCreateRateLimited(ip)) {
        sendJson(res, 429, { ok: false, error: "Too many agent runs created. Please slow down." });
        return;
      }
      const body = (await readJsonBody(req)) as {
        goal?: unknown; repo?: unknown; provider?: unknown; model?: unknown;
        apiKey?: unknown; projectContext?: unknown; autoApproveEdits?: unknown;
      };
      const run = manager.create({
        goal: typeof body.goal === "string" ? body.goal : "",
        repo: typeof body.repo === "string" ? body.repo : "",
        workspace: manager.workspace,
        apiKey: extractRequestKey(req, body),
        provider: extractRequestProvider(req, body) || (typeof body.provider === "string" ? body.provider : undefined),
        model: typeof body.model === "string" ? body.model : undefined,
        projectContext: typeof body.projectContext === "string" ? body.projectContext : undefined,
        autoApproveEdits: body.autoApproveEdits === true,
      });
      sendJson(res, 202, { ok: true, run: serializeRun(run) });
      return;
    }
    if (seg[0] === "runs" && seg[1]) {
      let id = "";
      try { id = decodeURIComponent(seg[1] as string); } catch { /* 400 below */ }
      if (!id || !SESSION_ID_RE.test(id)) throw new AgentHttpError(400, "Invalid run id.");
      if (req.method === "GET" && seg.length === 2) {
        sendJson(res, 200, { ok: true, run: serializeRun(manager.get(id)) });
        return;
      }
      if (req.method === "GET" && seg.length === 3 && seg[2] === "result") {
        const run = manager.get(id);
        if (!["completed", "failed", "stopped", "denied"].includes(run.status)) {
          sendJson(res, 409, { ok: false, error: "Run is still active.", status: run.status });
          return;
        }
        sendJson(res, 200, { ok: true, run: serializeRun(run) });
        return;
      }
      if (req.method === "POST" && seg.length === 3 && seg[2] === "stop") {
        sendJson(res, 200, { ok: true, run: serializeRun(manager.stop(id)) });
        return;
      }
      if (req.method === "POST" && seg.length === 4 && seg[2] === "approvals") {
        let approvalId = "";
        try { approvalId = decodeURIComponent(seg[3] as string); } catch { /* 400 below */ }
        if (!approvalId || !SESSION_ID_RE.test(approvalId)) throw new AgentHttpError(400, "Invalid approval id.");
        const body = (await readJsonBody(req)) as { approved?: unknown };
        const run = manager.decide(id, approvalId, body.approved === true);
        sendJson(res, 200, { ok: true, run: serializeRun(run) });
        return;
      }
      if (req.method === "POST" && seg.length === 3 && seg[2] === "restore-checkpoint") {
        const out = restoreRunCheckpoint(id, manager.workspace);
        sendJson(res, 200, { ok: true, ...out, run: serializeRun(manager.get(id)) });
        return;
      }
    }
    sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${path}` });
  } catch (e) {
    if (e instanceof AgentHttpError) {
      sendJson(res, e.status, { ok: false, error: e.message });
      return;
    }
    throw e;
  }
}

/**
 * Generalized checkpoint API (Node only — checkpoints live in the server
 * workspace, which serverless hosting doesn't have).
 *
 *   POST   /api/checkpoints                      {repo, label} → create
 *   GET    /api/checkpoints?repo=                → list (newest first)
 *   GET    /api/checkpoints/:id?repo=            → detail + file list
 *   DELETE /api/checkpoints/:id?repo=            → delete
 *   POST   /api/checkpoints/:id/restore          {repo} → safe restore
 *            (a "pre-restore" checkpoint is snapshotted first — nothing is
 *            ever silently destroyed)
 *   POST   /api/checkpoints/:id/restore-file     {repo, path} → revert one file
 *   GET    /api/checkpoints/:id/compare/:other?repo= → real per-file diffs
 *
 * The repo name must be a known workspace repo; checkpoint ids are validated
 * path segments. Per-IP rate limit, bounded.
 */
const cpBuckets = new Map<string, { count: number; reset: number }>();
const CP_LIMIT = 60;
const CP_WINDOW_MS = 60_000;
function checkpointRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = cpBuckets.get(ip);
  if (!entry || now > entry.reset) {
    cpBuckets.set(ip, { count: 1, reset: now + CP_WINDOW_MS });
    if (cpBuckets.size > 10_000) cpBuckets.clear();
    return false;
  }
  entry.count++;
  return entry.count > CP_LIMIT;
}
/** Test hook: clear all checkpoint buckets. */
export function resetCheckpointRateLimit(): void {
  cpBuckets.clear();
}

function resolveCheckpointRepo(workspace: string, repo: unknown): string {
  const name = typeof repo === "string" ? repo : "";
  const known = listWorkspaceRepos(workspace).some((r) => r.name === name);
  if (!known) throw new AgentHttpError(400, "Unknown repository.");
  return resolveSafePath(workspace, name);
}

function decodeId(seg: string | undefined): string {
  let id = "";
  try { id = decodeURIComponent(seg ?? ""); } catch { /* 400 below */ }
  if (!id || !CHECKPOINT_ID_RE.test(id)) throw new AgentHttpError(400, "Invalid checkpoint id.");
  return id;
}

async function handleCheckpointsApi(
  workspace: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (checkpointRateLimited(ip)) {
    sendJson(res, 429, { ok: false, error: "Too many checkpoint requests. Please slow down." });
    return;
  }
  const sub = url.pathname.slice("/api/checkpoints".length);
  const seg = sub.split("/").filter((s) => s.length > 0);
  try {
    if (req.method === "POST" && seg.length === 0) {
      const body = (await readJsonBody(req)) as { repo?: unknown; label?: unknown };
      const root = resolveCheckpointRepo(workspace, body.repo);
      const cp = createManualCheckpoint(root, typeof body.label === "string" ? body.label : "");
      sendJson(res, 201, { ok: true, checkpoint: cp });
      return;
    }
    if (req.method === "GET" && seg.length === 0) {
      const root = resolveCheckpointRepo(workspace, url.searchParams.get("repo"));
      sendJson(res, 200, { ok: true, checkpoints: listCheckpoints(root) });
      return;
    }
    if (seg.length >= 1) {
      const id = decodeId(seg[0]);
      if (req.method === "GET" && seg.length === 1) {
        const root = resolveCheckpointRepo(workspace, url.searchParams.get("repo"));
        sendJson(res, 200, { ok: true, checkpoint: getCheckpoint(root, id) });
        return;
      }
      if (req.method === "DELETE" && seg.length === 1) {
        const root = resolveCheckpointRepo(workspace, url.searchParams.get("repo"));
        sendJson(res, 200, { ok: true, ...deleteCheckpoint(root, id) });
        return;
      }
      if (req.method === "POST" && seg.length === 2 && seg[1] === "restore") {
        const body = (await readJsonBody(req)) as { repo?: unknown };
        const root = resolveCheckpointRepo(workspace, body.repo);
        sendJson(res, 200, { ok: true, ...safeRestoreCheckpoint(root, id) });
        return;
      }
      if (req.method === "POST" && seg.length === 2 && seg[1] === "restore-file") {
        const body = (await readJsonBody(req)) as { repo?: unknown; path?: unknown };
        const root = resolveCheckpointRepo(workspace, body.repo);
        const p = typeof body.path === "string" ? body.path : "";
        if (!p) throw new AgentHttpError(400, "path is required.");
        sendJson(res, 200, { ok: true, ...restoreCheckpointFile(root, id, p) });
        return;
      }
      if (req.method === "GET" && seg.length === 3 && seg[1] === "compare") {
        const other = decodeId(seg[2]);
        const root = resolveCheckpointRepo(workspace, url.searchParams.get("repo"));
        sendJson(res, 200, { ok: true, ...compareCheckpoints(root, id, other) });
        return;
      }
    }
    sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${url.pathname}` });
  } catch (e) {
    if (e instanceof ToolError) {
      const status = e.code === "NO_CHECKPOINT" ? 404 : 400;
      sendJson(res, status, { ok: false, error: e.message });
      return;
    }
    if (e instanceof AgentHttpError) {
      sendJson(res, e.status, { ok: false, error: e.message });
      return;
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Git workspace API (Node only — git repos live in the server workspace,
   which serverless hosting doesn't have).
 *
 *   GET    /api/git/status?repo=            → status + branch + ahead/behind
 *   GET    /api/git/branches?repo=          → current + branch list
 *   POST   /api/git/branches                {repo, name} → create branch
 *   POST   /api/git/checkout                {repo, branch} → switch branch
 *   POST   /api/git/commit                  {repo, message} → commit staged
 *   POST   /api/git/stage                   {repo, paths?} → stage (all if omitted)
 *   GET    /api/git/log?repo=&n=            → recent commits (cap 100)
 *   GET    /api/git/diff?repo=&staged=1&ref= → unified diff
 *   POST   /api/git/discard                 {repo, path} → restore file from HEAD
 *   GET    /api/git/stash?repo=             → stash list
 *   POST   /api/git/stash                   {repo, message?} → stash changes
 *   POST   /api/git/stash/pop               {repo, index?} → apply stash
 *   POST   /api/git/merge                   {repo, branch} → merge (honest conflicts)
 *   POST   /api/git/pull                    {repo} → pull (env git auth)
 *   POST   /api/git/push                    {repo} → push (env git auth)
 *   POST   /api/git/clone-token             {url, token} → token clone (transient)
 *
 * The repo name must be a known workspace repo AND a git repo. Pull/push
 * rely on the server environment's existing git authentication — the API
 * never accepts or stores git passwords. The clone token is used once via
 * http.extraHeader and never persisted or logged.
 * ------------------------------------------------------------------ */

const gitBuckets = new Map<string, { count: number; reset: number }>();
export const GIT_LIMIT = 60;
export const GIT_WINDOW_MS = 60_000;
function gitRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = gitBuckets.get(ip);
  if (!entry || now > entry.reset) {
    gitBuckets.set(ip, { count: 1, reset: now + GIT_WINDOW_MS });
    if (gitBuckets.size > 10_000) gitBuckets.clear();
    return false;
  }
  entry.count++;
  return entry.count > GIT_LIMIT;
}
/** Test hook: clear all git buckets. */
export function resetGitRateLimit(): void {
  gitBuckets.clear();
}

/** Resolve a repo name to its root; must be a known workspace repo and a git repo. */
function resolveGitRepo(workspace: string, repo: unknown): string {
  const name = typeof repo === "string" ? repo : "";
  const known = listWorkspaceRepos(workspace).some((r) => r.name === name);
  if (!known) throw new AgentHttpError(400, "Unknown repository.");
  const root = resolveSafePath(workspace, name);
  assertGitRepo(root); // throws GitError(NOT_A_REPO) otherwise
  return root;
}

async function handleGitApi(
  workspace: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (gitRateLimited(ip)) {
    sendJson(res, 429, { ok: false, error: "Too many git requests. Please slow down." });
    return;
  }
  const sub = url.pathname.slice("/api/git".length);
  const seg = sub.split("/").filter((s) => s.length > 0);
  const bad = (msg: string) => { throw new AgentHttpError(400, msg); };
  try {
    if (req.method === "GET" && seg.length === 1 && seg[0] === "status") {
      const root = resolveGitRepo(workspace, url.searchParams.get("repo"));
      sendJson(res, 200, { ok: true, ...(await gitStatus(root)) });
      return;
    }
    if (req.method === "GET" && seg.length === 1 && seg[0] === "branches") {
      const root = resolveGitRepo(workspace, url.searchParams.get("repo"));
      sendJson(res, 200, { ok: true, ...(await gitBranches(root)) });
      return;
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "branches") {
      const body = (await readJsonBody(req)) as { repo?: unknown; name?: unknown };
      const root = resolveGitRepo(workspace, body.repo);
      if (typeof body.name !== "string" || !body.name.trim()) bad("Branch name is required.");
      sendJson(res, 201, { ok: true, ...(await createBranch(root, body.name as string)) });
      return;
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "checkout") {
      const body = (await readJsonBody(req)) as { repo?: unknown; branch?: unknown };
      const root = resolveGitRepo(workspace, body.repo);
      if (typeof body.branch !== "string" || !body.branch.trim()) bad("Branch is required.");
      sendJson(res, 200, { ok: true, ...(await switchBranch(root, body.branch as string)) });
      return;
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "commit") {
      const body = (await readJsonBody(req)) as { repo?: unknown; message?: unknown };
      const root = resolveGitRepo(workspace, body.repo);
      sendJson(res, 201, { ok: true, ...(await gitCommit(root, typeof body.message === "string" ? body.message : "")) });
      return;
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "stage") {
      const body = (await readJsonBody(req)) as { repo?: unknown; paths?: unknown };
      const root = resolveGitRepo(workspace, body.repo);
      const paths = body.paths === undefined ? undefined : (Array.isArray(body.paths) ? body.paths : null);
      if (paths === null) bad("paths must be an array of strings.");
      sendJson(res, 200, { ok: true, ...(await gitStage(root, paths as string[] | undefined)) });
      return;
    }
    if (req.method === "GET" && seg.length === 1 && seg[0] === "log") {
      const root = resolveGitRepo(workspace, url.searchParams.get("repo"));
      const n = parseInt(url.searchParams.get("n") ?? "30", 10);
      sendJson(res, 200, { ok: true, commits: await gitLog(root, Number.isFinite(n) ? n : 30) });
      return;
    }
    if (req.method === "GET" && seg.length === 1 && seg[0] === "diff") {
      const root = resolveGitRepo(workspace, url.searchParams.get("repo"));
      const ref = url.searchParams.get("ref") ?? undefined;
      sendJson(res, 200, {
        ok: true,
        ...(await gitDiff(root, { staged: url.searchParams.get("staged") === "1", ref: ref || undefined })),
      });
      return;
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "discard") {
      const body = (await readJsonBody(req)) as { repo?: unknown; path?: unknown };
      const root = resolveGitRepo(workspace, body.repo);
      if (typeof body.path !== "string" || !body.path.trim()) bad("path is required.");
      sendJson(res, 200, { ok: true, ...(await discardFile(root, body.path as string)) });
      return;
    }
    if (seg.length >= 1 && seg[0] === "stash") {
      if (req.method === "GET" && seg.length === 1) {
        const root = resolveGitRepo(workspace, url.searchParams.get("repo"));
        sendJson(res, 200, { ok: true, stash: await stashList(root) });
        return;
      }
      if (req.method === "POST" && seg.length === 1) {
        const body = (await readJsonBody(req)) as { repo?: unknown; message?: unknown };
        const root = resolveGitRepo(workspace, body.repo);
        sendJson(res, 201, {
          ok: true,
          ...(await stashPush(root, typeof body.message === "string" ? body.message : undefined)),
        });
        return;
      }
      if (req.method === "POST" && seg.length === 2 && seg[1] === "pop") {
        const body = (await readJsonBody(req)) as { repo?: unknown; index?: unknown };
        const root = resolveGitRepo(workspace, body.repo);
        const idx = typeof body.index === "number" ? body.index : 0;
        sendJson(res, 200, { ok: true, ...(await stashPop(root, idx)) });
        return;
      }
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "merge") {
      const body = (await readJsonBody(req)) as { repo?: unknown; branch?: unknown };
      const root = resolveGitRepo(workspace, body.repo);
      if (typeof body.branch !== "string" || !body.branch.trim()) bad("Branch is required.");
      sendJson(res, 200, { ok: true, ...(await gitMerge(root, body.branch as string)) });
      return;
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "pull") {
      const body = (await readJsonBody(req)) as { repo?: unknown };
      const root = resolveGitRepo(workspace, body.repo);
      sendJson(res, 200, { ok: true, ...(await gitPull(root)) });
      return;
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "push") {
      const body = (await readJsonBody(req)) as { repo?: unknown };
      const root = resolveGitRepo(workspace, body.repo);
      sendJson(res, 200, { ok: true, ...(await gitPush(root)) });
      return;
    }
    if (req.method === "POST" && seg.length === 1 && seg[0] === "clone-token") {
      const body = (await readJsonBody(req)) as { url?: unknown; token?: unknown };
      if (typeof body.url !== "string" || !body.url.trim()) bad("url is required.");
      if (typeof body.token !== "string" || !body.token.trim()) bad("token is required.");
      sendJson(res, 201, {
        ok: true,
        ...(await cloneWithToken(workspace, body.url as string, body.token as string)),
      });
      return;
    }
    sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${url.pathname}` });
  } catch (e) {
    if (e instanceof GitError) {
      const status = e.code === "NOT_A_REPO" ? 404 : e.code === "TIMEOUT" ? 504 : 400;
      sendJson(res, status, { ok: false, error: e.message, code: e.code });
      return;
    }
    if (e instanceof ToolError) {
      sendJson(res, 400, { ok: false, error: e.message });
      return;
    }
    if (e instanceof AgentHttpError) {
      sendJson(res, e.status, { ok: false, error: e.message });
      return;
    }
    throw e;
  }
}

export function createRequestHandler(opts: ServeOptions): (req: IncomingMessage, res: ServerResponse) => void { return (req, res) => {    void handle(opts, req, res).catch((err) => {
      if (err instanceof BadRequestError) {
        sendJson(res, 400, { ok: false, error: err.message });
        return;
      }
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  };
}

/**
 * Per-IP rate limiter for collaboration room creation (bounded, in-memory).
 * 20 rooms per 10 minutes per address — generous for real use, but stops
 * one client from burning the global MAX_ROOMS cap for everyone.
 * Exported for tests.
 */
const roomCreateBuckets = new Map<string, { count: number; reset: number }>();
export const ROOM_CREATE_LIMIT = 20;
export const ROOM_CREATE_WINDOW_MS = 600_000;
export function roomCreateRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = roomCreateBuckets.get(ip);
  if (!entry || now > entry.reset) {
    roomCreateBuckets.set(ip, { count: 1, reset: now + ROOM_CREATE_WINDOW_MS });
    if (roomCreateBuckets.size > 10_000) roomCreateBuckets.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > ROOM_CREATE_LIMIT;
}
/** Test hook: clear all room-creation buckets. */
export function resetRoomCreateRateLimit(): void {
  roomCreateBuckets.clear();
}

async function handle(opts: ServeOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Reject percent-encoded path traversal in the RAW request target.
  // `new URL()` normalizes %2e/%2f away before routing, so without this check
  // an encoded traversal probe would silently land on an unrelated route
  // (usually a 404) instead of being explicitly rejected with a 400.
  // Only the path portion is inspected; query strings are unaffected.
  const rawTarget = req.url ?? "/";
  const rawPath = rawTarget.includes("?") ? rawTarget.slice(0, rawTarget.indexOf("?")) : rawTarget;
  if (/%(?:2e|2f|5c)/i.test(rawPath)) {
    sendJson(res, 400, { ok: false, error: "Invalid request path" });
    return;
  }
  if (opts.password) {
    const header = req.headers.authorization ?? "";
    const expected =
      "Basic " + Buffer.from(`${opts.username ?? "neutron"}:${opts.password}`).toString("base64");
    if (header !== expected) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="neutron"' });
      res.end("Unauthorized");
      return;
    }
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const sessions = new SessionStore(opts.root);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-api-key,x-provider",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
    const webDir = resolveWebDir();
    if (webDir) {
      sendHtml(res, readFileSync(join(webDir, "index.html"), "utf8"));
      return;
    }
    sendHtml(res, WEB_HTML);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
    sendJson(res, 200, { ok: true, version: getVersion(), agents: loadAgents(opts.root).map((a) => a.name) });
    return;
  }

  /* Collaboration rooms (Phase 1). Node server only — Vercel serverless
     cannot hold WebSocket connections, so these routes don't exist there. */
  if (req.method === "POST" && url.pathname === "/api/collab/rooms") {
    if (!opts.collabManager) {
      sendJson(res, 503, { ok: false, error: "Collaboration rooms are unavailable on this server." });
      return;
    }
    // Per-IP creation limit: without it one client could burn the global
    // MAX_ROOMS cap and deny room creation to everyone else.
    const creatorIp = req.socket.remoteAddress ?? "unknown";
    if (roomCreateRateLimited(creatorIp)) {
      sendJson(res, 429, { ok: false, error: "Too many rooms created from this address. Wait a few minutes and try again." });
      return;
    }
    const body = (await readJsonBody(req)) as { name?: unknown };
    try {
      const { room, ownerToken } = opts.collabManager.createRoom(typeof body.name === "string" ? body.name : "");
      // The owner token is returned exactly once, at creation.
      sendJson(res, 201, { ok: true, room, ownerToken });
    } catch (err) {
      sendJson(res, 429, { ok: false, error: err instanceof Error ? err.message : "Could not create room." });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/collab/rooms/")) {
    let code: string;
    try {
      code = decodeURIComponent(url.pathname.slice("/api/collab/rooms/".length));
    } catch {
      sendJson(res, 200, { ok: true, exists: false });
      return;
    }
    const room = opts.collabManager?.getRoom(code);
    sendJson(res, 200, { ok: true, exists: !!room, ...(room ? { name: room.name } : {}) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/agents") {
    sendJson(res, 200, { agents: loadAgents(opts.root) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/sessions") {
    sendJson(res, 200, { sessions: sessions.list() });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/sessions/")) {
    let id: string;
    try {
      id = decodeURIComponent(url.pathname.slice("/v1/sessions/".length));
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid session id" });
      return;
    }
    // Containment: only well-formed ids may become filesystem paths (blocks ../ traversal).
    if (!SESSION_ID_RE.test(id)) {
      sendJson(res, 400, { ok: false, error: "Invalid session id" });
      return;
    }
    const session = sessions.load(id);
    if (!session) {
      sendJson(res, 404, { ok: false, error: "Session not found" });
      return;
    }
    sendJson(res, 200, { session });
    return;
  }

  // NEUTRON endpoints
  if (req.method === "GET" && url.pathname === "/api/neutron/analyze") {
    try {
      const analysis = analyzeRepository(opts.root);
      const request = makeMaintenanceRequest("", "local", "main", "balanced", "plan-only");
      const graph = analyzeImpact(analysis, request);
      sendJson(res, 200, { analysis, graph });
      return;
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/neutron/analyze") {
    try {
      const rawBody = (await readJsonBody(req)) as {
        request?: string;
        repository?: string;
        branch?: string;
        riskTolerance?: unknown;
        execution?: unknown;
      };
      const request = rawBody.request;
      if (!request) { sendJson(res, 400, { ok: false, error: "request is required" }); return; }
      const riskTolerance = parseRiskTolerance(rawBody.riskTolerance);
      const execution = parseExecution(rawBody.execution, "plan-only");
      const analysis = analyzeRepository(opts.root);
      const maintRequest = makeMaintenanceRequest(
        request,
        rawBody.repository ?? "local",
        rawBody.branch ?? "main",
        riskTolerance,
        execution
      );
      const graph = analyzeImpact(analysis, maintRequest);
      sendJson(res, 200, { analysis, graph });
      return;
    } catch (e) {
      if (e instanceof BadRequestError) throw e;
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/neutron/plan") {
    try {
      const body = (await readJsonBody(req)) as { request?: string; riskTolerance?: unknown };
      const { request } = body;
      if (!request) { sendJson(res, 400, { ok: false, error: "request is required" }); return; }
      const riskTolerance = parseRiskTolerance(body.riskTolerance);
      const analysis = analyzeRepository(opts.root);
      const maintRequest: MaintenanceRequest = { request, repository: "local", branch: "main", riskTolerance, execution: "plan-only" };
      const graph = analyzeImpact(analysis, maintRequest);
      const plan = buildPlan(graph);
      // Persist request/graph/plan; a fresh plan invalidates any stale approval.
      const store = new NeutronStore(opts.root);
      store.ensure();
      const prev = store.load();
      store.save({ ...prev, request, repository: "local", branch: "main", riskTolerance, execution: "plan-only", analysis, graph, plan });
      planApprovals.delete(opts.root);
      sendJson(res, 200, { analysis, graph, plan });
      return;
    } catch (e) {
      if (e instanceof BadRequestError) throw e;
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/neutron/approve") {
    try {
      const body = (await readJsonBody(req)) as { request?: string };
      if (!body.request) { sendJson(res, 400, { ok: false, error: "request is required" }); return; }
      const store = new NeutronStore(opts.root);
      const saved = store.load();
      if (saved.request !== body.request || !saved.plan) {
        sendJson(res, 409, {
          ok: false,
          error: "No plan found for this request. Generate a plan first, review it, then approve it.",
        });
        return;
      }
      planApprovals.set(opts.root, { request: body.request, approvedAt: new Date().toISOString() });
      sendJson(res, 200, { ok: true, approved: true, request: body.request });
      return;
    } catch (e) {
      if (e instanceof BadRequestError) throw e;
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/neutron/execute") {
    try {
      const body = (await readJsonBody(req)) as {
        request?: string;
        repository?: string;
        branch?: string;
        riskTolerance?: unknown;
        execution?: unknown;
      };
      // NOTE: the HTTP API never accepts approval flags from the client. Approval is tracked
      // server-side via POST /api/neutron/approve and nowhere else.
      const { request, repository, branch } = body;
      if (!request) { sendJson(res, 400, { ok: false, error: "request is required" }); return; }
      const riskTolerance = parseRiskTolerance(body.riskTolerance);
      const execution = parseExecution(body.execution, "implement-and-test");

      const store = new NeutronStore(opts.root);
      store.ensure();
      const saved = store.load();

      // Human approval gate: code-changing runs need a server-side plan approval for THIS
      // request, and the plan must already exist from a prior plan run.
      if (execution !== "plan-only") {
        const approval = planApprovals.get(opts.root);
        if (!approval || approval.request !== request || saved.request !== request || !saved.plan) {
          sendJson(res, 409, {
            ok: false,
            requiresApproval: true,
            error: "Plan approval required. Generate a plan first (plan-only), review it, then approve it before implementation.",
          });
          return;
        }
        // Single-use: consume the approval BEFORE running so it cannot authorize a later run.
        planApprovals.delete(opts.root);
      }

      const maintenanceRequest: MaintenanceRequest = {
        request,
        repository: repository ?? saved.repository ?? "local",
        branch: branch ?? "main",
        riskTolerance,
        execution,
      };

      // Capture the approval decision now: the workflow re-plans and persists state mid-run,
      // so the callbacks below must use this captured value instead of re-reading mutable state.
      const approvedForRun = true;
      // BYOK: a request key (x-api-key header or apiKey body field) builds a
      // request-scoped provider config for the requested provider (x-provider
      // header or provider body field, default agentrouter); otherwise the
      // server config applies.
      const config = configForRequest(extractRequestKey(req, body), extractRequestProvider(req, body));
      const api = new ApiSystem({ config, logger: silentLogger });
      // Only the plan gate can be approved over HTTP. Command approvals and anything else stay denied
      // (they need the interactive CLI/TUI), and nothing is ever deployed.
      const result = await runFullWorkflow({
        root: opts.root,
        request: maintenanceRequest,
        api,
        autoApprove: false,
        invokeApproval: async ({ metadata }) =>
          metadata?.kind === "plan-approval" && approvedForRun
            ? { approved: true, reason: "plan approved by user in web UI" }
            : { approved: false, reason: "requires interactive approval in the CLI" },
      });

      sendJson(res, 200, { runId: result.runId, status: "completed", result });
      return;
    } catch (e) {
      if (e instanceof BadRequestError) throw e;
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/neutron/memory") {
    try {
      const wf = createNeutronWorkflow({ root: opts.root });
      const memory = wf.memory();
      sendJson(res, 200, { memory });
      return;
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/neutron/what-breaks") {
    try {
      const store = new NeutronStore(opts.root);
      const state = store.load();
      if (!state.graph) { sendJson(res, 404, { ok: false, error: "No impact graph available. Run analysis first." }); return; }
      sendJson(res, 200, { graph: state.graph, explanation: formatImpactGraph(state.graph) });
      return;
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/providers") {
    sendJson(res, 200, {
      ok: true,
      providers: listCatalog().map((e) => ({
        id: e.id,
        displayName: e.displayName,
        description: e.description,
        baseUrl: e.baseUrl,
        defaultModels: defaultModelsFor(e.id),
      })),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/neutron/repositories") {
    try {
      const store = new NeutronStore(opts.root);
      const state = store.load();
      const repos = state.repositories || [opts.root.split(/[\\/]/).pop() || 'local'];
      sendJson(res, 200, { repositories: repos });
      return;
    } catch (e) {
      sendJson(res, 200, { repositories: ['local'] });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/neutron/runs") {
    try {
      const archive = new RunArchive(opts.root);
      sendJson(res, 200, { runs: archive.list() });
      return;
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/neutron/runs/")) {
    try {
      let id = "";
      try {
        id = decodeURIComponent(url.pathname.slice("/api/neutron/runs/".length));
      } catch {
        /* malformed escape -> 404 below */
      }
      if (!id || id.includes("/") || !SESSION_ID_RE.test(id)) {
        sendJson(res, 404, { ok: false, error: "Not found" });
        return;
      }
      const archive = new RunArchive(opts.root);
      const run = archive.load(id);
      if (!run) {
        sendJson(res, 404, { ok: false, error: "Run not found" });
        return;
      }
      sendJson(res, 200, { run });
      return;
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/neutron/bob/activity") {    try {
      const { collectBobActivity } = await import("../neutron/bob");
      const activity = collectBobActivity(opts.root);
      sendJson(res, 200, { ...activity, recent: activity.sessions?.slice(-5) || [] });
      return;
    } catch (e) {
      sendJson(res, 500, { ok: false, error: `Unable to read Bob activity: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
  }

  // Stateless chat completion for the /app Chat view. Works on the Node
  // server AND on Vercel (see api-src/chat.ts). The request key (x-api-key
  // header or apiKey body field) wins; otherwise the server's configured
  // providers are used. Conversation history is kept client-side — nothing
  // is stored here. Without any provider, the error is honest, never faked.
  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const body = (await readJsonBody(req)) as {
        action?: unknown;
        q?: unknown;
        messages?: Array<{ role?: string; content?: unknown }>;
        model?: string;
        provider?: string;
        apiKey?: string;
        attachments?: unknown;
        projectContext?: unknown;
        maxTokens?: unknown;
      };
      /* Music search action: the Music section's server-side search.
         Mirrors the Vercel api/chat behavior below; handled on /api/chat
         (not a new route) for the same reason. */
      if (body.action === "music-search") {
        try {
          const results = await searchMusic(typeof body.q === "string" ? body.q : "");
          sendJson(res, 200, { ok: true, results });
        } catch (err) {
          sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      const apiKey = extractRequestKey(req, body);
      const providerId = extractRequestProvider(req, body);
      const messages: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => m && typeof m.content === "string" && (m.content as string).trim())
        .slice(-20)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
          content: (m.content as string).slice(0, 8000),
        }));
      if (!messages.some((m) => m.role === "user") && !hasChatAttachments(body)) {
        sendJson(res, 400, { ok: false, error: "No user message provided" });
        return;
      }
      // Teach the model the file-artifact convention (short, fixed nudge).
      // An optional client-supplied PROJECT MEMORY block is appended to the
      // same system message so the artifact convention always survives.
      if (!messages.some((m) => m.role === "system")) {
        let system = ARTIFACT_SYSTEM_NUDGE;
        if (typeof body.projectContext === "string" && body.projectContext.trim()) {
          system += "\n\n" + body.projectContext.slice(0, 6000);
        }
        messages.unshift({ role: "system", content: system });
      }
      // Attachments: validated + merged into the last user message here.
      // AttachmentError -> honest 400 (names/sizes only, never contents).
      let outgoing: ChatMessage[];
      try {
        outgoing = applyAttachmentsToMessages(messages, body.attachments).messages;
      } catch (err) {
        if (err instanceof AttachmentError) {
          sendJson(res, err.status, { ok: false, error: err.message });
          return;
        }
        throw err;
      }
      const config = configForRequest(apiKey, providerId);
      const api = new ApiSystem({ config, logger: silentLogger });
      try {
        const chatOpts: { model?: string; provider?: string; maxTokens?: number } = {};
        if (body.model) chatOpts.model = body.model;
        if (providerId) chatOpts.provider = providerId;
        /* Cost control: client-supplied max output tokens, sanity-capped. */
        if (typeof body.maxTokens === "number" && isFinite(body.maxTokens) && body.maxTokens > 0) {
          chatOpts.maxTokens = Math.min(Math.floor(body.maxTokens), 128000);
        }
        const reply = await api.chat("general", outgoing, chatOpts);
        const parsed = extractArtifacts(reply.text);
        sendJson(res, 200, {
          ok: true,
          text: parsed.text,
          artifacts: parsed.artifacts,
          provider: reply.provider,
          model: reply.model,
          /* Token usage is provider-reported; absent when the provider
             does not report it — the client shows "not reported" honestly. */
          usage:
            reply.inputTokens != null || reply.outputTokens != null
              ? {
                  input_tokens: reply.inputTokens ?? null,
                  output_tokens: reply.outputTokens ?? null,
                }
              : undefined,
        });
      } catch (err) {
        sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    } catch (e) {
      if (e instanceof BadRequestError) throw e;
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  // NEUTRON web demo (hackathon): guided maintenance workflow UI at /demo.
  // Served alongside the existing dashboard at / — nothing existing moves.
  if (req.method === "GET" && url.pathname === "/demo") {
    const webDir = resolveWebDir();
    const demoIndex = webDir ? join(webDir, "demo", "index.html") : "";
    if (demoIndex && existsSync(demoIndex)) {
      sendHtml(res, readFileSync(demoIndex, "utf8"));
      return;
    }
    sendJson(res, 404, { ok: false, error: "Demo UI not found. Rebuild with `npm run build`." });
    return;
  }

  // NEUTRON app: full product SPA (dashboard, maintain, repos, reports, chat).
  // Served alongside /demo and the existing dashboard at / — nothing existing moves.
  if (req.method === "GET" && url.pathname === "/app") {
    const webDir = resolveWebDir();
    const appIndex = webDir ? join(webDir, "app", "index.html") : "";
    if (appIndex && existsSync(appIndex)) {
      sendHtml(res, readFileSync(appIndex, "utf8"));
      return;
    }
    sendJson(res, 404, { ok: false, error: "NEUTRON app not found. Rebuild with `npm run build`." });
    return;
  }

  // APK download page (also served statically from /download on Vercel).
  if (req.method === "GET" && url.pathname === "/download") {
    const webDir = resolveWebDir();
    const dlIndex = webDir ? join(webDir, "download", "index.html") : "";
    if (dlIndex && existsSync(dlIndex)) {
      sendHtml(res, readFileSync(dlIndex, "utf8"));
      return;
    }
    sendJson(res, 404, { ok: false, error: "Download page not found. Rebuild with `npm run build`." });
    return;
  }

  if (url.pathname.startsWith("/api/demo/")) {
    await handleDemoApi(getDemoManager(opts.demoWorkspace), req, res, url);
    return;
  }

  /* Checkpoints (Node server only — snapshots live in the server workspace,
     which serverless hosting doesn't have). */
  if (url.pathname === "/api/checkpoints" || url.pathname.startsWith("/api/checkpoints/")) {
    await handleCheckpointsApi(getAgentManager(opts.demoWorkspace).workspace, req, res, url);
    return;
  }

  /* Git workspace (Node server only — git repos live in the server workspace,
     which serverless hosting doesn't have). */
  if (url.pathname === "/api/git" || url.pathname.startsWith("/api/git/")) {
    await handleGitApi(getAgentManager(opts.demoWorkspace).workspace, req, res, url);
    return;
  }

  /* Workspace file-name listing for the universal search palette (Node
     server only — no persistent workspace on serverless). Aggregates the
     existing per-repo file lister across all workspace repos; returns only
     relative paths, never absolute server paths. Bounded output. */
  if (req.method === "GET" && url.pathname === "/api/workspace/files") {
    const workspace = getAgentManager(opts.demoWorkspace).workspace;
    const repos = listWorkspaceRepos(workspace);
    const files: Array<{ repo: string; path: string }> = [];
    let truncated = false;
    for (const r of repos) {
      const listing = listRepoFiles(workspace, r.name);
      for (const p of listing.files) {
        if (files.length >= 3000) { truncated = true; break; }
        files.push({ repo: r.name, path: p });
      }
      if (truncated) break;
      if (listing.truncated) truncated = true;
    }
    sendJson(res, 200, { ok: true, files, truncated });
    return;
  }

  /* Project intelligence: security / dependency scans (Node server only —
     workspace access + process execution, which serverless hosting lacks). */
  if (url.pathname === "/api/insights" || url.pathname.startsWith("/api/insights/")) {
    await handleInsightsApi(getAgentManager(opts.demoWorkspace).workspace, req, res, url);
    return;
  }

  /* Autonomous AI agent (Node server only — serverless has no workspace or
     process execution). The request key (x-api-key header or apiKey body
     field) is passed to the run in memory only, never stored. */
  if (url.pathname.startsWith("/api/agent/")) {
    await handleAgentApi(getAgentManager(opts.demoWorkspace), req, res, url);
    return;
  }

  /* Accounts: login (guest / email / Google), profiles, connections.
     Node server only — needs a writable user store, which serverless lacks. */
  if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/") ||
      url.pathname === "/api/connections" || url.pathname.startsWith("/api/connections/")) {
    await handleAuthApi(opts.demoWorkspace, req, res, url);
    return;
  }

  /* Terminal sessions + Test Lab (Node server only — process execution,
     which serverless hosting doesn't have). */
  if (url.pathname === "/api/terminal" || url.pathname.startsWith("/api/terminal/")) {
    await handleTerminalApi(getAgentManager(opts.demoWorkspace).workspace, req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/src/web/")) {
    const webDir = resolveWebDir();
    let rel = "";
    try {
      rel = decodeURIComponent(url.pathname.slice("/src/web/".length));
    } catch {
      /* malformed escape -> 404 below */
    }
    if (webDir && serveWebFile(res, webDir, rel)) return;
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  /* Static assets under /app/ (manifest, icons) — the /app SPA entry above
     only serves index.html; this covers everything else inside dist/web/app. */
  if (req.method === "GET" && url.pathname.startsWith("/app/")) {
    const webDir = resolveWebDir();
    let rel = "";
    try {
      rel = decodeURIComponent("app/" + url.pathname.slice("/app/".length));
    } catch {
      /* malformed escape -> 404 below */
    }
    if (webDir && serveWebFile(res, webDir, rel)) return;
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/stream") {
    const body = (await readJsonBody(req)) as {
      message?: string;
      sessionId?: string;
      model?: string;
      provider?: string;
      agent?: string;
    };
    if (!body.message || typeof body.message !== "string") {
      sendJson(res, 400, { ok: false, error: "Missing required field: message" });
      return;
    }
    if (body.sessionId !== undefined) parseSessionId(body.sessionId);
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    const write = (event: unknown) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const config = configForRequest(extractRequestKey(req, body), extractRequestProvider(req, body));
      const api = new ApiSystem({ config, logger: silentLogger });
      const agents = loadAgents(opts.root);
      const agentConfig = body.agent ? findAgent(agents, body.agent) : undefined;
      let session: ChatSession | undefined = body.sessionId ? sessions.load(body.sessionId) : undefined;
      if (!session) session = sessions.create(body.message.slice(0, 60));
      let finalText = "";
      const agent = new ChatAgent({
        root: opts.root,
        api,
        agents,
        ...(agentConfig ? { agent: agentConfig } : {}),
        ...(body.model ? { model: body.model } : {}),
        ...(body.provider ? { provider: body.provider } : {}),
        stream: true,
        autoApprove: false,
        formatOnWrite: false,
        onEvent: (event) => {
          if (event.type === "assistant") finalText = event.text;
          write(event);
        },
      });
      const text = await agent.send(session, body.message);
      sessions.save(session);
      write({ type: "done", sessionId: session.id, text: text || finalText });
    } catch (err) {
      write({ type: "done", error: err instanceof Error ? err.message : String(err) });
    }
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat") {
    const body = (await readJsonBody(req)) as {
      message?: string;
      sessionId?: string;
      model?: string;
      provider?: string;
      agent?: string;
    };
    if (!body.message || typeof body.message !== "string") {
      sendJson(res, 400, { ok: false, error: "Missing required field: message" });
      return;
    }
    if (body.sessionId !== undefined) parseSessionId(body.sessionId);
    const config = configForRequest(extractRequestKey(req, body), extractRequestProvider(req, body));
    const api = new ApiSystem({ config, logger: silentLogger });
    const agents = loadAgents(opts.root);
    const agentConfig = body.agent ? findAgent(agents, body.agent) : undefined;
    let session: ChatSession | undefined = body.sessionId ? sessions.load(body.sessionId) : undefined;
    if (!session) session = sessions.create(body.message.slice(0, 60));
    const agent = new ChatAgent({
      root: opts.root,
      api,
      agents,
      ...(agentConfig ? { agent: agentConfig } : {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.provider ? { provider: body.provider } : {}),
      stream: false,
      autoApprove: false,
      formatOnWrite: false,
    });
    const text = await agent.send(session, body.message);
    sessions.save(session);
    sendJson(res, 200, { ok: true, text, sessionId: session.id });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = (await readJsonBody(req)) as {
      messages?: { role?: string; content?: string }[];
      model?: string;
    };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || typeof lastUser.content !== "string") {
      sendJson(res, 400, { error: { message: "No user message provided", type: "invalid_request_error" } });
      return;
    }
    try {
      const config = configForRequest(extractRequestKey(req, body), extractRequestProvider(req, body));
      const api = new ApiSystem({ config, logger: silentLogger });
      const session = sessions.create(lastUser.content.slice(0, 60));
      const agent = new ChatAgent({
        root: opts.root,
        api,
        ...(body.model ? { model: body.model } : {}),
        stream: false,
        autoApprove: false,
        formatOnWrite: false,
      });
      const text = await agent.send(session, lastUser.content);
      sessions.save(session);
      sendJson(res, 200, {
        id: `chatcmpl-${session.id}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "neutron",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    } catch (err) {
      sendJson(res, 502, { error: { message: err instanceof Error ? err.message : String(err), type: "upstream_error" } });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${url.pathname}` });
}

/**
 * Build the ICE server list advertised to collaboration voice clients.
 *
 * - STUN: NEUTRON_STUN_URL if set (clients also always try Google's public
 *   STUN as a fallback, so voice works out of the box for most NATs).
 * - TURN: NEUTRON_TURN_URL (+ optional NEUTRON_TURN_USERNAME /
 *   NEUTRON_TURN_CREDENTIAL) for restrictive NATs/firewalls.
 *
 * The list is only ever sent inside the JOINED message to validated room
 * members — never on a public endpoint, never logged. For production, prefer
 * short-lived TURN credentials (TURN REST API); static env credentials are
 * the honest simple default.
 */
export function collabIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [];
  const stun = (process.env.NEUTRON_STUN_URL || "").trim();
  if (stun) servers.push({ urls: [stun] });
  const turnUrl = (process.env.NEUTRON_TURN_URL || "").trim();
  if (turnUrl) {
    const entry: IceServerConfig = { urls: [turnUrl] };
    const username = (process.env.NEUTRON_TURN_USERNAME || "").trim();
    const credential = (process.env.NEUTRON_TURN_CREDENTIAL || "").trim();
    if (username) entry.username = username;
    if (credential) entry.credential = credential;
    servers.push(entry);
  }
  return servers;
}

export function startServer(opts: ServeOptions): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const collabManager = opts.collabManager ?? new RoomManager(opts.root);
    try {
      collabManager.load();
    } catch {
      /* A corrupt snapshot must never prevent boot; start with no rooms. */
    }
    const server = createServer(createRequestHandler({ ...opts, collabManager }));
    const collab = new CollabServer({
      manager: collabManager,
      dataRoot: opts.root,
      iceServers: collabIceServers(),
      log: process.env.NEUTRON_COLLAB_DEBUG ? (m) => console.log(`[collab] ${m}`) : undefined,
    });
    collab.attach(server);
    server.on("error", reject);
    server.listen(opts.port, opts.host ?? "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : opts.port;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((done) => {
            // Terminate collab sockets first: upgraded WebSocket connections
            // would otherwise keep server.close() hanging.
            try {
              collab.close();
            } catch {
              /* ignore */
            }
            server.close(() => done());
          }),
      });
    });
  });
}
