/* ==========================================================================
   NEUTRON UI utilities — pure functions only, zero DOM access.
   Safe to import in Node tests. Loaded as a classic script before app.js
   (exposes window.NeutronUI) and as a CommonJS module under vitest.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.NeutronUI = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Max chat messages rendered at once; older ones hide behind "show earlier". */
  var CHAT_RENDER_CAP = 120;

  /**
   * Trailing-edge debounce. The returned function has a .cancel() method.
   * Pure logic — no DOM.
   */
  function debounce(fn, wait) {
    var t = null;
    function debounced() {
      var args = arguments;
      var self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        fn.apply(self, args);
      }, wait);
    }
    debounced.cancel = function () {
      if (t) { clearTimeout(t); t = null; }
    };
    return debounced;
  }

  /**
   * Return a copy of the last `cap` items (or the whole array when it fits).
   * Used to cap the rendered chat history without mutating state.
   */
  function cappedSlice(arr, cap) {
    if (!Array.isArray(arr)) return [];
    if (arr.length <= cap) return arr.slice();
    return arr.slice(arr.length - cap);
  }

  /**
   * Should the server pill refresh? Throttles the /api/health call that
   * otherwise fires on every route change.
   */
  function shouldRefreshPill(lastMs, nowMs, intervalMs) {
    return (nowMs - lastMs) >= intervalMs;
  }

  /**
   * fetch() with a timeout. `deps` lets tests substitute fakes for fetch,
   * AbortController, and the timers. Rejects with
   * Error("Request timed out after Ns") on timeout.
   */
  function fetchWithTimeout(url, opts, ms, deps) {
    var d = deps || {};
    var doFetch = d.fetch || (typeof fetch !== "undefined" ? fetch : null);
    /* `"key" in d` (not ||) so tests can force the no-AbortController path
       by passing { AbortController: undefined } explicitly. */
    var AC = ("AbortController" in d) ? d.AbortController
      : (typeof AbortController !== "undefined" ? AbortController : null);
    var setT = d.setTimeout || setTimeout;
    var clearT = d.clearTimeout || clearTimeout;
    var label = "Request timed out after " + Math.round(ms / 1000) + "s";
    if (!doFetch) return Promise.reject(new Error("fetch is not available"));
    if (!AC) {
      /* No abort support: race the fetch against a timeout rejection. */
      var timer;
      var timeoutP = new Promise(function (_, reject) {
        timer = setT(function () { reject(new Error(label)); }, ms);
      });
      return Promise.race([doFetch(url, opts), timeoutP]).then(
        function (res) { clearT(timer); return res; },
        function (err) { clearT(timer); throw err; }
      );
    }
    var ctrl = new AC();
    var timer2 = setT(function () { try { ctrl.abort(); } catch (e) {} }, ms);
    var out = {};
    for (var k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) out[k] = opts[k]; }
    out.signal = ctrl.signal;
    return doFetch(url, out).then(
      function (res) { clearT(timer2); return res; },
      function (err) {
        clearT(timer2);
        if (err && err.name === "AbortError") throw new Error(label);
        throw err;
      }
    );
  }

  /**
   * Deep-copy a JSON-safe value, replacing attachment base64 `data` with a
   * short placeholder so API inspector logs stay readable (and small).
   * Only objects shaped like attachments ({kind, data}) are touched.
   */
  function stripAttachmentData(value) {
    if (Array.isArray(value)) return value.map(stripAttachmentData);
    if (value && typeof value === "object") {
      var isAttachment = typeof value.kind === "string" && typeof value.data === "string";
      var out = {};
      for (var k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        if (k === "data" && isAttachment) {
          out[k] = "[base64 omitted (" + value.data.length + " chars)]";
        } else {
          out[k] = stripAttachmentData(value[k]);
        }
      }
      return out;
    }
    return value;
  }

  /**
   * Copy text to the clipboard. Tries the async Clipboard API first, then
   * falls back to a hidden textarea + execCommand (for older WebViews /
   * non-secure contexts). `deps` lets tests inject fakes:
   * { navigator, document }. Resolves true on success, false otherwise.
   */
  function copyText(text, deps) {
    deps = deps || {};
    var nav = deps.navigator || (typeof navigator !== "undefined" ? navigator : undefined);
    var doc = deps.document || (typeof document !== "undefined" ? document : undefined);
    var s = text == null ? "" : String(text);
    function viaExecCommand() {
      try {
        if (!doc || !doc.createElement || !doc.body) return false;
        var ta = doc.createElement("textarea");
        ta.value = s;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        doc.body.appendChild(ta);
        if (typeof ta.select === "function") ta.select();
        var ok = false;
        try {
          ok = doc.execCommand ? !!doc.execCommand("copy") : false;
        } catch (e) { ok = false; }
        if (ta.parentNode) ta.parentNode.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    try {
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
        return Promise.resolve().then(function () {
          return nav.clipboard.writeText(s);
        }).then(function () { return true; }, function () {
          return viaExecCommand();
        });
      }
    } catch (e) { /* fall through to execCommand */ }
    try {
      return Promise.resolve(viaExecCommand());
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /**
   * Format a millisecond epoch as a local "HH:MM" 24h clock string.
   * Returns "" for invalid input. Pure — safe to test.
   */
  function fmtTime(ts) {
    try {
      if (ts === null || ts === undefined || ts === "") return "";
      var d = new Date(Number(ts));
      if (isNaN(d.getTime())) return "";
      function p(n) { return (n < 10 ? "0" : "") + n; }
      return p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

  /**
   * Pick the persistable subset of a maintain-wizard state object.
   * Returns a JSON-safe copy, or null when the input is not an object.
   * Keeps localStorage writes small and forward-compatible.
   */
  function sanitizeWizard(mz) {
    if (!mz || typeof mz !== "object") return null;
    var out = {};
    if (typeof mz.step === "string") out.step = mz.step;
    if (mz.form && typeof mz.form === "object") {
      out.form = {
        repo: String(mz.form.repo || ""),
        request: String(mz.form.request || ""),
        riskTolerance: String(mz.form.riskTolerance || ""),
      };
    }
    ["analysisId", "approvalToken", "jobId"].forEach(function (k) {
      if (typeof mz[k] === "string") out[k] = mz[k];
    });
    ["analysis", "impact", "plan", "job", "result"].forEach(function (k) {
      if (mz[k] !== undefined) {
        try { out[k] = JSON.parse(JSON.stringify(mz[k])); } catch (e) { /* skip */ }
      }
    });
    ["approved", "rejected"].forEach(function (k) {
      if (typeof mz[k] === "boolean") out[k] = mz[k];
    });
    if (typeof mz.unsupported === "string") out.unsupported = mz.unsupported;
    return out;
  }

  /**
   * Validate a restored wizard state: must have a known step.
   * Returns true only for objects whose step is in validSteps.
   */
  function isValidWizardState(obj, validSteps) {
    if (!obj || typeof obj !== "object") return false;
    if (typeof obj.step !== "string") return false;
    return Array.isArray(validSteps) && validSteps.indexOf(obj.step) !== -1;
  }

  /**
   * Pick the persistable subset of chat messages for localStorage.
   * Keeps role/text/ts/failed and artifact metadata; drops anything
   * oversized (artifact bodies are capped) so history stays small.
   * Returns [] for invalid input. Pure — safe to test.
   */
  var MAX_STORED_MSG_TEXT = 20000;
  var MAX_STORED_ARTIFACT_BYTES = 100000;
  function sanitizeChatHistory(messages, cap) {
    if (!Array.isArray(messages)) return [];
    var list = messages.slice(-(cap || 200));
    return list.map(function (m) {
      if (!m || typeof m !== "object") return null;
      var out = { role: m.role === "assistant" ? "assistant" : "user" };
      out.text = String(m.text == null ? "" : m.text).slice(0, MAX_STORED_MSG_TEXT);
      if (typeof m.ts === "number") out.ts = m.ts;
      if (m.failed === true) out.failed = true;
      if (Array.isArray(m.artifacts)) {
        out.artifacts = m.artifacts.slice(0, 10).map(function (a) {
          if (!a || typeof a !== "object") return null;
          return {
            path: String(a.path || "").slice(0, 200),
            content: String(a.content || "").slice(0, MAX_STORED_ARTIFACT_BYTES),
          };
        }).filter(Boolean);
        if (!out.artifacts.length) delete out.artifacts;
      }
      return out;
    }).filter(Boolean);
  }

  return {
    CHAT_RENDER_CAP: CHAT_RENDER_CAP,
    debounce: debounce,
    cappedSlice: cappedSlice,
    shouldRefreshPill: shouldRefreshPill,
    fetchWithTimeout: fetchWithTimeout,
    stripAttachmentData: stripAttachmentData,
    copyText: copyText,
    fmtTime: fmtTime,
    sanitizeWizard: sanitizeWizard,
    isValidWizardState: isValidWizardState,
    sanitizeChatHistory: sanitizeChatHistory,
  };
});
