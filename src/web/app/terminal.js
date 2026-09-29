/* ==========================================================================
   NEUTRON Terminal + Test Lab — Phases 8+13 (Node server only).
   Classic script; uses globals from app.js (el, api, showError, toast,
   announce) and pure helpers on window.NeutronUI. Loaded like rooms.js /
   agent.js; app.js only needs window.NeutronTerminal at render time.

   Honest limits, stated in the UI: sessions are non-interactive (no PTY —
   vim/htop and other full-screen TUIs will not work), commands run without
   a shell (no pipes/redirects), and everything is sandboxed to the chosen
   workspace repository.
   ========================================================================== */
(function () {
  "use strict";

  var UI = window.NeutronUI || {};
  var POLL_MS = 2000;
  var MAX_DOM_LINES = 1000;

  var T = freshTerminalState();
  var L = freshLabState();

  function freshTerminalState() {
    return { tabs: [], activeId: null, repos: null, tabSeq: 0 };
  }
  function freshLabState() {
    return { repos: null, repo: "", detected: null, sessionId: null, pollTimer: null, running: false, result: null, output: "" };
  }

  function teardown() {
    T.tabs.forEach(function (t) { if (t.pollTimer) clearInterval(t.pollTimer); });
    T = freshTerminalState();
    if (L.pollTimer) clearInterval(L.pollTimer);
    L = freshLabState();
  }

  /* Node-only gate with the honest serverless message. */
  async function nodeOnly(view, title, what) {
    var health = null;
    try { health = await api("GET", "/api/health"); } catch (e) { health = null; }
    if (health && !health.serverless) return true;
    var p = el("div", "panel");
    p.appendChild(el("h2", null, title + " needs the Node server"));
    p.appendChild(el("p", "muted",
      what + " runs real processes, which serverless hosting can't do. " +
      "Run the Node server and open this page there:"));
    p.appendChild(el("code", "rm-cmd", "node dist/cli-entry.js web --no-open"));
    view.appendChild(p);
    return false;
  }

  async function loadRepos() {
    if (T.repos) return T.repos;
    var r = await api("GET", "/api/demo/repos");
    T.repos = (r && r.repos) || [];
    return T.repos;
  }

  function repoSelect(repos, selected) {
    var sel = document.createElement("select");
    sel.className = "input tm-repo";
    sel.setAttribute("aria-label", "Repository");
    repos.forEach(function (rp) {
      var o = document.createElement("option");
      o.value = rp.name;
      o.textContent = rp.name + (rp.files != null ? " (" + rp.files + " files)" : "");
      sel.appendChild(o);
    });
    if (selected) sel.value = selected;
    return sel;
  }

  function sendToAgent(goal, repo) {
    try {
      sessionStorage.setItem("neutron_pending_goal", goal);
      if (repo) sessionStorage.setItem("neutron_pending_repo", repo);
    } catch (e) { /* private mode */ }
    location.hash = "#/agent";
  }

  /* ---------------------------------------------------------------- */
  /* Terminal view                                                     */
  /* ---------------------------------------------------------------- */

  async function renderTerminal(view) {
    teardown();
    view.appendChild(el("h1", null, "Terminal"));
    view.appendChild(el("p", "muted",
      "Run commands in a workspace repository. Non-interactive: no shell " +
      "(no pipes or redirects), same sandbox as the AI agent, and full-screen " +
      "programs like vim/htop won't work here."));
    if (!(await nodeOnly(view, "Terminal", "The terminal"))) return;

    var repos;
    try { repos = await loadRepos(); }
    catch (e) { showError("Could not load repositories: " + (e && e.message ? e.message : e)); return; }
    if (!repos.length) {
      view.appendChild(el("div", "panel", "No repositories on the server yet. Clone one from Repositories first."));
      return;
    }

    var bar = el("div", "tm-bar");
    var sel = repoSelect(repos);
    bar.appendChild(sel);
    var add = el("button", "btn primary", "+ New tab");
    add.type = "button";
    add.onclick = function () { newTab(sel.value); };
    bar.appendChild(add);
    view.appendChild(bar);

    var tabsEl = el("div", "tm-tabs");
    tabsEl.setAttribute("role", "tablist");
    view.appendChild(tabsEl);
    var pane = el("div", "tm-pane");
    view.appendChild(pane);
    T.tabsEl = tabsEl;
    T.pane = pane;
    newTab(sel.value);
  }

  async function newTab(repo) {
    var r;
    try {
      r = await api("POST", "/api/terminal/sessions", { repo: repo, label: repo });
    } catch (e) {
      showError("Could not start a terminal session: " + (e && e.message ? e.message : e));
      return;
    }
    var tab = {
      id: "tab" + (++T.tabSeq),
      label: repo,
      sessionId: r.session.id,
      cwd: r.session.cwd,
      lines: [],
      nextSeq: 0,
      history: [],
      histIdx: -1,
      pollTimer: null,
      running: false,
      dead: false,
    };
    T.tabs.push(tab);
    T.activeId = tab.id;
    paintTabs();
    paintPane();
    startPoll(tab);
    announce("Terminal tab opened in " + repo + ".");
  }

  function activeTab() {
    for (var i = 0; i < T.tabs.length; i++) {
      if (T.tabs[i].id === T.activeId) return T.tabs[i];
    }
    return null;
  }

  function paintTabs() {
    if (!T.tabsEl) return;
    T.tabsEl.innerHTML = "";
    T.tabs.forEach(function (t) {
      var b = el("button", "tm-tab" + (t.id === T.activeId ? " active" : ""), t.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", t.id === T.activeId ? "true" : "false");
      b.title = "Double-click to rename";
      b.onclick = function () { T.activeId = t.id; paintTabs(); paintPane(); };
      b.ondblclick = function () { renameTab(t, b); };
      var x = el("span", "tm-tab-x", "×");
      x.setAttribute("role", "button");
      x.setAttribute("aria-label", "Close tab " + t.label);
      x.setAttribute("tabindex", "0");
      var close = function (ev) {
        if (ev) ev.stopPropagation();
        closeTab(t);
      };
      x.onclick = close;
      x.onkeydown = function (ev) { if (ev.key === "Enter" || ev.key === " ") close(ev); };
      b.appendChild(x);
      T.tabsEl.appendChild(b);
    });
  }

  function renameTab(t, btn) {
    var input = document.createElement("input");
    input.className = "input tm-tab-rename";
    input.value = t.label;
    input.setAttribute("aria-label", "Tab name");
    btn.innerHTML = "";
    btn.appendChild(input);
    input.focus();
    input.select();
    var done = function (save) {
      if (save && input.value.trim()) t.label = input.value.trim().slice(0, 40);
      paintTabs();
    };
    input.onkeydown = function (ev) {
      if (ev.key === "Enter") done(true);
      else if (ev.key === "Escape") done(false);
      ev.stopPropagation();
    };
    input.onblur = function () { done(true); };
  }

  async function closeTab(t) {
    if (t.pollTimer) clearInterval(t.pollTimer);
    try { await api("DELETE", "/api/terminal/sessions/" + encodeURIComponent(t.sessionId)); }
    catch (e) { /* session may already be gone — the tab still closes */ }
    T.tabs = T.tabs.filter(function (x) { return x.id !== t.id; });
    if (T.activeId === t.id) T.activeId = T.tabs.length ? T.tabs[T.tabs.length - 1].id : null;
    if (!T.tabs.length) {
      T.pane.innerHTML = "";
      T.pane.appendChild(el("p", "muted", "No open tabs. Pick a repository above and press + New tab."));
    } else {
      paintPane();
    }
    paintTabs();
  }

  function paintPane() {
    var pane = T.pane;
    if (!pane) return;
    pane.innerHTML = "";
    var t = activeTab();
    if (!t) {
      pane.appendChild(el("p", "muted", "No open tabs."));
      return;
    }
    var wrap = el("div", "tm-wrap");

    var out = el("div", "tm-out");
    out.setAttribute("role", "log");
    out.setAttribute("aria-label", "Terminal output for " + t.label);
    out.tabIndex = 0;
    t.outEl = out;
    wrap.appendChild(out);

    var status = el("div", "tm-status muted small");
    t.statusEl = status;
    wrap.appendChild(status);

    var row = el("div", "tm-inputrow");
    var prompt = el("span", "tm-prompt", "$");
    row.appendChild(prompt);
    var input = document.createElement("input");
    input.className = "input tm-input";
    input.setAttribute("aria-label", "Command input");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.placeholder = t.running ? "A command is running — type to send stdin, or Stop it" : "Type a command, Enter to run";
    t.inputEl = input;
    row.appendChild(input);
    var stop = el("button", "btn", "Stop");
    stop.type = "button";
    stop.title = "Kill the running process (SIGKILL)";
    stop.onclick = function () { stopTab(t); };
    row.appendChild(stop);
    wrap.appendChild(row);

    var tools = el("div", "tm-tools");
    [
      ["Clear", function () { t.lines = []; t.nextSeq = 0; renderLines(t); }],
      ["Copy output", function () { copyTabOutput(t); }],
      ["Download logs", function () { downloadTabLogs(t); }],
      ["Ask AI to fix", function () { askAiToFix(t); }],
    ].forEach(function (pair) {
      var b = el("button", "btn small", pair[0]);
      b.type = "button";
      b.onclick = pair[1];
      tools.appendChild(b);
    });
    wrap.appendChild(tools);
    pane.appendChild(wrap);

    input.onkeydown = function (ev) {
      if (ev.key === "Enter") {
        var v = input.value;
        input.value = "";
        t.histIdx = -1;
        sendInput(t, v);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (t.history.length) {
          t.histIdx = t.histIdx < 0 ? t.history.length - 1 : Math.max(0, t.histIdx - 1);
          input.value = t.history[t.histIdx];
        }
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (t.histIdx >= 0) {
          t.histIdx++;
          input.value = t.histIdx >= t.history.length ? "" : t.history[t.histIdx];
          if (t.histIdx >= t.history.length) t.histIdx = -1;
        }
      }
    };

    renderLines(t);
    updateStatus(t);
    // Catch up immediately, then poll.
    pollTab(t);
  }

  function renderLines(t) {
    if (!t.outEl) return;
    var atBottom = t.outEl.scrollHeight - t.outEl.scrollTop - t.outEl.clientHeight < 40;
    t.outEl.innerHTML = "";
    var lines = t.lines.slice(-MAX_DOM_LINES);
    var frag = document.createDocumentFragment();
    lines.forEach(function (ln) {
      var d = document.createElement("div");
      d.className = "tm-line tm-" + ln.stream;
      d.innerHTML = (UI.ansiToHtml || function (s) { return s; })(ln.text === "" ? " " : ln.text);
      frag.appendChild(d);
    });
    t.outEl.appendChild(frag);
    if (atBottom) t.outEl.scrollTop = t.outEl.scrollHeight;
  }

  function updateStatus(t) {
    if (!t.statusEl) return;
    t.statusEl.textContent =
      (t.running ? "● running" : "○ idle") + " · " + t.cwd + " · session " + t.sessionId.slice(0, 8);
  }

  function startPoll(t) {
    if (t.pollTimer) clearInterval(t.pollTimer);
    t.pollTimer = setInterval(function () { pollTab(t); }, POLL_MS);
  }

  async function pollTab(t) {
    if (t.dead) return;
    var r;
    try {
      r = await api("GET", "/api/terminal/sessions/" + encodeURIComponent(t.sessionId) + "/output?since=" + t.nextSeq);
    } catch (e) {
      if (e && (e.status === 404 || e.status === 400)) {
        t.dead = true;
        if (t.pollTimer) clearInterval(t.pollTimer);
        if (t.statusEl) t.statusEl.textContent = "Session ended on the server.";
      }
      return;
    }
    var fresh = false;
    (r.lines || []).forEach(function (ln) {
      t.lines.push(ln);
      fresh = true;
    });
    if (typeof r.nextSeq === "number") t.nextSeq = r.nextSeq;
    if (t.lines.length > MAX_DOM_LINES * 2) t.lines = t.lines.slice(-MAX_DOM_LINES * 2);
    var wasRunning = t.running;
    t.running = !!r.running;
    if (fresh) renderLines(t);
    if (wasRunning !== t.running) {
      updateStatus(t);
      if (t.inputEl) {
        t.inputEl.placeholder = t.running
          ? "A command is running — type to send stdin, or Stop it"
          : "Type a command, Enter to run";
      }
      if (!t.running && r.exitCode !== null && r.exitCode !== undefined) {
        announce("Command finished with exit code " + r.exitCode + ".");
      }
    }
  }

  async function sendInput(t, v) {
    if (t.dead) { showError("This session has ended. Open a new tab."); return; }
    if (v.trim() && !t.running) {
      t.history.push(v);
      if (t.history.length > 200) t.history.shift();
    }
    try {
      await api("POST", "/api/terminal/sessions/" + encodeURIComponent(t.sessionId) + "/input", { data: v + "\n" });
    } catch (e) {
      showError("Input failed: " + (e && e.message ? e.message : e));
      return;
    }
    pollTab(t);
  }

  async function stopTab(t) {
    try {
      var r = await api("POST", "/api/terminal/sessions/" + encodeURIComponent(t.sessionId) + "/kill");
      if (r && r.killed) toast("Process killed.");
      else toast("Nothing was running.");
    } catch (e) {
      showError("Could not stop the process: " + (e && e.message ? e.message : e));
    }
    pollTab(t);
  }

  function copyTabOutput(t) {
    var text = t.lines.map(function (ln) { return ln.text; }).join("\n");
    var done = function (ok) { toast(ok ? "Output copied." : "Copy failed."); };
    if (UI.copyText) UI.copyText(text).then(done, function () { done(false); });
    else done(false);
  }

  function downloadTabLogs(t) {
    var text = t.lines.map(function (ln) { return ln.text; }).join("\n");
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "neutron-terminal-" + t.label.replace(/[^a-z0-9_-]+/gi, "_") + ".txt";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    toast("Logs downloaded.");
  }

  function askAiToFix(t) {
    var tail = t.lines.slice(-100).map(function (ln) { return ln.text; }).join("\n");
    if (!tail.trim()) { toast("No output to send yet — run a command first."); return; }
    var goal = "The following terminal output from the \"" + t.label + "\" repository " +
      "shows a problem (a failing command or error). Analyze the actual output below, " +
      "find the cause in the repository, fix it, and verify the fix. " +
      "Work in the same repository; create a checkpoint before changing files.\n\n" +
      "--- terminal output (last 100 lines) ---\n" + tail.slice(-8000);
    // Find the repo name from the tab's session via the repos list is
    // overkill — the label is the repo for fresh tabs.
    sendToAgent(goal, t.label);
  }

  /* ---------------------------------------------------------------- */
  /* Test Lab view                                                     */
  /* ---------------------------------------------------------------- */

  async function renderTestLab(view) {
    teardown();
    view.appendChild(el("h1", null, "Test Lab"));
    view.appendChild(el("p", "muted",
      "Run a repository's real test suite on the Node server and see honest " +
      "results — a pass is only reported when the test runner says so."));
    if (!(await nodeOnly(view, "Test Lab", "Test runs"))) return;

    var repos;
    try { repos = await loadRepos(); }
    catch (e) { showError("Could not load repositories: " + (e && e.message ? e.message : e)); return; }
    if (!repos.length) {
      view.appendChild(el("div", "panel", "No repositories on the server yet. Clone one from Repositories first."));
      return;
    }

    var bar = el("div", "tm-bar");
    var sel = repoSelect(repos);
    bar.appendChild(sel);
    var detectBtn = el("button", "btn", "Detect");
    detectBtn.type = "button";
    var runBtn = el("button", "btn primary", "Run Tests");
    runBtn.type = "button";
    bar.appendChild(detectBtn);
    bar.appendChild(runBtn);
    view.appendChild(bar);

    var cmdLine = el("p", "muted small");
    view.appendChild(cmdLine);

    var resultBox = el("div", "tl-result");
    view.appendChild(resultBox);
    L.resultBox = resultBox;

    async function detect() {
      cmdLine.textContent = "Detecting test command…";
      try {
        var r = await api("GET", "/api/terminal/test-command?repo=" + encodeURIComponent(sel.value));
        L.detected = r.command;
        L.kind = r.kind;
        cmdLine.textContent = r.command
          ? "Detected (" + r.kind + "): " + r.command.join(" ")
          : "No test command detected for this repository (no npm test script, vitest config, pytest, go.mod, or Cargo.toml).";
      } catch (e) {
        cmdLine.textContent = "Detection failed: " + (e && e.message ? e.message : e);
        L.detected = null;
      }
    }
    detectBtn.onclick = detect;
    sel.onchange = function () { L.repo = sel.value; detect(); };
    L.repo = sel.value;
    detect();

    runBtn.onclick = function () { runTests(sel.value, resultBox); };

    var actions = el("div", "tm-tools");
    var gen = el("button", "btn", "Generate Tests");
    gen.type = "button";
    gen.title = "Open the Agent with a goal to write tests for this repo";
    gen.onclick = function () {
      sendToAgent(
        "Write automated tests for the \"" + sel.value + "\" repository. " +
        "First inspect the codebase and any existing test setup, then add meaningful tests " +
        "covering the core logic. Run the test suite and fix failures. Report what you added.",
        sel.value);
    };
    var fix = el("button", "btn", "Fix Failed Tests");
    fix.type = "button";
    fix.title = "Open the Agent with the last failure output as context";
    fix.onclick = function () {
      var ctx = L.lastOutput ? L.lastOutput.slice(-8000) : "(no test run yet — run the tests first)";
      sendToAgent(
        "The test suite for the \"" + sel.value + "\" repository has failures. " +
        "Analyze the actual failure output below, fix the underlying causes in the repository, " +
        "re-run the tests, and report what was wrong and what changed. " +
        "Create a checkpoint before changing files.\n\n--- test output ---\n" + ctx,
        sel.value);
    };
    actions.appendChild(gen);
    actions.appendChild(fix);
    view.appendChild(actions);
  }

  async function runTests(repo, resultBox) {
    if (L.running) { toast("A test run is already in progress."); return; }
    if (L.pollTimer) clearInterval(L.pollTimer);
    L.result = null;
    L.output = "";
    resultBox.innerHTML = "";
    resultBox.appendChild(el("p", "muted", "Starting test run in " + repo + "…"));

    var sess;
    try {
      var r = await api("POST", "/api/terminal/sessions", { repo: repo, label: "test-lab" });
      sess = r.session;
      L.sessionId = sess.id;
    } catch (e) {
      resultBox.innerHTML = "";
      resultBox.appendChild(el("p", null, "Could not start a session: " + (e && e.message ? e.message : e)));
      return;
    }
    var cmd = L.detected && L.detected.join(" ");
    if (!cmd) {
      try {
        var d = await api("GET", "/api/terminal/test-command?repo=" + encodeURIComponent(repo));
        if (d.command) { cmd = d.command.join(" "); L.detected = d.command; L.kind = d.kind; }
      } catch (e) { /* fall through to honest message */ }
    }
    if (!cmd) {
      resultBox.innerHTML = "";
      resultBox.appendChild(el("p", null,
        "No test command detected for this repository — nothing was run, nothing is claimed. " +
        "Add an npm test script, vitest config, pytest, go.mod, or Cargo.toml first."));
      try { await api("DELETE", "/api/terminal/sessions/" + encodeURIComponent(sess.id)); } catch (e) {}
      return;
    }
    resultBox.innerHTML = "";
    var running = el("p", "muted", "Running: " + cmd + " …");
    resultBox.appendChild(running);
    var out = el("div", "tm-out tl-out");
    out.setAttribute("role", "log");
    out.setAttribute("aria-label", "Test run output");
    resultBox.appendChild(out);
    L.running = true;
    try {
      await api("POST", "/api/terminal/sessions/" + encodeURIComponent(sess.id) + "/input", { data: cmd + "\n" });
    } catch (e) {
      L.running = false;
      running.textContent = "Failed to start the test command: " + (e && e.message ? e.message : e);
      return;
    }
    var since = 0;
    L.pollTimer = setInterval(async function () {
      var o;
      try {
        o = await api("GET", "/api/terminal/sessions/" + encodeURIComponent(sess.id) + "/output?since=" + since);
      } catch (e) { return; }
      (o.lines || []).forEach(function (ln) {
        var d = document.createElement("div");
        d.className = "tm-line tm-" + ln.stream;
        d.innerHTML = (UI.ansiToHtml || function (s) { return s; })(ln.text === "" ? " " : ln.text);
        out.appendChild(d);
        L.output += ln.text + "\n";
      });
      if (typeof o.nextSeq === "number") since = o.nextSeq;
      out.scrollTop = out.scrollHeight;
      if (!o.running) {
        clearInterval(L.pollTimer);
        L.pollTimer = null;
        L.running = false;
        finishRun(sess.id, resultBox, running);
      }
    }, POLL_MS);
  }

  async function finishRun(sessionId, resultBox, runningEl) {
    var res;
    try {
      res = await api("GET", "/api/terminal/sessions/" + encodeURIComponent(sessionId) + "/result");
    } catch (e) {
      runningEl.textContent = "Could not read the test result: " + (e && e.message ? e.message : e);
      return;
    }
    L.lastOutput = L.output;
    runningEl.remove();
    var banner = el("div", "tl-banner tl-" + res.verdict);
    var p = res.parsed || {};
    var title =
      res.verdict === "pass" ? "✓ Tests passed" :
      res.verdict === "fail" ? "✗ Tests failed" :
      res.verdict === "running" ? "… Still running" :
      "? Could not determine the result";
    banner.appendChild(el("strong", null, title));
    var sub;
    if (p.matched) {
      sub = (p.framework || "tests") + ": " + p.passed + " passed, " + p.failed +
        " failed" + (res.exitCode !== null ? " · exit code " + res.exitCode : "") +
        (res.timedOut ? " · timed out" : "");
    } else if (res.verdict === "unknown") {
      sub = "The output didn't match any known test runner format — showing raw output. " +
        "Nothing is claimed about pass/fail." +
        (res.exitCode !== null ? " (process exit code " + res.exitCode + ")" : "");
    } else {
      sub = res.exitCode !== null ? "Exit code " + res.exitCode : "";
    }
    banner.appendChild(el("div", "muted small", sub));
    resultBox.insertBefore(banner, resultBox.firstChild);
    if ((p.tests || []).length) {
      var list = el("div", "tl-tests");
      p.tests.slice(0, 50).forEach(function (t) {
        var row = el("div", "tl-test tl-" + t.status);
        row.appendChild(el("span", "tl-dot", t.status === "fail" ? "✗" : "✓"));
        var name = el("span", "tl-name", t.name);
        row.appendChild(name);
        if (t.detail) row.appendChild(el("span", "muted small", t.detail));
        list.appendChild(row);
      });
      if (p.tests.length > 50) list.appendChild(el("p", "muted small", "…and " + (p.tests.length - 50) + " more."));
      resultBox.appendChild(list);
    }
    announce(title + ". " + sub);
    // Keep the session around for inspection; the user can close tabs in Terminal.
  }

  window.NeutronTerminal = {
    renderTerminal: renderTerminal,
    renderTestLab: renderTestLab,
    teardown: teardown,
  };
})();
