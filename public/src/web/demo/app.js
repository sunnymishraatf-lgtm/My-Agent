/* NEUTRON web demo frontend.
 * Talks only to /api/demo/* (server-side). No API keys, no secrets here.
 * All dynamic text is set via textContent — never innerHTML with server data.
 */
(function () {
  "use strict";

  var STAGE_ORDER = [
    "repository-analysis",
    "impact-analysis",
    "implementation-plan",
    "human-approval",
    "agent-execution",
    "testing",
    "security",
    "code-review",
    "release-readiness",
  ];
  var STAGE_LABELS = {
    "repository-analysis": "Repository Analysis",
    "impact-analysis": "Impact Analysis",
    "implementation-plan": "Implementation Plan",
    "human-approval": "Human Approval",
    "agent-execution": "Agent Execution",
    "testing": "Testing",
    "security": "Security",
    "code-review": "Code Review",
    "release-readiness": "Release Readiness",
  };
  var STAGE_ICONS = {
    pending: "○",
    running: "◉",
    completed: "✓",
    failed: "⚠",
    skipped: "⊘",
  };

  var state = {
    analysisId: null,
    approvalToken: null,
    jobId: null,
    pollTimer: null,
    status: null,
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function showError(msg) {
    var bar = $("error-bar");
    bar.textContent = msg;
    bar.classList.remove("hidden");
  }
  function clearError() {
    $("error-bar").classList.add("hidden");
    $("error-bar").textContent = "";
  }

  async function api(method, path, body) {
    var opts = { method: method, headers: { "content-type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(path, opts);
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok || json.ok === false) {
      var err = new Error(json.error || ("HTTP " + res.status));
      err.status = res.status;
      err.requiresApproval = !!json.requiresApproval;
      throw err;
    }
    return json;
  }

  /* ---------------- stages ---------------- */

  function renderStages(stages) {
    var list = $("stages");
    list.innerHTML = "";
    var byKey = {};
    (stages || []).forEach(function (s) { byKey[s.key] = s; });
    STAGE_ORDER.forEach(function (key) {
      var s = byKey[key] || { key: key, status: "pending" };
      var li = el("li", "stage");
      li.setAttribute("data-status", s.status);
      li.appendChild(el("span", "icon", STAGE_ICONS[s.status] || "○"));
      var wrap = el("span");
      wrap.appendChild(el("div", "s-label", STAGE_LABELS[key] || key));
      if (s.detail) wrap.appendChild(el("div", "s-detail", s.detail));
      li.appendChild(wrap);
      list.appendChild(li);
    });
  }

  /* ---------------- events ---------------- */

  function renderEvents(events, total) {
    var log = $("event-log");
    log.innerHTML = "";
    (events || []).forEach(function (ev) {
      var div = el("div", "event");
      var ts = "";
      try { ts = new Date(ev.ts).toLocaleTimeString(); } catch (e) { /* ignore */ }
      div.appendChild(el("span", "e-ts", ts));
      div.appendChild(el("span", "e-stage", ev.stage));
      div.appendChild(el("div", null, ev.message));
      log.appendChild(div);
    });
    if (total && total > (events || []).length) {
      var more = el("div", "muted small", "… " + (total - events.length) + " earlier events (full audit in run archive)");
      log.insertBefore(more, log.firstChild);
    }
    log.scrollTop = log.scrollHeight;
  }

  function setJobState(text) {
    $("job-state").textContent = text;
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    renderStages(null);
    try {
      var s = await api("GET", "/api/demo/status");
      state.status = s;
      var pill = $("llm-pill");
      if (s.providerConfigured) {
        pill.textContent = "LLM: connected";
        pill.classList.add("ok");
      } else {
        pill.textContent = "LLM: not configured";
        pill.classList.add("warn");
      }
      var note = $("llm-note");
      note.textContent = s.llmNote;
      note.classList.remove("hidden");
      if (!s.providerConfigured) note.classList.add("amber");
      if (s.serverless) {
        var sn = $("serverless-note");
        sn.textContent = "Serverless demo: repository analysis, impact analysis, planning and approval run live here. Full agent execution needs the persistent Node host (see docs/DEPLOYMENT.md).";
        sn.classList.remove("hidden");
      }
      $("demo-repo-desc").textContent = s.demoDescription;
      if (!$("request-input").value) $("request-input").value = s.defaultRequest;
    } catch (e) {
      showError("Could not reach the demo API: " + e.message);
    }
  }

  /* ---------------- prepare ---------------- */

  $("btn-prepare").addEventListener("click", async function () {
    clearError();
    var btn = $("btn-prepare");
    btn.disabled = true;
    $("prepare-state").textContent = "Preparing…";
    try {
      var r = await api("POST", "/api/demo/prepare");
      $("repo-input").value = "demo";
      $("prepare-state").textContent = r.reused
        ? "Demo repository ready (" + r.files + " files)."
        : "Scaffolded " + r.files + " files.";
      $("repo-state").textContent = "Selected repository: demo (taskflow)";
    } catch (e) {
      showError(e.message);
      $("prepare-state").textContent = "";
    } finally {
      btn.disabled = false;
    }
  });

  $("btn-clone").addEventListener("click", async function () {
    clearError();
    var v = $("repo-input").value.trim();
    if (!/^https?:\/\//i.test(v)) {
      showError("Paste a https://github.com/<owner>/<repo> URL to clone, or use \"demo\".");
      return;
    }
    $("repo-state").textContent = "Cloning…";
    try {
      var r = await api("POST", "/api/demo/clone", { url: v });
      $("repo-input").value = r.repository;
      $("repo-state").textContent = "Cloned: " + r.repository;
    } catch (e) {
      showError(e.message);
      $("repo-state").textContent = "";
    }
  });

  /* ---------------- analyze ---------------- */

  $("btn-analyze").addEventListener("click", async function () {
    clearError();
    stopPolling();
    var btn = $("btn-analyze");
    btn.disabled = true;
    $("analyze-state").textContent = "Analyzing… (real NEUTRON analysis)";
    $("analysis-panel").classList.add("hidden");
    $("plan-panel").classList.add("hidden");
    $("results-panel").classList.add("hidden");
    renderStages([
      { key: "repository-analysis", status: "running" },
      { key: "impact-analysis", status: "pending" },
      { key: "implementation-plan", status: "pending" },
    ]);
    setJobState("Analyzing…");
    try {
      var r = await api("POST", "/api/demo/analyze", {
        repo: $("repo-input").value.trim() || "demo",
        request: $("request-input").value,
        riskTolerance: $("risk-input").value,
      });
      state.analysisId = r.analysisId;
      renderAnalysis(r);
      renderStages([
        { key: "repository-analysis", status: "completed" },
        { key: "impact-analysis", status: "completed" },
        { key: "implementation-plan", status: "completed" },
        { key: "human-approval", status: "pending" },
      ]);
      $("analysis-panel").classList.remove("hidden");
      $("plan-panel").classList.remove("hidden");
      $("btn-approve").disabled = false;
      $("btn-reject").disabled = false;
      $("btn-execute").classList.add("hidden");
      $("gate-state").textContent = "Review the plan, then approve or reject.";
      $("analyze-state").textContent = "Analysis complete.";
      setJobState("Analysis complete — awaiting plan approval.");
    } catch (e) {
      showError(e.message);
      renderStages(null);
      $("analyze-state").textContent = "";
      setJobState("Analysis failed.");
    } finally {
      btn.disabled = false;
    }
  });

  function kv(container, k, v) {
    var d = el("div", "kv");
    d.appendChild(el("div", "k", k));
    d.appendChild(el("div", "v", v));
    container.appendChild(d);
  }

  function renderAnalysis(r) {
    var a = r.analysis || {};
    var sum = $("analysis-summary");
    sum.innerHTML = "";
    kv(sum, "Files analyzed", a.filesAnalyzed);
    kv(sum, "Nodes", a.nodeCount);
    kv(sum, "Health", (a.health !== undefined ? a.health : "—") + (a.health !== undefined ? "%" : ""));
    kv(sum, "Entry points", (a.entryPoints || []).length);
    var tech = $("analysis-tech");
    tech.innerHTML = "";
    (a.languages || []).concat(a.frameworks || []).concat(a.packageManagers || []).forEach(function (t) {
      tech.appendChild(el("span", "chip", t));
    });
    if (!tech.children.length) tech.appendChild(el("span", "muted small", "Not available"));

    var g = r.impact || {};
    var s = g.summary || {};
    var breaks = $("impact-breaks");
    breaks.innerHTML = "";
    var wb = g.whatCouldBreak || [];
    if (!wb.length) breaks.appendChild(el("li", "muted", "No medium/high/critical impact found — nothing flagged."));
    wb.slice(0, 12).forEach(function (w) { breaks.appendChild(el("li", null, w)); });

    var nodes = g.nodes || [];
    $("impact-count").textContent = "— " + (s.files !== undefined ? s.files : nodes.length) + " files in scope";
    var tbody = $("impact-table").querySelector("tbody");
    tbody.innerHTML = "";
    nodes.slice(0, 40).forEach(function (n) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", null, n.path));
      tr.appendChild(el("td", null, n.category));
      var imp = el("td", "impact-" + n.impact, n.impact);
      tr.appendChild(imp);
      tr.appendChild(el("td", null, Math.round((n.confidence || 0) * 100) + "%"));
      tbody.appendChild(tr);
    });
    if (!nodes.length) {
      var tr = document.createElement("tr");
      var td = el("td", "muted", "No affected files detected.");
      td.setAttribute("colspan", "4");
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    var p = r.plan || {};
    $("plan-meta").textContent =
      (p.tasks || []).length + " tasks · " +
      (p.affectedFiles || []).length + " files affected · " +
      (p.affectedServices || []).length + " services · " +
      (p.affectedTests || []).length + " tests · risk " + (p.overallRisk || "unknown");
    var tasks = $("plan-tasks");
    tasks.innerHTML = "";
    (p.tasks || []).forEach(function (t, i) {
      var li = document.createElement("li");
      li.appendChild(el("div", null, (i + 1) + ". " + t.label));
      li.appendChild(el("span", "t-meta", "[" + t.agent + "] risk=" + t.risk + " files=" + (t.files || []).slice(0, 4).join(", ") + ((t.files || []).length > 4 ? "…" : "")));
      tasks.appendChild(li);
    });
  }

  /* ---------------- approve / reject ---------------- */

  $("btn-approve").addEventListener("click", async function () {
    clearError();
    if (!state.analysisId) return;
    $("gate-state").textContent = "Recording approval…";
    try {
      var r = await api("POST", "/api/demo/approve", { analysisId: state.analysisId });
      state.approvalToken = r.approvalToken || null; // serverless: signed token; Node server: undefined (server-side gate)
      $("btn-approve").disabled = true;
      $("btn-reject").disabled = true;
      $("btn-execute").classList.remove("hidden");
      $("gate-state").textContent = "Plan approved (single-use, recorded server-side). You can now execute.";
      renderStages([
        { key: "repository-analysis", status: "completed" },
        { key: "impact-analysis", status: "completed" },
        { key: "implementation-plan", status: "completed" },
        { key: "human-approval", status: "completed", detail: "approved in web demo" },
      ]);
      setJobState("Plan approved — ready to execute.");
    } catch (e) {
      showError(e.message);
      $("gate-state").textContent = "";
    }
  });

  $("btn-reject").addEventListener("click", async function () {
    clearError();
    if (!state.analysisId) return;
    try {
      await api("POST", "/api/demo/reject", { analysisId: state.analysisId });
      $("btn-approve").disabled = true;
      $("btn-reject").disabled = true;
      $("btn-execute").classList.add("hidden");
      $("gate-state").textContent = "Plan rejected. Nothing was changed — refine the request and analyze again.";
      setJobState("Plan rejected.");
    } catch (e) {
      showError(e.message);
    }
  });

  /* ---------------- execute + poll ---------------- */

  $("btn-execute").addEventListener("click", async function () {
    clearError();
    if (!state.analysisId) return;
    var btn = $("btn-execute");
    btn.disabled = true;
    $("execute-state").textContent = "Starting…";
    try {
      var r = await api("POST", "/api/demo/execute", {
        analysisId: state.analysisId,
        approvalToken: state.approvalToken, // ignored by the Node server; validated on serverless
      });
      if (r.executionUnsupported) {
        // Honest serverless limit: show it plainly instead of faking a run.
        var box = $("execute-state");
        box.innerHTML = "";
        box.appendChild(el("div", "warn-t", "Full agent execution isn't available on this demo deployment."));
        box.appendChild(el("div", "small muted", r.message || "Run the persistent Node server to see execution."));
        setJobState("Execution unavailable here — analysis, impact, plan and approval above are 100% real.");
        btn.disabled = false;
        return;
      }
      state.jobId = r.job.jobId;
      $("execute-state").textContent = "Running — live below.";
      setJobState("Job " + state.jobId + " running…");
      startPolling();
    } catch (e) {
      showError(e.message);
      $("execute-state").textContent = "";
      btn.disabled = false;
    }
  });

  function startPolling() {
    stopPolling();
    pollOnce();
    state.pollTimer = setInterval(pollOnce, 1000);
  }
  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function pollOnce() {
    if (!state.jobId) return;
    try {
      var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(state.jobId));
      var job = r.job;
      renderStages(job.stages);
      renderEvents(job.events, job.eventCount);
      setJobState("Job " + job.jobId + " — " + job.status);
      if (job.status === "completed" || job.status === "failed" || job.status === "denied") {
        stopPolling();
        $("execute-state").textContent = "Finished: " + job.status + ".";
        await loadResult();
      }
    } catch (e) {
      showError("Lost contact with job: " + e.message);
      stopPolling();
    }
  }

  async function loadResult() {
    try {
      var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(state.jobId) + "/result");
      renderResult(r.result, r.job);
    } catch (e) {
      showError("Could not load results: " + e.message);
    }
  }

  function setResult(id, ok, lines) {
    var box = $(id);
    box.innerHTML = "";
    var head = el("div", ok === true ? "ok" : ok === false ? "bad" : "warn-t", lines[0]);
    box.appendChild(head);
    lines.slice(1).forEach(function (l) { box.appendChild(el("div", "small muted", l)); });
  }

  function renderResult(res, job) {
    if (!res) {
      if (job && job.status === "denied") {
        $("results-panel").classList.remove("hidden");
        setResult("res-tests", null, ["Not run", "Plan was not approved."]);
      }
      return;
    }
    $("results-panel").classList.remove("hidden");
    var note = $("results-note");
    if (res.llmNote) {
      note.textContent = res.llmNote;
      note.classList.remove("hidden");
      note.classList.add("amber");
    } else {
      note.classList.add("hidden");
    }

    if (res.tests) {
      var t = res.tests;
      if (t.after) setResult("res-tests", t.after.failed === 0, [
        t.after.passed + "/" + t.after.total + " passed",
        "command: " + t.command,
        t.regression ? "REGRESSION detected" : "no regression",
      ]);
      else setResult("res-tests", null, ["Not executed", (t.stdoutTail || "no output").slice(0, 200)]);
    } else setResult("res-tests", null, ["Not available"]);

    if (res.security) {
      var sec = res.security;
      setResult("res-security", sec.blocked ? false : true, [
        sec.blocked ? "BLOCKED" : sec.findings.length + " finding(s)",
        sec.summary,
      ]);
      if (sec.findings.length) {
        var ul = el("ul", "list");
        sec.findings.slice(0, 8).forEach(function (f) {
          ul.appendChild(el("li", null, "[" + f.severity + "] " + f.title + (f.file ? " — " + f.file : "")));
        });
        $("res-security").appendChild(ul);
      }
    } else setResult("res-security", null, ["Not available"]);

    if (res.codeReview) {
      var cr = res.codeReview;
      setResult("res-review", cr.passed, [
        "Score " + cr.score + "/100 — " + (cr.passed ? "PASS" : "FAIL"),
        cr.summary,
      ]);
    } else setResult("res-review", null, ["Not available"]);

    if (res.release) {
      var rel = res.release;
      var ok = rel.status === "released" || rel.status === "ready-for-review";
      setResult("res-release", rel.status === "blocked" ? false : ok ? true : null, [
        "Status: " + rel.status,
      ].concat((rel.blockedBy || []).slice(0, 4)));
    } else setResult("res-release", null, ["Not available"]);

    var ch = $("res-changes");
    ch.innerHTML = "";
    if (res.execution) {
      var ex = res.execution;
      ch.appendChild(el("div", null,
        ex.completed + " completed · " + ex.failed + " failed · " + ex.blocked + " blocked · " + ex.changes.length + " file change(s)"));
      if (ex.noLlm) ch.appendChild(el("div", "warn-t", "Implementation skipped: no LLM provider on this server. Nothing was fabricated."));
      ex.changes.slice(0, 20).forEach(function (c) {
        ch.appendChild(el("div", null, c.kind + " " + c.path + " (+" + c.linesAdded + "/-" + c.linesRemoved + ") [" + c.agent + "]"));
      });
    } else {
      ch.textContent = "Not available";
    }

    var dw = $("res-deviations-wrap");
    if (res.deviations && res.deviations.length) {
      dw.classList.remove("hidden");
      var dul = $("res-deviations");
      dul.innerHTML = "";
      res.deviations.forEach(function (d) { dul.appendChild(el("li", null, d)); });
    } else dw.classList.add("hidden");

    var ew = $("res-errors-wrap");
    if (res.errors && res.errors.length) {
      ew.classList.remove("hidden");
      var eul = $("res-errors");
      eul.innerHTML = "";
      res.errors.forEach(function (d) { eul.appendChild(el("li", null, d)); });
    } else ew.classList.add("hidden");

    document.getElementById("results-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  boot();
})();
