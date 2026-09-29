/* ==========================================================================
   NEUTRON app — vanilla JS SPA (no build step).
   All dynamic text is set via textContent (never innerHTML with server data).

   ONE backend surface: /api/demo/* + /api/health + /api/chat. These routes
   exist on BOTH the persistent Node server and the Vercel serverless
   deployment, so this exact UI works everywhere (browser, APK wrapper).

   BYOK: a provider API key saved in Settings lives in localStorage and
   is sent as the `x-api-key` header with every request. It is never stored
   on the server — each request builds a request-scoped provider config.
   There is NO default provider: the user must pick one explicitly in
   Settings (sent as the `x-provider` header); chat refuses to send until
   a provider is chosen.

   DEVELOPER MODE (Settings): optional backend URL override
   (localStorage neutron_backend_url; empty = same-origin), a client-side
   API inspector (last 50 calls, secrets redacted), and verbose logging.
   ========================================================================== */
"use strict";

/* ---------- helpers ---------- */

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ----- BYOK key storage (localStorage only, never sent anywhere except
   as the x-api-key header on the user's own requests) ----- */
var API_KEY_STORAGE = "neutron_api_key";
var PROVIDER_STORAGE = "neutron_provider";
var MODEL_STORAGE = "neutron_model";
var JOB_HISTORY_STORAGE = "neutron_jobs";
var BACKEND_URL_STORAGE = "neutron_backend_url";
var VERBOSE_STORAGE = "neutron_verbose";

function storedApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ""; } catch (e) { return ""; }
}
function setStoredApiKey(k) {
  try { localStorage.setItem(API_KEY_STORAGE, k); } catch (e) { /* private mode */ }
}
function clearStoredApiKey() {
  try { localStorage.removeItem(API_KEY_STORAGE); } catch (e) { /* private mode */ }
}
function storedProvider() {
  try { return localStorage.getItem(PROVIDER_STORAGE) || ""; } catch (e) { return ""; }
}
function setStoredProvider(id) {
  try {
    if (id) localStorage.setItem(PROVIDER_STORAGE, id);
    else localStorage.removeItem(PROVIDER_STORAGE);
  } catch (e) { /* private mode */ }
}
function storedModel() {
  try { return localStorage.getItem(MODEL_STORAGE) || ""; } catch (e) { return ""; }
}
function setStoredModel(m) {
  try {
    if (m) localStorage.setItem(MODEL_STORAGE, m);
    else localStorage.removeItem(MODEL_STORAGE);
  } catch (e) { /* private mode */ }
}
/* ----- Developer Mode storage (all client-side) ----- */
function storedBackendUrl() {
  try { return (localStorage.getItem(BACKEND_URL_STORAGE) || "").trim(); } catch (e) { return ""; }
}
function setStoredBackendUrl(u) {
  try {
    if (u) localStorage.setItem(BACKEND_URL_STORAGE, u);
    else localStorage.removeItem(BACKEND_URL_STORAGE);
  } catch (e) { /* private mode */ }
}
/** The base every api() call is made against. Empty = same-origin (automatic). */
function backendBase() {
  return storedBackendUrl().replace(/\/+$/, "");
}
function isVerbose() {
  try { return localStorage.getItem(VERBOSE_STORAGE) === "1"; } catch (e) { return false; }
}
function setVerbose(on) {
  try { localStorage.setItem(VERBOSE_STORAGE, on ? "1" : "0"); } catch (e) { /* private mode */ }
}
function jobHistory() {
  try { return JSON.parse(localStorage.getItem(JOB_HISTORY_STORAGE) || "[]"); }
  catch (e) { return []; }
}
function recordJob(entry) {
  try {
    var h = jobHistory();
    h.unshift(entry);
    localStorage.setItem(JOB_HISTORY_STORAGE, JSON.stringify(h.slice(0, 50)));
  } catch (e) { /* private mode */ }
}

/* ----- API inspector: ring buffer of the last 50 calls (client-side only).
   Secrets are redacted before anything is stored for display. ----- */
var API_LOG = [];
var API_LOG_MAX = 50;

