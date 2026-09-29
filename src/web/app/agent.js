/* ==========================================================================
   NEUTRON Agent — autonomous AI agent UI (Phase 2).
   Classic script; uses globals from app.js (el, api, showError, clearError,
   toast, announce) and pure helpers on window.NeutronUI. Node server only:
   serverless hosting gets an honest "needs the Node server" note.
   ========================================================================== */
(function () {
  "use strict";

  var UI = window.NeutronUI || {};
  var POLL_MS = 2500;

  var S = freshState();
  function freshState() {
    return {
      run: null,          // last serialized run
      runId: null,
      pollTimer: null,
      starting: false,
      deciding: {},       // approvalId -> true while the request is in flight
      restoring: false,
      showDiff: {},       // change idx -> true
      verdicts: {},       // change idx -> "accepted" | "reverted"
    };
  }

  function teardown() {
    if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
    S = freshState();
  }

  var PHASE_LABELS = {
    understand: "Understand", analyze: "Analyze", plan: "Plan",
    implement: "Implement", test: "Test", fix: "Fix",
    review: "Review", report: "Report",
  };
  var PHASE_ORDER = ["understand", "analyze", "plan", "implement", "test", "fix", "review", "report"];

  var STATUS_LABELS = {
    running: "Running", "awaiting-approval": "Waiting for approval",
    completed: "Completed", failed: "Failed", stopped: "Stopped", denied: "Denied",
  };

  function statusClass(st) {
    return st === "completed" ? "ok" : (st === "failed" || st === "denied") ? "bad" :
      st === "awaiting-approval" ? "warn" : st === "stopped" ? "muted" : "run";
  }

  /* ---------- entry ---------- */

  async function renderAgent(view) {
    teardown();
    view.appendChild(el("h1", null, "Agent"));
    view.appendChild(el("p", "muted",
      "Give the agent a goal. It understands, analyzes, plans, asks your approval, " +
      "implements, runs tests, fixes failures, and reports back — with a checkpoint you can restore."));

    var health = null;
    try { health = await api("GET", "/api/health"); } catch (e) { health = null; }
    if (!health || health.serverless) {
      var p = el("div", "panel");
      p.appendChild(el("h2", null, "Agent needs the Node server"));
      p.appendChild(el("p", "muted",
        "The autonomous agent edits files and runs commands, which serverless hosting can't do. " +
        "Run the Node server and open this page there:"));
      p.appendChild(el("code", "rm-cmd", "node dist/cli-entry.js web --no-open"));
      view.appendChild(p);
      return;
    }

    var wrap = el("div", "ag-wrap");
    view.appendChild(wrap);
    renderNewRunForm(wrap);
    var runPanel = el("div", "ag-run");
    wrap.appendChild(runPanel);
    S.runPanel = runPanel;
    if (window.NeutronCheckpoints) {
      var cpWrap = el("div", "ag-checkpoints");
      wrap.appendChild(cpWrap);
      window.NeutronCheckpoints.renderPanel(cpWrap);
    }
  }

  /* ---------- new run form ---------- */

  function stored(k, dflt) {
    try { var v = localStorage.getItem(k); return v == null ? dflt : v; } catch (e) { return dflt; }
  }

  async function renderNewRunForm(wrap) {
    var form = el("div", "panel ag-form");
    form.appendChild(el("h2", null, "New agent run"));

    var goalLabel = el("label", "fld-label", "Goal");
    goalLabel.setAttribute("for", "ag-goal");
    var goal = document.createElement("textarea");
    goal.id = "ag-goal";
    goal.className = "input ag-goal";
    goal.rows = 3;
    goal.placeholder = "e.g. Add input validation to the signup form and cover it with tests";
    /* Prefill from another view (e.g. Dependency Center's "Plan upgrade with AI"). */
    try {
      var pending = sessionStorage.getItem("neutron_pending_goal");
      if (pending) {
        goal.value = pending;
        sessionStorage.removeItem("neutron_pending_goal");
      }
    } catch (e) { /* private mode — goal stays empty */ }
    form.appendChild(goalLabel);
    form.appendChild(goal);

    var row = el("div", "ag-row");
    // Repo picker (workspace repos on the Node server).
    var repoWrap = el("div", "ag-field");
    var repoLabel = el("label", "fld-label", "Repository");
    repoLabel.setAttribute("for", "ag-repo");
    var repoSel = document.createElement("select");
    repoSel.id = "ag-repo";
    repoSel.className = "input";
    var loading = document.createElement("option");
    loading.textContent = "Loading…";
    repoSel.appendChild(loading);
    repoWrap.appendChild(repoLabel);
    repoWrap.appendChild(repoSel);
    row.appendChild(repoWrap);
    // Project picker (Project Brain, device-local) — optional context.
    var projWrap = el("div", "ag-field");
    var projLabel = el("label", "fld-label", "Project memory (optional)");
    projLabel.setAttribute("for", "ag-project");
    var projSel = document.createElement("select");
    projSel.id = "ag-project";
    projSel.className = "input";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "None";
    projSel.appendChild(none);
    try {
      var store = JSON.parse(localStorage.getItem("neutron_projects") || "null");
      if (store && store.items) {
        Object.keys(store.items).forEach(function (id) {
          var pr = store.items[id];
          var o = document.createElement("option");
          o.value = id;
          o.textContent = pr.name || id;
          projSel.appendChild(o);
        });
      }
    } catch (e) { /* project store unreadable — picker stays empty */ }
    projWrap.appendChild(projLabel);
    projWrap.appendChild(projSel);
    row.appendChild(projWrap);
    form.appendChild(row);

    // Provider/model come from Settings (BYOK); show what will be used.
    var prov = stored("neutron_provider", "");
    var model = stored("neutron_model", "");
    var meta = el("p", "muted small",
      "LLM: " + (prov ? prov : "(no provider selected)") +
      (model ? " · " + model : "") +
      " — from Settings. Your key is sent per request, never stored server-side.");
    form.appendChild(meta);

    var chkRow = el("label", "ag-check");
    var chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = "ag-auto";
    chkRow.appendChild(chk);
    chkRow.appendChild(document.createTextNode(" Auto-approve file edits for this run (delete/commands/tests still ask)"));
    form.appendChild(chkRow);

    var startBtn = el("button", "btn primary", "Start agent run");
    startBtn.type = "button";
    form.appendChild(startBtn);
    wrap.appendChild(form);

    try {
      var r = await api("GET", "/api/demo/repos");
      repoSel.innerHTML = "";
      var repos = (r && r.repos) || [];
      if (!repos.length) {
        var o2 = document.createElement("option");
        o2.textContent = "No repositories on the server";
        repoSel.appendChild(o2);
        repoSel.disabled = true;
      } else {
        repos.forEach(function (rp) {
          var o = document.createElement("option");
          o.value = rp.name;
          o.textContent = rp.name + (rp.files != null ? " (" + rp.files + " files)" : "");
          repoSel.appendChild(o);
        });
        /* Preselect from another view (e.g. Terminal's "Ask AI to fix"). */
        try {
          var pendingRepo = sessionStorage.getItem("neutron_pending_repo");
          if (pendingRepo) {
            sessionStorage.removeItem("neutron_pending_repo");
            for (var i = 0; i < repoSel.options.length; i++) {
              if (repoSel.options[i].value === pendingRepo) { repoSel.selectedIndex = i; break; }
            }
          }
        } catch (e) { /* private mode — selection stays default */ }
      }
    } catch (e) {
      repoSel.innerHTML = "";
      var o3 = document.createElement("option");
      o3.textContent = "Could not load repositories";
      repoSel.appendChild(o3);
      repoSel.disabled = true;
    }

    startBtn.onclick = function () {
      startRun({
        goal: goal.value,
        repo: repoSel.value,
        projectId: projSel.value,
        autoApproveEdits: !!chk.checked,
        button: startBtn,
      });
    };
  }

  function projectContextBlock(projectId) {
    if (!projectId || !UI.buildProjectContextBlock) return "";
    try {
      var store = JSON.parse(localStorage.getItem("neutron_projects") || "null");
      var pr = store && UI.projectGet ? UI.projectGet(store, projectId) : null;
      return pr ? UI.buildProjectContextBlock(pr) : "";
    } catch (e) { return ""; }
  }

  async function startRun(opts) {
    if (S.starting) return;
    var goal = (opts.goal || "").trim();
    if (!goal) { showError("Describe the goal first."); return; }
    if (!opts.repo) { showError("Pick a repository."); return; }
    S.starting = true;
    opts.button.disabled = true;
    opts.button.textContent = "Starting…";
    try {
      var r = await api("POST", "/api/agent/runs", {
        goal: goal,
        repo: opts.repo,
        projectContext: projectContextBlock(opts.projectId),
        autoApproveEdits: opts.autoApproveEdits,
      });
      S.runId = r.run.id;
      S.run = r.run;
      announce("Agent run started.");
      paintRun();
      startPolling();
    } catch (e) {
      showError(e && e.message ? e.message : "Could not start the agent run.");
    } finally {
      S.starting = false;
      opts.button.disabled = false;
      opts.button.textContent = "Start agent run";
    }
  }

  /* ---------- polling ---------- */

  function startPolling() {
    stopPolling();
    S.pollTimer = setInterval(refreshRun, POLL_MS);
  }
  function stopPolling() {
    if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
  }
  function isTerminal(st) {
    return st === "completed" || st === "failed" || st === "stopped" || st === "denied";
  }

  async function refreshRun() {
    if (!S.runId) return;
    try {
      var r = await api("GET", "/api/agent/runs/" + encodeURIComponent(S.runId));
      var prevStatus = S.run && S.run.status;
      S.run = r.run;
      paintRun();
      if (isTerminal(r.run.status)) {
        stopPolling();
        if (prevStatus !== r.run.status) announce("Agent run " + r.run.status + ".");
      }
    } catch (e) { /* transient poll failure — keep the last state, retry next tick */ }
  }

  /* ---------- run panel ---------- */

  function paintRun() {
    var panel = S.runPanel;
    if (!panel) return;
    panel.innerHTML = "";
    var run = S.run;
    if (!run) {
      panel.appendChild(el("p", "muted", "No run yet. Describe a goal above to start."));
      return;
    }

    var head = el("div", "ag-head");
    var title = el("div", null);
    title.appendChild(el("h2", null, "Run · " + run.repo));
    title.appendChild(el("p", "muted small ag-goal-line", run.goal));
    head.appendChild(title);
    var side = el("div", "ag-side");
    var pill = el("span", "pill " + statusClass(run.status), STATUS_LABELS[run.status] || run.status);
    side.appendChild(pill);
    var budget = el("span", "muted small",
      "Step " + run.stepsUsed + "/" + run.maxSteps +
      " · " + Math.round((run.elapsedMs || 0) / 1000) + "s");
    side.appendChild(budget);
    if (!isTerminal(run.status)) {
      var stopBtn = el("button", "btn sm danger", "Stop");
      stopBtn.setAttribute("aria-label", "Stop the agent run");
      stopBtn.onclick = stopCurrentRun;
      side.appendChild(stopBtn);
    }
    head.appendChild(side);
    panel.appendChild(head);
    if (run.error) panel.appendChild(el("div", "ag-error", run.error));

    paintApprovals(panel, run);
    paintTimeline(panel, run);
    paintReport(panel, run);
  }

  async function stopCurrentRun() {
    if (!S.runId) return;
    try {
      var r = await api("POST", "/api/agent/runs/" + encodeURIComponent(S.runId) + "/stop");
      S.run = r.run;
      stopPolling();
      paintRun();
      toast("Run stopped.");
    } catch (e) {
      showError(e && e.message ? e.message : "Could not stop the run.");
    }
  }

  /* ---------- approvals ---------- */

  function paintApprovals(panel, run) {
    var pending = (run.approvals || []).filter(function (a) { return a.status === "pending"; });
    if (!pending.length) return;
    var box = el("div", "ag-approvals");
    box.setAttribute("role", "alert");
    pending.forEach(function (a) {
      var card = el("div", "panel ag-card");
      card.appendChild(el("h3", null, a.kind === "plan" ? "Approve the plan?" : "Approve this action?"));
      var detail = el("pre", "ag-detail", a.detail);
      card.appendChild(detail);
      if (a.kind === "tool" && a.args) {
        var argLine = el("p", "muted small", "args: " + summarizeArgs(a.tool, a.args));
        card.appendChild(argLine);
      }
      var btns = el("div", "ag-btns");
      var ok = el("button", "btn primary sm", "Approve");
      ok.disabled = !!S.deciding[a.id];
      ok.onclick = function () { decideApproval(a.id, true); };
      var no = el("button", "btn sm", "Reject");
      no.disabled = !!S.deciding[a.id];
      no.onclick = function () { decideApproval(a.id, false); };
      btns.appendChild(ok);
      btns.appendChild(no);
      card.appendChild(btns);
      box.appendChild(card);
    });
    panel.appendChild(box);
  }

  function summarizeArgs(tool, args) {
    try {
      if (tool === "write_file" && typeof args.content === "string") {
        return "path=" + args.path + " (" + args.content.length + " chars)";
      }
      return Object.keys(args).map(function (k) {
        var v = args[k];
        var s = typeof v === "string" ? (v.length > 120 ? v.slice(0, 120) + "…" : v) : JSON.stringify(v);
        return k + "=" + s;
      }).join(", ");
    } catch (e) { return ""; }
  }

  async function decideApproval(approvalId, approved) {
    if (!S.runId || S.deciding[approvalId]) return;
    S.deciding[approvalId] = true;
    paintRun();
    try {
      var r = await api("POST",
        "/api/agent/runs/" + encodeURIComponent(S.runId) + "/approvals/" + encodeURIComponent(approvalId),
        { approved: approved });
      S.run = r.run;
      paintRun();
      startPolling();
      toast(approved ? "Approved." : "Rejected.");
    } catch (e) {
      showError(e && e.message ? e.message : "Could not record the decision.");
    } finally {
      delete S.deciding[approvalId];
      paintRun();
    }
  }

  /* ---------- timeline ---------- */

  function paintTimeline(panel, run) {
    var box = el("div", "ag-timeline");
    box.appendChild(el("h3", null, "Steps"));
    var steps = run.steps || [];
    if (!steps.length) {
      box.appendChild(el("p", "muted small", "Waiting for the first step…"));
    }
    // Phase progress strip.
    var strip = el("div", "ag-phases");
    PHASE_ORDER.forEach(function (ph) {
      var idx = PHASE_ORDER.indexOf(run.phase);
      var mine = PHASE_ORDER.indexOf(ph);
      var cls = "ag-phase" + (mine < idx ? " done" : mine === idx ? " cur" : "");
      var b = el("span", cls, PHASE_LABELS[ph]);
      strip.appendChild(b);
    });
    box.appendChild(strip);

    var list = el("ol", "ag-steps");
    list.setAttribute("aria-live", "polite");
    steps.slice().reverse().forEach(function (s) {
      var li = el("li", "ag-step");
      var top = el("div", "ag-step-top");
      top.appendChild(el("span", "ag-step-n", "#" + s.n));
      top.appendChild(el("span", "ag-phase " + (s.phase === run.phase && !isTerminal(run.status) ? "cur" : ""), PHASE_LABELS[s.phase] || s.phase));
      if (s.tool) top.appendChild(el("code", "ag-tool", s.tool));
      li.appendChild(top);
      if (s.thought) li.appendChild(el("p", "ag-thought", s.thought));
      if (s.error) li.appendChild(el("p", "ag-error-line", s.error));
      if (s.resultSummary) {
        var det = document.createElement("details");
        det.className = "ag-result";
        var sum = document.createElement("summary");
        sum.textContent = "Result";
        det.appendChild(sum);
        det.appendChild(el("pre", "ag-detail", s.resultSummary));
        li.appendChild(det);
      }
      if (s.approvalId) li.appendChild(el("p", "muted small", "→ approval requested"));
      list.appendChild(li);
    });
    box.appendChild(list);
    panel.appendChild(box);
  }

  /* ---------- final report ---------- */

  function paintReport(panel, run) {
    if (!isTerminal(run.status) || !run.report) return;
    var rep = run.report;
    var box = el("div", "panel ag-report");
    box.appendChild(el("h3", null, "Final report"));
    if (rep.summary) box.appendChild(el("p", null, rep.summary));

    var files = rep.filesChanged || [];
    if (files.length) {
      box.appendChild(el("h4", null, "Files changed (" + files.length + ")"));
      var ul = el("ul", "ag-files");
      files.forEach(function (f, i) {
        var li = el("li", null);
        var line = el("div", "ag-file-line");
        line.appendChild(el("span", "ag-kind " + f.kind, f.kind));
        line.appendChild(el("code", null, f.path));
        var verdict = S.verdicts[i];
        if (verdict) {
          line.appendChild(el("span", "pill " + (verdict === "accepted" ? "ok" : "warn"),
            verdict === "accepted" ? "Accepted" : "Reverted"));
        }
        if (f.diff && verdict !== "reverted") {
          var tgl = el("button", "btn ghost sm", S.showDiff[i] ? "Hide diff" : "Show diff");
          tgl.setAttribute("aria-expanded", S.showDiff[i] ? "true" : "false");
          tgl.onclick = function () { S.showDiff[i] = !S.showDiff[i]; paintRun(); };
          line.appendChild(tgl);
        }
        if (rep.checkpointId && !verdict) {
          var acc = el("button", "btn ghost sm", "Accept");
          acc.setAttribute("aria-label", "Accept change to " + f.path);
          acc.onclick = (function (idx) {
            return function () { S.verdicts[idx] = "accepted"; paintRun(); toast("Change accepted."); };
          })(i);
          var rej = el("button", "btn ghost sm", "Reject");
          rej.setAttribute("aria-label", "Reject change to " + f.path + " and revert it from the checkpoint");
          rej.onclick = (function (idx, file) {
            return function () { rejectFileChange(idx, file); };
          })(i, f);
          line.appendChild(acc);
          line.appendChild(rej);
        }
        li.appendChild(line);
        if (f.diff && S.showDiff[i] && verdict !== "reverted" && window.NeutronDiff && UI.parseCompactDiff) {
          var holder = el("div", "ag-diff");
          window.NeutronDiff.renderRows(holder, UI.parseCompactDiff(f.diff),
            { ariaLabel: "Diff for " + f.path });
          li.appendChild(holder);
        }
        ul.appendChild(li);
      });
      box.appendChild(ul);
      /* AI code review of the agent's own changes (uses the user's BYOK provider). */
      var revRow = el("div", "row");
      var revBtn = el("button", "btn sm", "Review changes");
      revBtn.type = "button";
      revBtn.title = "Ask your AI to review these changes";
      revBtn.setAttribute("aria-label", "Ask AI to review the agent's changes");
      var revBox = el("div", "ag-review");
      revBtn.onclick = function () {
        if (!window.NeutronInsights) {
          revBox.appendChild(el("p", "error", "Review UI not loaded."));
          return;
        }
        var unified = UI.compactDiffsToUnified(files);
        window.NeutronInsights.reviewChanges(unified, revBox);
      };
      revRow.appendChild(revBtn);
      box.appendChild(revRow);
      box.appendChild(revBox);
    } else {
      box.appendChild(el("p", "muted", "No files were changed."));
    }

    if (rep.tests) {
      var t = rep.tests;
      var tline = el("p", null,
        "Tests: " + (t.detected ? t.detected : "no test command detected") +
        (t.exitCode == null ? "" : t.exitCode === 0 ? " — passed" : " — failed (exit " + t.exitCode + ")"));
      box.appendChild(tline);
      if (t.tail) {
        var det = document.createElement("details");
        det.className = "ag-result";
        var sum = document.createElement("summary");
        sum.textContent = "Test output";
        det.appendChild(sum);
        det.appendChild(el("pre", "ag-detail", t.tail));
        box.appendChild(det);
      }
    }

    if (rep.checkpointId) {
      var cp = el("div", "ag-checkpoint");
      cp.appendChild(el("p", "muted small",
        "Checkpoint holds " + (rep.checkpointFiles || []).length + " file(s) from before the agent's edits."));
      var rb = el("button", "btn sm", S.restoring ? "Restoring…" : "Restore checkpoint");
      rb.disabled = !!S.restoring;
      rb.onclick = restoreCheckpoint;
      cp.appendChild(rb);
      box.appendChild(cp);
    }
    panel.appendChild(box);
  }

  async function restoreCheckpoint() {
    if (!S.runId || S.restoring) return;
    if (!window.confirm("Restore the pre-run checkpoint? This undoes the agent's file changes.")) return;
    S.restoring = true;
    paintRun();
    try {
      var r = await api("POST", "/api/agent/runs/" + encodeURIComponent(S.runId) + "/restore-checkpoint");
      S.run = r.run;
      // Every changed file now matches the checkpoint — mark them reverted.
      var n = (S.run && S.run.report && S.run.report.filesChanged) || [];
      for (var i = 0; i < n.length; i++) S.verdicts[i] = "reverted";
      paintRun();
      var note = "Checkpoint restored (" + (r.restored || []).length + " files).";
      if (r.preRestoreId) note += " (A pre-restore snapshot was saved first.)";
      toast(note);
      announce("Checkpoint restored.");
    } catch (e) {
      showError(e && e.message ? e.message : "Could not restore the checkpoint.");
    } finally {
      S.restoring = false;
      paintRun();
    }
  }

  /** Reject one file's change: revert just that file from the checkpoint. */
  async function rejectFileChange(idx, f) {
    var cpId = S.run && S.run.report && S.run.report.checkpointId;
    if (!cpId || !S.run) return;
    if (!window.confirm("Reject the change to " + f.path + "?\n\nOnly this file is reverted to the pre-run checkpoint.")) return;
    try {
      await api("POST", "/api/checkpoints/" + encodeURIComponent(cpId) + "/restore-file",
        { repo: S.run.repo, path: f.path });
      S.verdicts[idx] = "reverted";
      paintRun();
      toast("Reverted " + f.path + " from the checkpoint.");
      announce("Change to " + f.path + " reverted.");
    } catch (e) {
      showError(e && e.message ? e.message : "Could not revert the file.");
    }
  }

  window.NeutronAgent = {
    renderAgent: renderAgent,
    teardown: teardown,
  };
})();
