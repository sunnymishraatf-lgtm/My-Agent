/* ==========================================================================
   NEUTRON shared diff viewer + checkpoints panel.
   Classic script; uses globals from app.js at call time (el, api,
   showError, toast, announce) and pure parsers on window.NeutronUI.
   One diff-review component reused by the Agent report, the rooms Ask-AI
   review card, and the Checkpoints panel — theme variables only.
   ========================================================================== */
(function () {
  "use strict";

  function ui() { return window.NeutronUI || {}; }

  /** Normalize a row/hunk line type to add|del|ctx|note. */
  function kindOf(t) {
    if (t === "add" || t === "+") return "add";
    if (t === "del" || t === "-") return "del";
    if (t === "note") return "note";
    return "ctx";
  }

  function sigFor(kind) {
    return kind === "add" ? "+ " : kind === "del" ? "\u2212 " : kind === "note" ? "" : "  ";
  }

  function classFor(kind, cls) {
    return kind === "add" ? cls.add : kind === "del" ? cls.del : kind === "note" ? cls.note : cls.ctx;
  }

  function defaultClasses() {
    return { add: "nd-add", del: "nd-del", ctx: "nd-ctx", note: "nd-note" };
  }

  function lineEl(t, text, cls) {
    var kind = kindOf(t);
    var d = el("div", "nd-line " + classFor(kind, cls));
    d.textContent = sigFor(kind) + text;
    return d;
  }

  function appendCollapsedToggle(box, hiddenCount, renderRest) {
    var btn = el("button", "btn ghost sm nd-more", "\u2026 Show " + hiddenCount + " more lines");
    btn.type = "button";
    btn.onclick = function () {
      renderRest();
      if (btn.parentNode) btn.parentNode.removeChild(btn);
    };
    box.appendChild(btn);
  }

  /**
   * Render flat diff rows [{t, text}] (from diffLineBlocks or
   * parseCompactDiff). opts: {maxLines (default 400), classes, ariaLabel}.
   */
  function renderRows(parent, rows, opts) {
    opts = opts || {};
    var cls = Object.assign(defaultClasses(), opts.classes || {});
    var maxLines = opts.maxLines || 400;
    var box = el("div", "nd-rows");
    box.setAttribute("role", "group");
    if (opts.ariaLabel) box.setAttribute("aria-label", opts.ariaLabel);
    rows = Array.isArray(rows) ? rows : [];
    var shown = rows.slice(0, maxLines);
    shown.forEach(function (r) { box.appendChild(lineEl(r.t, r.text, cls)); });
    if (!rows.length) box.appendChild(el("p", "muted small", "No differences."));
    parent.appendChild(box);
    if (rows.length > shown.length) {
      appendCollapsedToggle(parent, rows.length - shown.length, function () {
        rows.slice(shown.length).forEach(function (r) { box.appendChild(lineEl(r.t, r.text, cls)); });
      });
    }
    return box;
  }

  function renderHunk(hunk, opts, cls) {
    var box = el("div", "nd-hunk");
    box.appendChild(el("div", "nd-hunk-head", hunk.header));
    var maxLines = opts.maxLines || 400;
    var lines = hunk.lines || [];
    var wrap = el("div", "nd-lines");
    lines.slice(0, maxLines).forEach(function (l) { wrap.appendChild(lineEl(l.t, l.text, cls)); });
    box.appendChild(wrap);
    if (lines.length > maxLines) {
      appendCollapsedToggle(box, lines.length - maxLines, function () {
        lines.slice(maxLines).forEach(function (l) { wrap.appendChild(lineEl(l.t, l.text, cls)); });
      });
    }
    return box;
  }

  /**
   * Render a unified diff string. opts: {maxLines (default 400 per hunk),
   * ariaLabel}. One file block per ---/+++ pair with collapsible hunks.
   */
  function renderUnified(parent, text, opts) {
    opts = opts || {};
    var cls = Object.assign(defaultClasses(), opts.classes || {});
    var parsed = ui().parseUnifiedDiff ? ui().parseUnifiedDiff(text) : { files: [] };
    if (!parsed.files.length) {
      parent.appendChild(el("p", "muted small", "No differences."));
      return;
    }
    parsed.files.forEach(function (f) {
      var wrap = el("div", "nd-file");
      var head = el("div", "nd-file-head");
      head.appendChild(el("code", null, f.path));
      wrap.appendChild(head);
      var body = el("div", "nd-file-body");
      body.setAttribute("role", "group");
      body.setAttribute("aria-label", "Changes to " + f.path);
      (f.hunks || []).forEach(function (h) { body.appendChild(renderHunk(h, opts, cls)); });
      if (!(f.hunks || []).length) body.appendChild(el("p", "muted small", "No hunks."));
      wrap.appendChild(body);
      parent.appendChild(wrap);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Checkpoints panel                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Render the user-facing checkpoints panel into container.
   * Repo picker + create/label + list with View/Compare/Restore/Delete.
   * Node server only; serverless gets an honest note.
   */
  function renderPanel(container) {
    var sec = el("section", "panel cp-panel");
    sec.appendChild(el("h2", null, "Checkpoints"));
    sec.appendChild(el("p", "muted small",
      "Snapshots of a repository you can compare, inspect, and restore. " +
      "Restoring always saves a pre-restore snapshot first \u2014 nothing is ever silently destroyed."));
    var body = el("div", "cp-body");
    sec.appendChild(body);
    container.appendChild(sec);

    var sk = el("div", "cp-loading");
    sk.appendChild(el("div", "skeleton sk-line sk-w40"));
    sk.appendChild(el("div", "skeleton sk-line"));
    body.appendChild(sk);

    api("GET", "/api/health").then(function (h) {
      body.innerHTML = "";
      if (!h || h.serverless) {
        var p = el("div", "cp-note");
        p.appendChild(el("p", "muted",
          "Checkpoints need the Node server \u2014 serverless hosting has no workspace to snapshot. " +
          "Run the Node server and open this page there."));
        body.appendChild(p);
        return;
      }
      boot(body);
    }, function () {
      body.innerHTML = "";
      var err = el("div", "cp-note");
      err.appendChild(el("p", null, "Could not reach the server."));
      var retry = el("button", "btn sm", "Retry");
      retry.onclick = function () { container.innerHTML = ""; renderPanel(container); };
      err.appendChild(retry);
      body.appendChild(err);
    });
  }

  function boot(body) {
    var S = { repo: "", items: [], arming: null, expanded: {} };

    var top = el("div", "cp-top");
    var repoSel = document.createElement("select");
    repoSel.className = "input cp-repo";
    repoSel.setAttribute("aria-label", "Repository");
    var loading = document.createElement("option");
    loading.textContent = "Loading repositories\u2026";
    repoSel.appendChild(loading);
    top.appendChild(repoSel);

    var labelIn = el("input", "input cp-label");
    labelIn.placeholder = "Checkpoint label\u2026";
    labelIn.maxLength = 120;
    labelIn.setAttribute("aria-label", "Checkpoint label");
    top.appendChild(labelIn);

    var createBtn = el("button", "btn primary sm", "Create checkpoint");
    createBtn.type = "button";
    top.appendChild(createBtn);
    body.appendChild(top);

    var list = el("div", "cp-list");
    body.appendChild(list);

    function setBusy(b, msg) {
      createBtn.disabled = b;
      createBtn.textContent = b ? (msg || "Working\u2026") : "Create checkpoint";
    }

    async function loadRepos() {
      try {
        var r = await api("GET", "/api/demo/repos");
        var repos = (r && r.repos) || [];
        repoSel.innerHTML = "";
        if (!repos.length) {
          var o = document.createElement("option");
          o.textContent = "No repositories on the server";
          repoSel.appendChild(o);
          repoSel.disabled = true;
          return;
        }
        repos.forEach(function (rp) {
          var op = document.createElement("option");
          op.value = rp.name;
          op.textContent = rp.name;
          repoSel.appendChild(op);
        });
        S.repo = repoSel.value;
        loadList();
      } catch (e) {
        repoSel.innerHTML = "";
        var o2 = document.createElement("option");
        o2.textContent = "Could not load repositories";
        repoSel.appendChild(o2);
        repoSel.disabled = true;
      }
    }

    repoSel.onchange = function () { S.repo = repoSel.value; S.arming = null; S.expanded = {}; loadList(); };

    async function create() {
      var label = labelIn.value.trim();
      if (!label) { showError("Give the checkpoint a label first."); labelIn.focus(); return; }
      if (!S.repo) { showError("Pick a repository."); return; }
      setBusy(true, "Snapshotting\u2026");
      try {
        var r = await api("POST", "/api/checkpoints", { repo: S.repo, label: label });
        labelIn.value = "";
        var extra = r.checkpoint.skippedLarge || r.checkpoint.skippedBinary
          ? " (" + r.checkpoint.skippedLarge + " large, " + r.checkpoint.skippedBinary + " binary skipped)"
          : "";
        toast("Checkpoint created (" + r.checkpoint.fileCount + " files" + extra + ").");
        announce("Checkpoint created.");
        loadList();
      } catch (e) {
        showError(e && e.message ? e.message : "Could not create the checkpoint.");
      } finally {
        setBusy(false);
      }
    }
    createBtn.onclick = create;
    labelIn.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); create(); }
    });

    async function loadList() {
      list.innerHTML = "";
      S.expanded = {};
      if (!S.repo) { list.appendChild(el("p", "muted", "Pick a repository to see its checkpoints.")); return; }
      var sk = el("div", null);
      sk.appendChild(el("div", "skeleton sk-line sk-w60"));
      sk.appendChild(el("div", "skeleton sk-line sk-w40"));
      list.appendChild(sk);
      try {
        var r = await api("GET", "/api/checkpoints?repo=" + encodeURIComponent(S.repo));
        S.items = (r && r.checkpoints) || [];
        paintList();
      } catch (e) {
        list.innerHTML = "";
        var err = el("div", "cp-note");
        err.appendChild(el("p", null, "Could not load checkpoints."));
        var retry = el("button", "btn sm", "Retry");
        retry.onclick = loadList;
        err.appendChild(retry);
        list.appendChild(err);
      }
    }

    function relTime(iso) {
      return ui().relativeTime ? ui().relativeTime(new Date(iso).getTime(), Date.now()) : iso;
    }

    function paintList() {
      list.innerHTML = "";
      if (!S.items.length) {
        list.appendChild(el("p", "muted", "No checkpoints yet. Create one before a risky change."));
        return;
      }
      var ul = el("ul", "cp-items");
      S.items.forEach(function (cp) {
        ul.appendChild(itemEl(cp));
      });
      list.appendChild(ul);
    }

    function itemEl(cp) {
      var li = el("li", "cp-item");
      var main = el("div", "cp-main");
      var titleRow = el("div", "cp-title-row");
      var badge = el("span", "cp-kind cp-kind-" + cp.kind, cp.kind === "manual" ? "manual" : "agent run");
      titleRow.appendChild(badge);
      titleRow.appendChild(el("strong", null, cp.label || "(untitled)"));
      main.appendChild(titleRow);
      main.appendChild(el("p", "muted small",
        relTime(cp.at) + " \u00b7 " + cp.fileCount + " file" + (cp.fileCount === 1 ? "" : "s")));
      li.appendChild(main);

      var btns = el("div", "cp-actions");
      function mkBtn(label, fn, aria) {
        var b = el("button", "btn ghost sm", label);
        b.type = "button";
        if (aria) b.setAttribute("aria-label", aria);
        b.onclick = fn;
        btns.appendChild(b);
        return b;
      }
      var expanded = el("div", "cp-expanded");
      var viewBtn = mkBtn(S.expanded[cp.id] ? "Hide" : "View", function () {
        if (S.expanded[cp.id]) {
          delete S.expanded[cp.id];
          expanded.innerHTML = "";
          viewBtn.textContent = "View";
          return;
        }
        viewDetail(cp, expanded, viewBtn);
      }, "View files in checkpoint " + (cp.label || cp.id));
      var cmpBtn = el("button", "btn ghost sm", S.arming === cp.id ? "Pick another\u2026" : "Compare");
      cmpBtn.type = "button";
      cmpBtn.setAttribute("aria-label", "Compare checkpoint " + (cp.label || cp.id));
      cmpBtn.onclick = function () { armCompare(cp); };
      if (S.arming && S.arming !== cp.id) cmpBtn.classList.add("cp-armed");
      btns.appendChild(cmpBtn);
      mkBtn("Restore", function () { doRestore(cp); }, "Restore checkpoint " + (cp.label || cp.id));
      mkBtn("Delete", function () { doDelete(cp); }, "Delete checkpoint " + (cp.label || cp.id));
      li.appendChild(btns);
      li.appendChild(expanded);
      return li;
    }

    async function viewDetail(cp, expanded, btn) {
      expanded.innerHTML = "";
      expanded.appendChild(el("p", "muted small", "Loading\u2026"));
      try {
        var r = await api("GET", "/api/checkpoints/" + encodeURIComponent(cp.id) + "?repo=" + encodeURIComponent(S.repo));
        var files = ((r && r.checkpoint && r.checkpoint.files) || []);
        S.expanded[cp.id] = true;
        if (btn) btn.textContent = "Hide";
        expanded.innerHTML = "";
        if (!files.length) { expanded.appendChild(el("p", "muted small", "Empty checkpoint.")); return; }
        var ul = el("ul", "cp-files");
        files.slice(0, 200).forEach(function (f) {
          var li = el("li", null);
          li.appendChild(el("code", null, f.path));
          li.appendChild(el("span", "muted small", f.existed ? "" : " (did not exist)"));
          ul.appendChild(li);
        });
        expanded.appendChild(ul);
        if (files.length > 200) expanded.appendChild(el("p", "muted small", "\u2026 and " + (files.length - 200) + " more"));
      } catch (e) {
        expanded.innerHTML = "";
        showError(e && e.message ? e.message : "Could not load the checkpoint.");
      }
    }

    function armCompare(cp) {
      if (!S.arming) {
        S.arming = cp.id;
        toast("Pick another checkpoint to compare against.");
        paintList();
        return;
      }
      if (S.arming === cp.id) { S.arming = null; paintList(); return; }
      var a = S.arming;
      S.arming = null;
      doCompare(a, cp.id);
    }

    async function doCompare(idA, idB) {
      list.innerHTML = "";
      var back = el("button", "btn ghost sm", "\u2190 Back to checkpoints");
      back.type = "button";
      back.onclick = loadList;
      list.appendChild(back);
      var head = el("h3", null, "Compare checkpoints");
      list.appendChild(head);
      var prog = el("p", "muted small", "Computing diff\u2026");
      list.appendChild(prog);
      try {
        var r = await api("GET",
          "/api/checkpoints/" + encodeURIComponent(idA) +
          "/compare/" + encodeURIComponent(idB) +
          "?repo=" + encodeURIComponent(S.repo));
        prog.parentNode.removeChild(prog);
        var diffs = (r && r.diffs) || [];
        var meta = el("p", "muted small",
          (r.a.label || r.a.id) + " \u2192 " + (r.b.label || r.b.id) +
          " \u00b7 " + diffs.length + " changed file" + (diffs.length === 1 ? "" : "s") +
          (r.truncated ? " (truncated)" : ""));
        list.appendChild(meta);
        if (!diffs.length) {
          list.appendChild(el("p", "muted", "No differences."));
          return;
        }
        diffs.forEach(function (d) {
          var wrap = el("div", "nd-file");
          var fh = el("div", "nd-file-head");
          fh.appendChild(el("code", null, d.path));
          fh.appendChild(el("span", "cp-kind cp-kind-" + d.status, d.status));
          wrap.appendChild(fh);
          if (d.note && !d.diff) {
            wrap.appendChild(el("p", "muted small", d.note));
          } else {
            renderUnified(wrap, d.diff, { ariaLabel: "Changes to " + d.path });
          }
          list.appendChild(wrap);
        });
        announce("Comparison ready: " + diffs.length + " changed files.");
      } catch (e) {
        prog.parentNode.removeChild(prog);
        showError(e && e.message ? e.message : "Could not compare the checkpoints.");
        loadList();
      }
    }

    async function doRestore(cp) {
      var label = cp.label || cp.id;
      if (!window.confirm("Restore checkpoint \"" + label + "\"?\n\nA pre-restore snapshot of the current state is saved first, so you can undo this.")) return;
      try {
        var r = await api("POST", "/api/checkpoints/" + encodeURIComponent(cp.id) + "/restore", { repo: S.repo });
        toast("Restored " + (r.restored || []).length + " file(s). Pre-restore saved as \"" + r.preRestoreLabel + "\".");
        announce("Checkpoint restored. Pre-restore snapshot saved.");
        loadList();
      } catch (e) {
        showError(e && e.message ? e.message : "Could not restore the checkpoint.");
      }
    }

    async function doDelete(cp) {
      var label = cp.label || cp.id;
      if (!window.confirm("Delete checkpoint \"" + label + "\"?\n\nThis removes the snapshot. The repository files are not touched.")) return;
      try {
        await api("DELETE", "/api/checkpoints/" + encodeURIComponent(cp.id) + "?repo=" + encodeURIComponent(S.repo));
        toast("Checkpoint deleted.");
        loadList();
      } catch (e) {
        showError(e && e.message ? e.message : "Could not delete the checkpoint.");
      }
    }

    loadRepos();
  }

  window.NeutronDiff = {
    renderUnified: renderUnified,
    renderRows: renderRows,
  };
  window.NeutronCheckpoints = {
    renderPanel: renderPanel,
  };
})();
