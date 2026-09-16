import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadConfig } from "../config";
import { ApiSystem } from "../api/api-manager";
import { ChatAgent } from "../chat/agent";
import { SessionStore, type ChatSession } from "../chat/session";
import { findAgent, loadAgents } from "../chat/agent-config";
import { getVersion } from "../version";

export interface ServeOptions {
  root: string;
  port: number;
  host?: string;
  password?: string;
  username?: string;
  web?: boolean;
}

const WEB_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>sunny</title>
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
  <h1>sunny<span>.</span></h1>
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
  <form id="f"><input id="m" placeholder="Ask sunny..." autocomplete="off" autofocus /><button id="send">Send</button></form>
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

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 5_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

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
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  };
}

async function handle(opts: ServeOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (opts.password) {
    const header = req.headers.authorization ?? "";
    const expected =
      "Basic " + Buffer.from(`${opts.username ?? "sunny"}:${opts.password}`).toString("base64");
    if (header !== expected) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="sunny"' });
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

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/ui") && opts.web) {
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
    const id = decodeURIComponent(url.pathname.slice("/v1/sessions/".length));
    const session = sessions.load(id);
    if (!session) {
      sendJson(res, 404, { ok: false, error: "Session not found" });
      return;
    }
    sendJson(res, 200, { session });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/stream") {
    const body = (await readBody(req)) as {
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
    const body = (await readBody(req)) as {
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
    const body = (await readBody(req)) as {
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
        model: body.model ?? "sunny",
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
