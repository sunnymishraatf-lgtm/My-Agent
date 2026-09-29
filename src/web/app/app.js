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
  if (body !== undefined) {
    /* Strip base64 attachment blobs before logging — the inspector shows
       name/mime/kind/size, not megabytes of noise. */
    var NU = window.NeutronUI;
    var logBody = (NU && NU.stripAttachmentData) ? NU.stripAttachmentData(body) : body;
    entry.request = redactSecrets(JSON.stringify(logBody)).slice(0, 4000);
  }

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
    /* Fail fast when the browser knows it's offline — no point burning
       the 90s timeout in a dead zone. */
    if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
      throw new Error("You appear to be offline — check your connection and try again.");
    }
    /* 90s cap: serverless functions top out at 60s, so anything slower is
       a stall. Timeouts surface through the normal error paths (and the
       chat Retry button from the message log). */
    var UI = window.NeutronUI;
    var doFetch = (UI && UI.fetchWithTimeout)
      ? function (u, o) { return UI.fetchWithTimeout(u, o, 90000); }
      : function (u, o) { return fetch(u, o); };
    res = await doFetch(url, opts);
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

/* ----- toast: transient confirmation for successful actions (errors keep
   using the error bar). GPU-friendly entrance via transform/opacity. ----- */
var toastTimers = [];
function toast(msg) {
  var host = document.getElementById("toast-host");
  if (!host) {
    host = el("div", "toast-host");
    host.id = "toast-host";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  var t = el("div", "toast", msg);
  host.appendChild(t);
  /* Single forced reflow outside any loop to trigger the entrance transition. */
  void t.offsetWidth;
  t.classList.add("show");
  var hide = setTimeout(function () {
    t.classList.remove("show");
    var drop = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 320);
    toastTimers.push(drop);
  }, 2600);
  toastTimers.push(hide);
  /* Keep the stack small on rapid-fire toasts. */
  while (host.children.length > 3) host.removeChild(host.firstChild);
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

/* APK shell version via the native JS bridge (null on plain browsers). */
function apkVersion() {
  try {
    if (window.NeutronApp && typeof window.NeutronApp.getApkVersion === "function") {
      var v = window.NeutronApp.getApkVersion();
      return v && v !== "?" ? v : null;
    }
  } catch (e) {}
  return null;
}

function versionLabel(serverVersion) {
  var av = apkVersion();
  var parts = [];
  if (av) parts.push("App v" + av);
  parts.push("Server v" + (serverVersion || "?"));
  return parts.join(" · ");
}

/* Throttle the /api/health call: it otherwise fires on every route change. */
var PILL_REFRESH_MS = 30000;
var lastPillRefresh = 0;

async function refreshServerPill(force) {
  var pill = document.getElementById("server-pill");
  try {
    var now = Date.now();
    var UI = window.NeutronUI;
    if (!force && UI && !UI.shouldRefreshPill(lastPillRefresh, now, PILL_REFRESH_MS)) return;
    lastPillRefresh = now;
    var h = await api("GET", "/api/health");
    /* Compact and professional: app version only (server version lives
       on the Dashboard Server card). */
    pill.textContent = "ONLINE · v" + (apkVersion() || h.version || "?");
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
  /* Chat gets a full-viewport workspace: hide the sidebar and footer. */
  document.body.classList.toggle("chat-full", route === "chat");
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
  /* Subtle route transition (GPU-friendly fade+rise; disabled under
     prefers-reduced-motion via CSS). */
  view.classList.remove("view-enter");
  void view.offsetWidth;
  view.classList.add("view-enter");
  refreshServerPill();
}

window.addEventListener("hashchange", render);

/* ---------- dashboard ---------- */

async function renderDashboard(view) {
  view.appendChild(el("h1", null, "Dashboard"));

  /* Skeleton placeholders while the two status calls are in flight. */
  var stats = el("div", "grid cols-3");
  function skeletonCard() {
    var p = el("section", "panel skeleton-card");
    p.setAttribute("aria-busy", "true");
    p.appendChild(el("div", "skeleton sk-line sk-w40"));
    p.appendChild(el("div", "skeleton sk-num"));
    p.appendChild(el("div", "skeleton sk-line"));
    return p;
  }
  for (var i = 0; i < 3; i++) stats.appendChild(skeletonCard());
  view.appendChild(stats);

  var results = await Promise.allSettled([
    api("GET", "/api/health"),
    api("GET", "/api/demo/status"),
  ]);
  var health = results[0].status === "fulfilled" ? results[0].value : null;
  var demo = results[1].status === "fulfilled" ? results[1].value : null;
  var keySet = !!storedApiKey();

  stats.innerHTML = "";
  function statCard(title, big, sub) {
    var p = el("section", "panel");
    p.appendChild(el("h2", null, title));
    p.appendChild(el("div", "stat-num", big));
    if (sub) p.appendChild(el("div", "muted small", sub));
    return p;
  }
  stats.appendChild(statCard("Server", health ? "ONLINE" : "OFFLINE",
    health ? versionLabel(health.version) : "could not reach /api/health"));
  stats.appendChild(statCard("Demo repository", demo ? demo.demoRepository : "—",
    demo ? demo.demoDescription : "could not reach /api/demo/status"));
  stats.appendChild(statCard("API key", keySet ? "SET" : "NOT SET",
    keySet ? "sent with your requests only" : "add one in Settings"));

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
  /* Skeleton while the status call is in flight — no blank screen. */
  var sk = el("section", "panel skeleton-card");
  sk.setAttribute("aria-busy", "true");
  sk.appendChild(el("div", "skeleton sk-line sk-w40"));
  sk.appendChild(el("div", "skeleton sk-line"));
  sk.appendChild(el("div", "skeleton sk-line sk-w60"));
  view.appendChild(sk);

  var st;
  try {
    st = await api("GET", "/api/demo/status");
  } catch (e) {
    sk.innerHTML = "";
    sk.appendChild(el("p", "muted", "Could not reach the server. Check your connection and try again."));
    return;
  }
  sk.parentNode.removeChild(sk);

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

var WIZARD_STORAGE = "neutron_maintain_wizard";

/* Persist the wizard after every step so a reload or accidental
   navigation never loses analysis/plan/approval progress.
   Quota errors are swallowed — persistence is best-effort. */
function persistWizard() {
  try {
    var UI = window.NeutronUI;
    if (!UI || !mz) return;
    var clean = UI.sanitizeWizard(mz);
    if (!clean) return;
    localStorage.setItem(WIZARD_STORAGE, JSON.stringify(clean));
  } catch (e) { /* private mode or quota — not fatal */ }
}

function restoreWizard() {
  try {
    var UI = window.NeutronUI;
    if (!UI) return null;
    var raw = localStorage.getItem(WIZARD_STORAGE);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    if (!UI.isValidWizardState(obj, WIZARD_STEPS)) return null;
    return obj;
  } catch (e) { return null; }
}

function clearWizard() {
  try { localStorage.removeItem(WIZARD_STORAGE); } catch (e) {}
}

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

function freshWizard() {
  return {
    step: "REQUEST",
    form: { repo: "demo", request: "", riskTolerance: "balanced" },
    analysisId: null, approvalToken: null,
    analysis: null, impact: null, plan: null,
    approved: false, rejected: false,
    jobId: null, job: null, result: null, unsupported: null,
  };
}

async function renderMaintain(view) {
  var saved = restoreWizard();
  view.appendChild(el("h1", null, "Maintain"));
  var body = el("div", null);
  view.appendChild(body);
  if (saved && saved.step && saved.step !== "REQUEST") {
    /* Offer to resume where the user left off. */
    var p = el("section", "panel");
    p.appendChild(el("h2", null, "Resume maintenance?"));
    p.appendChild(el("p", "muted",
      "You left off at step " + saved.step + " (repository: " +
      ((saved.form && saved.form.repo) || "demo") + "). Resume, or start over."));
    var row = el("div", "row");
    var resume = el("button", "btn primary", "Resume");
    resume.onclick = function () { mz = saved; persistWizard(); maintainRender(body); };
    var over = el("button", "btn ghost", "Start over");
    over.onclick = function () { clearWizard(); mz = freshWizard(); maintainRender(body); };
    row.appendChild(resume);
    row.appendChild(over);
    p.appendChild(row);
    body.appendChild(p);
    return;
  }
  mz = freshWizard();
  await maintainRender(body);
}

async function maintainRender(body) {
  persistWizard();
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
  b.onclick = function () { clearWizard(); renderMaintain(document.getElementById("view")); };
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

async function pollJob(jobId, onUpdate, maxWaitMs) {
  /* A stuck job must never poll forever (battery/data on mobile).
     10 minutes comfortably covers real runs; the api() timeout also
     breaks the loop on network stalls. */
  var maxWait = (typeof maxWaitMs === "number" && maxWaitMs > 0) ? maxWaitMs : 10 * 60 * 1000;
  var start = Date.now();
  for (;;) {
    var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(jobId));
    var job = r.job;
    onUpdate(job);
    if (job.status === "completed" || job.status === "failed" || job.status === "denied") return job;
    if (Date.now() - start >= maxWait) {
      throw new Error("Timed out waiting for the job to finish — check Reports for its latest state.");
    }
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

/* ---------- chat workspace (full-screen, attachments, voice, artifacts) ----------
   Chat is stateless: history lives in this browser (chatState). The API key
   goes as x-api-key, the provider as x-provider; neither is stored server-side.
   There is NO default provider: chat refuses to send until one is chosen.
   Attachments ride inside the JSON body as base64 (WebView-simple):
     attachments: [{ name, mime, kind: "image"|"text"|"zip", data: "<base64>" }]
   Server limits: 5 files, 100 KB per file, 512 KB total (said in the UI).
   Voice is client-side only: Web Speech API for input, speechSynthesis for
   output. No audio leaves the device except via the OS speech recognizer.
   File artifacts come back as res.artifacts and render as download cards.
   Honest limit: files are generated for DOWNLOAD — the app cannot write to
   the phone's folders or execute code on the serverless backend. */

var chatState = { messages: [] };

var CHAT_STORAGE = "neutron_chat_history";
var CHAT_HISTORY_CAP = 200;

/* Persist chat history to this browser only (same trust boundary as the
   API key). Best-effort: quota/private-mode failures are silent. */
function persistChat() {
  try {
    var UI = window.NeutronUI;
    if (!UI) return;
    localStorage.setItem(CHAT_STORAGE,
      JSON.stringify(UI.sanitizeChatHistory(chatState.messages, CHAT_HISTORY_CAP)));
  } catch (e) { /* not fatal */ }
}

function restoreChat() {
  try {
    var raw = localStorage.getItem(CHAT_STORAGE);
    if (!raw) return;
    var arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) chatState.messages = arr;
  } catch (e) { /* corrupt history — start fresh */ }
}

function clearChatHistory() {
  try { localStorage.removeItem(CHAT_STORAGE); } catch (e) {}
}

var VOICE_SPEAK_STORAGE = "neutron_voice_speak";
function voiceSpeakEnabled() {
  try { return localStorage.getItem(VOICE_SPEAK_STORAGE) === "1"; } catch (e) { return false; }
}
function setVoiceSpeakEnabled(on) {
  try { localStorage.setItem(VOICE_SPEAK_STORAGE, on ? "1" : "0"); } catch (e) { /* private mode */ }
}

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function downloadBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = name || "download";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} a.remove(); }, 4000);
}

