/* ==========================================================================
   NEUTRON command palette + universal search (Phases 14+15).

   Vanilla JS, zero dependencies. Dual-mode like ui-utils.js: exposes
   window.NeutronPalette in the browser and module.exports under vitest.
   Top-level code touches no DOM, so it is safe to require in node.

   Ctrl/Cmd+K opens the palette on EVERY route (it replaces the old
   chat-only "focus history search" binding — the history search input is
   still clickable, and the palette has a "Search Chat History" command).

   Search sources are all real device-local or server data:
   conversations + projects (localStorage), rooms (localStorage),
   agent runs + checkpoints + workspace files (Node server only — the
   groups are silently skipped on serverless), GitHub repos (only when a
   token is connected). Nothing is invented.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NeutronPalette = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function getUI() {
    try {
      if (typeof module !== "undefined" && module.exports) return require("./ui-utils.js");
    } catch (e) { /* fall through to window */ }
    try { return (typeof window !== "undefined" && window.NeutronUI) || null; }
    catch (e) { return null; }
  }

  /* ---------------- command runners (ctx-injected for testability) ------ */
  /* Each runner performs the REAL action: navigation via location.hash,
     or a bridge call (new chat, theme cycle, focus). ctx defaults to the
     live browser environment; tests inject stubs. */

  function defaultCtx() {
    var w = {};
    try { w = (typeof window !== "undefined") ? window : {}; } catch (e) {}
    return {
      go: function (hash) { try { location.hash = hash; } catch (e) {} },
      openUrl: function (url) { try { w.open(url, "_blank", "noopener"); } catch (e) {} },
      copy: function (text) {
        var U = getUI();
        if (U && U.copyText) { try { return U.copyText(text); } catch (e) {} }
        return Promise.resolve(false);
      },
      toast: function (m) { try { if (w.toast) w.toast(m); } catch (e) {} },
      announce: function (m) { try { if (w.announce) w.announce(m); } catch (e) {} },
      app: w.NeutronApp || {},
      setSession: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    };
  }

  var COMMAND_RUNNERS = {
    "new-chat": function (ctx) { if (ctx.app.newChat) ctx.app.newChat(); },
    "ask-ai": function (ctx) { if (ctx.app.askAi) ctx.app.askAi(); },
    "search-history": function (ctx) { if (ctx.app.searchHistory) ctx.app.searchHistory(); },
    "new-project": function (ctx) { ctx.go("#/repos"); },
    "new-agent-run": function (ctx) { ctx.go("#/agent"); },
    "review-changes": function (ctx) { ctx.go("#/agent"); },
    "create-checkpoint": function (ctx) { ctx.go("#/repos"); },
    "create-room": function (ctx) { ctx.go("#/rooms"); },
    "join-room": function (ctx) { ctx.go("#/rooms"); },
    "open-terminal": function (ctx) { ctx.go("#/terminal"); },
    "run-tests": function (ctx) { ctx.go("#/testlab"); },
    "start-maintain": function (ctx) { ctx.go("#/maintain"); },
    "open-dashboard": function (ctx) { ctx.go("#/dashboard"); },
    "open-reports": function (ctx) { ctx.go("#/reports"); },
    "open-security": function (ctx) { ctx.go("#/security"); },
    "open-deps": function (ctx) { ctx.go("#/deps"); },
    "open-health": function (ctx) { ctx.go("#/health"); },
    "toggle-theme": function (ctx) { if (ctx.app.cycleTheme) ctx.app.cycleTheme(); },
    "open-settings": function (ctx) { ctx.go("#/settings"); },
  };

  function paletteCommandIds() { return Object.keys(COMMAND_RUNNERS); }

  function runPaletteCommand(id, ctx) {
    var r = COMMAND_RUNNERS[id];
    if (typeof r !== "function") return false;
    try { r(ctx || defaultCtx()); } catch (e) { return false; }
    return true;
  }

  /* ---------------- result opening (ctx-injected) ------------------------ */
  /* Every group opens something real: deep links for chats/projects/rooms,
     the agent view with a pending run id, the repos view (home of the
     checkpoints panel), path copy for workspace files (there is no
     in-app file viewer — copying is honest), new tab for GitHub repos. */

  function openPaletteResult(entry, ctx) {
    if (!entry) return false;
    ctx = ctx || defaultCtx();
    var ref = entry.ref || {};
    try {
      switch (entry.group) {
        case "chats":
          if (!ref.id) return false;
          ctx.go("#/chat/" + encodeURIComponent(ref.id));
          return true;
        case "projects":
          if (!ref.id) return false;
          ctx.go("#/repos/project/" + encodeURIComponent(ref.id));
          return true;
        case "rooms":
          if (!ref.code) return false;
          ctx.go("#room=" + encodeURIComponent(ref.code));
          return true;
        case "runs":
          if (!ref.id) return false;
          ctx.setSession("neutron_pending_run", ref.id);
          ctx.go("#/agent");
          return true;
        case "checkpoints":
          ctx.go("#/repos");
          ctx.toast("Checkpoints live in Repositories" + (ref.repo ? " \u00B7 " + ref.repo : ""));
          return true;
        case "files": {
          if (!ref.path) return false;
          var p = (ref.repo ? ref.repo + "/" : "") + ref.path;
          var done = ctx.copy(p);
          if (done && done.then) done.then(function (ok) {
            ctx.toast(ok ? "Copied path: " + p : "Could not copy the path.");
          });
          else ctx.toast("Path: " + p);
          return true;
        }
        case "github":
          if (!ref.htmlUrl) return false;
          ctx.openUrl(ref.htmlUrl);
          return true;
        default:
          return false;
      }
    } catch (e) { return false; }
  }

  /* ---------------- overlay state ---------------------------------------- */

  var S = null; /* session state while the palette is open */
  var keysBound = false;
  var debouncedSearch = null;
  var githubCache = null; /* per page-load: avoids hammering the GitHub API */

  function h(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function isOpen() { return !!S; }

  function focusInput() {
    try { if (S && S.input) S.input.focus(); } catch (e) {}
  }

  /* ---------------- data gathering --------------------------------------- */

  function readRooms() {
    try {
      var w = (typeof window !== "undefined") ? window : {};
      if (w.NeutronRooms && w.NeutronRooms.listKnownRooms) {
        return w.NeutronRooms.listKnownRooms() || [];
      }
      var raw = localStorage.getItem("neutron_rooms_v1");
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function gatherLocalSources() {
    var w = {};
    try { w = (typeof window !== "undefined") ? window : {}; } catch (e) {}
    var sources = { conversations: [], projects: [], rooms: [] };
    try {
      if (w.NeutronApp && w.NeutronApp.getConversationIndex) {
        sources.conversations = w.NeutronApp.getConversationIndex() || [];
      }
    } catch (e) {}
    try {
      if (w.NeutronApp && w.NeutronApp.getProjectIndex) {
        sources.projects = w.NeutronApp.getProjectIndex() || [];
      }
    } catch (e) {}
    sources.rooms = readRooms();
    return sources;
  }

  function apiFn() {
    try {
      if (typeof window !== "undefined" && typeof window.api === "function") return window.api;
    } catch (e) {}
    return null;
  }

  function rebuildIndex() {
    var U = getUI();
    if (!U || !S) return;
    S.entries = U.paletteBuildIndex(S.sources);
  }

  function mergeSources(part) {
    if (!S) return;
    Object.keys(part || {}).forEach(function (k) { S.sources[k] = part[k]; });
    rebuildIndex();
    if (S.query) renderResults();
  }

  /* Server sources are best-effort: on serverless (or offline) the calls
     fail and the groups are simply absent — never fake, never blocking. */
  function fetchServerSources() {
    var api = apiFn();
    if (!api) return;
    api("GET", "/api/agent/runs").then(function (r) {
      mergeSources({ runs: (r && r.runs) || [] });
    }).catch(function () {});
    api("GET", "/api/demo/repos").then(function (r) {
      var repos = (r && r.repos) || [];
      var names = repos.slice(0, 8).map(function (x) { return x && x.name; })
        .filter(function (n) { return !!n; });
      var chain = Promise.resolve([]);
      names.forEach(function (name) {
        chain = chain.then(function (acc) {
          return api("GET", "/api/checkpoints?repo=" + encodeURIComponent(name))
            .then(function (cr) {
              ((cr && cr.checkpoints) || []).forEach(function (c) {
                acc.push({ id: c.id, label: c.label, repo: name, createdAt: c.at });
              });
              return acc;
            }).catch(function () { return acc; });
        });
      });
      return chain;
    }).then(function (cps) {
      mergeSources({ checkpoints: cps || [] });
    }).catch(function () {});
    try {
      var w = (typeof window !== "undefined") ? window : {};
      var G = w.NeutronGitHub;
      if (G && G.isConnected && G.isConnected()) {
        if (githubCache) { mergeSources({ githubRepos: githubCache }); return; }
        G.gh("/user/repos?per_page=30&sort=updated").then(function (repos) {
          githubCache = (repos || []).map(function (r) {
            return { fullName: r.full_name, description: r.description, htmlUrl: r.html_url };
          });
          mergeSources({ githubRepos: githubCache });
        }).catch(function () {});
      }
    } catch (e) {}
  }

  /* Workspace files are fetched lazily — only when the query looks like a
     filename/path, and only once per palette open. */
  function ensureFiles(query, done) {
    var U = getUI();
    if (!S) { done(); return; }
    if (S.filesLoaded || S.filesLoading) { done(); return; }
    if (!U || !U.looksLikeFileQuery(query)) { done(); return; }
    var api = apiFn();
    if (!api) { done(); return; }
    S.filesLoading = true;
    api("GET", "/api/workspace/files").then(function (r) {
      if (!S) { done(); return; }
      S.filesLoaded = true;
      S.filesLoading = false;
      mergeSources({ files: (r && r.files) || [] });
      done();
    }).catch(function () {
      if (S) S.filesLoading = false;
      done();
    });
  }

  /* ---------------- rendering -------------------------------------------- */

  function buildOverlay() {
    var back = h("div", "pal-back");
    back.id = "pal-back";
    back.addEventListener("mousedown", function (ev) {
      if (ev.target === back) close();
    });

    var box = h("div", "pal");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Search and commands");

    var wrap = h("div", "pal-input-wrap");
    var icon = h("span", "pal-icon", "\u2315");
    icon.setAttribute("aria-hidden", "true");
    var input = h("input", "pal-input");
    input.id = "pal-input";
    input.setAttribute("type", "text");
    input.setAttribute("placeholder", "Search chats, projects, files\u2026  (type > for commands)");
    input.setAttribute("aria-label", "Search or type > for commands");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "pal-list");
    input.setAttribute("aria-activedescendant", "");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    var esc = h("kbd", "pal-kbd", "esc");
    wrap.appendChild(icon);
    wrap.appendChild(input);
    wrap.appendChild(esc);
    box.appendChild(wrap);

    var live = h("div", "sr-only");
    live.id = "pal-live";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    box.appendChild(live);

    var list = h("div", "pal-list");
    list.id = "pal-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Results");
    box.appendChild(list);

    var foot = h("div", "pal-foot");
    foot.appendChild(h("span", null, "\u2191\u2193 navigate"));
    foot.appendChild(h("span", null, "\u23CE open"));
    foot.appendChild(h("span", null, "esc close"));
    box.appendChild(foot);

    back.appendChild(box);
    document.body.appendChild(back);

    S.back = back;
    S.box = box;
    S.input = input;
    S.list = list;
    S.live = live;

    input.addEventListener("input", function () {
      S.query = input.value;
      S.sel = -1;
      scheduleSearch();
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        moveSel(ev.key === "ArrowDown" ? 1 : -1);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        activateSel();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    });

    renderHint();
  }

  function renderHint() {
    var U = getUI();
    S.list.innerHTML = "";
    S.rows = [];
    S.sel = -1;
    S.input.setAttribute("aria-activedescendant", "");
    var hint = h("div", "pal-hint");
    hint.appendChild(h("div", null, "Search across chats, projects, rooms, files, agent runs and more."));
    var hint2 = h("div", "muted");
    hint2.textContent = "Type \u003E for commands \u00B7 Ctrl+K toggles this palette";
    hint.appendChild(hint2);
    S.list.appendChild(hint);
    setLive(U, "");
  }

  function setLive(U, msg) {
    try { if (S && S.live) S.live.textContent = msg; } catch (e) {}
  }

  function scheduleSearch() {
    var U = getUI();
    if (!U || !S) return;
    if (!debouncedSearch) debouncedSearch = U.debounce(runSearch, 180);
    debouncedSearch();
  }

  function runSearch() {
    if (!S) return;
    var q = S.query;
    ensureFiles(q, function () {
      if (!S || S.query !== q) return; /* superseded */
      renderResults();
    });
  }

  function commandMode() {
    return S && S.query.charAt(0) === ">";
  }

  function renderResults() {
    var U = getUI();
    if (!U || !S) return;
    var q = S.query;
    S.list.innerHTML = "";
    S.rows = [];
    S.sel = -1;
    S.input.setAttribute("aria-activedescendant", "");

    if (!q.trim()) { renderHint(); return; }

    if (commandMode()) {
      var defs = U.paletteFilterCommands(U.PALETTE_COMMAND_DEFS, q);
      if (!defs.length) {
        S.list.appendChild(h("div", "pal-empty", "No commands match."));
        setLive(U, "No commands match.");
        return;
      }
      defs.forEach(function (d, i) {
        var row = h("div", "pal-row");
        row.id = "pal-row-" + i;
        row.setAttribute("role", "option");
        row.appendChild(h("span", "pal-row-icon", "\u2328"));
        var main = h("div", "pal-row-main");
        main.appendChild(h("div", "pal-row-title", d.title));
        row.appendChild(main);
        if (d.hint) row.appendChild(h("kbd", "pal-kbd", d.hint));
        row.addEventListener("click", function () { runPaletteCommand(d.id); close(); });
        row.addEventListener("mousemove", function () { setSel(i, false); });
        S.list.appendChild(row);
        S.rows.push({ type: "command", def: d, el: row });
      });
      setLive(U, defs.length + (defs.length === 1 ? " command" : " commands"));
      return;
    }

    var groups = U.paletteSearch(S.entries, q, { perGroup: 6 });
    if (!groups.length) {
      var empty = h("div", "pal-empty");
      empty.textContent = S.filesLoading ? "Searching files\u2026" : "No results for \u201C" + q.trim() + "\u201D.";
      S.list.appendChild(empty);
      setLive(U, "No results.");
      return;
    }
    var idx = 0;
    var total = 0;
    groups.forEach(function (g) {
      var glabel = h("div", "pal-group", g.group.icon + " " + g.group.label.toUpperCase());
      glabel.setAttribute("aria-hidden", "true");
      S.list.appendChild(glabel);
      g.items.forEach(function (hit) {
        (function (hit, i) {
          var row = h("div", "pal-row");
          row.id = "pal-row-" + i;
          row.setAttribute("role", "option");
          var main = h("div", "pal-row-main");
          main.appendChild(h("div", "pal-row-title", hit.entry.title));
          var sub = hit.entry.detail + (hit.snippet ? " \u00B7 " + hit.snippet : "");
          main.appendChild(h("div", "pal-row-sub muted", sub));
          row.appendChild(main);
          row.addEventListener("click", function () { openPaletteResult(hit.entry); close(); });
          row.addEventListener("mousemove", function () { setSel(i, false); });
          S.list.appendChild(row);
          S.rows.push({ type: "result", entry: hit.entry, el: row });
        })(hit, idx);
        idx++;
      });
      total += g.items.length;
    });
    setLive(U, total + (total === 1 ? " result" : " results"));
  }

  function setSel(i, scroll) {
    var U = getUI();
    if (!S || !S.rows.length) return;
    S.rows.forEach(function (r) { r.el.classList.remove("active"); r.el.removeAttribute("aria-selected"); });
    S.sel = i;
    var r = S.rows[i];
    if (!r) return;
    r.el.classList.add("active");
    r.el.setAttribute("aria-selected", "true");
    S.input.setAttribute("aria-activedescendant", r.el.id);
    if (scroll !== false) {
      try { r.el.scrollIntoView({ block: "nearest" }); } catch (e) {}
    }
  }

  function moveSel(delta) {
    var U = getUI();
    if (!U || !S || !S.rows.length) return;
    setSel(U.paletteMoveSelection(S.sel, delta, S.rows.length));
  }

  function activateSel() {
    if (!S || !S.rows.length) return;
    var i = S.sel >= 0 ? S.sel : 0;
    var r = S.rows[i];
    if (!r) return;
    if (r.type === "command") runPaletteCommand(r.def.id);
    else openPaletteResult(r.entry);
    close();
  }

  /* ---------------- open / close / toggle -------------------------------- */

  function open() {
    if (typeof document === "undefined") return false;
    if (S) { focusInput(); return true; }
    var U = getUI();
    S = {
      entries: [],
      sources: gatherLocalSources(),
      filesLoaded: false,
      filesLoading: false,
      rows: [],
      sel: -1,
      query: "",
      prevFocus: null,
      back: null, box: null, input: null, list: null, live: null,
    };
    try { S.prevFocus = document.activeElement; } catch (e) {}
    buildOverlay();
    rebuildIndex();
    fetchServerSources();
    focusInput();
    return true;
  }

  function close() {
    if (!S) return;
    try {
      if (S.back && S.back.parentNode) S.back.parentNode.removeChild(S.back);
    } catch (e) {}
    var prev = S.prevFocus;
    S = null;
    try {
      if (prev && prev.focus) prev.focus();
    } catch (e) {}
  }

  function toggle() {
    if (S) close();
    else open();
  }

  /* ---------------- global wiring (browser only) ------------------------- */

  function bindGlobalKeys() {
    if (keysBound) return;
    keysBound = true;
    document.addEventListener("keydown", function (ev) {
      var mod = ev.ctrlKey || ev.metaKey;
      if (mod && !ev.shiftKey && (ev.key === "k" || ev.key === "K")) {
        var t = ev.target;
        var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" || t.isContentEditable);
        if (typing) return; /* let text fields keep Ctrl+K */
        ev.preventDefault();
        toggle();
      }
    });
  }

  function init() {
    bindGlobalKeys();
    try {
      var btn = document.getElementById("pal-open-btn");
      if (btn) btn.addEventListener("click", function () { open(); });
    } catch (e) {}
  }

  try {
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
      else init();
    }
  } catch (e) {}

  return {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    /* test hooks (no DOM): every command def must have a real runner */
    runPaletteCommand: runPaletteCommand,
    paletteCommandIds: paletteCommandIds,
    openPaletteResult: openPaletteResult,
  };
});
