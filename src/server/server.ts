import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadConfig } from "../config";
import { ApiSystem } from "../api/api-manager";
import { ChatAgent } from "../chat/agent";
import { SessionStore, type ChatSession } from "../chat/session";
import { findAgent, loadAgents } from "../chat/agent-config";
import { getVersion } from "../version";
import { createNeutronWorkflow, runFullWorkflow, type NeutronWorkflowOptions, type NeutronResult } from "../neutron/workflow";
import { NeutronStore } from "../neutron/store";
import { analyzeRepository } from "../neutron/analyzer";
import { analyzeImpact } from "../neutron/impact";
import { buildPlan } from "../neutron/planner";
import { formatImpactGraph } from "../neutron/impact";
import type { RepoAnalysis, ImpactGraph, NeutronPlan, MaintenanceRequest } from "../neutron/model";
import { existsSync, readFileSync, createReadStream } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
  ".svg": "image/svg+xml",
  ".png": "image/png",
};


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
        reject(new BadRequestError("Request body too large"));
        req.destroy();
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

export function createRequestHandler(opts: ServeOptions): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handle(opts, req, res).catch((err) => {
      if (err instanceof BadRequestError) {
        sendJson(res, 400, { ok: false, error: err.message });
        return;
      }
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  };
}

async function handle(opts: ServeOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      "access-control-allow-headers": "content-type,authorization",
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

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, version: getVersion(), agents: loadAgents(opts.root).map((a) => a.name) });
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
      const config = loadConfig();
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

  if (req.method === "GET" && url.pathname === "/api/neutron/bob/activity") {
    try {
      const { collectBobActivity } = await import("../neutron/bob");
      const activity = collectBobActivity(opts.root);
      sendJson(res, 200, { ...activity, recent: activity.sessions?.slice(-5) || [] });
      return;
    } catch (e) {
      sendJson(res, 500, { ok: false, error: `Unable to read Bob activity: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/src/web/")) {
    const webDir = resolveWebDir();
    let rel = "";
    try {
      rel = decodeURIComponent(url.pathname.slice("/src/web/".length));
    } catch {
      /* malformed escape -> 404 below */
    }
    const filePath = webDir && rel ? normalize(join(webDir, rel)) : "";
    // Containment: never serve anything outside the dashboard directory.
    if (webDir && filePath.startsWith(webDir + sep) && existsSync(filePath)) {
      res.writeHead(200, { "content-type": WEB_MIME[extname(filePath)] ?? "text/plain; charset=utf-8" });
      const stream = createReadStream(filePath);
      stream.on("error", (err) => {
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: `Failed to read file: ${err.message}` });
        else res.destroy();
      });
      stream.pipe(res);
      return;
    }
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
      const config = loadConfig();
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
    const config = loadConfig();
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
      const config = loadConfig();
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

export function startServer(opts: ServeOptions): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = createServer(createRequestHandler(opts));
    server.on("error", reject);
    server.listen(opts.port, opts.host ?? "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : opts.port;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
