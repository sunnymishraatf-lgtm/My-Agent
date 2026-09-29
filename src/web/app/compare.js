/* ==========================================================================
   NEUTRON Model comparison (Phase 22) — send one prompt to 2–4 models
   side by side. Classic script; uses globals from app.js (el, showError,
   clearError, toast) and the pure helpers on window.NeutronUI plus the
   bridge on window.NeutronApp. Loaded before app.js; only needs
   window.NeutronCompare at render time.

   Architecture: BYOK — each slot fires an independent /api/chat call with
   its own x-provider header (per-request override, never touching the
   stored global). Text prompts only. No streaming (the chat API doesn't
   stream). One slot failing never affects the others.
   ========================================================================== */
(function () {
  "use strict";

  var UI = window.NeutronUI || {};
  function App() { return window.NeutronApp || {}; }

  /* Module state — reset on every render and on route teardown. */
  var S = null;
  function freshState() {
    return {
      prompt: "",
      slots: [],
      providers: [],
      byId: {},
      running: false,
      runHandle: null,
      els: {},
    };
  }

  function money(n) { return "$" + Number(n).toFixed(2); }
  function fmtTok(n) {
    if (n == null) return "–";
    n = Number(n);
    if (!isFinite(n)) return "–";
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n));
  }
  function fmtLatency(ms) {
    if (ms == null) return "";
    return (Number(ms) / 1000).toFixed(1) + "s";
  }
  function slotLabel(slot, i) {
    var pr = S.byId[slot.provider];
    var provName = pr ? (pr.displayName || pr.id) : (slot.provider || "no provider");
    var model = slot.model || "auto";
    return model + " · " + provName;
  }
  function friendlyErr(e) {
    try {
      if (UI.friendlyChatError) return UI.friendlyChatError(e);
    } catch (e2) {}
    return (e && e.message) ? e.message : String(e);
  }

  /* ---------------- slot pickers ---------------- */

  function providerOptions(sel, current) {
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Select a provider…";
    sel.appendChild(ph);
    S.providers.forEach(function (pr) {
      var o = document.createElement("option");
      o.value = pr.id;
      o.textContent = (pr.displayName || pr.id) + "  (" + pr.id + ")";
      sel.appendChild(o);
    });
    sel.value = current || "";
  }

  function modelOptions(sel, providerId, currentModel) {
    var pr = S.byId[providerId];
    var built = UI.buildModelOptions
      ? UI.buildModelOptions(pr && pr.defaultModels, "", currentModel || "")
      : { options: [{ value: "", label: "Auto (provider default)" }], selected: "" };
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    built.options.forEach(function (o) {
      var el2 = document.createElement("option");
      el2.value = o.value;
      el2.textContent = o.label;
      sel.appendChild(el2);
    });
    sel.value = built.selected;
  }

  function paintSlots() {
    var wrap = S.els.slotWrap;
    wrap.innerHTML = "";
    S.slots.forEach(function (slot, i) {
      var card = el("div", "panel cmp-slot");
      var head = el("div", "cmp-slot-head");
      head.appendChild(el("div", "cmp-slot-title", "Model " + (i + 1)));
      if (S.slots.length > UI.COMPARE_MIN_SLOTS && !S.running) {
        var rm = el("button", "btn ghost sm", "Remove");
        rm.type = "button";
        rm.setAttribute("aria-label", "Remove model " + (i + 1) + " from comparison");
        rm.onclick = function () {
          S.slots.splice(i, 1);
          paintSlots(); paintCost(); paintActions();
        };
        head.appendChild(rm);
      }
      card.appendChild(head);
      var provSel = el("select", "input");
      provSel.setAttribute("aria-label", "Provider for model " + (i + 1));
      provSel.disabled = S.running;
      providerOptions(provSel, slot.provider);
      provSel.onchange = function () {
        slot.provider = provSel.value;
        slot.model = "";
        modelOptions(modelSel, slot.provider, "");
        paintCost();
      };
      card.appendChild(labeledField("PROVIDER", provSel));
      var modelSel = el("select", "input");
      modelSel.setAttribute("aria-label", "Model for model " + (i + 1));
      modelSel.disabled = S.running;
      modelOptions(modelSel, slot.provider, slot.model);
      modelSel.onchange = function () {
        slot.model = modelSel.value;
        paintCost();
      };
      card.appendChild(labeledField("MODEL", modelSel));
      wrap.appendChild(card);
    });
    var addRow = el("div", "cmp-addrow");
    var addBtn = el("button", "btn ghost", "+ Add model");
    addBtn.type = "button";
    addBtn.disabled = S.running || S.slots.length >= UI.COMPARE_MAX_SLOTS;
    addBtn.title = "Up to " + UI.COMPARE_MAX_SLOTS + " models";
    addBtn.onclick = function () {
      if (S.slots.length >= UI.COMPARE_MAX_SLOTS) return;
      S.slots.push({ provider: "", model: "" });
      paintSlots(); paintCost(); paintActions();
    };
    addRow.appendChild(addBtn);
    addRow.appendChild(el("span", "muted small", S.slots.length + " of " + UI.COMPARE_MAX_SLOTS + " models"));
    wrap.appendChild(addRow);
  }

  function labeledField(label, input) {
    var f = el("div", "field");
    var lab = el("label", "field-label", label);
    /* Associate the label for screen readers. */
    try {
      var id = "cmp-f" + Math.random().toString(36).slice(2, 8);
      input.id = id;
      lab.setAttribute("for", id);
    } catch (e) {}
    f.appendChild(lab);
    f.appendChild(input);
    return f;
  }

  /* ---------------- cost line ---------------- */

  function paintCost(est) {
    var app = App();
    var line = S.els.costLine;
    line.innerHTML = "";
    var e = est || app.estimateCompareCost(S.slots, (S.prompt || "").length);
    var parts = [];
    if (e.costed > 0) {
      parts.push("Estimated max ≈ " + money(e.total) + " for " + S.slots.length +
        " model" + (S.slots.length === 1 ? "" : "s") +
        " · assumes ≤" + e.outTok + " output tokens each · input ≈ " + e.inTok + " tokens");
      if (e.uncosted > 0) {
        parts.push(e.uncosted + " model" + (e.uncosted === 1 ? "" : "s") +
          " ha" + (e.uncosted === 1 ? "s" : "ve") + " no rate set — excluded from the estimate.");
      }
    } else {
      parts.push("Set per-model rates in Settings → Usage to see cost estimates.");
    }
    if (e.daily || e.monthly) {
      var b = [];
      if (e.daily) b.push("daily " + money(e.spentDaily) + " of " + money(e.daily));
      if (e.monthly) b.push("monthly " + money(e.spentMonth) + " of " + money(e.monthly));
      parts.push("Budget: " + b.join(" · ") + " estimated so far.");
    }
    line.textContent = parts.join(" ");
  }

  /* ---------------- results ---------------- */

  var STATUS_LABEL = {
    queued: "Queued", running: "Running…", done: "Done",
    error: "Error", cancelled: "Cancelled",
  };

  function paintResults() {
    var grid = S.els.results;
    grid.innerHTML = "";
    var any = S.slots.some(function (s) { return s.status && s.status !== "idle"; });
    if (!any) {
      grid.appendChild(el("p", "muted", "Results will appear here — one column per model."));
      return;
    }
    S.slots.forEach(function (slot, i) {
      var card = el("article", "panel cmp-card cmp-" + (slot.status || "idle"));
      var head = el("div", "cmp-card-head");
      var title = el("div", "cmp-card-title", slotLabel(slot, i));
      head.appendChild(title);
      head.appendChild(el("span", "pill " + (slot.status === "done" ? "ok" : slot.status === "error" ? "bad" : ""),
        STATUS_LABEL[slot.status] || slot.status || ""));
      card.appendChild(head);
      var body = el("div", "cmp-card-body");
      if (slot.status === "done") {
        /* renderMarkdown escapes all HTML first — safe for innerHTML. */
        body.innerHTML = UI.renderMarkdown ? UI.renderMarkdown(slot.text || "") : "";
      } else if (slot.status === "error") {
        body.appendChild(el("p", "cmp-error", "Error: " + friendlyErr(slot.error)));
        body.appendChild(el("p", "muted small", "The other models were not affected."));
      } else if (slot.status === "cancelled") {
        body.appendChild(el("p", "muted", "Cancelled."));
      } else {
        var tp = el("p", "muted", "");
        tp.appendChild(el("span", "typing", ""));
        tp.appendChild(document.createTextNode(slot.status === "running" ? " Waiting for a reply…" : " Waiting to start…"));
        body.appendChild(tp);
      }
      card.appendChild(body);
      if (slot.status === "done") {
        var foot = el("div", "cmp-card-foot");
        var meta = [];
        if (slot.latencyMs != null) meta.push(fmtLatency(slot.latencyMs));
        if (slot.usage && (slot.usage.input_tokens != null || slot.usage.output_tokens != null)) {
          meta.push(fmtTok(slot.usage.input_tokens) + " in · " + fmtTok(slot.usage.output_tokens) + " out");
        }
        foot.appendChild(el("span", "muted small", meta.join("  ·  ")));
        var btnRow = el("div", "cmp-btnrow");
        var copyBtn = el("button", "btn ghost sm", "Copy");
        copyBtn.type = "button";
        copyBtn.setAttribute("aria-label", "Copy response from " + slotLabel(slot, i));
        copyBtn.onclick = function () {
          if (!UI.copyText) { toast("Copy not available."); return; }
          UI.copyText(slot.text || "").then(function (ok) {
            toast(ok ? "Response copied." : "Copy failed.");
          });
        };
        var saveBtn = el("button", "btn ghost sm", "Save to chat");
        saveBtn.type = "button";
        saveBtn.title = "Save this response as a new chat";
        saveBtn.setAttribute("aria-label", "Save response from " + slotLabel(slot, i) + " to a new chat");
        saveBtn.onclick = function () { saveToChat(slot, false); };
        var contBtn = el("button", "btn ghost sm", "Continue with this");
        contBtn.type = "button";
        contBtn.title = "Open a chat with this response and keep asking";
        contBtn.setAttribute("aria-label", "Continue chatting with response from " + slotLabel(slot, i));
        contBtn.onclick = function () { saveToChat(slot, true); };
        btnRow.appendChild(copyBtn);
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(contBtn);
        foot.appendChild(btnRow);
        card.appendChild(foot);
      }
      grid.appendChild(card);
    });
  }

  function saveToChat(slot, focus) {
    var app = App();
    if (!slot || slot.status !== "done") return;
    var id = app.createChatWith(slot.provider, slot.model, [
      { role: "user", text: S.prompt, ts: Date.now() },
      { role: "assistant", text: slot.text || "", ts: Date.now() },
    ]);
    if (!id) { showError("Could not create the chat."); return; }
    toast(focus ? "Chat opened — keep asking." : "Saved to a new chat.");
    app.openChat(id, focus);
  }

  /* ---------------- actions ---------------- */

  function paintActions() {
    var row = S.els.actions;
    row.innerHTML = "";
    var runBtn = el("button", "btn primary", "Run comparison");
    runBtn.type = "button";
    runBtn.disabled = S.running;
    runBtn.onclick = runComparison;
    row.appendChild(runBtn);
    if (S.running) {
      var cancelBtn = el("button", "btn danger", "Cancel");
      cancelBtn.type = "button";
      cancelBtn.onclick = function () {
        if (S.runHandle) S.runHandle.cancel();
      };
      row.appendChild(cancelBtn);
    }
    var clearBtn = el("button", "btn ghost", "Clear");
    clearBtn.type = "button";
    clearBtn.disabled = S.running;
    clearBtn.onclick = function () {
      if (S.running) return;
      S.prompt = "";
      if (S.els.prompt) S.els.prompt.value = "";
      initSlots();
      paintSlots(); paintResults(); paintCost(); paintActions();
    };
    row.appendChild(clearBtn);
  }

  function runComparison() {
    var app = App();
    clearError();
    var prompt = (S.prompt || "").trim();
    if (!prompt) { showError("Type a prompt first."); return; }
    var errs = UI.compareValidateSlots ? UI.compareValidateSlots(S.slots) : [];
    if (errs.length) { showError(errs.join(" ")); return; }
    if (!app.hasApiKey || !app.hasApiKey()) {
      showError("Add your API key in Settings first — comparison calls the providers with your own key.");
      return;
    }
    /* Cost guard: show the max estimate; confirm when it would push a
       budget over the top. */
    var est = app.estimateCompareCost(S.slots, prompt.length);
    paintCost(est);
    if (est.overDaily || est.overMonthly) {
      var which = est.overDaily ? "daily" : "monthly";
      var limit = est.overDaily ? est.daily : est.monthly;
      var spent = est.overDaily ? est.spentDaily : est.spentMonth;
      if (!window.confirm("This comparison could cost up to ~" + money(est.total) +
          " at your rates (" + money(spent) + " of " + money(limit) + " " + which +
          " budget already estimated). Run anyway?")) return;
    }
    S.running = true;
    S.slots.forEach(function (s) {
      s.status = "queued"; s.text = ""; s.error = null; s.latencyMs = 0; s.usage = null;
    });
    paintResults(); paintActions(); paintSlots();
    var handle = UI.runCompareSlots(S.slots, prompt, app.getMaxTokens(), {
      send: function (body, o) { return app.chatCompare(body, o); },
      log: function (entry) { try { app.logUsage(entry); } catch (e) {} },
      onState: function () { paintResults(); },
    });
    S.runHandle = handle;
    handle.promise.then(function () {
      S.running = false;
      S.runHandle = null;
      paintResults(); paintActions(); paintSlots();
      toast("Comparison finished.");
    });
  }

  /* ---------------- init ---------------- */

  function initSlots() {
    var app = App();
    var sp = (app.getStoredProvider && app.getStoredProvider()) || "";
    var sm = (app.getStoredModel && app.getStoredModel()) || "";
    var alt = "";
    try {
      alt = sp && UI.compareSuggestAlternative
        ? UI.compareSuggestAlternative(S.providers, sp, sm, S.prompt || "") : "";
    } catch (e) { alt = ""; }
    S.slots = [
      { provider: sp, model: sm },
      { provider: sp, model: alt },
    ];
  }

  function renderCompare(view) {
    S = freshState();
    view.appendChild(el("h1", null, "Model comparison"));
    view.appendChild(el("p", "muted",
      "Send one prompt to 2–4 models side by side. Each response is independent — " +
      "one failure never stops the others. Text prompts only; every call uses your own API key."));
    var promptSec = el("section", "panel");
    promptSec.appendChild(el("h2", null, "Prompt"));
    var ta = el("textarea", "input cmp-prompt");
    ta.rows = 4;
    ta.setAttribute("aria-label", "Comparison prompt");
    ta.placeholder = "Ask anything — the same prompt goes to every model…";
    var costDeb = null;
    ta.addEventListener("input", function () {
      S.prompt = ta.value;
      if (costDeb) clearTimeout(costDeb);
      costDeb = setTimeout(function () { paintCost(); }, 250);
    });
    S.els.prompt = ta;
    promptSec.appendChild(ta);
    view.appendChild(promptSec);

    var modelsSec = el("section", null);
    modelsSec.appendChild(el("h2", null, "Models"));
    var slotWrap = el("div", "cmp-slots");
    S.els.slotWrap = slotWrap;
    modelsSec.appendChild(slotWrap);
    view.appendChild(modelsSec);

    var costLine = el("p", "muted small cmp-cost");
    costLine.setAttribute("aria-live", "polite");
    S.els.costLine = costLine;
    view.appendChild(costLine);

    var actions = el("div", "cmp-actions");
    S.els.actions = actions;
    view.appendChild(actions);

    var resSec = el("section", null);
    resSec.appendChild(el("h2", null, "Results"));
    var grid = el("div", "cmp-grid");
    grid.setAttribute("aria-live", "polite");
    S.els.results = grid;
    resSec.appendChild(grid);
    view.appendChild(resSec);

    /* Providers load async; slots default to the current chat model plus a
       router-suggested alternative (never invented ids). */
    var app = App();
    app.getProviders().then(function (list) {
      if (!S) return; /* navigated away while loading */
      S.providers = Array.isArray(list) ? list : [];
      S.byId = {};
      S.providers.forEach(function (p) { if (p && p.id) S.byId[p.id] = p; });
      initSlots();
      paintSlots(); paintCost(); paintActions(); paintResults();
    }, function () {
      if (!S) return;
      S.providers = [];
      initSlots();
      paintSlots(); paintCost(); paintActions(); paintResults();
      showError("Could not load the provider list — check your connection and reopen Compare.");
    });
    paintActions();
  }

  function teardown() {
    try { if (S && S.runHandle) S.runHandle.cancel(); } catch (e) {}
    S = null;
  }

  window.NeutronCompare = {
    renderCompare: renderCompare,
    teardown: teardown,
  };
})();
