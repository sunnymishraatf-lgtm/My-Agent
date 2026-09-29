/* ==========================================================================
   NEUTRON GitHub integration (client-side).
   Classic script; uses globals from app.js at call time (el, api,
   showError, clearError, toast, field) and pure helpers on window.NeutronUI.

   The personal access token lives ONLY in browser localStorage
   ("neutron_github_token") and is sent as an Authorization header per
   request. It is never stored server-side and never logged. All data
   shown comes from the real GitHub API — when no token is connected the
   UI shows a clean connect prompt and zero fake data.
   ========================================================================== */
(function () {
  "use strict";

  function ui() { return window.NeutronUI || {}; }

  var TOKEN_KEY = "neutron_github_token";

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* storage unavailable */ }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }
  function isConnected() { return !!getToken(); }

  /**
   * Authenticated GitHub API call. Uses the pure githubRequest helper so the
   * URL/header/error logic is unit-tested; real fetch here.
   */
  function gh(path, opts) {
    var U = ui();
    if (!U.githubRequest) return Promise.reject(new Error("GitHub client not ready."));
    return U.githubRequest(path, getToken(), opts || {});
  }

  function errText(e) {
    return (e && e.message) ? e.message : String(e);
  }

  function timeAgo(iso) {
    var t = Date.parse(iso || "");
    if (!t) return "";
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  /**
   * Settings → "Connect GitHub" section. Password input with show/hide,
   * Save validates against GET /user, Clear removes the token.
   */
  function renderConnectSettings(container) {
    var sec = el("section", "panel");
    sec.appendChild(el("h2", null, "Connect GitHub"));
    sec.appendChild(el("p", "muted small",
      "Add a GitHub personal access token to browse your repositories, issues and pull requests, " +
      "and clone private repos into the workspace. The token stays in this browser only — it is sent " +
      "as an Authorization header with your requests and never stored on the server. " +
      "Create one at github.com → Settings → Developer settings → Personal access tokens " +
      "(classic, \"repo\" scope for private repositories)."));

    var wrap = el("div", "key-wrap");
    var tokIn = el("input", "input");
    tokIn.type = "password";
    tokIn.placeholder = "ghp_…";
    tokIn.setAttribute("aria-label", "GitHub personal access token");
    tokIn.autocomplete = "off";
    tokIn.setAttribute("spellcheck", "false");
    var tog = el("button", "btn ghost sm", "Show");
    tog.type = "button";
    tog.setAttribute("aria-label", "Show GitHub token");
    tog.setAttribute("aria-pressed", "false");
    tog.onclick = function () {
      var show = tokIn.type === "password";
      tokIn.type = show ? "text" : "password";
      tog.textContent = show ? "Hide" : "Show";
      tog.setAttribute("aria-pressed", show ? "true" : "false");
    };
    wrap.appendChild(tokIn);
    wrap.appendChild(tog);
    sec.appendChild(field("GITHUB TOKEN", wrap));

    var statusLine = el("p", "mono small", "");
    function paintStatus(user) {
      statusLine.textContent = getToken()
        ? "STATUS: connected" + (user ? " as @" + user : "") + " — token stored only in this browser."
        : "STATUS: not connected.";
    }
    paintStatus("");
    sec.appendChild(statusLine);

    var row = el("div", "row");
    var save = el("button", "btn primary", "Save & connect");
    var clear = el("button", "btn danger", "Disconnect");
    save.onclick = async function () {
      var t = tokIn.value.trim();
      if (!t) { showError("Paste a token first."); return; }
      save.disabled = true;
      save.textContent = "Connecting…";
      try {
        setToken(t);
        var me = await gh("/user");
        tokIn.value = "";
        tokIn.type = "password";
        tog.textContent = "Show";
        clearError();
        paintStatus(me && me.login);
        toast("GitHub connected as @" + (me && me.login ? me.login : "?") + ".");
      } catch (e) {
        clearToken();
        showError(errText(e));
        paintStatus("");
      }
      save.disabled = false;
      save.textContent = "Save & connect";
    };
    clear.onclick = function () {
      clearToken();
      tokIn.value = "";
      clearError();
      paintStatus("");
      toast("GitHub disconnected — token removed from this browser.");
    };
    row.appendChild(save);
    row.appendChild(clear);
    sec.appendChild(row);
    container.appendChild(sec);
  }

  /* ---------------- repository browser ---------------- */

  function repoRow(r, onOpen, onClone) {
    var li = el("li");
    var nameBtn = el("button", "linklike mono", (r.full_name || r.name || "?"));
    nameBtn.type = "button";
    nameBtn.onclick = function () { onOpen(r); };
    li.appendChild(nameBtn);
    if (r.private) li.appendChild(el("span", "muted small", " · private"));
    if (r.language) li.appendChild(el("span", "muted small", " · " + r.language));
    if (r.updated_at) li.appendChild(el("span", "muted small", " · updated " + timeAgo(r.updated_at)));
    var sp = el("span", "git-spacer");
    li.appendChild(sp);
    var cl = el("button", "btn ghost sm", "Clone");
    cl.type = "button";
    cl.setAttribute("aria-label", "Clone " + (r.full_name || ""));
    cl.onclick = function () { onClone(r, cl); };
    li.appendChild(cl);
    return li;
  }

  async function onCloneRepo(r, btn) {
    var url = r.html_url || ("https://github.com/" + r.full_name);
    var U = ui();
    if (!U.githubRepoUrlOk || !U.githubRepoUrlOk(url)) {
      showError("Refusing to clone an unexpected URL.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Cloning…";
    try {
      var res;
      if (r.private) {
        /* Private repo: the token goes to the Node server transiently in the
           request body (redacted in logs); the server clones via
           http.extraHeader and never stores it. */
        res = await api("POST", "/api/git/clone-token", { url: url, token: getToken() });
      } else {
        res = await api("POST", "/api/demo/clone", { url: url });
      }
      clearError();
      toast("Cloned as \"" + (res.repository || res.name || r.name) + "\".");
    } catch (e) {
      showError(errText(e));
    }
    btn.disabled = false;
    btn.textContent = "Clone";
  }

  function issueRow(i) {
    var li = el("li");
    li.appendChild(el("span", "mono small", "#" + i.number));
    li.appendChild(el("span", null, " " + (i.title || "(no title)")));
    li.appendChild(el("div", "muted small",
      " " + (i.user && i.user.login ? "@" + i.user.login : "") +
      (i.created_at ? " · " + timeAgo(i.created_at) : "") +
      (typeof i.comments === "number" ? " · " + i.comments + " comments" : "")));
    return li;
  }

  function prRow(p) {
    var li = el("li");
    li.appendChild(el("span", "mono small", "#" + p.number));
    li.appendChild(el("span", null, " " + (p.title || "(no title)")));
    li.appendChild(el("div", "muted small",
      " " + (p.user && p.user.login ? "@" + p.user.login : "") +
      " · " + (p.head && p.head.ref ? p.head.ref : "") +
      (p.base && p.base.ref ? " → " + p.base.ref : "") +
      (p.created_at ? " · " + timeAgo(p.created_at) : "")));
    return li;
  }

  async function renderRepoDetail(sec, container, r) {
    sec.innerHTML = "";
    sec.appendChild(el("h2", null, "GitHub"));
    var back = el("button", "linklike", "\u2190 All repositories");
    back.type = "button";
    back.onclick = function () { paintRepoList(sec, container); };
    sec.appendChild(back);
    sec.appendChild(el("h3", null, r.full_name || r.name || "?"));

    var tabs = el("div", "row");
    var issuesBtn = el("button", "btn ghost sm", "Issues");
    var prsBtn = el("button", "btn ghost sm", "Pull requests");
    var newBtn = el("button", "btn ghost sm", "+ New issue");
    issuesBtn.type = prsBtn.type = newBtn.type = "button";
    tabs.appendChild(issuesBtn);
    tabs.appendChild(prsBtn);
    tabs.appendChild(newBtn);
    sec.appendChild(tabs);
    var body = el("div", null);
    sec.appendChild(body);

    var owner = (r.full_name || "").split("/")[0];
    var repo = (r.full_name || "").split("/")[1];

    async function showIssues() {
      body.innerHTML = "";
      body.appendChild(el("p", "muted small", "Loading issues…"));
      try {
        var list = await gh("/repos/" + owner + "/" + repo + "/issues?state=open&per_page=30");
        body.innerHTML = "";
        if (!list.length) { body.appendChild(el("p", "muted", "No open issues.")); return; }
        var ul = el("ul", "list");
        list.forEach(function (i) { if (!i.pull_request) ul.appendChild(issueRow(i)); });
        if (!ul.children.length) body.appendChild(el("p", "muted", "No open issues."));
        else body.appendChild(ul);
      } catch (e) {
        body.innerHTML = "";
        body.appendChild(el("p", "error", errText(e)));
      }
    }
    async function showPRs() {
      body.innerHTML = "";
      body.appendChild(el("p", "muted small", "Loading pull requests…"));
      try {
        var list = await gh("/repos/" + owner + "/" + repo + "/pulls?state=open&per_page=30");
        body.innerHTML = "";
        if (!list.length) { body.appendChild(el("p", "muted", "No open pull requests.")); return; }
        var ul = el("ul", "list");
        list.forEach(function (p) { ul.appendChild(prRow(p)); });
        body.appendChild(ul);
      } catch (e) {
        body.innerHTML = "";
        body.appendChild(el("p", "error", errText(e)));
      }
    }
    function showNewIssue() {
      body.innerHTML = "";
      var tIn = el("input", "input");
      tIn.placeholder = "Issue title";
      tIn.setAttribute("aria-label", "Issue title");
      var bIn = document.createElement("textarea");
      bIn.className = "input";
      bIn.placeholder = "Description (optional)";
      bIn.setAttribute("aria-label", "Issue description");
      bIn.rows = 4;
      var go = el("button", "btn primary", "Create issue");
      go.type = "button";
      go.onclick = async function () {
        var t = tIn.value.trim();
        if (!t) { showError("Enter an issue title first."); return; }
        go.disabled = true;
        try {
          var created = await gh("/repos/" + owner + "/" + repo + "/issues",
            { method: "POST", body: { title: t, body: bIn.value.trim() || undefined } });
          clearError();
          toast("Issue #" + (created && created.number) + " created.");
          showIssues();
        } catch (e) { showError(errText(e)); }
        go.disabled = false;
      };
      body.appendChild(field("TITLE", tIn));
      body.appendChild(field("DESCRIPTION", bIn));
      body.appendChild(go);
    }
    issuesBtn.onclick = showIssues;
    prsBtn.onclick = showPRs;
    newBtn.onclick = showNewIssue;
    showIssues();
  }

  /**
   * Render the GitHub panel into container (Repositories view).
   * No token → clean connect prompt, zero fake data.
   */
  function renderPanel(container) {
    var sec = el("section", "panel gh-panel");
    sec.appendChild(el("h2", null, "GitHub"));
    container.appendChild(sec);

    if (!isConnected()) {
      sec.appendChild(el("p", "muted",
        "Connect a GitHub personal access token to browse your repositories, issues and pull requests here."));
      var go = el("a", "btn", "Connect in Settings");
      go.href = "#/settings";
      sec.appendChild(go);
      return;
    }
    paintRepoList(sec, container);
  }

  /** Repository list inside an existing panel section. */
  function paintRepoList(sec, container) {
    sec.innerHTML = "";
    sec.appendChild(el("h2", null, "GitHub"));
    var body = el("div", null);
    sec.appendChild(body);
    body.appendChild(el("p", "muted small", "Loading repositories…"));
    gh("/user/repos?per_page=50&sort=updated")
      .then(function (repos) {
        body.innerHTML = "";
        if (!Array.isArray(repos) || !repos.length) {
          body.appendChild(el("p", "muted", "No repositories found for this token."));
          return;
        }
        var ul = el("ul", "list");
        repos.forEach(function (r) {
          ul.appendChild(repoRow(r,
            function (rr) { renderRepoDetail(sec, container, rr); },
            onCloneRepo));
        });
        body.appendChild(ul);
      })
      .catch(function (e) {
        body.innerHTML = "";
        var p = el("p", "error", errText(e));
        body.appendChild(p);
        if (/401/.test(errText(e))) {
          var d = el("button", "btn ghost sm", "Disconnect token");
          d.type = "button";
          d.onclick = function () {
            clearToken();
            renderPanel(container);
          };
          body.appendChild(d);
        }
      });
  }

  window.NeutronGitHub = {
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    isConnected: isConnected,
    gh: gh,
    renderConnectSettings: renderConnectSettings,
    renderPanel: renderPanel,
  };
})();
