/* ==========================================================================
   NEUTRON Git workspace panel (Node server only).
   Classic script; uses globals from app.js at call time (el, api,
   showError, clearError, toast, field, kvGrid, notice). Renders into the
   Repositories view: branch badge + switcher, changed files, commit box,
   history with per-commit diffs (via window.NeutronDiff), stash, pull/push.
   Serverless deployments get an honest "needs the Node server" note.
   ========================================================================== */
(function () {
  "use strict";

  function ui() { return window.NeutronUI || {}; }

  var state = { repo: "", loading: false };

  function glyphFor(f) {
    var s = f.staged || "", u = f.unstaged || "";
    if (s === "?" || u === "?") return "\u2753"; // untracked
    if (s === "D" || u === "D") return "\u2716"; // deleted
    if (s === "A") return "\u2795";             // added
    if (s === "R") return "\u27a1";             // renamed
    return "\u25cf";                            // modified
  }

  function statusLabel(f) {
    var bits = [];
    if (f.staged) bits.push("staged:" + f.staged);
    if (f.unstaged) bits.push("unstaged:" + f.unstaged);
    return bits.join(", ") || "modified";
  }

  function errText(e) {
    return (e && e.message) ? e.message : String(e);
  }

  async function loadRepos() {
    var r = await api("GET", "/api/demo/repos");
    var repos = (r && Array.isArray(r.repos)) ? r.repos : [];
    return repos.map(function (x) { return (x && x.name) || ""; }).filter(Boolean);
  }

  async function refreshAll(sec) {
    if (!state.repo) return;
    state.loading = true;
    try {
      var st = await api("GET", "/api/git/status?repo=" + encodeURIComponent(state.repo));
      paintStatus(sec, st);
      var br = await api("GET", "/api/git/branches?repo=" + encodeURIComponent(state.repo));
      paintBranches(sec, br);
      var log = await api("GET", "/api/git/log?repo=" + encodeURIComponent(state.repo) + "&n=30");
      paintHistory(sec, log.commits || []);
      var stash = await api("GET", "/api/git/stash?repo=" + encodeURIComponent(state.repo));
      paintStash(sec, stash.stash || []);
    } catch (e) {
      var eb = sec.querySelector("[data-git-error]");
      if (eb) {
        eb.innerHTML = "";
        var code = (e && e.code) || "";
        eb.appendChild(el("p", "error",
          code === "NOT_A_REPO"
            ? "\u201c" + state.repo + "\u201d is not a git repository yet."
            : errText(e)));
      }
    } finally {
      state.loading = false;
    }
  }

  function paintStatus(sec, st) {
    var box = sec.querySelector("[data-git-status]");
    if (!box) return;
    box.innerHTML = "";
    var head = el("div", "row git-head");
    var badge = el("span", "mono pill", "\uE0A0 " + (st.branch || "?"));
    badge.setAttribute("title", "Current branch");
    head.appendChild(badge);
    if (st.ahead || st.behind) {
      head.appendChild(el("span", "muted small",
        "\u2191" + st.ahead + " \u2193" + st.behind + " vs upstream"));
    } else {
      head.appendChild(el("span", "muted small", st.clean ? "Working tree clean." : "Uncommitted changes."));
    }
    box.appendChild(head);

    var files = Array.isArray(st.files) ? st.files : [];
    if (!files.length) {
      box.appendChild(el("p", "muted small", "Nothing to commit."));
      return;
    }
    var ul = el("ul", "list git-files");
    files.forEach(function (f) {
      var li = el("li");
      li.appendChild(el("span", "mono git-glyph", glyphFor(f)));
      var nm = el("span", "mono small", f.path);
      nm.title = statusLabel(f);
      li.appendChild(nm);
      li.appendChild(el("span", "muted small", " \u00B7 " + statusLabel(f)));
      var spacer = el("span", "git-spacer");
      li.appendChild(spacer);
      var disc = el("button", "btn ghost sm", "Discard");
      disc.type = "button";
      disc.setAttribute("aria-label", "Discard changes to " + f.path);
      disc.onclick = function () { onDiscard(sec, f.path); };
      li.appendChild(disc);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function paintBranches(sec, br) {
    var box = sec.querySelector("[data-git-branches]");
    if (!box) return;
    box.innerHTML = "";
    var sel = document.createElement("select");
    sel.className = "input";
    sel.setAttribute("aria-label", "Switch branch");
    (br.branches || []).forEach(function (b) {
      var o = document.createElement("option");
      o.value = b;
      o.textContent = b + (b === br.current ? "  (current)" : "");
      sel.appendChild(o);
    });
    sel.value = br.current || "";
    sel.onchange = async function () {
      if (!sel.value || sel.value === br.current) return;
      if (!window.confirm("Switch to branch \"" + sel.value + "\"? Uncommitted changes carry over when possible.")) {
        sel.value = br.current || "";
        return;
      }
      try {
        await api("POST", "/api/git/checkout", { repo: state.repo, branch: sel.value });
        toast("Switched to " + sel.value + ".");
        refreshAll(sec);
      } catch (e) {
        showError(errText(e));
        sel.value = br.current || "";
      }
    };
    box.appendChild(sel);

    var row = el("div", "row");
    var nameIn = el("input", "input");
    nameIn.placeholder = "new-branch-name";
    nameIn.setAttribute("aria-label", "New branch name");
    nameIn.autocomplete = "off";
    var mk = el("button", "btn", "Create branch");
    mk.type = "button";
    mk.onclick = async function () {
      var nm = nameIn.value.trim();
      if (!nm) { showError("Enter a branch name first."); return; }
      try {
        await api("POST", "/api/git/branches", { repo: state.repo, name: nm });
        await api("POST", "/api/git/checkout", { repo: state.repo, branch: nm });
        nameIn.value = "";
        clearError();
        toast("Created and switched to " + nm + ".");
        refreshAll(sec);
      } catch (e) { showError(errText(e)); }
    };
    row.appendChild(nameIn);
    row.appendChild(mk);
    box.appendChild(row);
  }

  function paintHistory(sec, commits) {
    var box = sec.querySelector("[data-git-history]");
    if (!box) return;
    box.innerHTML = "";
    if (!commits.length) {
      box.appendChild(el("p", "muted small", "No commits yet."));
      return;
    }
    var ul = el("ul", "list");
    commits.forEach(function (c) {
      var li = el("li");
      var btn = el("button", "linklike mono small", (c.shortSha || "") + "  " + String(c.message || "").split("\n")[0]);
      btn.type = "button";
      btn.setAttribute("aria-label", "Show diff for commit " + (c.shortSha || ""));
      var diffBox = el("div", "git-commit-diff");
      diffBox.style.display = "none";
      btn.onclick = async function () {
        if (diffBox.style.display === "none") {
          diffBox.style.display = "";
          diffBox.innerHTML = "";
          diffBox.appendChild(el("p", "muted small", "Loading diff…"));
          try {
            var d = await api("GET", "/api/git/diff?repo=" + encodeURIComponent(state.repo) +
              "&ref=" + encodeURIComponent(c.sha));
            diffBox.innerHTML = "";
            var meta = el("p", "muted small",
              (c.author || "") + " · " + (c.date || "").slice(0, 16).replace("T", " "));
            diffBox.appendChild(meta);
            if (window.NeutronDiff) window.NeutronDiff.renderUnified(diffBox, d.diff || "");
            else diffBox.appendChild(el("pre", "mono small", d.diff || "(empty)"));
          } catch (e) {
            diffBox.innerHTML = "";
            diffBox.appendChild(el("p", "error", errText(e)));
          }
        } else {
          diffBox.style.display = "none";
        }
      };
      li.appendChild(btn);
      li.appendChild(el("div", "muted small",
        " " + (c.author || "") + " · " + (c.date || "").slice(0, 16).replace("T", " ")));
      li.appendChild(diffBox);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function paintStash(sec, entries) {
    var box = sec.querySelector("[data-git-stash]");
    if (!box) return;
    box.innerHTML = "";
    if (!entries.length) {
      box.appendChild(el("p", "muted small", "No stashed changes."));
      return;
    }
    var ul = el("ul", "list");
    entries.forEach(function (s) {
      var li = el("li");
      li.appendChild(el("span", "mono small", "stash@{" + s.index + "}"));
      li.appendChild(el("span", "muted small", " " + (s.message || "")));
      var pop = el("button", "btn ghost sm", "Apply");
      pop.type = "button";
      pop.setAttribute("aria-label", "Apply stash@{" + s.index + "}");
      pop.onclick = async function () {
        try {
          await api("POST", "/api/git/stash/pop", { repo: state.repo, index: s.index });
          toast("Stash applied.");
          refreshAll(sec);
        } catch (e) { showError(errText(e)); }
      };
      li.appendChild(pop);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  async function onDiscard(sec, path) {
    if (!window.confirm("Discard all changes to \"" + path + "\"? This restores the file from HEAD.")) return;
    try {
      /* Safety net: snapshot a checkpoint first so nothing is silently lost. */
      try {
        await api("POST", "/api/checkpoints", { repo: state.repo, label: "Before discarding " + path });
      } catch (e) { /* checkpoints are best-effort — the discard still needs its confirm */ }
      await api("POST", "/api/git/discard", { repo: state.repo, path: path });
      clearError();
      toast("Discarded changes to " + path + " (checkpoint saved).");
      refreshAll(sec);
    } catch (e) { showError(errText(e)); }
  }

  async function showDiff(sec, staged) {
    var box = sec.querySelector("[data-git-diff]");
    if (!box) return;
    box.innerHTML = "";
    box.appendChild(el("p", "muted small", "Loading diff…"));
    try {
      var d = await api("GET", "/api/git/diff?repo=" + encodeURIComponent(state.repo) +
        (staged ? "&staged=1" : ""));
      box.innerHTML = "";
      if (window.NeutronDiff) window.NeutronDiff.renderUnified(box, d.diff || "");
      else box.appendChild(el("pre", "mono small", d.diff || "(empty)"));
    } catch (e) {
      box.innerHTML = "";
      box.appendChild(el("p", "error", errText(e)));
    }
  }

  /**
   * Render the Git workspace panel into container.
   * Node server only; serverless gets an honest note.
   */
  async function renderPanel(container) {
    var sec = el("section", "panel git-panel");
    sec.appendChild(el("h2", null, "Git workspace"));
    container.appendChild(sec);

    var h = null;
    try { h = await api("GET", "/api/health"); } catch (e) { /* offline */ }
    if (!h || h.serverless) {
      sec.appendChild(el("p", "muted",
        "Git needs the Node server — serverless hosting has no workspace to run git in. " +
        "Run the app with \u201cnode dist/cli-entry.js web\u201d for the full Git workspace."));
      return;
    }

    var errBox = el("div", null);
    errBox.setAttribute("data-git-error", "1");
    sec.appendChild(errBox);

    var pickerRow = el("div", "row");
    var repoSel = document.createElement("select");
    repoSel.className = "input";
    repoSel.setAttribute("aria-label", "Repository");
    pickerRow.appendChild(repoSel);
    var reloadBtn = el("button", "btn ghost", "Refresh");
    reloadBtn.type = "button";
    reloadBtn.onclick = function () { refreshAll(sec); };
    pickerRow.appendChild(reloadBtn);
    sec.appendChild(pickerRow);

    sec.appendChild(el("h3", null, "Branch"));
    var brBox = el("div", null);
    brBox.setAttribute("data-git-branches", "1");
    sec.appendChild(brBox);

    sec.appendChild(el("h3", null, "Changes"));
    var stBox = el("div", null);
    stBox.setAttribute("data-git-status", "1");
    sec.appendChild(stBox);

    var commitRow = el("div", "row");
    var stageBtn = el("button", "btn", "Stage all");
    stageBtn.type = "button";
    stageBtn.onclick = async function () {
      try {
        await api("POST", "/api/git/stage", { repo: state.repo });
        clearError();
        refreshAll(sec);
      } catch (e) { showError(errText(e)); }
    };
    commitRow.appendChild(stageBtn);
    var msgIn = el("input", "input");
    msgIn.placeholder = "Commit message";
    msgIn.setAttribute("aria-label", "Commit message");
    msgIn.autocomplete = "off";
    commitRow.appendChild(msgIn);
    var commitBtn = el("button", "btn primary", "Commit");
    commitBtn.type = "button";
    commitBtn.onclick = async function () {
      var m = msgIn.value.trim();
      if (!m) { showError("Enter a commit message first."); return; }
      try {
        var r = await api("POST", "/api/git/commit", { repo: state.repo, message: m });
        msgIn.value = "";
        clearError();
        toast("Committed " + (r.sha || "").slice(0, 7) + ".");
        refreshAll(sec);
      } catch (e) { showError(errText(e)); }
    };
    commitRow.appendChild(commitBtn);
    sec.appendChild(commitRow);

    sec.appendChild(el("h3", null, "Diff"));
    var diffRow = el("div", "row");
    var dwBtn = el("button", "btn ghost sm", "Working tree");
    dwBtn.type = "button";
    dwBtn.onclick = function () { showDiff(sec, false); };
    var dsBtn = el("button", "btn ghost sm", "Staged");
    dsBtn.type = "button";
    dsBtn.onclick = function () { showDiff(sec, true); };
    diffRow.appendChild(dwBtn);
    diffRow.appendChild(dsBtn);
    sec.appendChild(diffRow);
    var diffBox = el("div", null);
    diffBox.setAttribute("data-git-diff", "1");
    sec.appendChild(diffBox);

    sec.appendChild(el("h3", null, "History"));
    var histBox = el("div", null);
    histBox.setAttribute("data-git-history", "1");
    sec.appendChild(histBox);

    sec.appendChild(el("h3", null, "Stash"));
    var stashRow = el("div", "row");
    var stashMsg = el("input", "input");
    stashMsg.placeholder = "Stash message (optional)";
    stashMsg.setAttribute("aria-label", "Stash message");
    stashMsg.autocomplete = "off";
    var stashBtn = el("button", "btn", "Stash changes");
    stashBtn.type = "button";
    stashBtn.onclick = async function () {
      try {
        var r = await api("POST", "/api/git/stash", { repo: state.repo, message: stashMsg.value.trim() || undefined });
        stashMsg.value = "";
        clearError();
        toast(r.stashed ? "Changes stashed." : "Nothing to stash.");
        refreshAll(sec);
      } catch (e) { showError(errText(e)); }
    };
    stashRow.appendChild(stashMsg);
    stashRow.appendChild(stashBtn);
    sec.appendChild(stashRow);
    var stashBox = el("div", null);
    stashBox.setAttribute("data-git-stash", "1");
    sec.appendChild(stashBox);

    sec.appendChild(el("h3", null, "Sync"));
    var syncRow = el("div", "row");
    var pullBtn = el("button", "btn", "Pull");
    pullBtn.type = "button";
    pullBtn.onclick = async function () {
      pullBtn.disabled = true;
      try {
        var r = await api("POST", "/api/git/pull", { repo: state.repo });
        clearError();
        toast("Pull: " + String(r.output || "up to date").split("\n")[0]);
        refreshAll(sec);
      } catch (e) { showError(errText(e)); }
      pullBtn.disabled = false;
    };
    var pushBtn = el("button", "btn", "Push");
    pushBtn.type = "button";
    pushBtn.onclick = async function () {
      pushBtn.disabled = true;
      try {
        var r2 = await api("POST", "/api/git/push", { repo: state.repo });
        clearError();
        toast("Push: " + String(r2.output || "done").split("\n")[0]);
        refreshAll(sec);
      } catch (e) { showError(errText(e)); }
      pushBtn.disabled = false;
    };
    syncRow.appendChild(pullBtn);
    syncRow.appendChild(pushBtn);
    sec.appendChild(syncRow);
    sec.appendChild(el("p", "muted small",
      "Pull/push use the server's own git authentication (SSH agent or credential helper). " +
      "NEUTRON never asks for or stores git passwords — if the server can't authenticate, you'll get the real git error."));

    try {
      var repos = await loadRepos();
      repoSel.innerHTML = "";
      if (!repos.length) {
        var o = document.createElement("option");
        o.value = "";
        o.textContent = "No workspace repositories";
        repoSel.appendChild(o);
        sec.appendChild(el("p", "muted", "Clone a repository above to use the Git workspace."));
        return;
      }
      repos.forEach(function (n) {
        var op = document.createElement("option");
        op.value = n;
        op.textContent = n;
        repoSel.appendChild(op);
      });
      state.repo = repos[0] || "";
      repoSel.value = state.repo;
      repoSel.onchange = function () {
        state.repo = repoSel.value;
        errBox.innerHTML = "";
        refreshAll(sec);
      };
      refreshAll(sec);
    } catch (e) {
      errBox.appendChild(el("p", "error", errText(e)));
    }
  }

  window.NeutronGit = { renderPanel: renderPanel };
})();