function redactSecrets(s) {
  return String(s)
    .replace(/("apiKey"\s*:\s*")[^"]*(")/g, "$1***$2")
    .replace(/("x-api-key"\s*:\s*")[^"]*(")/g, "$1***$2");
}

function pushApiLog(entry) {
  API_LOG.unshift(entry);
  if (API_LOG.length > API_LOG_MAX) API_LOG.length = API_LOG_MAX;
}

/** Recent API calls, newest first. Used by the Developer Mode inspector. */
function apiLog() { return API_LOG.slice(); }

async function api(method, path, body) {
  var base = backendBase();
  var url = base + path;
  var t0 = Date.now();
  var opts = { method: method, headers: { "content-type": "application/json" } };
  var key = storedApiKey();
  if (key) opts.headers["x-api-key"] = key;
  /* No default provider: only send the header when the user chose one. */
  var prov = storedProvider();
  if (prov) opts.headers["x-provider"] = prov;
  if (body !== undefined) opts.body = JSON.stringify(body);

  var entry = { method: method, path: path, url: url, ts: new Date().toISOString(), status: 0, ms: 0 };
  if (body !== undefined) entry.request = redactSecrets(JSON.stringify(body)).slice(0, 4000);

  function finish() {
    entry.ms = Date.now() - t0;
    pushApiLog(entry);
    if (isVerbose()) {
      try { console.log("[neutron api]", method, url, entry.status || "ERR", entry.ms + "ms"); }
      catch (e) { /* console unavailable */ }
    }
  }

  var res, text = "", json = {};
  try {
    res = await fetch(url, opts);
    text = await res.text();
    try { json = text ? JSON.parse(text) : {}; } catch (e) { json = {}; }
  } catch (e) {
    entry.error = String((e && e.message) || e).slice(0, 500);
    finish();
    throw e;
  }
  entry.status = res.status;
  entry.response = redactSecrets(text).slice(0, 4000);
  finish();
  if (!res.ok || json.ok === false) {
    var err = new Error(json.error || ("HTTP " + res.status));
    err.status = res.status;
    err.requiresApproval = !!json.requiresApproval;
    throw err;
  }
  return json;
}

function showError(msg) {
  var bar = document.getElementById("error-bar");
  bar.textContent = msg;
  bar.classList.remove("hidden");
}

function clearError() {
  var bar = document.getElementById("error-bar");
  bar.textContent = "";
  bar.classList.add("hidden");
}

function kvGrid(pairs) {
  var g = el("div", "kv-grid");
  pairs.forEach(function (p) {
    var cell = el("div", "kv");
    cell.appendChild(el("div", "k", p[0]));
    cell.appendChild(el("div", "v", p[1]));
    g.appendChild(cell);
  });
  return g;
}

function table(headers, rows) {
  var t = el("table", "tbl");
  var thead = el("thead");
  var hr = el("tr");
  headers.forEach(function (h) { hr.appendChild(el("th", null, h)); });
  thead.appendChild(hr);
  t.appendChild(thead);
  var tb = el("tbody");
  rows.forEach(function (r) {
    var tr = el("tr");
    r.forEach(function (c) {
      var td = el("td", c.mono ? "mono" : null, c.text);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}

function cell(text, mono) { return { text: text, mono: !!mono }; }

function notice(kind, text) {
  return el("div", "notice" + (kind ? " " + kind : ""), text);
}

function dump(title, obj) {
  var d = el("details", "dump");
  d.appendChild(el("summary", null, title));
  var pre = el("pre", null, JSON.stringify(obj, null, 2).slice(0, 20000));
  d.appendChild(pre);
  return d;
}

function field(label, inputEl) {
  var lab = el("label", "field");
  lab.appendChild(el("span", null, label));
  lab.appendChild(inputEl);
  return lab;
}

function selectInput(options, value) {
  var s = el("select", "input");
  options.forEach(function (o) {
    var opt = el("option", null, o.label);
    opt.value = o.value;
    if (o.value === value) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}

function chips(parent, items) {
  var c = el("div", "chips");
  (items || []).forEach(function (x) { c.appendChild(el("span", "chip", x)); });
  if (!items || !items.length) c.appendChild(el("span", "muted small", "none detected"));
  parent.appendChild(c);
}

/* ---------- server status ---------- */

async function refreshServerPill() {
  var pill = document.getElementById("server-pill");
  try {
    var h = await api("GET", "/api/health");
    pill.textContent = "ONLINE · v" + (h.version || "?");
    pill.className = "pill ok";
  } catch (e) {
    pill.textContent = "OFFLINE";
    pill.className = "pill bad";
  }
}

/* ---------- router ---------- */

var ROUTES = {
  dashboard: renderDashboard,
  maintain: renderMaintain,
  repos: renderRepos,
  reports: renderReports,
  chat: renderChat,
  settings: renderSettings,
};

function currentRoute() {
  var h = (location.hash || "").replace(/^#\/?/, "").split("/")[0];
  return ROUTES[h] ? h : "dashboard";
}

async function render() {
  clearError();
  var route = currentRoute();
  document.querySelectorAll(".sidebar a[data-route]").forEach(function (a) {
    a.classList.toggle("active", a.getAttribute("data-route") === route);
  });
  var view = document.getElementById("view");
  view.innerHTML = "";
  try {
    await ROUTES[route](view);
  } catch (e) {
    showError(e && e.message ? e.message : String(e));
  }
  refreshServerPill();
}

window.addEventListener("hashchange", render);

/* ---------- dashboard ---------- */

async function renderDashboard(view) {
  view.appendChild(el("h1", null, "Dashboard"));

  var results = await Promise.allSettled([
    api("GET", "/api/health"),
    api("GET", "/api/demo/status"),
  ]);
  var health = results[0].status === "fulfilled" ? results[0].value : null;
  var demo = results[1].status === "fulfilled" ? results[1].value : null;
  var keySet = !!storedApiKey();

  var stats = el("div", "grid cols-3");
  function statCard(title, big, sub) {
    var p = el("section", "panel");
    p.appendChild(el("h2", null, title));
    p.appendChild(el("div", "stat-num", big));
    if (sub) p.appendChild(el("div", "muted small", sub));
    return p;
  }
  stats.appendChild(statCard("Server", health ? "ONLINE" : "OFFLINE",
    health ? "v" + health.version : "could not reach /api/health"));
  stats.appendChild(statCard("Demo repository", demo ? demo.demoRepository : "—",
    demo ? demo.demoDescription : "could not reach /api/demo/status"));
  stats.appendChild(statCard("API key", keySet ? "SET" : "NOT SET",
    keySet ? "sent with your requests only" : "add one in Settings"));
  view.appendChild(stats);

  var mid = el("div", "grid cols-2");

  var llm = el("section", "panel");
  llm.appendChild(el("h2", null, "LLM provider"));
  if (demo) {
    llm.appendChild(el("p", null, demo.providerConfigured ? "CONFIGURED" : "NOT CONFIGURED"));
    llm.appendChild(el("p", "muted small", demo.llmNote || ""));
  } else {
    llm.appendChild(el("p", "muted", "Status unavailable."));
  }
  mid.appendChild(llm);

  var how = el("section", "panel");
  how.appendChild(el("h2", null, "How NEUTRON works"));
  var ol = el("ol", "small");
  ["Understand the repository", "Analyze impact", "Build an explicit plan",
   "Human approves the plan", "Execute the change", "Run tests",
   "Security review", "Final report"].forEach(function (s) {
    ol.appendChild(el("li", null, s));
  });
  how.appendChild(ol);
  mid.appendChild(how);
  view.appendChild(mid);

  var actions = el("section", "panel");
  actions.appendChild(el("h2", null, "Quick actions"));
  var row = el("div", "row");
  [["Start maintenance", "#/maintain", "primary"], ["Open chat", "#/chat", ""],
   ["Settings", "#/settings", ""], ["Guided demo", "/demo", "ghost"]].forEach(function (a) {
    var b = el("a", "btn " + a[2], a[0]);
    b.href = a[1];
    row.appendChild(b);
  });
  actions.appendChild(row);
  actions.appendChild(el("p", "muted small",
    "Analysis, impact, and planning run without a key. Live execution and chat use your Settings API key when set (sent as x-api-key, never stored on the server); otherwise they report honestly that no provider is configured."));
  view.appendChild(actions);
}

/* ---------- repositories ---------- */

async function renderRepos(view) {
  view.appendChild(el("h1", null, "Repositories"));
  var st = await api("GET", "/api/demo/status");

  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Demo repository"));
  p.appendChild(kvGrid([
    ["Name", st.demoRepository],
    ["Description", st.demoDescription],
    ["Workspace ready", st.workspaceReady ? "yes" : "no"],
    ["Cloning", st.cloneEnabled ? "enabled" : "disabled"],
  ]));
  p.appendChild(el("p", "muted small",
    "The demo repository is a small scaffolded project the real pipeline analyzes in milliseconds. You can also clone any public GitHub repository and maintain it the same way."));
  view.appendChild(p);

  var c = el("section", "panel");
  c.appendChild(el("h2", null, "Clone a repository"));
  var urlIn = el("input", "input");
  urlIn.placeholder = "https://github.com/owner/repo";
  urlIn.setAttribute("aria-label", "Repository URL");
  c.appendChild(field("PUBLIC GIT URL", urlIn));
  var row = el("div", "row");
  var go = el("button", "btn primary", "Clone");
  go.onclick = async function () {
    var url = urlIn.value.trim();
    if (!url) { showError("Enter a repository URL first."); return; }
    clearError();
    go.disabled = true; go.textContent = "Cloning…";
    try {
      var r = await api("POST", "/api/demo/clone", { url: url });
      c.appendChild(notice("", "Cloned as \"" + r.repository + "\". Use that name as the repository in Maintain."));
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    }
    go.disabled = false; go.textContent = "Clone";
  };
  row.appendChild(go);
  c.appendChild(row);
  view.appendChild(c);
}

/* ---------- maintain wizard (on /api/demo/*) ---------- */

var WIZARD_STEPS = ["REQUEST", "ANALYSIS", "IMPACT", "PLAN", "APPROVAL", "EXECUTE", "RESULT"];

var mz = null; // wizard state, reset on each entry to #/maintain

function stepsBar(current) {
  var bar = el("div", "steps");
  WIZARD_STEPS.forEach(function (s) {
    var cls = "step";
    var idx = WIZARD_STEPS.indexOf(s), cur = WIZARD_STEPS.indexOf(current);
    if (idx < cur) cls += " done";
    if (idx === cur) cls += " current";
    bar.appendChild(el("div", cls, (idx < cur ? "✓ " : "") + s));
  });
  return bar;
}

async function renderMaintain(view) {
  mz = {
    step: "REQUEST",
    form: { repo: "demo", request: "", riskTolerance: "balanced" },
    analysisId: null, approvalToken: null,
    analysis: null, impact: null, plan: null,
    approved: false, rejected: false,
    jobId: null, job: null, result: null, unsupported: null,
  };
  view.appendChild(el("h1", null, "Maintain"));
  var body = el("div", null);
  view.appendChild(body);
  await maintainRender(body);
}

async function maintainRender(body) {
  body.innerHTML = "";
  body.appendChild(stepsBar(mz.step));
  var fn = {
    REQUEST: mzRequest, ANALYSIS: mzAnalysis, IMPACT: mzImpact, PLAN: mzPlan,
    APPROVAL: mzApproval, EXECUTE: mzExecute, RESULT: mzResult,
  }[mz.step];
  try {
    await fn(body);
  } catch (e) {
    showError(e && e.message ? e.message : String(e));
  }
}

function mzStartOver(body) {
  var row = el("div", "row");
  var b = el("button", "btn ghost", "Start over");
  b.onclick = function () { renderMaintain(document.getElementById("view")); };
  row.appendChild(b);
  body.appendChild(row);
}

async function mzRequest(body) {
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "New maintenance request"));

  var repoIn = el("input", "input");
  repoIn.value = mz.form.repo;
  repoIn.placeholder = "demo — or a cloned repo name, or a GitHub URL to clone";
  var reqIn = el("textarea", "input");
  reqIn.placeholder = "e.g. Fix the login redirect loop on the settings page";
  reqIn.value = mz.form.request;
  var riskSel = selectInput(
    [{ label: "safe", value: "safe" }, { label: "balanced", value: "balanced" }, { label: "aggressive", value: "aggressive" }],
    mz.form.riskTolerance);

  p.appendChild(field("REPOSITORY", repoIn));
  p.appendChild(field("MAINTENANCE REQUEST", reqIn));
  p.appendChild(field("RISK TOLERANCE", riskSel));
  p.appendChild(el("p", "muted small",
    "Use \"demo\" for the scaffolded project, a cloned repository name, or paste a public GitHub URL — it will be cloned first. Analysis and planning run now; code only changes after you explicitly approve the plan."));

  var row = el("div", "row");
  var go = el("button", "btn primary", "Analyze repository");
  go.onclick = async function () {
    var repo = repoIn.value.trim() || "demo";
    mz.form.repo = repo;
    mz.form.request = reqIn.value.trim();
    mz.form.riskTolerance = riskSel.value;
    if (!mz.form.request) { showError("Describe the maintenance request first."); return; }
    clearError();
    go.disabled = true; go.textContent = "Analyzing…";
    try {
      if (/^https?:\/\//i.test(repo)) {
        go.textContent = "Cloning…";
        var cl = await api("POST", "/api/demo/clone", { url: repo });
        repo = cl.repository;
        mz.form.repo = repo;
        go.textContent = "Analyzing…";
      }
      var res = await api("POST", "/api/demo/analyze", {
        repo: repo, request: mz.form.request, riskTolerance: mz.form.riskTolerance,
      });
      mz.analysisId = res.analysisId;
      mz.analysis = res.analysis; mz.impact = res.impact; mz.plan = res.plan;
      mz.step = "ANALYSIS";
      await maintainRender(body);
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
      go.disabled = false; go.textContent = "Analyze repository";
    }
  };
  row.appendChild(go);
  p.appendChild(row);
  body.appendChild(p);
}

async function mzAnalysis(body) {
  var a = mz.analysis;
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Repository analysis"));
  p.appendChild(kvGrid([
    ["Analysis ID", (mz.analysisId || "").slice(0, 18) + "…"],
    ["Health", a.health + "%"],
    ["Files analyzed", a.filesAnalyzed],
    ["Nodes", a.nodeCount],
    ["Analyzed at", (a.analyzedAt || "").slice(0, 19).replace("T", " ")],
  ]));
  p.appendChild(el("h3", null, "LANGUAGES")); chips(p, a.languages);
  p.appendChild(el("h3", null, "FRAMEWORKS")); chips(p, a.frameworks);
  p.appendChild(el("h3", null, "PACKAGE MANAGERS")); chips(p, a.packageManagers);
  p.appendChild(el("h3", null, "ENTRY POINTS")); chips(p, a.entryPoints);
  if (a.warnings && a.warnings.length) {
    p.appendChild(el("h3", null, "WARNINGS"));
    var ul = el("ul", "list");
    a.warnings.forEach(function (w) { ul.appendChild(el("li", "warn", w)); });
    p.appendChild(ul);
  }
  var row = el("div", "row");
  var next = el("button", "btn primary", "Continue to impact analysis");
  next.onclick = function () { mz.step = "IMPACT"; maintainRender(body); };
  row.appendChild(next);
  p.appendChild(row);
  body.appendChild(p);
  mzStartOver(body);
}

async function mzImpact(body) {
  var g = mz.impact;
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Impact analysis"));
  p.appendChild(kvGrid(Object.keys(g.summary || {}).map(function (k) { return [k, g.summary[k]]; })));
  if (g.whatCouldBreak && g.whatCouldBreak.length) {
    p.appendChild(el("h3", null, "WHAT COULD BREAK"));
    var ul = el("ul", "list");
    g.whatCouldBreak.forEach(function (w) { ul.appendChild(el("li", "warn", w)); });
    p.appendChild(ul);
  }
  var nodes = (g.nodes || []).slice(0, 40);
  if (nodes.length) {
    p.appendChild(el("h3", null, "IMPACTED NODES (SHOWING " + nodes.length + " OF " + g.nodes.length + ")"));
    p.appendChild(table(["Path", "Category", "Impact", "Confidence"],
      nodes.map(function (n) {
        return [cell(n.path, true), cell(n.category), cell(n.impact),
                cell(Math.round((n.confidence || 0) * 100) + "%")];
      })));
  }
  var row = el("div", "row");
  var next = el("button", "btn primary", "Continue to plan review");
  next.onclick = function () { mz.step = "PLAN"; maintainRender(body); };
  row.appendChild(next);
  p.appendChild(row);
  body.appendChild(p);
  mzStartOver(body);
}

async function mzPlan(body) {
  var plan = mz.plan;
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Maintenance plan — review required"));
  p.appendChild(el("p", null, plan.summary || ""));
  p.appendChild(kvGrid([
    ["Overall risk", plan.overallRisk], ["Tasks", (plan.tasks || []).length],
    ["Affected files", (plan.affectedFiles || []).length],
    ["Database migrations", plan.databaseMigrations],
  ]));
  if (plan.tasks && plan.tasks.length) {
    p.appendChild(el("h3", null, "TASKS"));
    var ul = el("ul", "list");
    plan.tasks.forEach(function (t, i) {
      var li = el("li");
      li.appendChild(el("div", "mono", (i + 1) + ". " + t.label));
      li.appendChild(el("div", "muted small",
        "agent: " + (t.agent || "—") + " · risk: " + (t.risk || "—") +
        ((t.files && t.files.length) ? " · files: " + t.files.slice(0, 4).join(", ") : "")));
      ul.appendChild(li);
    });
    p.appendChild(ul);
  }
  ["affectedFiles", "affectedServices", "affectedTests"].forEach(function (k) {
    if (plan[k] && plan[k].length) {
      p.appendChild(el("h3", null, k.replace(/([A-Z])/g, " $1").toUpperCase()));
      chips(p, plan[k].slice(0, 12));
    }
  });
  var row = el("div", "row");
  var cont = el("button", "btn primary", "Continue to approval gate");
  cont.onclick = function () { mz.step = "APPROVAL"; maintainRender(body); };
  row.appendChild(cont);
  p.appendChild(row);
  body.appendChild(p);
  mzStartOver(body);
}

async function mzApproval(body) {
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Human approval gate"));
  p.appendChild(notice("", "Fail-closed: nothing executes unless you explicitly approve this exact plan. The approval is single-use."));
  p.appendChild(el("p", "mono small", "Request: " + mz.form.request));

  var row = el("div", "row");
  var approveBtn = el("button", "btn primary", "Approve plan");
  var rejectBtn = el("button", "btn danger", "Reject plan");
  approveBtn.onclick = async function () {
    approveBtn.disabled = true; rejectBtn.disabled = true;
    approveBtn.textContent = "Approving…";
    try {
      var r = await api("POST", "/api/demo/approve", { analysisId: mz.analysisId });
      mz.approved = true; mz.rejected = false;
      mz.approvalToken = r.approvalToken || null; // serverless deployments issue a signed token
      mz.step = "EXECUTE";
      await maintainRender(body);
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
      approveBtn.disabled = false; rejectBtn.disabled = false;
      approveBtn.textContent = "Approve plan";
    }
  };
  rejectBtn.onclick = async function () {
    rejectBtn.disabled = true;
    try { await api("POST", "/api/demo/reject", { analysisId: mz.analysisId }); } catch (e) { /* best effort */ }
    mz.approved = false; mz.rejected = true;
    mz.step = "EXECUTE";
    maintainRender(body);
  };
  row.appendChild(approveBtn);
  row.appendChild(rejectBtn);
  p.appendChild(row);
  body.appendChild(p);
  mzStartOver(body);
}

async function mzExecute(body) {
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Execute"));

  if (mz.rejected) {
    p.appendChild(el("div", "rejected-stamp", "PLAN REJECTED"));
    p.appendChild(el("p", null, "The approval gate stays closed. Nothing will be executed."));
    body.appendChild(p);
    mzStartOver(body);
    return;
  }

  p.appendChild(el("div", "approved-stamp", "PLAN APPROVED"));
  p.appendChild(el("p", "muted small",
    "Single-use approval recorded for this exact plan." +
    (storedApiKey() ? " Your saved API key will be sent with the execution request." :
      " No API key is set in Settings — the run will report honestly if no provider is configured.")));

  var row = el("div", "row");
  var go = el("button", "btn primary", "Execute maintenance");
  var live = el("div", null);
  go.onclick = async function () {
    go.disabled = true; go.textContent = "Starting…";
    clearError();
    try {
      var reqBody = { analysisId: mz.analysisId };
      if (mz.approvalToken) reqBody.approvalToken = mz.approvalToken;
      var res = await api("POST", "/api/demo/execute", reqBody);
      if (res.executionUnsupported) {
        // Honest serverless limit — surfaced exactly as the API reports it.
        mz.unsupported = res.message;
        mz.step = "RESULT";
        await maintainRender(body);
        return;
      }
      mz.jobId = res.jobId;
      recordJob({ jobId: res.jobId, request: mz.form.request, repository: res.repository, createdAt: res.createdAt });
      go.textContent = "Running…";
      var job = await pollJob(res.jobId, function (j) { paintLiveJob(live, j); });
      mz.job = job;
      try {
        var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(res.jobId) + "/result");
        mz.result = r.result;
      } catch (e) {
        mz.result = null;
      }
      mz.step = "RESULT";
      await maintainRender(body);
    } catch (e) {
      go.disabled = false; go.textContent = "Execute maintenance";
      showError(e && e.message ? e.message : String(e));
    }
  };
  row.appendChild(go);
  p.appendChild(row);
  p.appendChild(live);
  body.appendChild(p);
  mzStartOver(body);
}

async function pollJob(jobId, onUpdate) {
  for (;;) {
    var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(jobId));
    var job = r.job;
    onUpdate(job);
    if (job.status === "completed" || job.status === "failed" || job.status === "denied") return job;
    await sleep(2500);
  }
}

function paintLiveJob(container, job) {
  container.innerHTML = "";
  container.appendChild(el("h3", null, "LIVE — " + String(job.status).toUpperCase()));
  if (job.stages && job.stages.length) {
    container.appendChild(table(["Stage", "Status", "Detail"],
      job.stages.map(function (s) {
        return [cell(s.label || s.key), cell(s.status), cell((s.detail || "").slice(0, 120))];
      })));
  }
  var tail = (job.events || []).slice(-6);
  if (tail.length) {
    var ul = el("ul", "list");
    tail.forEach(function (ev) { ul.appendChild(el("li", "mono small", ev.message || "")); });
    container.appendChild(ul);
  }
}

async function mzResult(body) {
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Result"));

  if (mz.unsupported) {
    p.appendChild(notice("warn", "EXECUTION NOT AVAILABLE ON THIS SERVER"));
    p.appendChild(el("p", null, mz.unsupported));
    p.appendChild(el("p", "muted small",
      "Everything up to this point — repository analysis, impact analysis, implementation plan, and your approval — ran for real. Full agent execution needs the persistent Node server (it cannot fit serverless function limits)."));
    body.appendChild(p);
    mzStartOver(body);
    return;
  }

  var job = mz.job || {};
  p.appendChild(kvGrid([
    ["Job ID", (mz.jobId || "").slice(0, 20) + "…"],
    ["Status", job.status || "—"],
    ["No-LLM mode", job.noLlm ? "yes — implementation honestly skipped" : "no"],
    ["Finished", (job.finishedAt || "").slice(0, 19).replace("T", " ")],
  ]));
  if (job.error) p.appendChild(el("p", "warn", "Error: " + job.error));
  if (job.stages && job.stages.length) {
    p.appendChild(el("h3", null, "STAGES"));
    p.appendChild(table(["Stage", "Status", "Detail"],
      job.stages.map(function (s) {
        return [cell(s.label || s.key), cell(s.status), cell((s.detail || "").slice(0, 160))];
      })));
  }
  var res = mz.result || {};
  [["Test result", res.testResult], ["Security review", res.security],
   ["Code review", res.codeReview], ["Release gate", res.release]].forEach(function (pair) {
    if (pair[1]) {
      p.appendChild(el("h3", null, pair[0].toUpperCase()));
      p.appendChild(el("p", "small mono", JSON.stringify(pair[1]).slice(0, 600)));
    }
  });
  ["deviations", "errors"].forEach(function (k) {
    if (res[k] && res[k].length) {
      p.appendChild(el("h3", null, k.toUpperCase()));
      var ul = el("ul", "list");
      res[k].forEach(function (x) { ul.appendChild(el("li", "warn", x)); });
      p.appendChild(ul);
    }
  });
  if (mz.result) p.appendChild(dump("FULL RESULT JSON", mz.result));
  body.appendChild(p);
  var row = el("div", "row");
  var rep = el("a", "btn", "Open in Reports");
  rep.href = "#/reports";
  row.appendChild(rep);
  p.appendChild(row);
  mzStartOver(body);
}

/* ---------- reports (local job history; server memory on Node) ---------- */

async function renderReports(view) {
  view.appendChild(el("h1", null, "Reports"));
  var sub = (location.hash.split("/")[1] || "");
  if (sub) { await renderJobDetail(view, sub); return; }

  var runs = jobHistory();
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Past runs (" + runs.length + ")"));
  if (!runs.length) {
    p.appendChild(el("p", "muted", "No runs recorded yet. Run the Maintain flow to create one."));
  } else {
    p.appendChild(table(["Job", "Request", "Repository", "Started"],
      runs.map(function (x) {
        return [cell((x.jobId || "").slice(0, 16) + "…", true),
                cell((x.request || "").slice(0, 50)),
                cell(x.repository || "—"),
                cell((x.createdAt || "").slice(0, 19).replace("T", " "))];
      })));
    var list = el("div", "chips");
    runs.slice(0, 20).forEach(function (x) {
      var a = el("a", "chip", (x.jobId || "").slice(0, 16) + "…");
      a.href = "#/reports/" + encodeURIComponent(x.jobId);
      list.appendChild(a);
    });
    p.appendChild(list);
  }
  p.appendChild(el("p", "muted small",
    "This list lives in this browser. Full job records live in the server's memory on the persistent Node host; on serverless deployments they are honestly unavailable."));
  view.appendChild(p);
}

async function renderJobDetail(view, id) {
  var back = el("a", "btn ghost", "← All reports");
  back.href = "#/reports";
  view.appendChild(back);
  view.appendChild(el("p", null, ""));
  try {
    var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(id));
    var job = r.job;
    view.appendChild(el("h1", "mono", (job.jobId || id).slice(0, 24) + "…"));
    var p = el("section", "panel");
    p.appendChild(el("h2", null, "Job"));
    p.appendChild(kvGrid([
      ["Status", job.status || "—"],
      ["Request", (job.request || "").slice(0, 80)],
      ["Repository", job.repository || "—"],
      ["No-LLM mode", job.noLlm ? "yes" : "no"],
      ["Events", String(job.eventCount != null ? job.eventCount : (job.events || []).length)],
    ]));
    if (job.error) p.appendChild(el("p", "warn", "Error: " + job.error));
    if (job.stages && job.stages.length) {
      p.appendChild(el("h3", null, "STAGES"));
      p.appendChild(table(["Stage", "Status", "Detail"],
        job.stages.map(function (s) {
          return [cell(s.label || s.key), cell(s.status), cell((s.detail || "").slice(0, 160))];
        })));
    }
    view.appendChild(p);
    try {
      var rr = await api("GET", "/api/demo/jobs/" + encodeURIComponent(id) + "/result");
      if (rr.result) {
        var q = el("section", "panel");
        q.appendChild(el("h2", null, "Result"));
        q.appendChild(dump("FULL RESULT JSON", rr.result));
        view.appendChild(q);
      }
    } catch (e) { /* result may not be ready */ }
  } catch (e) {
    view.appendChild(notice("warn", "JOB NOT FOUND"));
    view.appendChild(el("p", "muted",
      "Job records live in the server's memory and do not survive restarts; on serverless deployments they never exist. " +
      "Detail: " + (e && e.message ? e.message : String(e))));
  }
}

/* ---------- chat (stateless /api/chat, history kept client-side) ---------- */

var chatState = { messages: [] };

async function renderChat(view) {
  view.appendChild(el("h1", null, "Chat"));
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Talk to NEUTRON"));

  var log = el("div", "chat-log");
  p.appendChild(log);
  function paint() {
    log.innerHTML = "";
    if (!chatState.messages.length) {
      log.appendChild(el("p", "muted", "No messages yet. Ask about your codebase, plans, or past runs."));
    }
    chatState.messages.forEach(function (m) {
      var wrap = el("div", "msg " + m.role);
      wrap.appendChild(el("div", "who", m.role === "user" ? "YOU" : "NEUTRON"));
      wrap.appendChild(el("div", "bubble", m.text));
      log.appendChild(wrap);
    });
    log.scrollTop = log.scrollHeight;
  }
  paint();

  var row = el("div", "chat-input-row");
  var input = el("input", "input");
  input.placeholder = "Type a message… (Enter to send)";
  input.setAttribute("aria-label", "Chat message");
  var send = el("button", "btn primary", "Send");
  var fresh = el("button", "btn ghost", "New conversation");

  async function doSend() {
    var text = input.value.trim();
    if (!text) return;
    /* No silent default: chat needs an explicit provider choice. */
    if (!storedProvider()) {
      var hint = "Please select a provider in Settings first — NEUTRON never picks one for you.";
      chatState.messages.push({ role: "user", text: text });
      chatState.messages.push({ role: "assistant", text: hint });
      showError(hint);
      input.value = "";
      paint();
      return;
    }
    input.value = "";
    send.disabled = true;
    chatState.messages.push({ role: "user", text: text });
    paint();
    try {
      var chatBody = {
        messages: chatState.messages.map(function (m) { return { role: m.role, content: m.text }; }),
      };
      var cm = storedModel();
      if (cm) chatBody.model = cm;
      var res = await api("POST", "/api/chat", chatBody);
      chatState.messages.push({ role: "assistant", text: res.text || "(empty reply)" });
      clearError();
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      chatState.messages.push({ role: "assistant", text: "Error: " + msg });
      showError(msg);
    }
    send.disabled = false;
    paint();
  }
  send.onclick = doSend;
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") doSend();
  });
  fresh.onclick = function () {
    chatState.messages = [];
    clearError();
    paint();
  };

  row.appendChild(input);
  row.appendChild(send);
  p.appendChild(row);
  var row2 = el("div", "row");
  row2.appendChild(fresh);
  p.appendChild(row2);
  p.appendChild(el("p", "muted small",
    "Chat is stateless: your conversation lives in this browser. It uses your Settings API key when set (sent as x-api-key); otherwise the server's provider. Without any provider you get an honest error — never a fabricated reply."));
  view.appendChild(p);
}

/* ---------- settings (BYOK + provider/model choice) ---------- */

var PROVIDER_FALLBACK = [
  { id: "nvidia", displayName: "NVIDIA", description: "", defaultModels: [] },
  { id: "agentrouter", displayName: "AgentRouter", description: "", defaultModels: [] },
  { id: "openrouter", displayName: "OpenRouter", description: "", defaultModels: [] },
  { id: "nous", displayName: "NousResearch", description: "", defaultModels: [] },
];

async function fetchProviders() {
  try {
    var res = await api("GET", "/api/providers");
    if (res && Array.isArray(res.providers) && res.providers.length) return res.providers;
  } catch (e) { /* offline — fall back to the static list */ }
  return PROVIDER_FALLBACK;
}

async function renderSettings(view) {
  view.appendChild(el("h1", null, "Settings"));
  var providers = await fetchProviders();
  var byId = {};
  providers.forEach(function (pr) { byId[pr.id] = pr; });

  /* ----- provider choice ----- */
  var pp = el("section", "panel");
  pp.appendChild(el("h2", null, "Provider"));
  pp.appendChild(el("p", "muted small",
    "Which provider your API key is for. Sent as the x-provider header with your requests; the backend builds a request-scoped provider entry for it. Your key is never stored on the server."));

  var provSel = el("select", "input");
  provSel.setAttribute("aria-label", "Provider");
  /* No default provider: the first option is an unselected placeholder. */
  var placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a provider…";
  provSel.appendChild(placeholder);
  providers.forEach(function (pr) {
    var o = document.createElement("option");
    o.value = pr.id;
    o.textContent = pr.displayName + "  (" + pr.id + ")";
    provSel.appendChild(o);
  });
  var savedProv = storedProvider();
  provSel.value = byId[savedProv] ? savedProv : "";
  pp.appendChild(field("PROVIDER", provSel));

  var provNote = el("p", "mono small", "");
  function paintProvNote() {
    var pr = byId[provSel.value];
    provNote.textContent = pr && pr.description ? "NOTE: " + pr.description : "";
  }
  paintProvNote();
  pp.appendChild(provNote);

  /* ----- model choice ----- */
  var modelSel = el("select", "input");
  modelSel.setAttribute("aria-label", "Model");
  var modelCustom = el("input", "input");
  modelCustom.type = "text";
  modelCustom.placeholder = "Custom model id (overrides the dropdown)";
  modelCustom.setAttribute("aria-label", "Custom model id");
  modelCustom.autocomplete = "off";
  modelCustom.value = storedModel();

  function paintModels() {
    var pr = byId[provSel.value];
    var defs = (pr && Array.isArray(pr.defaultModels) ? pr.defaultModels : []).slice();
    var cur = modelCustom.value.trim() || storedModel();
    while (modelSel.firstChild) modelSel.removeChild(modelSel.firstChild);
    var auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto (provider default)";
    modelSel.appendChild(auto);
    defs.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modelSel.appendChild(o);
    });
    if (cur && defs.indexOf(cur) === -1 && !modelCustom.value.trim()) {
      var o2 = document.createElement("option");
      o2.value = cur;
      o2.textContent = cur + "  (saved)";
      modelSel.appendChild(o2);
    }
    modelSel.value = modelCustom.value.trim() ? "" : (defs.indexOf(cur) !== -1 ? cur : "");
  }
  paintModels();
  pp.appendChild(field("MODEL", modelSel));
  pp.appendChild(field("CUSTOM MODEL", modelCustom));

  var modelStatus = el("p", "mono small", "");
  function paintModelStatus() {
    var eff = modelCustom.value.trim() || (modelSel.value || "");
    modelStatus.textContent = eff
      ? "STATUS: model \"" + eff + "\" will be requested."
      : "STATUS: no model override — the provider default is used.";
  }
  paintModelStatus();

  function persistChoice() {
    setStoredProvider(provSel.value);
    var eff = modelCustom.value.trim() || modelSel.value;
    setStoredModel(eff);
    paintProvNote();
    paintModels();
    paintModelStatus();
    clearError();
  }
  provSel.onchange = persistChoice;
  modelSel.onchange = function () { modelCustom.value = ""; persistChoice(); };
  var modelSave = el("button", "btn primary", "Save provider & model");
  modelSave.onclick = persistChoice;
  var mrow = el("div", "row");
  mrow.appendChild(modelSave);
  pp.appendChild(mrow);
  pp.appendChild(modelStatus);
  view.appendChild(pp);

  /* ----- API key ----- */
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Provider API key"));
  p.appendChild(el("p", "muted small",
    "Bring your own key. It is stored only in this browser's localStorage and sent as the x-api-key header with your requests. It is never stored on the server — each request builds a request-scoped provider from it, and it is redacted from logs."));

  var keyIn = el("input", "input");
  keyIn.type = "password";
  keyIn.placeholder = "Paste your provider API key";
  keyIn.setAttribute("aria-label", "Provider API key");
  keyIn.autocomplete = "off";
  p.appendChild(field("API KEY", keyIn));

  var statusLine = el("p", "mono small", "");
  function paintStatus() {
    statusLine.textContent = storedApiKey()
      ? "STATUS: key set — sent only with your requests, never stored on the server."
      : "STATUS: no key set.";
  }
  paintStatus();
  p.appendChild(statusLine);

  var row = el("div", "row");
  var save = el("button", "btn primary", "Save key");
  var clear = el("button", "btn danger", "Clear key");
  save.onclick = function () {
    var k = keyIn.value.trim();
    if (!k) { showError("Paste a key first."); return; }
    setStoredApiKey(k);
    keyIn.value = "";
    clearError();
    paintStatus();
  };
  clear.onclick = function () {
    clearStoredApiKey();
    keyIn.value = "";
    clearError();
    paintStatus();
  };
  row.appendChild(save);
  row.appendChild(clear);
  p.appendChild(row);
  view.appendChild(p);

  var s = el("section", "panel");
  s.appendChild(el("h2", null, "Server provider state"));
  var st = null;
  try { st = await api("GET", "/api/demo/status"); } catch (e) { /* offline */ }
  if (st) {
    s.appendChild(kvGrid([
      ["Server provider", st.providerConfigured ? "configured" : "not configured"],
      ["Note", (st.llmNote || "").slice(0, 160)],
    ]));
  } else {
    s.appendChild(el("p", "muted", "Could not reach the server."));
  }
  s.appendChild(el("p", "muted small",
    "Your key takes precedence over the server's provider for your requests. Remove it here any time; clearing is immediate and nothing of it remains server-side."));
  view.appendChild(s);

  /* ----- Developer Mode (collapsible) ----- */
  var dev = el("details", "dump");
  dev.appendChild(el("summary", null, "DEVELOPER MODE"));
  var devBody = el("div", "dev-body");
  dev.appendChild(devBody);

  // Backend URL override
  devBody.appendChild(el("h3", null, "BACKEND URL OVERRIDE"));
  devBody.appendChild(el("p", "muted small",
    "Point the app at any backend (self-hosted Node server, another deployment). Empty = automatic (same origin as this page). The target must allow CORS — both bundled backends do."));
  var buIn = el("input", "input");
  buIn.type = "url";
  buIn.placeholder = "https://your-backend.example.com  (empty = automatic)";
  buIn.value = storedBackendUrl();
  buIn.setAttribute("aria-label", "Backend URL override");
  buIn.autocomplete = "off";
  devBody.appendChild(field("BACKEND BASE URL", buIn));
  var buEff = el("p", "mono small", "");
  function paintBackendEff() {
    var b = backendBase();
    buEff.textContent = "EFFECTIVE: " + (b ? b : "(same origin as this page)") + "  —  requests go to " + (b || "(same origin)") + "/api/…";
  }
  paintBackendEff();
  devBody.appendChild(buEff);
  var buRow = el("div", "row");
  var buSave = el("button", "btn primary", "Save backend URL");
  var buClear = el("button", "btn ghost", "Use automatic");
  buSave.onclick = function () {
    var u = buIn.value.trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) { showError("Backend URL must start with http:// or https://"); return; }
    setStoredBackendUrl(u);
    buIn.value = u;
    clearError();
    paintBackendEff();
  };
  buClear.onclick = function () {
    setStoredBackendUrl("");
    buIn.value = "";
    clearError();
    paintBackendEff();
  };
  buRow.appendChild(buSave);
  buRow.appendChild(buClear);
  devBody.appendChild(buRow);

  // Verbose logging
  devBody.appendChild(el("h3", null, "VERBOSE LOGGING"));
  var vLabel = el("label", "field check");
  var vBox = document.createElement("input");
  vBox.type = "checkbox";
  vBox.checked = isVerbose();
  vBox.onchange = function () { setVerbose(vBox.checked); };
  vLabel.appendChild(vBox);
  vLabel.appendChild(el("span", null, "Log every API call to the browser console"));
  devBody.appendChild(vLabel);

  // API inspector
  devBody.appendChild(el("h3", null, "API INSPECTOR"));
  devBody.appendChild(el("p", "muted small",
    "Last " + API_LOG_MAX + " API calls made by this app in this session, newest first. Secrets are redacted."));
  var insp = el("div", null);
  function paintInspector() {
    insp.innerHTML = "";
    var calls = apiLog();
    if (!calls.length) {
      insp.appendChild(el("p", "muted small", "No API calls recorded yet. Use the app and come back."));
      return;
    }
    calls.forEach(function (c) {
      var d = el("details", "dump");
      d.appendChild(el("summary", "mono small",
        c.method + " " + c.path + "  →  " + (c.status || "ERR") + "  (" + c.ms + "ms)"));
      var txt = "URL: " + c.url + "\nTime: " + c.ts;
      if (c.request) txt += "\n\n— request —\n" + c.request;
      if (c.response) txt += "\n\n— response —\n" + c.response;
      if (c.error) txt += "\n\n— error —\n" + c.error;
      d.appendChild(el("pre", null, txt.slice(0, 8000)));
      insp.appendChild(d);
    });
  }
  paintInspector();
  var iRow = el("div", "row");
  var iRefresh = el("button", "btn ghost", "Refresh");
  iRefresh.onclick = paintInspector;
  iRow.appendChild(iRefresh);
  devBody.appendChild(iRow);
  devBody.appendChild(insp);

  view.appendChild(dev);
}

/* ---------- boot ---------- */

document.addEventListener("DOMContentLoaded", function () {
  if (!location.hash) location.hash = "#/dashboard";
  render();
});
