/* ==========================================================================
   NEUTRON project intelligence UI (Phases 7/9/10/11):
   AI code review, Security Center, Dependency Center, Project Health.
   Classic script; uses globals from app.js at call time (el, api,
   showError, clearError, toast, announce) and pure helpers on
   window.NeutronUI. Node server only — serverless gets an honest note.
   Every finding/metric shown here comes from a real scan or an honest
   "unknown"/"never scanned" state. Nothing is invented.
   ========================================================================== */
(function () {
  "use strict";

  function ui() { return window.NeutronUI || {}; }
  function errText(e) { return (e && e.message) ? e.message : String(e); }

  var SEV_CLASS = { critical: "bad", high: "bad", medium: "warn", low: "", info: "muted" };
  var CAT_CLASS = { BUG: "bad", SECURITY: "bad", PERFORMANCE: "warn", TESTING: "ok", STYLE: "muted", MAINTAINABILITY: "" };
  var HEALTH_DOT = { good: "ok", attention: "bad", unknown: "muted" };

  /* ---------- shared ---------- */

  async function nodeOnly(view, title, what) {
    var h = null;
    try { h = await api("GET", "/api/health"); } catch (e) { /* offline */ }
    if (!h || h.serverless) {
      view.appendChild(el("h1", null, title));
      view.appendChild(el("p", "muted",
        what + " need the Node server — serverless hosting has no workspace to scan. " +
        "Run the app with \u201cnode dist/cli-entry.js web\u201d for the full experience."));
      return false;
    }
    return true;
  }

  async function loadRepos() {
    var r = await api("GET", "/api/demo/repos");
    var repos = (r && Array.isArray(r.repos)) ? r.repos : [];
    return repos.map(function (x) { return (x && x.name) || ""; }).filter(Boolean);
  }

  function repoPicker(onchange) {
    var wrap = el("div", "row");
    var label = el("label", "fld-label", "Repository");
    var sel = document.createElement("select");
    sel.className = "input";
    sel.setAttribute("aria-label", "Repository");
    var loading = document.createElement("option");
    loading.textContent = "Loading…";
    sel.appendChild(loading);
    wrap.appendChild(label);
    wrap.appendChild(sel);
    loadRepos().then(function (repos) {
      sel.innerHTML = "";
      if (!repos.length) {
        var o = document.createElement("option");
        o.value = "";
        o.textContent = "No workspace repositories";
        sel.appendChild(o);
        return;
      }
      repos.forEach(function (n) {
        var op = document.createElement("option");
        op.value = n;
        op.textContent = n;
        sel.appendChild(op);
      });
      sel.onchange = function () { onchange(sel.value); };
      onchange(sel.value);
    }).catch(function (e) {
      sel.innerHTML = "";
      var o = document.createElement("option");
      o.value = "";
      o.textContent = "Couldn't load repositories";
      sel.appendChild(o);
      showError(errText(e));
    });
    return wrap;
  }

  function scannedLine(scannedAt) {
    var U = ui();
    var ago = (U.timeAgo ? U.timeAgo(Date.parse(scannedAt), Date.now()) : scannedAt);
    return "Last scanned " + ago + ".";
  }

  function sevBadge(sev) {
    var b = el("span", "pill mono " + (SEV_CLASS[sev] || ""), String(sev || "?").toUpperCase());
    return b;
  }

  /* ======================================================================
     AI CODE REVIEW — shared by the Git panel and the Agent view.
     ====================================================================== */

  function renderReviewFindings(box, result, truncated) {
    box.innerHTML = "";
    if (truncated) {
      box.appendChild(el("p", "muted small",
        "Note: the diff exceeded the review size limit, so this is a partial review " +
        "of the first part of the changes."));
    }
    var findings = (result && result.findings) || [];
    if (!findings.length) {
      if (result && result.raw) {
        box.appendChild(el("p", "muted",
          "The AI didn't return structured findings — showing its raw reply instead:"));
        var pre = el("pre", "mono small review-raw");
        pre.textContent = String(result.raw).slice(0, 4000);
        box.appendChild(pre);
      } else {
        var ok = el("p", "ok");
        ok.textContent = "\u2713 No issues found — the AI reviewed the diff and reported nothing worth flagging.";
        box.appendChild(ok);
      }
      return;
    }
    var counts = {};
    findings.forEach(function (f) { counts[f.category] = (counts[f.category] || 0) + 1; });
    var sum = el("p", "muted small",
      findings.length + " finding(s): " +
      Object.keys(counts).map(function (c) { return counts[c] + " " + c; }).join(" · "));
    box.appendChild(sum);
    findings.forEach(function (f) {
      var card = el("div", "panel review-finding");
      var head = el("div", "row");
      head.appendChild(el("span", "pill mono " + (CAT_CLASS[f.category] || ""), f.category || "?"));
      head.appendChild(el("strong", null, f.problem || "(no summary)"));
      card.appendChild(head);
      if (f.evidence) {
        var ev = el("pre", "mono small review-evidence");
        ev.textContent = f.evidence;
        card.appendChild(ev);
      }
      if (f.why_it_matters) {
        var why = el("p", "small");
        why.appendChild(el("strong", null, "Why it matters: "));
        why.appendChild(document.createTextNode(f.why_it_matters));
        card.appendChild(why);
      }
      if (f.suggested_fix) {
        var fix = el("p", "small");
        fix.appendChild(el("strong", null, "Suggested fix: "));
        fix.appendChild(document.createTextNode(f.suggested_fix));
        card.appendChild(fix);
      }
      box.appendChild(card);
    });
  }

  /**
   * Run an AI review of a unified diff string and render into box.
   * Uses the user's own provider/key via /api/chat (BYOK) — never stored.
   */
  async function reviewChanges(diffText, box) {
    box.innerHTML = "";
    if (!String(diffText || "").trim()) {
      box.appendChild(el("p", "muted", "No changes to review."));
      return;
    }
    box.appendChild(el("p", "muted small", "Asking your AI to review the changes…"));
    var U = ui();
    var prompt = U.buildReviewPrompt(diffText, {});
    try {
      var res = await api("POST", "/api/chat", {
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      });
      var parsed = U.parseReviewFindings((res && res.text) || "");
      renderReviewFindings(box, parsed, prompt.truncated);
      if (typeof announce === "function") announce("Code review complete.");
    } catch (e) {
      box.innerHTML = "";
      var msg = errText(e);
      box.appendChild(el("p", "text-bad", "Review failed: " + msg));
      if (/provider|api key|401/i.test(msg)) {
        box.appendChild(el("p", "muted small",
          "Code review uses your configured AI provider (Settings → API key). " +
          "Set one up and try again."));
      }
    }
  }

  /* ======================================================================
     SECURITY CENTER
     ====================================================================== */

  function paintSecurity(box, data, onRescan) {
    box.innerHTML = "";
    if (!data || !data.scannedAt) {
      box.appendChild(el("p", "muted", "This repository has never been scanned."));
      var b0 = el("button", "btn primary", "Scan now");
      b0.type = "button";
      b0.onclick = onRescan;
      box.appendChild(b0);
      return;
    }
    box.appendChild(el("p", "muted small", scannedLine(data.scannedAt)));
    var counts = data.counts || {};
    var row = el("div", "row sec-counts");
    ["critical", "high", "medium", "low", "info"].forEach(function (s) {
      var chip = el("span", "pill " + (SEV_CLASS[s] || ""));
      chip.textContent = s.toUpperCase() + "  " + (counts[s] || 0);
      row.appendChild(chip);
    });
    box.appendChild(row);
    if (data.summary) box.appendChild(el("p", "small", data.summary));
    if (data.committedSecretsChecked === false) {
      box.appendChild(el("p", "muted small",
        "Note: the committed-secrets check needs a git repository — it was skipped."));
    }
    var findings = data.findings || [];
    if (!findings.length) {
      var ok = el("p", "ok");
      ok.textContent = "\u2713 No security issues detected.";
      box.appendChild(ok);
    } else {
      findings.forEach(function (f) {
        var det = document.createElement("details");
        det.className = "sec-finding";
        var sum = document.createElement("summary");
        sum.appendChild(sevBadge(f.severity));
        var t = document.createElement("span");
        t.textContent = " " + (f.title || "(no title)");
        sum.appendChild(t);
        det.appendChild(sum);
        if (f.file) {
          var fl = el("p", "mono small muted", f.file);
          det.appendChild(fl);
        }
        if (f.detail) {
          var d = el("p", "small");
          d.textContent = f.detail;
          det.appendChild(d);
        }
        var cat = el("p", "muted small", "Category: " + (f.category || "—"));
        det.appendChild(cat);
        box.appendChild(det);
      });
    }
    var b1 = el("button", "btn ghost", "Rescan");
    b1.type = "button";
    b1.onclick = onRescan;
    box.appendChild(b1);
  }

  async function renderSecurity(view) {
    view.appendChild(el("h1", null, "Security Center"));
    if (!(await nodeOnly(view, "Security Center", "Security scans"))) return;
    view.appendChild(el("p", "muted",
      "On-demand security scan of a workspace repository: static checks plus a " +
      "committed-secrets sweep over git-tracked files. Every finding carries evidence."));
    var box = el("div", "panel");
    view.appendChild(box);
    var results = el("div", null);
    view.appendChild(results);

    var current = "";
    function refresh() {
      if (!current) return;
      results.innerHTML = "";
      results.appendChild(el("p", "muted small", "Loading…"));
      api("GET", "/api/insights/security?repo=" + encodeURIComponent(current))
        .then(function (d) { paintSecurity(results, d, scan); })
        .catch(function (e) {
          results.innerHTML = "";
          results.appendChild(el("p", "text-bad", "Couldn't load scan results: " + errText(e)));
        });
    }
    function scan() {
      if (!current) return;
      results.innerHTML = "";
      results.appendChild(el("p", "muted small", "Scanning… this can take up to a minute on large repos."));
      api("POST", "/api/insights/security/scan", { repo: current })
        .then(function (d) {
          paintSecurity(results, d, scan);
          clearError();
          toast("Security scan complete.");
        })
        .catch(function (e) {
          results.innerHTML = "";
          results.appendChild(el("p", "text-bad", "Scan failed: " + errText(e)));
          var retry = el("button", "btn", "Retry");
          retry.type = "button";
          retry.onclick = scan;
          results.appendChild(retry);
        });
    }
    box.appendChild(repoPicker(function (r) { current = r; refresh(); }));
  }

  /* ======================================================================
     DEPENDENCY CENTER
     ====================================================================== */

  function depStatusBadges(p) {
    var out = [];
    if (p.vulns && p.vulns.length) {
      var v = el("span", "pill bad", "Vulnerable (" + p.vulns.length + ")");
      out.push(v);
    }
    if (p.deprecated) out.push(el("span", "pill warn", "Deprecated"));
    if (p.updateAvailable) out.push(el("span", "pill", "Update available"));
    if (!out.length) {
      out.push(el("span", "pill ok", p.latest === null ? "Latest unknown" : "Up to date"));
    }
    return out;
  }

  function paintDeps(box, data, repo, onRescan) {
    box.innerHTML = "";
    if (!data || !data.scannedAt) {
      box.appendChild(el("p", "muted", "Dependencies have never been scanned for this repository."));
      var b0 = el("button", "btn primary", "Scan now");
      b0.type = "button";
      b0.onclick = onRescan;
      box.appendChild(b0);
      return;
    }
    box.appendChild(el("p", "muted small", scannedLine(data.scannedAt)));
    var counts = data.counts || {};
    var row = el("div", "row sec-counts");
    row.appendChild(el("span", "pill", (counts.total || 0) + " packages"));
    row.appendChild(el("span", "pill", (counts.updates || 0) + " updates"));
    if (counts.deprecated) row.appendChild(el("span", "pill warn", counts.deprecated + " deprecated"));
    if (counts.vulnerable) row.appendChild(el("span", "pill bad", counts.vulnerable + " vulnerable"));
    box.appendChild(row);
    var mans = data.manifests || [];
    box.appendChild(el("p", "muted small",
      mans.length ? "Manifests: " + mans.join(", ") : "No dependency manifests detected."));
    if ((data.unsupported || []).length) {
      box.appendChild(el("p", "muted small",
        "Version lookups are npm-only — " + data.unsupported.join(", ") +
        " detected but not version-checked (honest gap, not an error)."));
    }
    if (data.auditNote) box.appendChild(el("p", "muted small", data.auditNote));

    var pkgs = data.packages || [];
    if (!pkgs.length) {
      box.appendChild(el("p", "muted", "No npm dependencies found."));
    } else {
      var table = el("table", "tbl");
      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      ["Package", "Current", "Latest", "Status"].forEach(function (c) {
        var th = document.createElement("th");
        th.textContent = c;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = document.createElement("tbody");
      pkgs.forEach(function (p) {
        var tr = document.createElement("tr");
        var nm = document.createElement("td");
        nm.className = "mono small";
        nm.textContent = p.name;
        tr.appendChild(nm);
        var cur = document.createElement("td");
        cur.className = "mono small";
        cur.textContent = p.current;
        tr.appendChild(cur);
        var lat = document.createElement("td");
        lat.className = "mono small";
        lat.textContent = p.latest || "unknown";
        tr.appendChild(lat);
        var st = document.createElement("td");
        depStatusBadges(p).forEach(function (b) { st.appendChild(b); });
        if (p.vulns && p.vulns.length) {
          p.vulns.forEach(function (v) {
            var vd = el("p", "small",
              "[" + (v.severity || "?") + "] " + (v.title || "vulnerability") +
              (v.via ? " (via " + v.via + ")" : ""));
            st.appendChild(vd);
          });
        }
        tr.appendChild(st);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      box.appendChild(table);
    }

    var btnRow = el("div", "row");
    var b1 = el("button", "btn ghost", "Rescan");
    b1.type = "button";
    b1.onclick = onRescan;
    btnRow.appendChild(b1);
    if (pkgs.length && (counts.updates || counts.vulnerable || counts.deprecated)) {
      var plan = el("button", "btn primary", "Plan upgrade with AI");
      plan.type = "button";
      plan.setAttribute("aria-label", "Open the agent with a dependency-upgrade goal");
      plan.onclick = function () {
        var notable = pkgs.filter(function (p) { return p.updateAvailable || p.vulns.length || p.deprecated; })
          .slice(0, 8).map(function (p) { return p.name + " " + p.current + " → " + (p.latest || "?"); });
        var goal = "Upgrade outdated dependencies in the " + repo + " repository. " +
          "State: " + (counts.updates || 0) + " updates available, " +
          (counts.deprecated || 0) + " deprecated, " + (counts.vulnerable || 0) + " vulnerable. " +
          "Notable: " + notable.join("; ") + ". " +
          "Work one dependency at a time starting with the vulnerable ones, " +
          "run the build and tests after each upgrade, and report what changed. " +
          "A checkpoint is created automatically before you start — restore it if an upgrade breaks things.";
        try { sessionStorage.setItem("neutron_pending_goal", goal); } catch (e) { /* ignore */ }
        location.hash = "#/agent";
      };
      btnRow.appendChild(plan);
    }
    box.appendChild(btnRow);
  }

  async function renderDeps(view) {
    view.appendChild(el("h1", null, "Dependency Center"));
    if (!(await nodeOnly(view, "Dependency Center", "Dependency scans"))) return;
    view.appendChild(el("p", "muted",
      "Dependency inventory from real manifests. Latest versions come from the npm " +
      "registry; vulnerabilities come from a real `npm audit` run. Anything " +
      "unverifiable is labeled unknown — never guessed."));
    var box = el("div", "panel");
    view.appendChild(box);
    var results = el("div", null);
    view.appendChild(results);

    var current = "";
    function refresh() {
      if (!current) return;
      results.innerHTML = "";
      results.appendChild(el("p", "muted small", "Loading…"));
      api("GET", "/api/insights/deps?repo=" + encodeURIComponent(current))
        .then(function (d) { paintDeps(results, d, current, scan); })
        .catch(function (e) {
          results.innerHTML = "";
          results.appendChild(el("p", "text-bad", "Couldn't load: " + errText(e)));
        });
    }
    function scan() {
      if (!current) return;
      results.innerHTML = "";
      results.appendChild(el("p", "muted small",
        "Scanning… registry lookups plus `npm audit`; can take a minute on large repos."));
      api("POST", "/api/insights/deps/scan", { repo: current })
        .then(function (d) {
          paintDeps(results, d, current, scan);
          clearError();
          toast("Dependency scan complete.");
        })
        .catch(function (e) {
          results.innerHTML = "";
          results.appendChild(el("p", "text-bad", "Scan failed: " + errText(e)));
          var retry = el("button", "btn", "Retry");
          retry.type = "button";
          retry.onclick = scan;
          results.appendChild(retry);
        });
    }
    box.appendChild(repoPicker(function (r) { current = r; refresh(); }));
  }

  /* ======================================================================
     PROJECT HEALTH
     ====================================================================== */

  function lastJobForRepo() {
    try {
      var raw = localStorage.getItem("neutron_job_history");
      var h = JSON.parse(raw || "[]");
      if (!Array.isArray(h) || !h.length) return null;
      return h[0] || null;
    } catch (e) { return null; }
  }

  async function renderHealth(view) {
    view.appendChild(el("h1", null, "Project Health"));
    if (!(await nodeOnly(view, "Project Health", "Health signals"))) return;
    view.appendChild(el("p", "muted",
      "Real signals from this project's actual state. No scores are invented — " +
      "anything unmeasured shows as unknown."));
    var box = el("div", "panel");
    view.appendChild(box);
    var results = el("div", null);
    view.appendChild(results);

    var current = "";
    async function refresh() {
      if (!current) return;
      results.innerHTML = "";
      results.appendChild(el("p", "muted small", "Gathering signals…"));
      var git = null, sec = null, deps = null;
      try {
        var g = await api("GET", "/api/git/status?repo=" + encodeURIComponent(current));
        git = { clean: !!g.clean, branch: g.branch || "", ahead: g.ahead || 0, behind: g.behind || 0 };
      } catch (e) { git = null; }
      try {
        var s = await api("GET", "/api/insights/security?repo=" + encodeURIComponent(current));
        sec = s && s.scannedAt ? { counts: s.counts } : null;
      } catch (e) { sec = null; }
      try {
        var d = await api("GET", "/api/insights/deps?repo=" + encodeURIComponent(current));
        deps = d && d.scannedAt ? { counts: d.counts } : null;
      } catch (e) { deps = null; }

      // Build/tests: last recorded maintain run (client-side job history).
      var build = null, tests = null, jobLink = null;
      var job = lastJobForRepo();
      if (job && job.jobId) {
        jobLink = "#/reports/" + encodeURIComponent(job.jobId);
        try {
          var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(job.jobId) + "/result");
          var res = r && (r.result || r);
          var ex = res && res.execution;
          if (ex && typeof ex === "object") {
            build = (ex.failed || 0) > 0 ? "failed" : ((ex.completed || 0) > 0 ? "passed" : null);
          } else if (res && Array.isArray(res.errors) && res.errors.length) {
            build = "failed";
          }
          var t = res && res.tests;
          if (t && typeof t === "object" && typeof t.total === "number") {
            tests = (t.failed || 0) > 0 ? "failed" : (t.total > 0 ? "passed" : null);
          }
        } catch (e) { /* result gone (server restart) — stays unknown, honestly */ }
      }

      var U = ui();
      var health = U.computeHealth({ git: git, security: sec, deps: deps, build: build, tests: tests });
      paintHealth(results, health, git, current, jobLink);
    }
    box.appendChild(repoPicker(function (r) { current = r; refresh(); }));
  }

  function paintHealth(box, health, git, repo, jobLink) {
    box.innerHTML = "";
    var banner = el("div", "panel health-banner " + (health.overall === "healthy" ? "ok" :
      health.overall === "attention" ? "bad" : ""));
    var title = el("strong", null,
      health.overall === "healthy" ? "Healthy" :
      health.overall === "attention" ? "Attention needed" : "Unknown");
    banner.appendChild(title);
    banner.appendChild(el("p", "muted small",
      "Overall rule: \u201cattention\u201d if the tree is dirty, any critical/high " +
      "security finding, any vulnerable dependency, or the last build/test run failed; " +
      "\u201chealthy\u201d if every measured signal is good; otherwise \u201cunknown\u201d. " +
      "No invented scores."));
    box.appendChild(banner);

    var links = { git: "#/repos", security: "#/security", deps: "#/deps", build: "#/reports", tests: "#/reports" };
    health.items.forEach(function (item) {
      var card = el("div", "panel health-card");
      var head = el("div", "row");
      head.appendChild(el("span", "dot " + (HEALTH_DOT[item.state] || "muted")));
      head.appendChild(el("strong", null, item.key.charAt(0).toUpperCase() + item.key.slice(1)));
      card.appendChild(head);
      card.appendChild(el("p", "muted small", item.label));
      if (item.key === "git" && git) {
        card.appendChild(el("p", "mono small muted",
          (git.branch || "?") + (git.ahead || git.behind ? " \u2191" + git.ahead + " \u2193" + git.behind : "")));
      }
      var href = links[item.key];
      if (href === "#/reports" && !jobLink) href = null;
      if (href) {
        var a = el("a", "linklike small", item.key === "git" ? "Open Git workspace" :
          item.key === "security" ? "Open Security Center" :
          item.key === "deps" ? "Open Dependency Center" : "Open Reports");
        a.href = item.key === "build" || item.key === "tests" ? (jobLink || "#/reports") : href;
        card.appendChild(a);
      }
      box.appendChild(card);
    });
  }

  window.NeutronInsights = {
    renderSecurity: renderSecurity,
    renderDeps: renderDeps,
    renderHealth: renderHealth,
    renderReviewFindings: renderReviewFindings,
    reviewChanges: reviewChanges,
  };
})();