function b64encode(buf) {
  var bytes = new Uint8Array(buf);
  var s = "";
  for (var i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function utf8Decode(buf) {
  try {
    var dec = new TextDecoder("utf-8", { fatal: true });
    return dec.decode(buf);
  } catch (e) {
    return null;
  }
}

async function renderChat(view) {
  restoreChat(); // reload-safe: history lives in this browser only
  var providers = await fetchProviders();
  var byId = {};
  providers.forEach(function (pr) { byId[pr.id] = pr; });

  var root = el("div", "chat-root");

  /* ----- header: title + provider/model pickers + toggles ----- */
  var head = el("div", "chat-head");
  var backBtn = el("button", "btn ghost sm", "←");
  backBtn.setAttribute("aria-label", "Back to dashboard");
  backBtn.title = "Back to dashboard";
  backBtn.onclick = function () { location.hash = "#/dashboard"; };
  head.appendChild(backBtn);
  head.appendChild(el("div", "chat-title", "Chat"));

  var provSel = el("select", "input chat-pick");
  provSel.setAttribute("aria-label", "Provider");
  var ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select a provider…";
  provSel.appendChild(ph);
  providers.forEach(function (pr) {
    var o = document.createElement("option");
    o.value = pr.id;
    o.textContent = pr.displayName;
    provSel.appendChild(o);
  });
  var savedProv = storedProvider();
  provSel.value = byId[savedProv] ? savedProv : "";

  var modelSel = el("select", "input chat-pick");
  modelSel.setAttribute("aria-label", "Model");
  function paintModelOptions() {
    var pr = byId[provSel.value];
    var defs = (pr && Array.isArray(pr.defaultModels) ? pr.defaultModels : []).slice();
    while (modelSel.firstChild) modelSel.removeChild(modelSel.firstChild);
    var auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Model: auto";
    modelSel.appendChild(auto);
    defs.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modelSel.appendChild(o);
    });
    var cur = storedModel();
    if (cur && defs.indexOf(cur) === -1) {
      var o2 = document.createElement("option");
      o2.value = cur;
      o2.textContent = cur + " (custom)";
      modelSel.appendChild(o2);
    }
    modelSel.value = defs.indexOf(cur) !== -1 || (cur && defs.indexOf(cur) === -1) ? cur : "";
    if (!cur) modelSel.value = "";
  }
  paintModelOptions();

  provSel.onchange = function () {
    setStoredProvider(provSel.value);
    paintModelOptions();
    paintPanel();
    clearError();
  };
  modelSel.onchange = function () {
    setStoredModel(modelSel.value);
    paintPanel();
    clearError();
  };

  var detailsBtn = el("button", "btn ghost sm", "Provider info");
  var voiceBtn = el("button", "btn ghost sm", voiceSpeakEnabled() ? "Voice: on" : "Voice: off");
  var newBtn = el("button", "btn ghost sm", "New");
  head.appendChild(provSel);
  head.appendChild(modelSel);
  var hbtns = el("div", "chat-hbtns");
  hbtns.appendChild(detailsBtn);
  hbtns.appendChild(voiceBtn);
  hbtns.appendChild(newBtn);
  head.appendChild(hbtns);
  root.appendChild(head);

  /* ----- provider details panel ----- */
  var panel = el("div", "prov-panel hidden");
  function kv(k, v) {
    var row = el("div", "kv");
    row.appendChild(el("span", "k", k));
    var vv = el("span", "v mono small", v);
    row.appendChild(vv);
    return row;
  }
  function paintPanel() {
    panel.innerHTML = "";
    var id = storedProvider();
    var pr = byId[id];
    if (!pr) {
      panel.appendChild(el("p", "muted small",
        "Select a provider above to see its endpoint, models, and key status. Your key is never shown here."));
      return;
    }
    panel.appendChild(el("div", "prov-name", pr.displayName + "  (" + pr.id + ")"));
    if (pr.description) panel.appendChild(el("p", "muted small", pr.description));
    panel.appendChild(kv("Endpoint", pr.baseUrl || "—"));
    panel.appendChild(kv("API key", storedApiKey() ? "SET" : "NOT SET"));
    panel.appendChild(kv("Model", storedModel() || "Auto (provider default)"));
    var mrow = el("div", "kv");
    mrow.appendChild(el("span", "k", "Models"));
    var mc = el("span", "v");
    var defs = Array.isArray(pr.defaultModels) ? pr.defaultModels : [];
    if (!defs.length) {
      mc.appendChild(el("span", "muted small", "provider default"));
    } else {
      var c = el("div", "chips");
      defs.forEach(function (m) { c.appendChild(el("span", "chip", m)); });
      mc.appendChild(c);
    }
    mrow.appendChild(mc);
    panel.appendChild(mrow);
  }
  paintPanel();
  detailsBtn.onclick = function () { panel.classList.toggle("hidden"); };
  root.appendChild(panel);

  /* ----- message log ----- */
  var log = el("div", "chat-log full");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", "Chat messages");

  function artifactCards(artifacts) {
    var wrap = el("div", "artifact-list");
    wrap.appendChild(el("div", "artifact-head", "FILE ARTIFACTS"));
    artifacts.forEach(function (a) {
      var card = el("div", "artifact-card");
      var meta = el("div", "artifact-meta");
      meta.appendChild(el("div", "artifact-name mono", a.path));
      meta.appendChild(el("div", "muted small", fmtSize(a.size)));
      card.appendChild(meta);
      var dl = el("button", "btn ghost sm", "Download");
      dl.onclick = function () {
        downloadBlob(new Blob([a.content], { type: "application/octet-stream" }),
          String(a.path).split("/").pop() || "file");
      };
      card.appendChild(dl);
      wrap.appendChild(card);
    });
    var all = el("button", "btn primary sm", "Download all as .zip");
    all.onclick = function () {
      try {
        if (!window.NeutronZip) throw new Error("zip engine missing");
        var zip = window.NeutronZip.createStoredZip(artifacts.map(function (a) {
          return { name: a.path, data: a.content };
        }));
        downloadBlob(zip, "neutron-files.zip");
      } catch (e) {
        showError("Could not build the zip: " + (e && e.message ? e.message : e));
      }
    };
    wrap.appendChild(all);
    wrap.appendChild(el("p", "muted small",
      "Files are generated for download — the app cannot write to your phone's folders or run code on the server."));
    return wrap;
  }

  /* ----- message rendering: buildMsgEl constructs one message element;
     appendMsg adds just the new one (no full re-render per message);
     paint() does a full render with a cap for very long histories. ----- */
  function buildMsgEl(m) {
    var wrap = el("div", "msg " + m.role);
    var whoRow = el("div", "who-row");
    whoRow.appendChild(el("span", "who", m.role === "user" ? "YOU" : "NEUTRON"));
    var UI = window.NeutronUI;
    var tstr = (UI && UI.fmtTime) ? UI.fmtTime(m.ts) : "";
    if (tstr) whoRow.appendChild(el("span", "msg-ts", tstr));
    wrap.appendChild(whoRow);
    var bubble = el("div", "bubble", m.text);
    if (m.role === "user" && m.files && m.files.length) {
      m.files.forEach(function (f) {
        bubble.appendChild(el("div", "attach-line mono small", "file: " + f.name + " (" + fmtSize(f.size) + ")"));
      });
    }
    wrap.appendChild(bubble);
    if (m.role === "assistant" && m.text) {
      var copyBtn = el("button", "btn ghost sm msg-copy", "Copy");
      copyBtn.setAttribute("aria-label", "Copy message to clipboard");
      copyBtn.onclick = function () {
        var UI = window.NeutronUI;
        var btn = copyBtn;
        function done(ok) {
          btn.textContent = ok ? "Copied ✓" : "Copy failed";
          setTimeout(function () { btn.textContent = "Copy"; }, 1500);
        }
        if (UI && UI.copyText) {
          UI.copyText(m.text).then(done, function () { done(false); });
        } else {
          done(false);
        }
      };
      wrap.appendChild(copyBtn);
    }
    if (m.role === "assistant" && m.artifacts && m.artifacts.length) {
      wrap.appendChild(artifactCards(m.artifacts));
    }
    if (m.failed) {
      var retry = el("button", "btn ghost sm retry-btn", "Retry");
      retry.setAttribute("aria-label", "Retry failed message");
      retry.onclick = function () { retryLast(); };
      wrap.appendChild(retry);
    }
    return wrap;
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  }

  function scrollLog() {
    try {
      log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    } catch (e) {
      log.scrollTop = log.scrollHeight;
    }
  }

  var renderAll = false;
  function paint() {
    persistChat();
    log.innerHTML = "";
    var UI = window.NeutronUI;
    var cap = UI ? UI.CHAT_RENDER_CAP : 120;
    var msgs = chatState.messages;
    if (!renderAll && UI && msgs.length > cap) {
      var hidden = msgs.length - cap;
      var more = el("button", "btn ghost sm load-more",
        "Show earlier messages (" + hidden + " more)");
      more.onclick = function () { renderAll = true; paint(); };
      log.appendChild(more);
      msgs = UI.cappedSlice(msgs, cap);
    }
    if (!chatState.messages.length) {
      log.appendChild(el("p", "muted",
        "No messages yet. Ask about your codebase, attach files, or ask the assistant to generate files for download."));
    }
    msgs.forEach(function (m) {
      log.appendChild(buildMsgEl(m));
    });
    scrollLog();
  }

  /** Append a single message efficiently; animates entry via .msg-enter. */
  function appendMsg(m) {
    persistChat();
    var UI = window.NeutronUI;
    var cap = UI ? UI.CHAT_RENDER_CAP : 120;
    if (chatState.messages.length === 1 ||
        (!renderAll && chatState.messages.length > cap)) {
      /* First message (drops the empty state) or over the render cap:
         do a full paint to keep the log consistent. */
      paint();
      return;
    }
    var w = buildMsgEl(m);
    w.classList.add("msg-enter");
    log.appendChild(w);
    scrollLog();
  }

  /* ----- typing indicator while the reply is in flight ----- */
  var typingEl = null;
  function showTyping() {
    hideTyping();
    typingEl = el("div", "msg assistant typing");
    var bubble = el("div", "bubble typing-dots");
    bubble.setAttribute("aria-label", "NEUTRON is typing");
    for (var i = 0; i < 3; i++) bubble.appendChild(el("span", "dot"));
    typingEl.appendChild(bubble);
    log.appendChild(typingEl);
    scrollLog();
  }
  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  paint();

  /* ----- attachments ----- */
  var MAX_ATTACH_FILES = 5;
  var MAX_ATTACH_BYTES = 100 * 1024;
  var staged = [];
  var chips = el("div", "attach-chips");
  function paintChips() {
    chips.innerHTML = "";
    staged.forEach(function (f, i) {
      var chip = el("span", "chip attach-chip");
      chip.appendChild(el("span", null, f.name + " (" + fmtSize(f.size) + ")"));
      var x = el("button", "chip-x", "×");
      x.setAttribute("aria-label", "Remove " + f.name);
      x.onclick = function () { staged.splice(i, 1); paintChips(); };
      chip.appendChild(x);
      chips.appendChild(chip);
    });
    chips.classList.toggle("hidden", !staged.length);
  }
  paintChips();

  var fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = "image/*,.zip,.txt,.md,.js,.jsx,.ts,.tsx,.py,.json,.yaml,.yml,.toml,.css,.html,.xml,.csv,.sh,.java,.c,.h,.cpp,.go,.rs,.php,.swift,.kt,.sql,.log,.ini,.cfg,.diff,.patch";
  fileInput.className = "hidden";
  function classifyClient(name, mime) {
    var m = (mime || "").toLowerCase();
    var n = (name || "").toLowerCase();
    if (m.indexOf("image/") === 0) return "image";
    if (m === "application/zip" || m === "application/x-zip-compressed" || n.slice(-4) === ".zip") return "zip";
    return "text";
  }
  fileInput.onchange = function () {
    var files = Array.prototype.slice.call(fileInput.files || []);
    (function next(i) {
      if (i >= files.length) { fileInput.value = ""; return; }
      var f = files[i];
      if (staged.length >= MAX_ATTACH_FILES) {
        showError("At most " + MAX_ATTACH_FILES + " files per message.");
        fileInput.value = "";
        return;
      }
      if (f.size > MAX_ATTACH_BYTES) {
        showError("\"" + f.name + "\" is " + fmtSize(f.size) + "; the per-file limit is " + fmtSize(MAX_ATTACH_BYTES) + ".");
        return next(i + 1);
      }
      var rd = new FileReader();
      rd.onload = function () {
        var buf = rd.result;
        var kind = classifyClient(f.name, f.type);
        if (kind === "text") {
          var dec = utf8Decode(new Uint8Array(buf));
          if (dec === null || dec.indexOf("\0") !== -1) {
            showError("\"" + f.name + "\" is not a text file, image, or zip — binary files are not accepted.");
            return next(i + 1);
          }
        }
        staged.push({ name: f.name, mime: f.type || "application/octet-stream", kind: kind, data: b64encode(buf), size: f.size });
        clearError();
        paintChips();
        next(i + 1);
      };
      rd.onerror = function () {
        showError("Could not read \"" + f.name + "\".");
        next(i + 1);
      };
      rd.readAsArrayBuffer(f);
    })(0);
  };

  /* ----- composer ----- */
  var composer = el("div", "composer");
  var attachBtn = el("button", "icon-btn", "+");
  attachBtn.title = "Attach images, zip, or text files (max 5, 100 KB each)";
  attachBtn.setAttribute("aria-label", "Attach files");
  attachBtn.onclick = function () { fileInput.click(); };

  var micBtn = el("button", "icon-btn", "mic");
  micBtn.setAttribute("aria-label", "Voice input");
  var RecCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!RecCtor) {
    micBtn.disabled = true;
    micBtn.title = "Voice input isn't supported in this browser";
    micBtn.classList.add("off");
  } else {
    micBtn.title = "Voice input (transcript stays editable before sending)";
    micBtn.onclick = function () {
      if (micBtn.classList.contains("listening")) return;
      var rec;
      try { rec = new RecCtor(); } catch (e) { showError("Could not start voice input."); return; }
      rec.lang = (navigator.language || "en-US");
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      var startText = input.value;
      var finalText = "";
      micBtn.classList.add("listening");
      micBtn.title = "Listening… tap Send or wait";
      rec.onresult = function (ev) {
        var interim = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t;
          else interim += t;
        }
        input.value = (startText ? startText + " " : "") + finalText + interim;
        autoGrow();
      };
      var done = function () {
        micBtn.classList.remove("listening");
        micBtn.title = "Voice input (transcript stays editable before sending)";
        input.value = ((startText ? startText + " " : "") + finalText).trim();
        autoGrow();
        try { rec.stop(); } catch (e) {}
      };
      rec.onend = done;
      rec.onerror = function (ev) {
        done();
        if (ev && ev.error === "not-allowed") showError("Microphone blocked — allow it in the browser settings to use voice input.");
        else if (ev && ev.error !== "aborted") showError("Voice input error: " + ev.error);
      };
      try { rec.start(); } catch (e) { done(); showError("Could not start voice input."); }
    };
  }

  var input = document.createElement("textarea");
  input.className = "input composer-input";
  input.rows = 1;
  input.placeholder = "Type a message… (Enter to send, Shift+Enter for newline)";
  input.setAttribute("aria-label", "Chat message");
  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }
  input.addEventListener("input", autoGrow);

  var sendBtn = el("button", "btn primary", "Send");

  /* ----- voice output (speaker toggle) ----- */
  var synthSupported = ("speechSynthesis" in window);
  function paintVoiceBtn() {
    voiceBtn.textContent = voiceSpeakEnabled() ? "Voice: on" : "Voice: off";
    voiceBtn.classList.toggle("on", voiceSpeakEnabled());
  }
  paintVoiceBtn();
  voiceBtn.onclick = function () {
    var next = !voiceSpeakEnabled();
    if (next && !synthSupported) {
      showError("Voice output isn't supported in this browser.");
      return;
    }
    setVoiceSpeakEnabled(next);
    if (!next) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    paintVoiceBtn();
    clearError();
    toast(next ? "Voice output on — replies will be read aloud." : "Voice output off.");
  };
  function speak(text) {
    if (!voiceSpeakEnabled() || !synthSupported) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text || "").slice(0, 1200));
      window.speechSynthesis.speak(u);
    } catch (e) { /* unsupported voice */ }
  }

  async function doSend() {
    var text = input.value.trim();
    var files = staged.slice();
    if (!text && !files.length) return;
    /* No silent default: chat needs an explicit provider choice. */
    if (!storedProvider()) {
      var hint = "Please select a provider in Settings first — NEUTRON never picks one for you.";
      chatState.messages.push({ role: "user", text: text || "(attachment)", ts: Date.now() });
      appendMsg(chatState.messages[chatState.messages.length - 1]);
      chatState.messages.push({ role: "assistant", text: hint, ts: Date.now() });
      appendMsg(chatState.messages[chatState.messages.length - 1]);
      showError(hint);
      return;
    }
    var umsg = { role: "user", text: text || "(sent with attachments)", ts: Date.now() };
    if (files.length) {
      umsg.files = files.map(function (f) { return { name: f.name, size: f.size }; });
    }
    chatState.messages.push(umsg);
    appendMsg(umsg);
    var chatBody = {
      messages: chatState.messages.map(function (m) { return { role: m.role, content: m.text }; }),
    };
    var cm = storedModel();
    if (cm) chatBody.model = cm;
    if (files.length) {
      chatBody.attachments = files.map(function (f) {
        return { name: f.name, mime: f.mime, kind: f.kind, data: f.data };
      });
    }
    staged = [];
    paintChips();
    input.value = "";
    autoGrow();
    sendOnce(chatBody);
  }

  /* The request body of the last failed send (attachments included),
     so a retry never forces the user to retype or re-attach. */
  var lastFailedBody = null;

  async function sendOnce(chatBody) {
    sendBtn.disabled = true;
    sendBtn.classList.add("sending");
    showTyping();
    try {
      var res = await api("POST", "/api/chat", chatBody);
      var amsg = { role: "assistant", text: res.text || "(empty reply)", ts: Date.now() };
      if (res.artifacts && res.artifacts.length) amsg.artifacts = res.artifacts;
      chatState.messages.push(amsg);
      clearError();
      lastFailedBody = null;
      speak(amsg.text);
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      chatState.messages.push({ role: "assistant", text: "Error: " + msg, failed: true, ts: Date.now() });
      showError(msg);
      lastFailedBody = chatBody;
      /* Never read error text aloud — only real replies get spoken. */
    }
    hideTyping();
    appendMsg(chatState.messages[chatState.messages.length - 1]);
    sendBtn.disabled = false;
    sendBtn.classList.remove("sending");
  }

  function retryLast() {
    if (!lastFailedBody || sendBtn.disabled) return;
    var tail = chatState.messages[chatState.messages.length - 1];
    if (tail && tail.failed) chatState.messages.pop();
    var body = lastFailedBody;
    lastFailedBody = null;
    clearError();
    paint();
    sendOnce(body);
  }
  sendBtn.onclick = doSend;
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      doSend();
    }
  });

  composer.appendChild(attachBtn);
  composer.appendChild(micBtn);
  composer.appendChild(input);
  composer.appendChild(sendBtn);
  root.appendChild(log);
  root.appendChild(chips);
  root.appendChild(fileInput);
  root.appendChild(composer);
  root.appendChild(el("p", "muted small chat-fine",
    "Stateless chat — history lives in this browser. Attachments: images, .zip, text/code files (max 5, 100 KB each). " +
    "Voice input/output never leaves your device except via the OS speech recognizer. " +
    "Without a provider you get an honest error — never a fabricated reply."));
  view.appendChild(root);

  newBtn.onclick = function () {
    chatState.messages = [];
    clearChatHistory();
    try { if (synthSupported) window.speechSynthesis.cancel(); } catch (e) {}
    clearError();
    paint();
    toast("Conversation cleared.");
  };
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
    toast("Provider & model saved.");
  }
  provSel.onchange = persistChoice;
  modelSel.onchange = function () { modelCustom.value = ""; persistChoice(); };
  /* Auto-save the custom model as it is typed (debounced) so it can never
     be silently dropped — the STATUS line below always shows the truth. */
  function localDebounce(fn, wait) {
    var t = null;
    function d() {
      var a = arguments, s = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(s, a); }, wait);
    }
    d.cancel = function () { if (t) { clearTimeout(t); t = null; } };
    return d;
  }
  var debounceFn = window.NeutronUI ? window.NeutronUI.debounce : localDebounce;
  var saveModelSoon = debounceFn(function () {
    setStoredModel(modelCustom.value.trim() || modelSel.value);
    paintModelStatus();
    clearError();
  }, 600);
  modelCustom.oninput = function () { saveModelSoon(); };
  modelCustom.onblur = function () {
    saveModelSoon.cancel();
    setStoredModel(modelCustom.value.trim() || modelSel.value);
    paintModelStatus();
  };
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
    toast("API key saved — stored only in this browser.");
  };
  clear.onclick = function () {
    clearStoredApiKey();
    keyIn.value = "";
    clearError();
    paintStatus();
    toast("API key cleared.");
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

function paintOfflineBar() {
  var bar = document.getElementById("offline-bar");
  if (!bar) return;
  var offline = (typeof navigator !== "undefined" && "onLine" in navigator)
    ? !navigator.onLine : false;
  bar.classList.toggle("hidden", !offline);
}
window.addEventListener("online", paintOfflineBar);
window.addEventListener("offline", paintOfflineBar);

document.addEventListener("DOMContentLoaded", function () {
  if (!location.hash) location.hash = "#/dashboard";
  paintOfflineBar();
  render();
});
