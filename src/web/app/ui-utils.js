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
      if (m.local === true) out.local = true;
      if (Array.isArray(m.files)) {
        out.files = m.files.slice(0, 5).map(function (f) {
          if (!f || typeof f !== "object") return null;
          return { name: String(f.name || "").slice(0, 200), size: Number(f.size) || 0 };
        }).filter(Boolean);
        if (!out.files.length) delete out.files;
      }
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

          /**
   * Minimal safe markdown renderer for assistant messages.
   * Escapes ALL HTML first, then applies a small subset: fenced code
   * blocks, inline code, bold, italic, links (http/https only), and
   * line breaks. Anything else renders as plain text. Returns an HTML
   * string safe for innerHTML. Pure — safe to test.
   */
  function renderMarkdown(src) {
    var s = String(src == null ? "" : src);
    // 1. Escape HTML.
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // 2. Extract fenced code blocks first (protect their contents).
    var blocks = [];
    s = s.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, function (m, lang, code) {
      blocks.push({ lang: lang || "", code: code.replace(/\n$/, "") });
      return "\u0000BLOCK" + (blocks.length - 1) + "\u0000";
    });
    // 3. Extract inline code.
    var inlines = [];
    s = s.replace(/`([^`\n]+)`/g, function (m, code) {
      inlines.push(code);
      return "\u0000INLINE" + (inlines.length - 1) + "\u0000";
    });
    // 4. Links [text](http/https URL) — escape quotes in URL.
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, text, url) {
      var safeUrl = url.replace(/"/g, "&quot;");
      return '<a href="' + safeUrl + '" target="_blank" rel="noopener">' + text + "</a>";
    });
    // 5. Bold and italic (after links so link text isn't mangled).
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    // 6. Line breaks.
    s = s.replace(/\n/g, "<br>");
    // 7. Restore inline code, then blocks.
    s = s.replace(/\u0000INLINE(\d+)\u0000/g, function (m, i) {
      return "<code>" + inlines[Number(i)] + "</code>";
    });
    s = s.replace(/\u0000BLOCK(\d+)\u0000/g, function (m, i) {
      var b = blocks[Number(i)];
      var cls = b.lang ? ' class="lang-' + b.lang.replace(/[^a-z0-9-]/gi, "") + '"' : "";
      return "<pre" + cls + "><code>" + b.code + "</code></pre>";
    });
    return s;
  }

  /* Map a raw send error to a user-friendly message. The raw detail stays
     in the API inspector / verbose log; the chat bubble and error bar get
     something actionable instead of "HTTP 401". Pure — safe to test. */
  function friendlyChatError(err) {
    var msg = err && err.message ? String(err.message) : String(err == null ? "" : err);
    var status = err && typeof err.status === "number" ? err.status : 0;
    if (/offline/i.test(msg))
      return "You appear to be offline — check your connection and try again.";
    if (/timed out after/i.test(msg))
      return "The request timed out after 90 seconds. The provider may be slow or stuck — try again.";
    if (status === 401 || /\b401\b|unauthorized|invalid api key|invalid_api_key|incorrect api key/i.test(msg))
      return "Your API key was rejected (401). Check the key in Settings — it must belong to the selected provider.";
    if (status === 429 || /\b429\b|rate.?limit|too many requests/i.test(msg))
      return "Rate limited (429) — the provider is throttling requests. Wait a moment, then use Retry.";
    if (status === 400 || /\b400\b/i.test(msg))
      return "The request was rejected (400): " + msg + ". Check the selected model id.";
    if (status === 502 || status === 503 || status === 504 || /\b50[234]\b|bad gateway|service unavailable|gateway timeout/i.test(msg))
      return "The provider is having trouble (" + (status || "server error") + "). Try again in a bit.";
    if (/failed to fetch|networkerror|load failed/i.test(msg))
      return "Couldn't reach the server. Check your connection and the backend URL in Developer settings.";
    return msg || "Something went wrong sending that message.";
  }

  /* Strip markdown syntax for text-to-speech: the voice reader must hear
     words, not "asterisk asterisk". Fenced code blocks become a short
     placeholder; inline formatting is dropped; links read as their text. */
  function stripMarkdownForSpeech(src) {
    var s = String(src == null ? "" : src);
    s = s.replace(/```[\s\S]*?```/g, " [code block] ");
    s = s.replace(/`([^`]*)`/g, "$1");
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1");
    s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");
    s = s.replace(/(^|\W)\*(\S[^*]*\S)\*(?=\W|$)/g, "$1$2");
    s = s.replace(/(^|\W)_(\S[^_]*\S)_(?=\W|$)/g, "$1$2");
    s = s.replace(/^#{1,6}\s+/gm, "");
    s = s.replace(/^>\s?/gm, "");
    s = s.replace(/^\s*[-*+]\s+/gm, "");
    s = s.replace(/[ \t]+/g, " ");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }


  /* ========================================================================
     Conversation workspace store — pure helpers.
     Multi-conversation history is device-local (localStorage key
     "neutron_conversations"): this browser IS the user (BYOK, no accounts).
     This module only shapes the data; app.js owns storage and the DOM.
     ======================================================================== */

  var CONV_STORE_VERSION = 1;
  /* Max messages persisted per conversation. */
  var CONV_MESSAGE_CAP = 200;
  /* Max characters of message text persisted per message. */
  var CONV_MAX_MSG_TEXT = 20000;
  /* Max artifact bytes persisted per artifact. */
  var CONV_MAX_ARTIFACT_BYTES = 100000;
  /* Attachment data (base64) is kept only for small text files; the running
     total per conversation is capped so localStorage stays small. Anything
     else restores honestly as unavailable. */
  var CONV_MAX_ATTACH_DATA = 10 * 1024;

  function newConversation(id, nowMs) {
    return {
      id: String(id),
      title: "",
      renamed: false,
      createdAt: nowMs,
      updatedAt: nowMs,
      pinned: false,
      archived: false,
      provider: "",
      model: "",
      messages: [],
      projectId: "",
      projectContextOn: true,
    };
  }

  /* Light markdown strip for auto-titles. Unlike the TTS variant, titles
     drop code blocks entirely instead of saying "[code block]". */
  function stripForTitle(src) {
    var s = String(src == null ? "" : src);
    s = s.replace(/```[\s\S]*?```/g, " ");
    s = s.replace(/`([^`]*)`/g, "$1");
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");
    s = s.replace(/(^|\W)[*_](\S[^*_]*\S)[*_](?=\W|$)/g, "$1$2");
    s = s.replace(/^#{1,6}\s+/gm, "");
    s = s.replace(/^>\s?/gm, "");
    s = s.replace(/^\s*[-*+]\s+/gm, "");
    s = s.replace(/[ \t]+/g, " ").replace(/\n+/g, " ");
    return s.trim();
  }

  /**
   * Generate a conversation title from the first user message.
   * Returns "" when there is nothing to title from (the UI shows a
   * "New task" placeholder). Never returns "New Chat"/"Untitled".
   * `files` is used as a fallback for attachment-only first messages.
   */
  function autoTitle(text, files) {
    var t = stripForTitle(text);
    if (!t && files && files.length) {
      t = "Files: " + files.map(function (f) {
        return f && f.name ? String(f.name) : "?";
      }).join(", ");
    }
    t = t.replace(/\s+/g, " ").trim();
    if (!t) return "";
    if (t.length > 42) {
      var cut = t.slice(0, 42);
      var sp = cut.lastIndexOf(" ");
      if (sp > 20) cut = cut.slice(0, sp);
      t = cut + "…";
    }
    return t;
  }

  /** Display title: stored title, or the "New task" placeholder. */
  function convDisplayTitle(item) {
    var t = item && typeof item.title === "string" ? item.title.trim() : "";
    return t || "New task";
  }

  /**
   * Relative time: "just now", "5 min ago", "3 hr ago", "Yesterday",
   * "4 days ago", or "Sep 12" / "Sep 12, 2025". Pure.
   */
  function relativeTime(ts, nowMs) {
    try {
      var t = Number(ts), n = Number(nowMs);
      if (!isFinite(t) || !isFinite(n)) return "";
      var diff = n - t;
      if (diff < 0) diff = 0;
      var s = Math.floor(diff / 1000);
      if (s < 60) return "just now";
      var m = Math.floor(s / 60);
      if (m < 60) return m + " min ago";
      var h = Math.floor(m / 60);
      if (h < 24) return h + " hr ago";
      var d = Math.floor(h / 24);
      if (d === 1) return "Yesterday";
      if (d < 7) return d + " days ago";
      var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      var dt = new Date(t);
      var label = months[dt.getMonth()] + " " + dt.getDate();
      if (dt.getFullYear() !== new Date(n).getFullYear()) label += ", " + dt.getFullYear();
      return label;
    } catch (e) { return ""; }
  }

  function startOfDayMs(t) {
    var d = new Date(Number(t));
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Day bucket for grouping: today / yesterday / week / month / older. */
  function convDayBucket(ts, nowMs) {
    try {
      var diff = Math.round((startOfDayMs(nowMs) - startOfDayMs(ts)) / 86400000);
      if (diff <= 0) return "today";
      if (diff === 1) return "yesterday";
      if (diff < 7) return "week";
      if (diff < 30) return "month";
      return "older";
    } catch (e) { return "older"; }
  }

  function convMeta(item) {
    return {
      id: item.id,
      title: convDisplayTitle(item),
      updatedAt: item.updatedAt || 0,
      pinned: !!item.pinned,
    };
  }

  var CONV_GROUPS = [
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "week", label: "Previous 7 days" },
    { id: "month", label: "Previous 30 days" },
    { id: "older", label: "Older" },
  ];

  /**
   * Group non-archived conversations: pinned first, then day buckets,
   * each sorted by updatedAt desc. `items` is the store's items object.
   * Returns { pinned: [meta], groups: [{ id, label, items: [meta] }] }
   * with empty groups omitted.
   */
  function groupConversations(items, nowMs) {
    var pinned = [];
    var buckets = { today: [], yesterday: [], week: [], month: [], older: [] };
    Object.keys(items || {}).forEach(function (id) {
      var it = items[id];
      if (!it || it.archived) return;
      var meta = convMeta(it);
      if (it.pinned) {
        pinned.push(meta);
      } else {
        var b = convDayBucket(it.updatedAt || it.createdAt || nowMs, nowMs);
        (buckets[b] || buckets.older).push(meta);
      }
    });
    function byRecent(a, b) { return b.updatedAt - a.updatedAt; }
    pinned.sort(byRecent);
    var groups = CONV_GROUPS.map(function (g) {
      return { id: g.id, label: g.label, items: buckets[g.id].sort(byRecent) };
    }).filter(function (g) { return g.items.length > 0; });
    return { pinned: pinned, groups: groups };
  }

  /** Flat list of archived conversations, most recent first. */
  function archivedConversations(items) {
    var out = [];
    Object.keys(items || {}).forEach(function (id) {
      var it = items[id];
      if (it && it.archived) out.push(convMeta(it));
    });
    out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return out;
  }

  /**
   * Search title + message text (case-insensitive). Returns metas sorted
   * by updatedAt desc, capped at 100. Empty query → [].
   */
  function searchConversations(items, query) {
    var q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q) return [];
    var out = [];
    Object.keys(items || {}).forEach(function (id) {
      var it = items[id];
      if (!it || it.archived) return;
      var hit = String(it.title || "").toLowerCase().indexOf(q) !== -1;
      if (!hit && Array.isArray(it.messages)) {
        for (var i = 0; i < it.messages.length; i++) {
          var m = it.messages[i];
          if (m && String(m.text || "").toLowerCase().indexOf(q) !== -1) { hit = true; break; }
        }
      }
      if (hit) out.push(convMeta(it));
    });
    out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return out.slice(0, 100);
  }

  /**
   * Pick the persistable subset of one attachment. `budget` ({left}) caps
   * the running total of base64 data kept per conversation; attachments
   * without data restore honestly as unavailable.
   */
  function sanitizeAttachment(a, budget) {
    if (!a || typeof a !== "object") return null;
    var out = {
      name: String(a.name || "").slice(0, 200),
      size: Number(a.size) || 0,
    };
    if (typeof a.mime === "string" && a.mime) out.mime = a.mime.slice(0, 100);
    var kind = String(a.kind || "");
    if (kind === "text" || kind === "image" || kind === "zip") out.kind = kind;
    var data = typeof a.data === "string" ? a.data : "";
    if (out.kind === "text" && data && data.length <= budget.left) {
      out.data = data;
      budget.left -= data.length;
    } else {
      out.unavailable = true;
    }
    return out;
  }

  /**
   * Pick the persistable subset of a conversation for localStorage.
   * Caps messages/text/artifacts and attachment data so history stays
   * small; converts the legacy single-chat `files` shape to attachments.
   * Returns null for invalid input. Pure.
   */
  function sanitizeConversation(item) {
    if (!item || typeof item !== "object") return null;
    var out = {
      id: String(item.id || ""),
      title: String(item.title || "").slice(0, 200),
      renamed: !!item.renamed,
      createdAt: Number(item.createdAt) || 0,
      updatedAt: Number(item.updatedAt) || 0,
      pinned: !!item.pinned,
      archived: !!item.archived,
      provider: String(item.provider || "").slice(0, 100),
      model: String(item.model || "").slice(0, 200),
      messages: [],
      projectId: String(item.projectId || "").slice(0, 100),
      projectContextOn: item.projectContextOn !== false,
    };
    var budget = { left: CONV_MAX_ATTACH_DATA };
    var msgs = Array.isArray(item.messages) ? item.messages.slice(-CONV_MESSAGE_CAP) : [];
    out.messages = msgs.map(function (m) {
      if (!m || typeof m !== "object") return null;
      var mo = { role: m.role === "assistant" ? "assistant" : "user" };
      mo.text = String(m.text == null ? "" : m.text).slice(0, CONV_MAX_MSG_TEXT);
      if (typeof m.ts === "number") mo.ts = m.ts;
      if (m.failed === true) mo.failed = true;
      if (m.local === true) mo.local = true;
      /* New shape: attachments. Legacy single-chat shape: files. */
      var atts = Array.isArray(m.attachments) ? m.attachments : null;
      if (!atts && Array.isArray(m.files)) {
        atts = m.files.map(function (f) {
          return {
            name: f && f.name ? String(f.name) : "",
            size: f && f.size ? Number(f.size) : 0,
            kind: "file",
            unavailable: true,
          };
        });
      }
      if (atts) {
        mo.attachments = atts.map(function (a) {
          return sanitizeAttachment(a, budget);
        }).filter(Boolean);
        if (!mo.attachments.length) delete mo.attachments;
      }
      if (Array.isArray(m.artifacts)) {
        mo.artifacts = m.artifacts.slice(0, 10).map(function (a) {
          if (!a || typeof a !== "object") return null;
          return {
            path: String(a.path || "").slice(0, 200),
            content: String(a.content || "").slice(0, CONV_MAX_ARTIFACT_BYTES),
          };
        }).filter(Boolean);
        if (!mo.artifacts.length) delete mo.artifacts;
      }
      return mo;
    }).filter(Boolean);
    return out;
  }

  /**
   * Wrap a legacy single-chat message array (the old "neutron_chat_history"
   * value) as the first conversation of a new store. Never loses the
   * user's current chat. Pure.
   */
  function migrateLegacyChat(messages, provider, model, nowMs, id) {
    var item = newConversation(id, nowMs);
    item.provider = String(provider || "");
    item.model = String(model || "");
    var clean = sanitizeConversation({
      id: item.id, title: "", renamed: false, createdAt: 0, updatedAt: 0,
      pinned: false, archived: false, provider: item.provider, model: item.model,
      messages: Array.isArray(messages) ? messages : [],
    });
    item.messages = clean.messages;
    var firstTs = 0, lastTs = 0, firstUserText = "";
    item.messages.forEach(function (m) {
      if (typeof m.ts === "number") {
        if (!firstTs || m.ts < firstTs) firstTs = m.ts;
        if (m.ts > lastTs) lastTs = m.ts;
      }
      if (!firstUserText && m.role === "user" && !m.local && m.text) firstUserText = m.text;
    });
    item.createdAt = firstTs || nowMs;
    item.updatedAt = lastTs || nowMs;
    item.title = autoTitle(firstUserText, null);
    var store = { version: CONV_STORE_VERSION, activeId: item.id, items: {} };
    store.items[item.id] = item;
    return store;
  }

  function convGet(store, id) {
    if (!store || !store.items || !id) return null;
    return store.items[id] || null;
  }

  /** Set the active conversation. Returns true only when the id exists
      and is not archived. Pure — safe to test. */
  function convSetActive(store, id) {
    var it = convGet(store, id);
    if (!it || it.archived) return false;
    store.activeId = id;
    return true;
  }

  /** Most recently updated non-archived conversation id (or null). */
  function mostRecentConvId(store, excludeId) {
    if (!store || !store.items) return null;
    var best = null, bestTs = -1;
    Object.keys(store.items).forEach(function (id) {
      if (id === excludeId) return;
      var it = store.items[id];
      if (!it || it.archived) return;
      var ts = it.updatedAt || it.createdAt || 0;
      if (ts >= bestTs) { bestTs = ts; best = id; }
    });
    return best;
  }

  function convCreate(store, id, nowMs) {
    if (!store || !store.items || !id || store.items[id]) return null;
    var item = newConversation(id, nowMs);
    store.items[id] = item;
    store.activeId = id;
    return item;
  }

  /**
   * Rename a conversation. Trims and collapses whitespace, rejects empty
   * names, touches updatedAt, and locks the title against auto-titling.
   * Returns true on success.
   */
  function convRename(store, id, title, nowMs) {
    var it = convGet(store, id);
    var t = String(title == null ? "" : title).replace(/\s+/g, " ").trim();
    if (!it || !t) return false;
    it.title = t.slice(0, 200);
    it.renamed = true;
    it.updatedAt = nowMs;
    return true;
  }

  function convSetPinned(store, id, pinned) {
    var it = convGet(store, id);
    if (!it) return false;
    it.pinned = !!pinned;
    return true;
  }

  function convSetArchived(store, id, archived, nowMs) {
    var it = convGet(store, id);
    if (!it) return false;
    it.archived = !!archived;
    it.updatedAt = nowMs;
    if (archived && store.activeId === id) {
      store.activeId = mostRecentConvId(store, id);
    }
    return true;
  }

  function convDelete(store, id) {
    if (!store || !store.items || !store.items[id]) return false;
    delete store.items[id];
    if (store.activeId === id) store.activeId = mostRecentConvId(store, null);
    return true;
  }

  /**
   * Duplicate a conversation: new unique id, " — Copy" title, original
   * untouched, copy not pinned/archived. Returns the copy (or null).
   */
  function convDuplicate(store, id, newId, nowMs) {
    var src = convGet(store, id);
    if (!src || !newId || store.items[newId]) return null;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = newId;
    copy.title = (src.title && src.title.trim() ? src.title.trim() : "New task") + " — Copy";
    copy.renamed = true;
    copy.createdAt = nowMs;
    copy.updatedAt = nowMs;
    copy.pinned = false;
    copy.archived = false;
    store.items[newId] = copy;
    return copy;
  }

  /**
   * Record activity: bump updatedAt, and auto-title from the first real
   * user message unless the user renamed it. `firstUserText` may be "".
   */
  function convTouch(store, id, nowMs, firstUserText, firstUserFiles) {
    var it = convGet(store, id);
    if (!it) return false;
    it.updatedAt = nowMs;
    if (!it.title && !it.renamed && firstUserText !== undefined) {
      var t = autoTitle(firstUserText, firstUserFiles);
      if (t) it.title = t;
    }
    return true;
  }

  /* ---------- collaboration rooms (Phase 1): pure client helpers ---------- */

  /**
   * Normalize a user-typed room code: trim, drop inner whitespace, uppercase.
   */
  function normalizeRoomCode(code) {
    return String(code == null ? "" : code).trim().replace(/\s+/g, "").toUpperCase();
  }

  /** True for codes shaped like NEUTRON-XXXXXX (unambiguous alphabet). */
  function isValidRoomCode(code) {
    return /^NEUTRON-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(normalizeRoomCode(code));
  }

  /**
   * Reconnect backoff in ms for a 0-based attempt: 1s, 2s, 4s … capped at 30s.
   * Deterministic (no jitter) so it is unit-testable; callers may add jitter.
   */
  function collabBackoffMs(attempt) {
    var a = Math.max(0, Math.floor(Number(attempt) || 0));
    return Math.min(1000 * Math.pow(2, a), 30000);
  }

  /**
   * Clean a display name: trim, collapse whitespace, strip control chars,
   * cap at 32 chars. Returns "" when nothing usable remains.
   */
  function sanitizeCollabName(name) {
    return String(name == null ? "" : name)
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .slice(0, 32);
  }

  /** Trim a chat message and cap it at 2000 chars. */
  function sanitizeCollabText(text) {
    return String(text == null ? "" : text).trim().slice(0, 2000);
  }

  /**
   * Short relative time: "just now", "5m ago", "3h ago", "2d ago",
   * else a locale date. Pure — safe to test.
   */
  function timeAgo(ts, nowMs) {
    var t = Number(ts);
    var now = Number(nowMs);
    if (!isFinite(t) || !isFinite(now)) return "";
    var diff = now - t;
    if (diff < 0) diff = 0;
    if (diff < 60 * 1000) return "just now";
    if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + "m ago";
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + "h ago";
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / (24 * 60 * 60 * 1000)) + "d ago";
    try {
      return new Date(t).toLocaleDateString();
    } catch (e) {
      return "";
    }
  }

  /* ========================================================================
     Universal search + command palette (Phases 14+15) — pure helpers.
     The DOM overlay lives in palette.js. Indexes are built once per
     palette open from the device-local stores; excerpts are capped so no
     full message bodies sit in the index, and snippets are extracted from
     the capped excerpt on demand.
     ======================================================================== */

  /**
   * Group order + labels for universal search results.
   */
  var PALETTE_GROUPS = [
    { id: "projects", label: "Projects", icon: "\uD83D\uDCC1" },
    { id: "chats", label: "Chats", icon: "\uD83D\uDCAC" },
    { id: "files", label: "Files", icon: "\uD83D\uDCC4" },
    { id: "rooms", label: "Rooms", icon: "\uD83D\uDC65" },
    { id: "runs", label: "Agent runs", icon: "\uD83E\uDD16" },
    { id: "checkpoints", label: "Checkpoints", icon: "\uD83D\uDCF8" },
    { id: "github", label: "GitHub", icon: "\uD83D\uDC19" },
  ];

  function paletteGroupDef(id) {
    for (var i = 0; i < PALETTE_GROUPS.length; i++) {
      if (PALETTE_GROUPS[i].id === id) return PALETTE_GROUPS[i];
    }
    return { id: id, label: id, icon: "\u2022" };
  }

  function paletteStr(v, cap) {
    var s = String(v == null ? "" : v);
    return cap && s.length > cap ? s.slice(0, cap) : s;
  }

  /**
   * Build a flat lightweight index from prepared source arrays.
   * sources: {
   *   conversations: [{id,title,updatedAt,archived,excerpt}],
   *   projects: [{id,name,updatedAt,memoryText}],
   *   rooms: [{code,name}],
   *   runs: [{id,goal,repo,status,createdAt}],
   *   checkpoints: [{id,label,repo,createdAt}],
   *   files: [{repo,path}],
   *   githubRepos: [{fullName,description,htmlUrl}]
   * }
   * Entry: {key,group,title,detail,text,body,ts,ref}. `text` is the
   * lowercased haystack; `body` is capped original text for snippets.
   */
  function paletteBuildIndex(sources) {
    var s = sources || {};
    var entries = [];
    function push(group, key, title, detail, bodyText, ts, ref) {
      var t = paletteStr(title, 200) || "(untitled)";
      var body = paletteStr(bodyText, 400);
      entries.push({
        key: group + ":" + key,
        group: group,
        title: t,
        detail: paletteStr(detail, 160),
        text: (t + " " + body).toLowerCase(),
        body: body,
        ts: Number(ts) || 0,
        ref: ref || null,
      });
    }
    (s.conversations || []).forEach(function (c) {
      if (!c || c.archived) return;
      var nowMs = Date.now();
      push("chats", c.id, c.title || "Untitled chat",
        "Chat" + (c.updatedAt ? " \u00B7 " + relativeTime(c.updatedAt, nowMs) : ""),
        c.excerpt, c.updatedAt || c.createdAt, { id: c.id });
    });
    (s.projects || []).forEach(function (p) {
      if (!p) return;
      push("projects", p.id, p.name || "Untitled project", "Project",
        p.memoryText, p.updatedAt || p.createdAt, { id: p.id });
    });
    (s.rooms || []).forEach(function (r) {
      if (!r || !r.code) return;
      push("rooms", r.code, r.name || r.code, "Room \u00B7 " + r.code,
        r.code + " " + (r.name || ""), 0, { code: r.code });
    });
    (s.runs || []).forEach(function (r) {
      if (!r || !r.id) return;
      push("runs", r.id, paletteStr(r.goal, 120) || "Agent run",
        "Agent run" + (r.status ? " \u00B7 " + r.status : "") + (r.repo ? " \u00B7 " + r.repo : ""),
        r.goal, Date.parse(r.createdAt) || 0, { id: r.id });
    });
    (s.checkpoints || []).forEach(function (c) {
      if (!c || !c.id) return;
      push("checkpoints", c.repo + ":" + c.id, c.label || "Checkpoint",
        "Checkpoint" + (c.repo ? " \u00B7 " + c.repo : ""),
        c.label, Date.parse(c.createdAt) || 0, { id: c.id, repo: c.repo });
    });
    (s.files || []).forEach(function (f, i) {
      if (!f || !f.path) return;
      var label = (f.repo ? f.repo + "/" : "") + f.path;
      push("files", i + ":" + label, f.path.split("/").pop(), label,
        label, 0, { repo: f.repo, path: f.path });
    });
    (s.githubRepos || []).forEach(function (g) {
      if (!g || !g.fullName) return;
      push("github", g.fullName, g.fullName, g.description || "GitHub repository",
        g.fullName + " " + (g.description || ""), 0, { fullName: g.fullName, htmlUrl: g.htmlUrl });
    });
    return entries;
  }

  /**
   * Score a (title, haystack) pair against a raw query. 0 = no match.
   * Title matches beat body matches; prefix/word-boundary beats substring.
   */
  function paletteScore(title, haystack, query) {
    var q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q) return 0;
    var t = String(title || "").toLowerCase();
    var h = String(haystack || "").toLowerCase();
    if (t === q) return 100;
    if (t.indexOf(q) === 0) return 80;
    var words = t.split(/[^a-z0-9]+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i].indexOf(q) === 0 && words[i]) return 70;
    }
    if (t.indexOf(q) !== -1) return 60;
    if (h.indexOf(q) !== -1) return 30;
    return 0;
  }

  /**
   * Extract a ~90-char snippet around the first case-insensitive match.
   * Returns "" when there is no match.
   */
  function paletteSnippet(text, query, len) {
    var s = String(text == null ? "" : text);
    var q = String(query == null ? "" : query).trim().toLowerCase();
    if (!s || !q) return "";
    var idx = s.toLowerCase().indexOf(q);
    if (idx === -1) return "";
    var n = len || 90;
    var half = Math.floor((n - q.length) / 2);
    var start = Math.max(0, idx - half);
    var end = Math.min(s.length, idx + q.length + half);
    var out = s.slice(start, end).replace(/\s+/g, " ").trim();
    if (start > 0) out = "\u2026" + out;
    if (end < s.length) out = out + "\u2026";
    return out;
  }

  /**
   * Search flat entries. Returns [{group, items:[{entry,score,snippet}]}]
   * in PALETTE_GROUPS order, non-empty groups only. opts.perGroup caps
   * items per group (default 5).
   */
  function paletteSearch(entries, query, opts) {
    var q = String(query == null ? "" : query).trim();
    if (!q) return [];
    var perGroup = (opts && opts.perGroup) || 5;
    var scored = [];
    (entries || []).forEach(function (e) {
      if (!e) return;
      var score = paletteScore(e.title, e.text, q);
      if (score > 0) scored.push({ entry: e, score: score });
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var tl = a.entry.title.length - b.entry.title.length;
      if (tl !== 0) return tl;
      return (b.entry.ts || 0) - (a.entry.ts || 0);
    });
    var byGroup = {};
    scored.forEach(function (r) {
      var g = r.entry.group;
      if (!byGroup[g]) byGroup[g] = [];
      if (byGroup[g].length < perGroup) {
        r.snippet = paletteSnippet(r.entry.body || r.entry.title, q);
        byGroup[g].push(r);
      }
    });
    var out = [];
    PALETTE_GROUPS.forEach(function (g) {
      if (byGroup[g.id] && byGroup[g.id].length) {
        out.push({ group: g, items: byGroup[g.id] });
      }
    });
    return out;
  }

  /**
   * Static command metadata for the palette's `>` command mode.
   * Runners live in palette.js (they need the DOM + app bridge); this is
   * pure data so filtering stays unit-testable.
   */
  var PALETTE_COMMAND_DEFS = [
    { id: "new-chat", title: "New Chat", hint: "Ctrl+Shift+N", keywords: "chat conversation new task start" },
    { id: "ask-ai", title: "Ask AI", hint: "", keywords: "ai ask assistant question chat" },
    { id: "search-history", title: "Search Chat History", hint: "", keywords: "history search find chat" },
    { id: "new-project", title: "New Project", hint: "", keywords: "project create new workspace brain" },
    { id: "new-agent-run", title: "New Agent Run", hint: "", keywords: "agent run autonomous goal implement" },
    { id: "review-changes", title: "Review Changes", hint: "", keywords: "review diff changes agent approve" },
    { id: "create-checkpoint", title: "Create Checkpoint", hint: "", keywords: "checkpoint snapshot save backup" },
    { id: "create-room", title: "Create Room", hint: "", keywords: "room create collaboration share" },
    { id: "join-room", title: "Join Room", hint: "", keywords: "room join collaborate code invite" },
    { id: "open-terminal", title: "Open Terminal", hint: "", keywords: "terminal shell command console" },
    { id: "run-tests", title: "Run Tests", hint: "", keywords: "test lab run tests verify" },
    { id: "new-task", title: "New Task", hint: "", keywords: "task todo create track work kanban" },
    { id: "open-timeline", title: "Open Activity Timeline", hint: "", keywords: "timeline activity history events feed" },
    { id: "start-maintain", title: "Start Maintenance", hint: "", keywords: "maintain maintenance analyze plan" },
    { id: "open-dashboard", title: "Open Dashboard", hint: "", keywords: "dashboard home overview" },
    { id: "open-reports", title: "Open Reports", hint: "", keywords: "reports jobs history results" },
    { id: "open-security", title: "Open Security Center", hint: "", keywords: "security vulnerabilities scan findings" },
    { id: "open-deps", title: "Open Dependencies", hint: "", keywords: "dependencies packages updates outdated" },
    { id: "open-health", title: "Open Project Health", hint: "", keywords: "health status project dashboard" },
    { id: "toggle-theme", title: "Toggle Theme", hint: "", keywords: "theme dark light appearance color" },
    { id: "open-settings", title: "Open Settings", hint: "", keywords: "settings preferences configuration" },
  ];

  /**
   * Filter command defs by a query (the `>` prefix is stripped by the
   * caller). Empty query → all defs in order. Ranked: title-prefix >
   * title-substring > keyword match.
   */
  function paletteFilterCommands(defs, query) {
    var list = Array.isArray(defs) ? defs : PALETTE_COMMAND_DEFS;
    var q = String(query == null ? "" : query).replace(/^>\s*/, "").trim().toLowerCase();
    if (!q) return list.slice();
    var out = [];
    list.forEach(function (c) {
      if (!c || !c.id) return;
      var t = String(c.title || "").toLowerCase();
      var k = String(c.keywords || "").toLowerCase();
      var score = 0;
      if (t.indexOf(q) === 0) score = 3;
      else if (t.indexOf(q) !== -1) score = 2;
      else if (k.split(/\s+/).some(function (w) { return w.indexOf(q) === 0; })) score = 1;
      else if (k.indexOf(q) !== -1) score = 1;
      if (score > 0) out.push({ def: c, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.map(function (r) { return r.def; });
  }

  /**
   * Pure list-navigation for the palette: move `delta` steps from `cur`
   * within [0, count). `cur` of -1 means "nothing selected" — moving down
   * selects the first item. Returns -1 when count is 0.
   */
  function paletteMoveSelection(cur, delta, count) {
    if (!count || count <= 0) return -1;
    var next = (typeof cur === "number" ? cur : -1) + delta;
    if (next < 0) next = 0;
    if (next > count - 1) next = count - 1;
    return next;
  }

  /**
   * Heuristic: does the query look like a filename/path? The palette only
   * fetches the (Node-only) workspace file listing for such queries, so
   * plain word searches never pay for it.
   */
  function looksLikeFileQuery(q) {
    var s = String(q == null ? "" : q).trim();
    if (!s) return false;
    if (s.indexOf("/") !== -1 || s.indexOf("\\") !== -1) return true;
    /* "app.tsx", ".gitignore", "Dockerfile." — a dot with text around it. */
    return /\.[a-z0-9]{1,8}$/i.test(s) || /^\.[a-z0-9]+/i.test(s);
  }

  /* ========================================================================
     Collaborative editing (Phase 2) — pure helpers for the Yjs binding.
     ======================================================================== */

  /**
   * Base64 encode a Uint8Array. Uses Buffer in node, chunked btoa in the
   * browser (avoids call-stack blowups on large arrays).
   */
  function b64encodeBytes(bytes) {
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
      return Buffer.from(bytes).toString("base64");
    }
    var s = "";
    var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }

  /** Base64 decode to Uint8Array. Returns null on invalid input. */
  function b64decodeBytes(str) {
    if (typeof str !== "string" || !str) return null;
    if (/[^A-Za-z0-9+/=]/.test(str)) return null;
    try {
      if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
        var b = Buffer.from(str, "base64");
        return new Uint8Array(b.buffer, b.byteOffset, b.length);
      }
      var bin = atob(str);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) {
      return null;
    }
  }

  function writeVarUintJS(num, out) {
    var n = num >>> 0;
    while (n > 127) {
      out.push(128 | (127 & n));
      n >>>= 7;
    }
    out.push(n);
  }

  function readVarUintJS(buf, pos) {
    var num = 0;
    var mult = 1;
    for (var k = 0; k < 5; k++) {
      if (pos.i >= buf.length) return null;
      var b = buf[pos.i++];
      num += (b & 127) * mult;
      mult *= 128;
      if (b < 128) return num >>> 0;
    }
    return null;
  }

  /**
   * Encode a y-protocols-style sync frame: varuint(type) varuint8array(payload).
   * type: 0 = step1 (state vector), 1 = step2 (diff update), 2 = update.
   */
  function encodeSyncFrame(type, payload) {
    var head = [];
    writeVarUintJS(type, head);
    writeVarUintJS(payload.length, head);
    var out = new Uint8Array(head.length + payload.length);
    out.set(head, 0);
    out.set(payload, head.length);
    return out;
  }

  /** Decode a sync frame. Returns {type, payload} or null. */
  function decodeSyncFrame(buf) {
    if (!(buf instanceof Uint8Array)) return null;
    var pos = { i: 0 };
    var type = readVarUintJS(buf, pos);
    if (type === null) return null;
    var len = readVarUintJS(buf, pos);
    if (len === null || len < 0 || pos.i + len > buf.length) return null;
    return { type: type, payload: buf.slice(pos.i, pos.i + len) };
  }

  /**
   * Minimal text diff (common prefix/suffix) → Y.Text ops.
   * Returns [{retain:n}, {delete:n}, {insert:str}] in order.
   */
  function diffTextToOps(oldText, newText) {
    oldText = String(oldText == null ? "" : oldText);
    newText = String(newText == null ? "" : newText);
    if (oldText === newText) return [];
    var prefix = 0;
    var maxPrefix = Math.min(oldText.length, newText.length);
    while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
    var suffix = 0;
    var maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix);
    while (
      suffix < maxSuffix &&
      oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
    ) {
      suffix++;
    }
    var ops = [];
    if (prefix > 0) ops.push({ retain: prefix });
    var delCount = oldText.length - prefix - suffix;
    if (delCount > 0) ops.push({ delete: delCount });
    var ins = newText.slice(prefix, newText.length - suffix);
    if (ins) ops.push({ insert: ins });
    return ops;
  }

  /** Convert a string index to 1-based {line, col}. */
  function indexToLineCol(text, index) {
    text = String(text == null ? "" : text);
    var i = Math.max(0, Math.min(index | 0, text.length));
    var line = 1;
    var col = 1;
    for (var k = 0; k < i; k++) {
      if (text.charCodeAt(k) === 10) { line++; col = 1; }
      else col++;
    }
    return { line: line, col: col };
  }

  /**
   * Client-side mirror of the server's path validation (pre-check only —
   * the server is authoritative). Returns the normalized path or null.
   */
  function sanitizeCollabPath(raw) {
    if (typeof raw !== "string") return null;
    var p = raw.trim().replace(/\\/g, "/");
    if (!p || p.length > 200) return null;
    if (p.charAt(0) === "/" || p.charAt(p.length - 1) === "/") return null;
    if (/[\u0000-\u001F\u007F]/.test(p)) return null;
    var segs = p.split("/");
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s || s === "." || s === ".." || s.length > 120) return null;
    }
    return segs.join("/");
  }

  /** Deterministic presence color for a member id (stable across reloads). */
  var PRESENCE_PALETTE = [
    "#CC8066", "#0891B2", "#2F9E5F", "#DE6B48", "#7C6BD6",
    "#C9A227", "#E35D8F", "#3E9BE0", "#5BBF6A", "#E07B39",
  ];
  function pickPresenceColor(memberId) {
    var h = 0;
    var s = String(memberId || "");
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return PRESENCE_PALETTE[Math.abs(h) % PRESENCE_PALETTE.length];
  }

  /** Max age of an awareness entry before the member counts as gone. */
  var PRESENCE_STALE_MS = 10 * 1000;

  /** True when a presence timestamp is older than maxAgeMs (default 10s). Pure. */
  function isPresenceStale(ts, nowMs, maxAgeMs) {
    var age = maxAgeMs == null ? PRESENCE_STALE_MS : maxAgeMs;
    var t = Number(ts);
    if (!isFinite(t)) return true;
    return nowMs - t > age;
  }

  /**
   * Return a copy of an awareness map (memberId -> entry) with stale entries
   * removed. Pure — the caller decides whether to persist the pruned map.
   */
  function pruneStalePresence(map, nowMs, maxAgeMs) {
    var out = {};
    if (!map || typeof map !== "object") return out;
    Object.keys(map).forEach(function (mid) {
      var entry = map[mid];
      if (!isPresenceStale(entry && entry.ts, nowMs, maxAgeMs)) out[mid] = entry;
    });
    return out;
  }

  /**
   * Build a folder tree from flat file metas: [{id, path}].
   * Returns root nodes: {name, path, dir:true, children:[...]} and
   * {name, path, dir:false, id}. Sorted: dirs first, then alpha.
   */
  function buildFileTree(files) {
    var root = { name: "", path: "", dir: true, children: [] };
    function ensureDir(parts) {
      var node = root;
      var cur = "";
      for (var i = 0; i < parts.length; i++) {
        cur = cur ? cur + "/" + parts[i] : parts[i];
        var found = null;
        for (var j = 0; j < node.children.length; j++) {
          if (node.children[j].dir && node.children[j].name === parts[i]) { found = node.children[j]; break; }
        }
        if (!found) {
          found = { name: parts[i], path: cur, dir: true, children: [] };
          node.children.push(found);
        }
        node = found;
      }
      return node;
    }
    (files || []).forEach(function (f) {
      if (!f || typeof f.path !== "string") return;
      var parts = f.path.split("/");
      var name = parts.pop();
      var parent = ensureDir(parts);
      parent.children.push({ name: name, path: f.path, dir: false, id: f.id, meta: f });
    });
    function sort(node) {
      node.children.sort(function (a, b) {
        if (a.dir !== b.dir) return a.dir ? -1 : 1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      node.children.forEach(function (c) { if (c.dir) sort(c); });
    }
    sort(root);
    return root.children;
  }

  /* ==========================================================================
     Voice calls (Phase 3) — pure helpers, no DOM / no WebRTC objects.
     ========================================================================== */

  /** Mesh voice cap: one RTCPeerConnection per other participant. */
  var MAX_VOICE_PARTICIPANTS = 6;

  /** Public STUN servers tried by every client (server may advertise more). */
  var DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

  /**
   * Deterministic offerer rule for the voice mesh: the member with the
   * lexicographically smaller id creates the offer. Both sides compute the
   * same answer, so there is never glare (double-offer).
   */
  function shouldInitiateVoiceOffer(myId, peerId) {
    var a = String(myId == null ? "" : myId);
    var b = String(peerId == null ? "" : peerId);
    if (!a || !b || a === b) return false;
    return a < b;
  }

  /**
   * Map an RTCPeerConnectionState to the small UI vocabulary the voice panel
   * shows. Pure so the state machine is unit-testable.
   */
  function voicePeerUiState(connState) {
    switch (String(connState || "")) {
      case "new":
      case "connecting":
        return "connecting";
      case "connected":
        return "connected";
      case "disconnected":
        return "reconnecting";
      case "failed":
        return "failed";
      case "closed":
        return "idle";
      default:
        return "connecting";
    }
  }

  /**
   * Speaking detection from an analyser RMS level (0..1). The threshold keeps
   * background hiss from lighting the ring; the client smooths with a small
   * hold so the ring doesn't flicker on pauses.
   */
  var VOICE_SPEAK_THRESHOLD = 0.02;
  function isSpeakingRms(rms, threshold) {
    var t = typeof threshold === "number" ? threshold : VOICE_SPEAK_THRESHOLD;
    var r = Number(rms);
    if (!isFinite(r) || r < 0) return false;
    return r >= t;
  }

  /**
   * Diff two voice-member lists by id for aria-live announcements.
   * Returns {joined: [...], left: [...]} with the member records.
   */
  function diffVoiceMembers(prev, next) {
    var before = {};
    (prev || []).forEach(function (m) { if (m && m.id) before[m.id] = m; });
    var after = {};
    (next || []).forEach(function (m) { if (m && m.id) after[m.id] = m; });
    var joined = [];
    var left = [];
    Object.keys(after).forEach(function (id) { if (!before[id]) joined.push(after[id]); });
    Object.keys(before).forEach(function (id) { if (!after[id]) left.push(before[id]); });
    return { joined: joined, left: left };
  }

  /* ==========================================================================
     AI in rooms (Phase 4) — pure helpers, no DOM.
     ========================================================================== */

  /**
   * Parse ```neutron-room-edit fenced blocks from an AI reply.
   * Format:
   *   ```neutron-room-edit
   *   path: relative/path.ts
   *   <complete new file content>
   *   ```
   * Returns { blocks: [{path, content}], stripped } where stripped is the
   * reply with the blocks removed (safe to render as markdown).
   */
  function parseRoomEditBlocks(text) {
    var src = String(text == null ? "" : text);
    var blocks = [];
    var stripped = src.replace(/```neutron-room-edit[ \t]*\r?\n([\s\S]*?)```/g, function (m, body) {
      var lines = String(body).replace(/\r\n?/g, "\n").split("\n");
      var first = (lines.shift() || "").trim();
      var pm = /^path\s*:\s*(.+)$/i.exec(first);
      var path = pm ? pm[1].trim() : "";
      var content = lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
      if (path) blocks.push({ path: path, content: content });
      return "";
    });
    stripped = stripped.replace(/\n{3,}/g, "\n\n").trim();
    return { blocks: blocks, stripped: stripped };
  }

  /**
   * Line-level diff via common prefix/suffix. Returns rows
   * [{t: " " | "add" | "del", text}] — enough for an honest review UI.
   */
  function diffLineBlocks(oldText, newText) {
    var a = String(oldText == null ? "" : oldText).split("\n");
    var b = String(newText == null ? "" : newText).split("\n");
    var p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    var s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    var out = [];
    var i;
    for (i = 0; i < p; i++) out.push({ t: " ", text: a[i] });
    for (i = p; i < a.length - s; i++) out.push({ t: "del", text: a[i] });
    for (i = p; i < b.length - s; i++) out.push({ t: "add", text: b[i] });
    for (i = a.length - s; i < a.length; i++) out.push({ t: " ", text: a[i] });
    return out;
  }

  /** Count added/removed lines between two texts. */
  function diffLineStats(oldText, newText) {
    var rows = diffLineBlocks(oldText, newText);
    var added = 0, removed = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].t === "add") added++;
      else if (rows[i].t === "del") removed++;
    }
    return { added: added, removed: removed };
  }

  /**
   * Parse a unified diff into structured files/hunks/lines.
   * Tolerant: ignores index lines, ---/+++ headers (paths captured),
   * truncation markers, and anything outside a hunk. A bare empty line
   * inside a hunk is treated as an empty context line.
   * Returns { files: [{ path, hunks: [{ header, lines: [{t, text}] }] }] }.
   */
  function parseUnifiedDiff(text) {
    var files = [];
    var cur = null;
    var hunk = null;
    function stripPrefix(p) {
      return p.replace(/^[ab]\//, "");
    }
    var lines = String(text == null ? "" : text).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (ln.indexOf("--- ") === 0) {
        continue;
      } else if (ln.indexOf("+++ ") === 0) {
        var p = ln.slice(4).trim();
        var q = p.indexOf("\t");
        if (q !== -1) p = p.slice(0, q);
        cur = { path: stripPrefix(p) || "(unknown)", hunks: [] };
        files.push(cur);
        hunk = null;
      } else if (ln.indexOf("@@ ") === 0) {
        if (!cur) { cur = { path: "(unknown)", hunks: [] }; files.push(cur); }
        hunk = { header: ln, lines: [] };
        cur.hunks.push(hunk);
      } else if (hunk) {
        var sig = ln.charAt(0);
        if (sig === " " || sig === "+" || sig === "-") {
          hunk.lines.push({ t: sig, text: ln.slice(1) });
        } else if (ln === "") {
          hunk.lines.push({ t: " ", text: "" });
        }
        /* anything else (truncation markers, "\ No newline…") is ignored */
      }
    }
    return { files: files };
  }

  /**
   * Parse the compact diff format produced by the agent's compactDiff
   * ("- line" / "+ line" / "(no changes)" / "… (+N more lines)") into
   * review rows [{t: "add"|"del"|"ctx"|"note", text}].
   */
  function parseCompactDiff(text) {
    var rows = [];
    var lines = String(text == null ? "" : text).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (ln.indexOf("- ") === 0) rows.push({ t: "del", text: ln.slice(2) });
      else if (ln.indexOf("+ ") === 0) rows.push({ t: "add", text: ln.slice(2) });
      else if (ln === "(no changes)" || ln.charAt(0) === "…") rows.push({ t: "note", text: ln });
      else if (ln !== "") rows.push({ t: "ctx", text: ln });
    }
    return rows;
  }

  /**
   * Build the model <select> options for the Settings provider/model picker.
   * Pure — the DOM wiring lives in app.js so this stays unit-testable.
   *
   * defs: provider's defaultModels array (may be missing/empty).
   * customValue: raw text in the custom-model input (trimmed here).
   * storedModel: the persisted model choice (trimmed here).
   *
   * Returns { options: [{value, label}], selected } where:
   *  - options always starts with "Auto (provider default)".
   *  - a stored model absent from defs is kept as a visible "(saved)"
   *    option so switching providers never silently discards the choice.
   *  - selected is "" (Auto) when a custom id is typed, otherwise the
   *    stored model — including the "(saved)" entry when present.
   */
  function buildModelOptions(defs, customValue, storedModel) {
    var list = Array.isArray(defs) ? defs.slice() : [];
    var custom = String(customValue == null ? "" : customValue).trim();
    var stored = String(storedModel == null ? "" : storedModel).trim();
    var options = [{ value: "", label: "Auto (provider default)" }];
    list.forEach(function (m) {
      var v = String(m == null ? "" : m);
      options.push({ value: v, label: v });
    });
    if (stored && list.indexOf(stored) === -1) {
      options.push({ value: stored, label: stored + "  (saved)" });
    }
    var selected = custom ? "" : stored;
    return { options: options, selected: selected };
  }

  /**
   * Scrub secrets from a string before it is stored for display (API
   * inspector, error text). Handles JSON-quoted key fields and URL
   * userinfo: https://user:secret@host → https://***@host. The userinfo
   * pattern only matches before the first "/" so "@" in URL paths is safe.
   * Pure — safe to test.
   */
  function redactSecrets(s) {
    return String(s)
      .replace(/("apiKey"\s*:\s*")[^"]*(")/g, "$1***$2")
      .replace(/("x-api-key"\s*:\s*")[^"]*(")/g, "$1***$2")
      .replace(/("ownerToken"\s*:\s*")[^"]*(")/g, "$1***$2")
      .replace(/("token"\s*:\s*")[^"]*(")/g, "$1***$2")
      .replace(/(\bhttps?:\/\/)[^\/\s@]*@/g, "$1***@");
  }

  /**
   * Normalize a maintain-job SanitizedResult into a render-ready summary.
   * Pure — the Reports view renders sections from this; the raw JSON dump
   * stays available underneath. Returns null for invalid input. Lists are
   * capped (with totals kept) so a huge result can't blow up the DOM.
   */
  var SUMMARY_LIST_CAP = 20;
  function summarizeJobResult(result) {
    if (!result || typeof result !== "object") return null;
    function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
    function str(v) { return String(v == null ? "" : v); }
    function strList(v) {
      if (!Array.isArray(v)) return [];
      return v.map(str).filter(function (s) { return s !== ""; });
    }
    var out = { deviations: strList(result.deviations), errors: strList(result.errors) };

    var ex = result.execution;
    if (ex && typeof ex === "object") {
      var changes = Array.isArray(ex.changes) ? ex.changes : [];
      out.execution = {
        completed: num(ex.completed), failed: num(ex.failed), blocked: num(ex.blocked),
        noLlm: ex.noLlm === true,
        changeCount: changes.length,
        changes: changes.slice(0, SUMMARY_LIST_CAP).map(function (c) {
          c = c || {};
          return {
            path: str(c.path).slice(0, 200), kind: str(c.kind),
            added: num(c.linesAdded), removed: num(c.linesRemoved),
            agent: str(c.agent), risk: str(c.risk),
          };
        }),
      };
    } else { out.execution = null; }

    var t = result.tests;
    if (t && typeof t === "object") {
      var after = (t.after && typeof t.after === "object") ? t.after : null;
      out.tests = {
        command: str(t.command).slice(0, 300),
        total: after ? num(after.total) : 0,
        passed: after ? num(after.passed) : 0,
        failed: after ? num(after.failed) : 0,
        hasAfter: !!after,
        regression: t.regression === true,
        failedTests: strList(t.failedTests).slice(0, SUMMARY_LIST_CAP),
        failedTestCount: strList(t.failedTests).length,
      };
    } else { out.tests = null; }

    function findingsOf(sec, withCategory) {
      var list = Array.isArray(sec.findings) ? sec.findings : [];
      return {
        blocked: sec.blocked === true,
        summary: str(sec.summary).slice(0, 500),
        findingCount: list.length,
        truncated: sec.findingsTruncated === true,
        findings: list.slice(0, SUMMARY_LIST_CAP).map(function (f) {
          f = f || {};
          var o = { severity: str(f.severity), title: str(f.title).slice(0, 300), file: str(f.file).slice(0, 200) };
          if (withCategory) o.category = str(f.category);
          return o;
        }),
      };
    }
    out.security = (result.security && typeof result.security === "object")
      ? findingsOf(result.security, true) : null;
    var cr = result.codeReview;
    if (cr && typeof cr === "object") {
      var r = findingsOf(cr, false);
      r.score = num(cr.score); r.passed = cr.passed === true;
      out.review = r;
    } else { out.review = null; }

    var rel = result.release;
    if (rel && typeof rel === "object") {
      var checks = Array.isArray(rel.checks) ? rel.checks : [];
      out.release = {
        status: str(rel.status),
        blockedBy: strList(rel.blockedBy),
        checks: checks.slice(0, SUMMARY_LIST_CAP).map(function (c) {
          c = c || {};
          return { name: str(c.name).slice(0, 200), ok: c.ok === true, detail: str(c.detail).slice(0, 300) };
        }),
      };
    } else { out.release = null; }
    return out;
  }

  /**
   * Parse the persisted job-history list. Always returns an array: corrupt
   * JSON or a non-array value (manual localStorage edit) yields [] instead
   * of breaking the Reports view with no recovery path. Pure — testable.
   */
  function parseJobHistory(raw) {
    try {
      var h = JSON.parse(raw == null ? "[]" : String(raw));
      return Array.isArray(h) ? h : [];
    } catch (e) { return []; }
  }

  /**
   * Stop any in-progress speech synthesis. `deps.window` lets tests inject
   * a fake; defaults to the real window. Returns true when cancel() ran,
   * false when speech isn't available or cancel threw. Never throws.
   */
  function stopSpeechSynthesis(deps) {
    try {
      var w = (deps && deps.window) || (typeof window !== "undefined" ? window : null);
      if (w && "speechSynthesis" in w && w.speechSynthesis &&
          typeof w.speechSynthesis.cancel === "function") {
        w.speechSynthesis.cancel();
        return true;
      }
    } catch (e) { /* fall through */ }
    return false;
  }

  /* ================= project brain (Phase 1) =================
     Device-local project intelligence: per-project memory the user owns,
     stored in localStorage under neutron_projects (same trust boundary as
     the API key). Pure helpers here; the SPA wires them in app.js.
     NEVER store secrets in project memory — looksLikeSecret() guards saves
     and scanProjectSecrets() flags anything already stored. */

  var PROJECT_STORE_VERSION = 1;
  var PROJECT_MAX_NAME = 120;
  var PROJECT_MAX_TEXT = 2000;   /* description + free-text memory fields */
  var PROJECT_MAX_ENTRY = 1000;  /* one list entry / dependency note */
  var PROJECT_MAX_LIST = 200;    /* entries per list section */
  var PROJECT_CONTEXT_MAX = 4000;/* chars of project memory sent to the model */

  /* Free-text memory sections (single string each). */
  var PROJECT_TEXT_SECTIONS = ["architecture", "framework", "database", "deployment", "docs"];
  /* String-list memory sections. */
  var PROJECT_LIST_SECTIONS = ["languages", "conventions", "decisions", "knownBugs",
    "importantFiles", "apis", "tasks"];
  /* dependencies is a list of {name, version, note} — handled separately. */

  function newProjectMemory() {
    return {
      architecture: "", framework: "", database: "", deployment: "", docs: "",
      languages: [], conventions: [], decisions: [], knownBugs: [],
      importantFiles: [], apis: [], tasks: [],
      dependencies: [],
    };
  }

  function newProject(id, name, nowMs) {
    return {
      id: String(id),
      name: String(name == null ? "" : name).slice(0, PROJECT_MAX_NAME),
      description: "",
      createdAt: nowMs, updatedAt: nowMs,
      memory: newProjectMemory(),
      linkedConversationIds: [],
      linkedRepoNames: [],
    };
  }

  function projectGet(store, id) {
    if (!store || !store.items || typeof id !== "string") return null;
    return store.items[id] || null;
  }

  /* Rename: trimmed, non-empty. Returns true on success. */
  function projectRename(store, id, name) {
    var p = projectGet(store, id);
    if (!p) return false;
    var n = String(name == null ? "" : name).trim();
    if (!n) return false;
    p.name = n.slice(0, PROJECT_MAX_NAME);
    p.updatedAt = Date.now();
    return true;
  }

  function projectDelete(store, id) {
    if (!store || !store.items || !store.items[id]) return false;
    delete store.items[id];
    return true;
  }

  function projectTouch(store, id, nowMs) {
    var p = projectGet(store, id);
    if (!p) return false;
    p.updatedAt = nowMs;
    return true;
  }

  function projectMemory(project) {
    if (!project || typeof project !== "object") return newProjectMemory();
    var m = project.memory && typeof project.memory === "object" ? project.memory : {};
    var out = newProjectMemory();
    PROJECT_TEXT_SECTIONS.forEach(function (k) {
      if (typeof m[k] === "string") out[k] = m[k];
    });
    PROJECT_LIST_SECTIONS.forEach(function (k) {
      if (Array.isArray(m[k])) out[k] = m[k];
    });
    if (Array.isArray(m.dependencies)) out.dependencies = m.dependencies;
    return out;
  }

  /* Set a free-text memory section. Returns true on success. */
  function projectMemorySetText(project, section, text) {
    if (!project || PROJECT_TEXT_SECTIONS.indexOf(section) === -1) return false;
    project.memory = projectMemory(project);
    project.memory[section] = String(text == null ? "" : text).slice(0, PROJECT_MAX_TEXT);
    project.updatedAt = Date.now();
    return true;
  }

  /* Add a string entry to a list section (or a dependency object).
     Returns the index, or -1 on failure. */
  function projectMemoryAdd(project, section, entry) {
    if (!project) return -1;
    project.memory = projectMemory(project);
    if (section === "dependencies") {
      if (!entry || typeof entry !== "object" || !String(entry.name || "").trim()) return -1;
      if (project.memory.dependencies.length >= PROJECT_MAX_LIST) return -1;
      project.memory.dependencies.push({
        name: String(entry.name).trim().slice(0, 200),
        version: String(entry.version || "").trim().slice(0, 100),
        note: String(entry.note || "").trim().slice(0, PROJECT_MAX_ENTRY),
      });
      project.updatedAt = Date.now();
      return project.memory.dependencies.length - 1;
    }
    if (PROJECT_LIST_SECTIONS.indexOf(section) === -1) return -1;
    var v = String(entry == null ? "" : entry).trim();
    if (!v) return -1;
    if (project.memory[section].length >= PROJECT_MAX_LIST) return -1;
    project.memory[section].push(v.slice(0, PROJECT_MAX_ENTRY));
    project.updatedAt = Date.now();
    return project.memory[section].length - 1;
  }

  function projectMemoryRemove(project, section, index) {
    if (!project) return false;
    project.memory = projectMemory(project);
    var list = section === "dependencies" ? project.memory.dependencies
      : (PROJECT_LIST_SECTIONS.indexOf(section) !== -1 ? project.memory[section] : null);
    if (!Array.isArray(list) || index < 0 || index >= list.length) return false;
    list.splice(index, 1);
    project.updatedAt = Date.now();
    return true;
  }

  /* Replace one entry (string for list sections, object for dependencies). */
  function projectMemoryUpdate(project, section, index, value) {
    if (!project) return false;
    project.memory = projectMemory(project);
    if (section === "dependencies") {
      var d = project.memory.dependencies[index];
      if (!d || !value || typeof value !== "object") return false;
      if (typeof value.name === "string" && value.name.trim()) d.name = value.name.trim().slice(0, 200);
      if (typeof value.version === "string") d.version = value.version.trim().slice(0, 100);
      if (typeof value.note === "string") d.note = value.note.trim().slice(0, PROJECT_MAX_ENTRY);
      project.updatedAt = Date.now();
      return true;
    }
    var list = PROJECT_LIST_SECTIONS.indexOf(section) !== -1 ? project.memory[section] : null;
    if (!Array.isArray(list) || index < 0 || index >= list.length) return false;
    var v = String(value == null ? "" : value).trim();
    if (!v) return false;
    list[index] = v.slice(0, PROJECT_MAX_ENTRY);
    project.updatedAt = Date.now();
    return true;
  }

  function linkConversation(project, convId) {
    if (!project || typeof convId !== "string" || !convId) return false;
    if (!Array.isArray(project.linkedConversationIds)) project.linkedConversationIds = [];
    if (project.linkedConversationIds.indexOf(convId) !== -1) return true;
    if (project.linkedConversationIds.length >= 100) return false;
    project.linkedConversationIds.push(convId);
    project.updatedAt = Date.now();
    return true;
  }

  function unlinkConversation(project, convId) {
    if (!project || !Array.isArray(project.linkedConversationIds)) return false;
    var i = project.linkedConversationIds.indexOf(convId);
    if (i === -1) return false;
    project.linkedConversationIds.splice(i, 1);
    project.updatedAt = Date.now();
    return true;
  }

  function linkRepo(project, name) {
    if (!project || typeof name !== "string" || !name.trim()) return false;
    if (!Array.isArray(project.linkedRepoNames)) project.linkedRepoNames = [];
    var n = name.trim().slice(0, 200);
    if (project.linkedRepoNames.indexOf(n) !== -1) return true;
    if (project.linkedRepoNames.length >= 100) return false;
    project.linkedRepoNames.push(n);
    project.updatedAt = Date.now();
    return true;
  }

  function unlinkRepo(project, name) {
    if (!project || !Array.isArray(project.linkedRepoNames)) return false;
    var i = project.linkedRepoNames.indexOf(name);
    if (i === -1) return false;
    project.linkedRepoNames.splice(i, 1);
    project.updatedAt = Date.now();
    return true;
  }

  function sanitizeProjectDep(d) {
    if (!d || typeof d !== "object") return null;
    var name = String(d.name || "").trim();
    if (!name) return null;
    return {
      name: name.slice(0, 200),
      version: String(d.version || "").slice(0, 100),
      note: String(d.note || "").slice(0, PROJECT_MAX_ENTRY),
    };
  }

  /* Quota-safe, JSON-safe copy for localStorage. Returns null for garbage. */
  function sanitizeProject(item) {
    if (!item || typeof item !== "object" || !item.id) return null;
    var mem = projectMemory(item);
    var out = {
      id: String(item.id).slice(0, 100),
      name: String(item.name || "").slice(0, PROJECT_MAX_NAME),
      description: String(item.description || "").slice(0, PROJECT_MAX_TEXT),
      createdAt: Number(item.createdAt) || 0,
      updatedAt: Number(item.updatedAt) || 0,
      memory: newProjectMemory(),
      linkedConversationIds: [],
      linkedRepoNames: [],
    };
    PROJECT_TEXT_SECTIONS.forEach(function (k) {
      out.memory[k] = String(mem[k] || "").slice(0, PROJECT_MAX_TEXT);
    });
    PROJECT_LIST_SECTIONS.forEach(function (k) {
      out.memory[k] = (Array.isArray(mem[k]) ? mem[k] : []).slice(0, PROJECT_MAX_LIST)
        .map(function (e) { return String(e == null ? "" : e).slice(0, PROJECT_MAX_ENTRY); })
        .filter(function (e) { return e.length > 0; });
    });
    out.memory.dependencies = (Array.isArray(mem.dependencies) ? mem.dependencies : [])
      .slice(0, PROJECT_MAX_LIST).map(sanitizeProjectDep).filter(Boolean);
    out.linkedConversationIds = (Array.isArray(item.linkedConversationIds) ? item.linkedConversationIds : [])
      .slice(0, 100).map(function (id) { return String(id).slice(0, 100); }).filter(Boolean);
    out.linkedRepoNames = (Array.isArray(item.linkedRepoNames) ? item.linkedRepoNames : [])
      .slice(0, 100).map(function (n) { return String(n).slice(0, 200); }).filter(Boolean);
    return out;
  }

  function mostRecentProjectId(store) {
    if (!store || !store.items) return null;
    var best = null, bestTs = -1;
    Object.keys(store.items).forEach(function (id) {
      var p = store.items[id];
      var t = p && typeof p.updatedAt === "number" ? p.updatedAt : -1;
      if (t > bestTs) { bestTs = t; best = id; }
    });
    return best;
  }

  /* ---------------- secret guard ----------------
     Never store secrets as project memory. looksLikeSecret() returns the
     matched pattern label (truthy) or null. Checked on every save; existing
     stores are scanned on load and flagged (not silently deleted). */
  var SECRET_PATTERNS = [
    { id: "openai-key", label: "API key (sk-…)", re: /\bsk-[A-Za-z0-9]{16,}\b/ },
    { id: "anthropic-key", label: "Anthropic API key (sk-ant-…)", re: /\bsk-ant-[A-Za-z0-9\-_]{16,}\b/ },
    { id: "google-key", label: "Google API key (AIza…)", re: /\bAIza[0-9A-Za-z\-_]{30,}\b/ },
    { id: "github-token", label: "GitHub token (ghp_/gho_/…)", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
    { id: "slack-token", label: "Slack token (xox…)", re: /\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/ },
    { id: "aws-key", label: "AWS access key (AKIA…)", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: "private-key", label: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
    { id: "bearer", label: "Bearer token", re: /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}={0,2}/ },
    { id: "jwt", label: "JWT", re: /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b/ },
    { id: "secret-assign", label: "Secret-like assignment", re: /\b(api[_-]?key|apikey|secret|passwd|password|pwd|auth[_-]?token|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*(?:"[^"]{8,}"|'[^']{8,}'|[\w\-./+]{12,})/i },
  ];

  function looksLikeSecret(value) {
    var s = String(value == null ? "" : value);
    if (!s) return null;
    for (var i = 0; i < SECRET_PATTERNS.length; i++) {
      if (SECRET_PATTERNS[i].re.test(s)) return SECRET_PATTERNS[i].label;
    }
    return null;
  }

  /* Scan every stored string in a project. Returns
     [{section, index (null for text fields), pattern}] — never the value. */
  function scanProjectSecrets(project) {
    var findings = [];
    if (!project) return findings;
    function check(section, index, value) {
      var label = looksLikeSecret(value);
      if (label) findings.push({ section: section, index: index, pattern: label });
    }
    if (typeof project.description === "string") check("description", null, project.description);
    if (typeof project.name === "string") check("name", null, project.name);
    var mem = projectMemory(project);
    PROJECT_TEXT_SECTIONS.forEach(function (k) { check(k, null, mem[k]); });
    PROJECT_LIST_SECTIONS.forEach(function (k) {
      (Array.isArray(mem[k]) ? mem[k] : []).forEach(function (e, i) { check(k, i, e); });
    });
    (Array.isArray(mem.dependencies) ? mem.dependencies : []).forEach(function (d, i) {
      if (!d) return;
      check("dependencies", i, d.name + " " + d.version + " " + d.note);
    });
    return findings;
  }

  /* ---------------- auto-detect (real data only) ----------------
     Given a repo's relative file list + optional package.json text, suggest
     framework, languages, important files, and dependencies. Everything is a
     suggestion — the UI marks it detected and the user can edit/remove.
     Never invents: unknown input → null/empty, honestly. */

  var EXT_LANG = {
    js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript",
    ts: "TypeScript", mts: "TypeScript", cts: "TypeScript", tsx: "TypeScript",
    py: "Python", pyi: "Python", rb: "Ruby", go: "Go", rs: "Rust",
    java: "Java", kt: "Kotlin", kts: "Kotlin", swift: "Swift", php: "PHP",
    cs: "C#", cpp: "C++", cxx: "C++", cc: "C++", c: "C", h: "C/C++",
    hpp: "C++", m: "Objective-C", mm: "Objective-C++",
    html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", sass: "SCSS",
    less: "Less", vue: "Vue", svelte: "Svelte", astro: "Astro",
    sql: "SQL", sh: "Shell", bash: "Shell", zsh: "Shell", ps1: "PowerShell",
    md: "Markdown", mdx: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML",
    toml: "TOML", xml: "XML", ini: "INI", env: "Env",
    dart: "Dart", lua: "Lua", r: "R", scala: "Scala", sc: "Scala",
    ex: "Elixir", exs: "Elixir", erl: "Erlang", hs: "Haskell",
    tf: "Terraform", dockerfile: "Docker",
  };

  function extOf(path) {
    var base = String(path).split("/").pop() || "";
    if (/^dockerfile(\.|$)/i.test(base)) return "dockerfile";
    var dot = base.lastIndexOf(".");
    if (dot <= 0) return "";
    return base.slice(dot + 1).toLowerCase();
  }

  /* Ordered framework rules: {name, confidence, test(files, pkg)} — first
     match wins so specific frameworks beat generic ones. */
  var FRAMEWORK_RULES = [
    { name: "Next.js", confidence: "high", test: function (f, p) { return hasDep(p, "next") || hasFile(f, /^next\.config\./); } },
    { name: "Nuxt", confidence: "high", test: function (f, p) { return hasDep(p, "nuxt") || hasFile(f, /^nuxt\.config\./); } },
    { name: "Gatsby", confidence: "high", test: function (f, p) { return hasDep(p, "gatsby"); } },
    { name: "Angular", confidence: "high", test: function (f, p) { return hasDep(p, "@angular/core") || hasFile(f, /^angular\.json$/); } },
    { name: "NestJS", confidence: "high", test: function (f, p) { return hasDep(p, "@nestjs/core"); } },
    { name: "Vite", confidence: "medium", test: function (f, p) { return hasFile(f, /^vite\.config\./); } },
    { name: "Vue", confidence: "medium", test: function (f, p) { return hasDep(p, "vue") || hasFile(f, /^vue\.config\./); } },
    { name: "Svelte", confidence: "medium", test: function (f, p) { return hasDep(p, "svelte") || hasFile(f, /^svelte\.config\./); } },
    { name: "React", confidence: "medium", test: function (f, p) { return hasDep(p, "react"); } },
    { name: "Express", confidence: "medium", test: function (f, p) { return hasDep(p, "express"); } },
    { name: "Fastify", confidence: "medium", test: function (f, p) { return hasDep(p, "fastify"); } },
    { name: "Koa", confidence: "medium", test: function (f, p) { return hasDep(p, "koa"); } },
    { name: "Django", confidence: "medium", test: function (f, p, c) { return /django/i.test(reqFile(c, "requirements.txt")); } },
    { name: "Flask", confidence: "medium", test: function (f, p, c) { return /flask/i.test(reqFile(c, "requirements.txt")); } },
  ];

  /* Helpers used by FRAMEWORK_RULES — hoisted function declarations. */
  function hasDep(pkg, name) {
    if (!pkg || typeof pkg !== "object") return false;
    var groups = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g && typeof g === "object" && Object.prototype.hasOwnProperty.call(g, name)) return true;
    }
    return false;
  }
  function hasFile(files, re) {
    for (var i = 0; i < files.length; i++) {
      var base = String(files[i]).split("/").pop();
      if (re.test(base)) return true;
    }
    return false;
  }
  /* Optional map of basename -> file content (capped by the caller), used
     by rules that need to peek inside a file (e.g. requirements.txt). */
  function reqFile(contents, basename) {
    if (!contents || typeof contents !== "object") return "";
    var v = contents[basename];
    return typeof v === "string" ? v : "";
  }

  function parsePackageJson(text) {
    if (!text || typeof text !== "string") return null;
    try {
      var o = JSON.parse(text);
      return (o && typeof o === "object" && !Array.isArray(o)) ? o : null;
    } catch (e) { return null; }
  }

  /* Detect the stack from a real file list + optional package.json text.
     Returns { framework: {name, confidence} | null, languages: [{lang, files, pct}],
     importantFiles: [paths], dependencies: [{name, version}] }. */
  function detectProjectStack(files, packageJsonText, fileContents) {
    var list = (Array.isArray(files) ? files : []).map(function (f) { return String(f); });
    var pkg = parsePackageJson(packageJsonText);
    var out = { framework: null, languages: [], importantFiles: [], dependencies: [] };

    for (var i = 0; i < FRAMEWORK_RULES.length; i++) {
      var rule = FRAMEWORK_RULES[i];
      try {
        if (rule.test(list, pkg, fileContents)) { out.framework = { name: rule.name, confidence: rule.confidence }; break; }
      } catch (e) { /* a bad rule never breaks detection */ }
    }
    if (!out.framework) {
      if (hasFile(list, /^go\.mod$/)) out.framework = { name: "Go", confidence: "medium" };
      else if (hasFile(list, /^Cargo\.toml$/)) out.framework = { name: "Rust", confidence: "medium" };
      else if (hasFile(list, /^(pom\.xml|build\.gradle(\.kts)?)$/)) out.framework = { name: "Java", confidence: "medium" };
      else if (hasFile(list, /^requirements\.txt$/) || hasFile(list, /^pyproject\.toml$/)) out.framework = { name: "Python", confidence: "low" };
    }

    var counts = {}, total = 0;
    list.forEach(function (f) {
      var lang = EXT_LANG[extOf(f)];
      if (!lang || lang === "Markdown" || lang === "JSON" || lang === "YAML" || lang === "TOML" || lang === "XML" || lang === "INI" || lang === "Env") return;
      counts[lang] = (counts[lang] || 0) + 1;
      total++;
    });
    out.languages = Object.keys(counts).map(function (lang) {
      return { lang: lang, files: counts[lang], pct: total ? Math.round(counts[lang] * 100 / total) : 0 };
    }).sort(function (a, b) { return b.files - a.files; }).slice(0, 5);

    var importantRes = [
      /^README(\.|$)/i, /^(package\.json|tsconfig\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml)$/,
      /^(Dockerfile|docker-compose\.ya?ml)$/i,
      /(^|\/)(index|main|app)\.(js|jsx|ts|tsx|py|go|rs|java)$/i,
      /(^|\/)App\.(jsx|tsx)$/,
    ];
    var seen = {};
    list.forEach(function (f) {
      var base = String(f).split("/").pop();
      for (var k = 0; k < importantRes.length; k++) {
        if (importantRes[k].test(base) && !seen[f] && out.importantFiles.length < 20) {
          seen[f] = true;
          out.importantFiles.push(f);
          break;
        }
      }
    });

    if (pkg) {
      ["dependencies", "devDependencies"].forEach(function (group) {
        var g = pkg[group];
        if (g && typeof g === "object") {
          Object.keys(g).slice(0, 100).forEach(function (name) {
            out.dependencies.push({ name: name, version: String(g[name]).slice(0, 100) });
          });
        }
      });
      out.dependencies = out.dependencies.slice(0, 100);
    }
    return out;
  }

  /* ---------------- AI context injection ----------------
     Condensed PROJECT MEMORY block for the system prompt. Only non-empty
     sections; hard-capped (default 4000 chars) with an honest truncation
     marker. The UI shows this exact text on demand — no hidden context. */
  function buildProjectContextBlock(project, maxChars) {
    var cap = (typeof maxChars === "number" && maxChars > 0) ? maxChars : PROJECT_CONTEXT_MAX;
    if (!project) return "";
    var mem = projectMemory(project);
    var lines = ["PROJECT MEMORY — \"" + String(project.name || "untitled") + "\"",
      "(Background context about the user's project. Use it to give relevant answers; the user can correct it.)"];
    function add(label, value) {
      if (value && String(value).trim()) lines.push(label + ": " + String(value).trim());
    }
    add("Architecture", mem.architecture);
    add("Framework", mem.framework);
    add("Languages", mem.languages.join(", "));
    add("Database", mem.database);
    add("Deployment", mem.deployment);
    if (mem.conventions.length) lines.push("Conventions:\n- " + mem.conventions.join("\n- "));
    if (mem.decisions.length) lines.push("Decisions:\n- " + mem.decisions.join("\n- "));
    if (mem.knownBugs.length) lines.push("Known bugs:\n- " + mem.knownBugs.join("\n- "));
    if (mem.importantFiles.length) lines.push("Important files: " + mem.importantFiles.join(", "));
    if (mem.apis.length) lines.push("APIs: " + mem.apis.join(", "));
    if (mem.dependencies.length) {
      lines.push("Dependencies: " + mem.dependencies.map(function (d) {
        return d.name + (d.version ? "@" + d.version : "");
      }).join(", "));
    }
    if (mem.tasks.length) lines.push("Open tasks:\n- " + mem.tasks.join("\n- "));
    add("Notes", mem.docs);
    if (project.description) lines.push("Project: " + String(project.description).trim());
    var text = lines.join("\n");
    if (text.length > cap) {
      text = text.slice(0, cap - 20).replace(/\s+\S*$/, "") + "\n…[truncated]";
    }
    return text;
  }

  /* ---------------------------------------------------------------- */
  /* GitHub integration — pure client core. The token lives only in
     browser localStorage and is sent as an Authorization header per
     request; it is never stored server-side and never logged.        */
  /* ---------------------------------------------------------------- */

  var GITHUB_API_BASE = "https://api.github.com";
  var GITHUB_REPO_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;

  function githubApiUrl(path) {
    var p = String(path == null ? "" : path);
    if (p.charAt(0) !== "/") p = "/" + p;
    return GITHUB_API_BASE + p;
  }

  function githubAuthHeaders(token) {
    return {
      "Authorization": "Bearer " + String(token || ""),
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /** Replace every occurrence of the token in text with [redacted]. */
  function redactGithubToken(text, token) {
    var s = String(text == null ? "" : text);
    var t = String(token == null ? "" : token);
    if (!t) return s;
    return s.split(t).join("[redacted]");
  }

  /** Friendly message for a GitHub API failure. Never includes the token. */
  function githubErrorMessage(status, bodyText) {
    var body = String(bodyText == null ? "" : bodyText).slice(0, 300);
    var apiMsg = "";
    try {
      var parsed = JSON.parse(body);
      if (parsed && typeof parsed.message === "string") apiMsg = parsed.message.slice(0, 200);
    } catch (e) { /* not JSON — ignore */ }
    if (status === 401) {
      return "GitHub rejected the token (401). Check it hasn't expired and was copied in full — " +
        "no extra spaces." + (apiMsg ? " GitHub says: " + apiMsg : "");
    }
    if (status === 403) {
      if (/rate limit/i.test(apiMsg) || /rate limit/i.test(body)) {
        return "GitHub rate limit reached (403). Wait a few minutes and try again.";
      }
      return "GitHub refused the request (403) — the token may lack the needed permission " +
        "(the repo scope for private repositories)." + (apiMsg ? " GitHub says: " + apiMsg : "");
    }
    if (status === 404) {
      return "Not found (404). Check the owner/repository name." + (apiMsg ? " GitHub says: " + apiMsg : "");
    }
    if (status === 422) {
      return "GitHub couldn't process the request (422)." + (apiMsg ? " GitHub says: " + apiMsg : "");
    }
    return "GitHub request failed (HTTP " + status + ")." + (apiMsg ? " GitHub says: " + apiMsg : "");
  }

  function githubRepoUrlOk(url) {
    return typeof url === "string" && GITHUB_REPO_URL_RE.test(url.trim());
  }

  /**
   * Authenticated GitHub API request. fetchImpl is injectable for tests.
   * Rejects when no token is set; failures become friendly messages and
   * the token is scrubbed from every error.
   */
  function githubRequest(path, token, opts, fetchImpl) {
    opts = opts || {};
    var fetchFn = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!fetchFn) return Promise.reject(new Error("fetch is not available."));
    var t = String(token == null ? "" : token);
    if (!t) {
      return Promise.reject(new Error("GitHub token is not connected. Add it in Settings → Connect GitHub."));
    }
    var url = githubApiUrl(path);
    var init = { method: opts.method || "GET", headers: githubAuthHeaders(t) };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    function fail(msg) {
      throw new Error(redactGithubToken(msg, t));
    }
    return Promise.resolve()
      .then(function () { return fetchFn(url, init); })
      .then(function (res) {
        return Promise.resolve(res.text()).then(function (text) {
          if (res.status >= 200 && res.status < 300) {
            if (!text) return null;
            try { return JSON.parse(text); } catch (e) { return text; }
          }
          fail(githubErrorMessage(res.status, text));
          return null; // unreachable — fail throws
        });
      })
      .catch(function (e) {
        fail(e && e.message ? e.message : String(e));
        return null; // unreachable — fail throws
      });
  }

  /* ======================================================================
     Project intelligence (Phases 7/9/10/11): AI code review prompt
     building + finding parsing, dependency helpers, health aggregation.
     All pure — safe to test.
     ====================================================================== */

  var REVIEW_CATEGORIES = ["BUG", "SECURITY", "PERFORMANCE", "MAINTAINABILITY", "STYLE", "TESTING"];
  var REVIEW_DIFF_MAX_CHARS = 7000; // /api/chat caps each message at 8000 chars

  var REVIEW_SYSTEM_PROMPT =
    "You are a senior code reviewer. Review the unified diff below and report " +
    "only issues you can point to with concrete evidence. Every finding needs: " +
    "category (one of BUG, SECURITY, PERFORMANCE, MAINTAINABILITY, STYLE, TESTING), " +
    "a one-line problem, evidence (file path and line quoted from the diff), " +
    "why it matters, and a suggested fix. " +
    "Respond with a single ```json fenced block containing an array of findings: " +
    "[{\"category\": \"...\", \"problem\": \"...\", \"evidence\": \"...\", " +
    "\"why_it_matters\": \"...\", \"suggested_fix\": \"...\"}]. " +
    "If you find nothing worth reporting, respond with ```json {\"no_issues\": true} ``` " +
    "and nothing else. Do not invent issues that are not visible in the diff.";

  /**
   * Build the review request for a unified diff. The diff is truncated to
   * REVIEW_DIFF_MAX_CHARS with an honest note — /api/chat caps messages at
   * 8000 chars, so a huge diff gets a clearly-marked partial review.
   * Returns { system, user, truncated }.
   */
  function buildReviewPrompt(diff, opts) {
    var o = opts || {};
    var maxChars = o.maxChars || REVIEW_DIFF_MAX_CHARS;
    var d = String(diff == null ? "" : diff);
    var truncated = false;
    if (d.length > maxChars) {
      d = d.slice(0, maxChars);
      truncated = true;
    }
    var note = truncated
      ? "\n\n[NOTE: the diff was truncated to " + maxChars + " characters for this review. " +
        "This is a partial review of the first part of the changes.]"
      : "";
    return {
      system: REVIEW_SYSTEM_PROMPT,
      user: "Review this unified diff:\n\n```diff\n" + d + "\n```" + note,
      truncated: truncated,
    };
  }

  function isValidReviewCategory(c) {
    return REVIEW_CATEGORIES.indexOf(String(c || "").toUpperCase()) !== -1;
  }

  /**
   * Parse an AI review response. Expects a ```json fenced array of findings
   * (or {"no_issues": true}). Returns { findings: [...] } with normalized
   * categories, or { findings: [], raw: text } when the model did not
   * produce parseable JSON — the raw text is still shown honestly.
   */
  function parseReviewFindings(text) {
    var s = String(text == null ? "" : text);
    var m = s.match(/```json\s*([\s\S]*?)```/);
    var payload = m ? m[1] : null;
    if (!payload) {
      // Tolerate a bare JSON object/array without a fence.
      var t = s.trim();
      if ((t.charAt(0) === "{" && t.charAt(t.length - 1) === "}") ||
          (t.charAt(0) === "[" && t.charAt(t.length - 1) === "]")) {
        payload = t;
      }
    }
    if (!payload) return { findings: [], raw: s };
    var parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (e) {
      return { findings: [], raw: s };
    }
    if (parsed && parsed.no_issues === true) return { findings: [] };
    if (!Array.isArray(parsed)) return { findings: [], raw: s };
    var findings = parsed.map(function (f) {
      if (!f || typeof f !== "object") return null;
      var cat = String(f.category || "").toUpperCase();
      return {
        category: isValidReviewCategory(cat) ? cat : "MAINTAINABILITY",
        problem: String(f.problem || "").slice(0, 500),
        evidence: String(f.evidence || "").slice(0, 800),
        why_it_matters: String(f.why_it_matters || f.whyItMatters || "").slice(0, 800),
        suggested_fix: String(f.suggested_fix || f.suggestedFix || "").slice(0, 1200),
      };
    }).filter(function (f) {
      return f && (f.problem || f.evidence);
    });
    return { findings: findings };
  }

  /**
   * Convert the agent's compact per-file diffs ("- "/"+" prefixes) into a
   * unified-diff-ish text the code-review prompt can consume.
   * files: [{path, diff}]. Pure — safe to test.
   */
  function compactDiffsToUnified(files) {
    var list = Array.isArray(files) ? files : [];
    var parts = [];
    list.forEach(function (f) {
      f = f || {};
      var path = String(f.path || "unknown");
      var body = String(f.diff || "").split("\n").map(function (ln) {
        if (ln.indexOf("- ") === 0) return "-" + ln.slice(2);
        if (ln.indexOf("+ ") === 0) return "+" + ln.slice(2);
        if (ln === "(no changes)" || ln.charAt(0) === "\u2026") return ln;
        return ln === "" ? "" : " " + ln;
      }).join("\n");
      parts.push("--- a/" + path + "\n+++ b/" + path + "\n" + body);
    });
    return parts.join("\n");
  }

  /**
   * Aggregate project-health signals into an overall verdict.
   * Rule (documented in the Health UI):
   *   "attention" if git is dirty, or any critical/high security finding,
   *   or any vulnerable dependency, or the last recorded build/test failed.
   *   "healthy" if every known signal is good AND at least one signal
   *   produced data. Otherwise "unknown" (honest — never a fake score).
   * signals: { git: {clean} | null, security: {counts} | null,
   *            deps: {counts} | null, build: "passed"|"failed"|null,
   *            tests: "passed"|"failed"|null }
   */
  function computeHealth(signals) {
    var s = signals || {};
    var items = [];
    function sevCounts(c) {
      c = c || {};
      return {
        critical: c.critical || 0, high: c.high || 0, medium: c.medium || 0,
        low: c.low || 0, info: c.info || 0,
      };
    }
    var gitState = !s.git ? "unknown" : (s.git.clean ? "good" : "attention");
    items.push({ key: "git", state: gitState,
      label: !s.git ? "Git status unknown" :
        (s.git.clean ? "Working tree clean" : "Uncommitted changes") });
    var sc = s.security ? sevCounts(s.security.counts) : null;
    var secState = !sc ? "unknown" : ((sc.critical + sc.high) > 0 ? "attention" : "good");
    var secTotal = sc ? (sc.critical + sc.high + sc.medium + sc.low + sc.info) : 0;
    items.push({ key: "security", state: secState,
      label: !sc ? "Never scanned" : (secTotal + " finding(s)") });
    var dc = s.deps ? s.deps.counts : null;
    var depState = !dc ? "unknown" : ((dc.vulnerable || 0) > 0 ? "attention" : "good");
    items.push({ key: "deps", state: depState,
      label: !dc ? "Never scanned" :
        ((dc.vulnerable || 0) + " vulnerable \u00B7 " + (dc.updates || 0) + " updates available") });
    var buildState = !s.build ? "unknown" : (s.build === "passed" ? "good" : "attention");
    items.push({ key: "build", state: buildState,
      label: !s.build ? "No recorded runs" : ("Last run " + s.build) });
    var testState = !s.tests ? "unknown" : (s.tests === "passed" ? "good" : "attention");
    items.push({ key: "tests", state: testState,
      label: !s.tests ? "No recorded runs" : ("Last run " + s.tests) });

    var overall;
    if (items.some(function (i) { return i.state === "attention"; })) overall = "attention";
    else if (items.some(function (i) { return i.state === "good"; })) overall = "healthy";
    else overall = "unknown";
    return { overall: overall, items: items };
  }

  /* ---------------------------------------------------------------- */
  /* Terminal rendering helpers (Phases 8+13)                          */
  /* ---------------------------------------------------------------- */

  /*
   * Minimal ANSI SGR → HTML converter for terminal output. HTML is escaped
   * FIRST, then a small subset of SGR codes is honored: reset (0), bold (1),
   * faint/dim (2), foreground 30–37/90–97, background 40–47/100–107.
   * Everything else (cursor movement, clears, 256-color, etc.) is dropped —
   * this is a scrolling log renderer, not a full terminal emulator, and the
   * Terminal view says so honestly.
   */
  var ANSI_FG = {
    30: "#9aa4b2", 31: "#f87171", 32: "#4ade80", 33: "#facc15",
    34: "#60a5fa", 35: "#e879f9", 36: "#22d3ee", 37: "#e5e7eb",
    90: "#6b7280", 91: "#fca5a5", 92: "#86efac", 93: "#fde047",
    94: "#93c5fd", 95: "#f0abfc", 96: "#67e8f9", 97: "#ffffff",
  };
  var ANSI_BG = {
    40: "#1f2937", 41: "#7f1d1d", 42: "#14532d", 43: "#713f12",
    44: "#1e3a8a", 45: "#701a75", 46: "#155e75", 47: "#374151",
    100: "#111827", 101: "#991b1b", 102: "#166534", 103: "#854d0e",
    104: "#1e40af", 105: "#86198f", 106: "#0e7490", 107: "#4b5563",
  };

  function ansiToHtml(src) {
    var s = String(src == null ? "" : src);
    // 1. Strip carriage returns (progress-bar overwrites) and escape HTML.
    s = s.replace(/\r/g, "");
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // 2. Walk SGR sequences, emitting styled spans.
    var out = "";
    var fg = null, bg = null, bold = false, dim = false;
    function openTag() {
      var style = "";
      if (fg) style += "color:" + fg + ";";
      if (bg) style += "background:" + bg + ";";
      if (bold) style += "font-weight:700;";
      if (dim) style += "opacity:.65;";
      return style ? '<span style="' + style + '">' : "";
    }
    var re = /\x1b\[([0-9;]*)m/g;
    var last = 0, m, open = false;
    while ((m = re.exec(s)) !== null) {
      out += s.slice(last, m.index);
      if (open) { out += "</span>"; open = false; }
      var codes = (m[1] || "0").split(";").map(function (c) { return parseInt(c, 10) || 0; });
      for (var i = 0; i < codes.length; i++) {
        var c = codes[i];
        if (c === 0) { fg = null; bg = null; bold = false; dim = false; }
        else if (c === 1) bold = true;
        else if (c === 2) dim = true;
        else if (c === 22) { bold = false; dim = false; }
        else if (ANSI_FG[c]) fg = ANSI_FG[c];
        else if (ANSI_BG[c]) bg = ANSI_BG[c];
        else if (c === 39) fg = null;
        else if (c === 49) bg = null;
        /* Unknown SGR codes are ignored (dropped, not rendered). */
      }
      var tag = openTag();
      if (tag) { out += tag; open = true; }
      last = m.index + m[0].length;
    }
    out += s.slice(last);
    if (open) out += "</span>";
    // 3. Drop any other escape sequences (cursor moves, clears, …).
    out = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b[()][0-9A-B]/g, "");
    return out;
  }

  /* ========================================================================
     Task management + notification center + activity timeline (Phases 16/27/28).
     Device-local stores (same BYOK trust boundary as everything else):
     "neutron_tasks" and "neutron_notifications". This module only shapes the
     data; tasks.js owns storage and the DOM. No fake entries are ever
     invented — every event comes from a real app action.
     ======================================================================== */

  var TASK_STORE_VERSION = 1;
  var TASK_STORE_KEY = "neutron_tasks";
  var NOTIF_STORE_KEY = "neutron_notifications";
  var ROOM_ACTIVITY_KEY = "neutron_room_activity";

  var TASK_STATUSES = ["backlog", "todo", "in_progress", "review", "done"];
  var TASK_STATUS_LABELS = {
    backlog: "Backlog", todo: "To Do", in_progress: "In Progress",
    review: "Review", done: "Done",
  };
  var TASK_PRIORITIES = ["low", "medium", "high"];
  var TASK_PRIORITY_LABELS = { low: "Low", medium: "Medium", high: "High" };

  var NOTIF_CAP = 100;
  var NOTIF_TYPES = ["agent", "tests", "rooms", "tasks", "system"];
  var NOTIF_TYPE_LABELS = {
    agent: "Agent", tests: "Tests", rooms: "Rooms", tasks: "Tasks", system: "System",
  };

  function newTask(id, nowMs) {
    return {
      id: String(id),
      title: "",
      description: "",
      status: "todo",
      priority: "medium",
      assignee: "",
      projectId: "",
      conversationId: "",
      createdAt: nowMs,
      updatedAt: nowMs,
      completedAt: 0,
    };
  }

  function sanitizeTask(t) {
    if (!t || typeof t !== "object" || !t.id) return null;
    var st = TASK_STATUSES.indexOf(t.status) !== -1 ? t.status : "todo";
    var pr = TASK_PRIORITIES.indexOf(t.priority) !== -1 ? t.priority : "medium";
    return {
      id: String(t.id).slice(0, 100),
      title: String(t.title || "").slice(0, 200),
      description: String(t.description || "").slice(0, 5000),
      status: st,
      priority: pr,
      assignee: String(t.assignee || "").slice(0, 100),
      projectId: String(t.projectId || "").slice(0, 100),
      conversationId: String(t.conversationId || "").slice(0, 100),
      createdAt: Number(t.createdAt) || 0,
      updatedAt: Number(t.updatedAt) || 0,
      completedAt: st === "done" ? (Number(t.completedAt) || Number(t.updatedAt) || 0) : 0,
    };
  }

  function taskGet(store, id) {
    if (!store || !store.items || !id) return null;
    return store.items[id] || null;
  }

  function taskCreate(store, id, nowMs) {
    if (!store || !store.items || !id || store.items[id]) return null;
    var t = newTask(id, nowMs);
    store.items[id] = t;
    return t;
  }

  /**
   * Patch title/description/priority/assignee/projectId/conversationId.
   * Trims strings; an explicitly empty title keeps the old one.
   * Returns true only when something actually changed.
   */
  function taskUpdate(store, id, patch, nowMs) {
    var t = taskGet(store, id);
    if (!t || !patch || typeof patch !== "object") return false;
    var changed = false;
    if (patch.title !== undefined) {
      var nt = String(patch.title).replace(/\s+/g, " ").trim().slice(0, 200);
      if (nt && nt !== t.title) { t.title = nt; changed = true; }
    }
    if (patch.description !== undefined) {
      var nd = String(patch.description).slice(0, 5000);
      if (nd !== t.description) { t.description = nd; changed = true; }
    }
    if (patch.priority !== undefined && TASK_PRIORITIES.indexOf(patch.priority) !== -1 &&
        patch.priority !== t.priority) {
      t.priority = patch.priority; changed = true;
    }
    if (patch.assignee !== undefined) {
      var na = String(patch.assignee).replace(/\s+/g, " ").trim().slice(0, 100);
      if (na !== t.assignee) { t.assignee = na; changed = true; }
    }
    if (patch.projectId !== undefined) {
      var np = String(patch.projectId).slice(0, 100);
      if (np !== t.projectId) { t.projectId = np; changed = true; }
    }
    if (patch.conversationId !== undefined) {
      var nc = String(patch.conversationId).slice(0, 100);
      if (nc !== t.conversationId) { t.conversationId = nc; changed = true; }
    }
    if (changed) t.updatedAt = nowMs;
    return changed;
  }

  /**
   * Status transition: sets completedAt on entering done, clears it when
   * leaving done, always bumps updatedAt. Returns false for bad input.
   */
  function taskSetStatus(store, id, status, nowMs) {
    var t = taskGet(store, id);
    if (!t || TASK_STATUSES.indexOf(status) === -1) return false;
    if (t.status === status) return true;
    t.status = status;
    t.updatedAt = nowMs;
    t.completedAt = status === "done" ? nowMs : 0;
    return true;
  }

  function taskDelete(store, id) {
    if (!store || !store.items || !store.items[id]) return false;
    delete store.items[id];
    return true;
  }

  /** List tasks newest-first. filter: { status?, projectId?, q? }. */
  function taskList(store, filter) {
    var out = [];
    if (!store || !store.items) return out;
    var f = filter || {};
    var q = f.q ? String(f.q).toLowerCase() : "";
    Object.keys(store.items).forEach(function (id) {
      var t = store.items[id];
      if (!t) return;
      if (f.status && t.status !== f.status) return;
      if (f.projectId && t.projectId !== f.projectId) return;
      if (q) {
        var hay = (t.title + " " + t.description).toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      out.push(t);
    });
    out.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return out;
  }

  function taskCounts(store) {
    var c = { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 };
    if (!store || !store.items) return c;
    Object.keys(store.items).forEach(function (id) {
      var t = store.items[id];
      if (t && c[t.status] !== undefined) c[t.status]++;
    });
    return c;
  }

  function newTaskId() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------------- notification center ---------------- */

  function newNotification(id, type, title, body, link, nowMs) {
    return {
      id: String(id),
      type: NOTIF_TYPES.indexOf(type) !== -1 ? type : "system",
      title: String(title || "").slice(0, 200),
      body: String(body || "").slice(0, 500),
      link: String(link || "").slice(0, 300),
      ts: nowMs,
      read: false,
    };
  }

  function sanitizeNotification(n) {
    if (!n || typeof n !== "object" || !n.id) return null;
    return {
      id: String(n.id).slice(0, 100),
      type: NOTIF_TYPES.indexOf(n.type) !== -1 ? n.type : "system",
      title: String(n.title || "").slice(0, 200),
      body: String(n.body || "").slice(0, 500),
      link: String(n.link || "").slice(0, 300),
      ts: Number(n.ts) || 0,
      read: n.read === true,
    };
  }

  /** Prepend; cap at NOTIF_CAP newest. Mutates and returns the list. */
  function notifAdd(list, n) {
    if (!Array.isArray(list) || !n) return list;
    list.unshift(n);
    if (list.length > NOTIF_CAP) list.length = NOTIF_CAP;
    return list;
  }

  function notifMarkRead(list, id) {
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) { list[i].read = true; return true; }
    }
    return false;
  }

  function notifMarkAllRead(list) {
    if (!Array.isArray(list)) return;
    list.forEach(function (n) { if (n) n.read = true; });
  }

  function notifUnreadCount(list) {
    if (!Array.isArray(list)) return 0;
    var c = 0;
    list.forEach(function (n) { if (n && !n.read) c++; });
    return c;
  }

  function defaultNotifPrefs() {
    return { agent: true, tests: true, rooms: true, tasks: true, system: true };
  }

  function sanitizeNotifPrefs(p) {
    var d = defaultNotifPrefs();
    if (!p || typeof p !== "object") return d;
    NOTIF_TYPES.forEach(function (t) {
      if (p[t] === false) d[t] = false;
    });
    return d;
  }

  function notifShouldShow(prefs, type) {
    if (!prefs || typeof prefs !== "object") return true;
    return prefs[type] !== false;
  }

  function newNotifId() {
    return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------- activity timeline ---------------- */

  function timelineEvent(source, kind, title, detail, ts, link) {
    return {
      source: String(source || ""),
      kind: String(kind || ""),
      title: String(title || "").slice(0, 300),
      detail: String(detail || "").slice(0, 500),
      ts: Number(ts) || 0,
      link: String(link || "").slice(0, 300),
    };
  }

  /** Merge events from multiple sources, newest first. Drops invalid entries. */
  function timelineMerge(lists) {
    var out = [];
    (lists || []).forEach(function (l) {
      (l || []).forEach(function (e) {
        if (e && isFinite(e.ts) && e.ts > 0) out.push(e);
      });
    });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out;
  }

  /** Day label for a day-start timestamp: Today / Yesterday / "Sep 12" … */
  function timelineDayLabel(dayStartMs, nowMs) {
    var d0 = startOfDayMs(nowMs);
    var diff = Math.round((d0 - startOfDayMs(dayStartMs)) / 86400000);
    if (diff <= 0) return "Today";
    if (diff === 1) return "Yesterday";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var dt = new Date(dayStartMs);
    var label = months[dt.getMonth()] + " " + dt.getDate();
    if (dt.getFullYear() !== new Date(nowMs).getFullYear()) label += ", " + dt.getFullYear();
    return label;
  }

  /** Group sorted events by calendar day: [{ dayStart, label, events }]. */
  function timelineGroupByDay(events, nowMs) {
    var groups = [];
    var byDay = {};
    (events || []).forEach(function (e) {
      var d = startOfDayMs(e.ts);
      if (!byDay[d]) { byDay[d] = []; groups.push(d); }
      byDay[d].push(e);
    });
    groups.sort(function (a, b) { return b - a; });
    return groups.map(function (d) {
      return { dayStart: d, label: timelineDayLabel(d, nowMs), events: byDay[d] };
    });
  }

  /* ================================================================
     Onboarding + personal dashboard (Phases 36+37). All pure — safe to
     test. Device-local only; the display name is stored in this browser
     and never sent anywhere except where the user explicitly uses it
     (greetings, room/task assignee defaults).
     ================================================================ */

  var ONBOARDING_STORE_KEY = "neutron_onboarding";
  var ONBOARDING_STEP_COUNT = 3;
  var DISPLAY_NAME_MAX = 40;

  /**
   * Clean a display name: strip control chars/newlines, collapse
   * whitespace, trim, cap length. Never throws.
   */
  function sanitizeDisplayName(name) {
    var s = String(name == null ? "" : name);
    s = s.replace(/[\x00-\x1f\x7f]/g, "");
    s = s.replace(/\s+/g, " ").trim();
    return s.slice(0, DISPLAY_NAME_MAX);
  }

  /** Fresh onboarding state. */
  function onboardingInitial() {
    return { version: 1, done: false, step: 0, name: "", projectType: "" };
  }

  /** Validate a stored onboarding blob; repairs or resets to initial. */
  function sanitizeOnboarding(raw) {
    var st = onboardingInitial();
    if (!raw || typeof raw !== "object") return st;
    st.done = raw.done === true;
    var step = Number(raw.step);
    st.step = (step >= 0 && step < ONBOARDING_STEP_COUNT) ? Math.floor(step) : 0;
    st.name = sanitizeDisplayName(raw.name);
    var pt = String(raw.projectType || "");
    st.projectType = projectTypeIds().indexOf(pt) !== -1 ? pt : "";
    return st;
  }

  function onboardingNext(st) {
    var s = sanitizeOnboarding(st);
    s.step = Math.min(s.step + 1, ONBOARDING_STEP_COUNT - 1);
    return s;
  }

  function onboardingBack(st) {
    var s = sanitizeOnboarding(st);
    s.step = Math.max(s.step - 1, 0);
    return s;
  }

  function onboardingSkip(st) {
    var s = sanitizeOnboarding(st);
    s.done = true;
    return s;
  }

  function onboardingFinish(st) {
    var s = sanitizeOnboarding(st);
    s.done = true;
    return s;
  }

  /** Replay from Settings: keep the name, restart at step 0, not done. */
  function onboardingReplay(st) {
    var s = sanitizeOnboarding(st);
    s.done = false;
    s.step = 0;
    return s;
  }

  /**
   * Time-of-day greeting for a 0-23 hour. Boundaries: 05:00–11:59 morning,
   * 12:00–16:59 afternoon, otherwise evening.
   */
  function greetingForHour(h) {
    var hour = Number(h);
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    return "Good evening";
  }

  /** "Good evening" or "Good evening, Sunny". nowMs injectable for tests. */
  function dashboardGreeting(name, nowMs) {
    var d = new Date(typeof nowMs === "number" ? nowMs : Date.now());
    var g = greetingForHour(d.getHours());
    var n = sanitizeDisplayName(name);
    return n ? g + ", " + n : g;
  }

  /** Normalize an array or id→item map into an array of objects. */
  function asItemArray(items) {
    if (Array.isArray(items)) return items.filter(function (x) { return x && typeof x === "object"; });
    if (items && typeof items === "object") {
      return Object.keys(items).map(function (k) { return items[k]; })
        .filter(function (x) { return x && typeof x === "object"; });
    }
    return [];
  }

  /**
   * Latest n items sorted by numeric key descending. Pure; accepts an
   * array or an id→item map.
   */
  function latestItems(items, key, n) {
    var arr = asItemArray(items);
    arr.sort(function (a, b) { return (Number(b[key]) || 0) - (Number(a[key]) || 0); });
    var c = typeof n === "number" && n >= 0 ? Math.floor(n) : arr.length;
    return arr.slice(0, c);
  }

  /** Count of tasks whose status is not "done". Pure. */
  function countOpenTasks(tasks) {
    return asItemArray(tasks).filter(function (t) { return t.status !== "done"; }).length;
  }

  /** Count of notifications not marked read. Pure. */
  function countUnreadNotifs(notifs) {
    var arr = Array.isArray(notifs) ? notifs : [];
    return arr.filter(function (n) { return n && !n.read; }).length;
  }

  /**
   * Project-type picker for onboarding step 2. Templates are static,
   * honest starter text (not AI-generated claims) using the real
   * project-memory sections.
   */
  var PROJECT_TYPES = [
    {
      id: "website", label: "Website", hint: "Pages, portfolios, landing sites",
      memory: {
        architecture: "Website project — describe the pages and stack as you build.",
        languages: ["HTML", "CSS", "JavaScript"],
        conventions: ["Mobile-first responsive layout", "Semantic HTML"],
      },
    },
    {
      id: "mobile", label: "Mobile App", hint: "iOS / Android apps",
      memory: {
        architecture: "Mobile app project — note the platform and navigation structure as you build.",
        conventions: ["Touch targets at least 44px", "Offline-first where possible"],
      },
    },
    {
      id: "api", label: "API", hint: "REST / backend services",
      memory: {
        architecture: "API project — list endpoints under apis as you add them.",
        conventions: ["Versioned routes (/v1)", "JSON request/response bodies", "Validate all input server-side"],
      },
    },
    {
      id: "ai", label: "AI App", hint: "Chatbots, agents, LLM features",
      memory: {
        architecture: "AI app — record provider and model choices under decisions.",
        conventions: ["Never log API keys", "Stream long responses", "Show model and provider in the UI"],
      },
    },
    {
      id: "other", label: "Other", hint: "Something else entirely",
      memory: {
        architecture: "Project — describe what you are building as you go.",
      },
    },
  ];

  function projectTypeIds() {
    return PROJECT_TYPES.map(function (t) { return t.id; });
  }

  /** [{id, label, hint}] for the onboarding picker. */
  function projectTypeList() {
    return PROJECT_TYPES.map(function (t) { return { id: t.id, label: t.label, hint: t.hint }; });
  }

  /**
   * Deep copy of the starter memory template for a type id, or null for
   * unknown ids. Sections match newProjectMemory() keys.
   */
  function projectTypeTemplate(typeId) {
    var t = null;
    PROJECT_TYPES.forEach(function (x) { if (x.id === typeId) t = x; });
    if (!t) return null;
    try { return JSON.parse(JSON.stringify(t.memory)); } catch (e) { return null; }
  }

  /* ================================================================
     Model router + usage dashboard + cost control (Phases 21/23/31).
     All pure — safe to test. Heuristics operate only over the user's own
     configured providers/models; they never invent model ids.
     ================================================================ */

  var ROUTER_MODE_KEY = "neutron_router_mode";
  var ROUTER_MODES = ["auto", "manual", "locked"];
  var USAGE_STORE_KEY = "neutron_usage";
  var USAGE_CAP = 2000;
  var RATES_STORE_KEY = "neutron_rates";
  var BUDGET_STORE_KEY = "neutron_budget";
  var MAXTOK_STORE_KEY = "neutron_max_tokens";
  var LONG_INPUT_CHARS = 8000;

  /** Normalize a stored router mode; default is "auto". */
  function sanitizeRouterMode(m) {
    var v = String(m == null ? "" : m).toLowerCase();
    return ROUTER_MODES.indexOf(v) !== -1 ? v : "auto";
  }

  /**
   * Classify a chat task for routing. Pure heuristic over the user's own
   * input — never calls out, never invents models.
   * Returns { kind: "vision"|"code"|"long"|"chat", reason }.
   */
  function classifyTask(input) {
    var text = String((input && input.text) == null ? "" : input.text);
    var hasImages = !!(input && input.hasImages);
    if (hasImages) {
      return { kind: "vision", reason: "images attached — needs a vision-capable model" };
    }
    if (text.length > LONG_INPUT_CHARS) {
      return {
        kind: "long",
        reason: "long input (" + text.length + " chars) — needs a long-context model",
      };
    }
    if (/```/.test(text) ||
        /\b(function|class|import\s|export\s|def\s|const\s|let\s|var\s|=>|async\s|await\s|bug|error|stack\s?trace|refactor|debug|compile|syntax|typescript|python|rust|golang)\b/i.test(text)) {
      return { kind: "code", reason: "looks like a coding task — coding-strong model preferred" };
    }
    return { kind: "chat", reason: "general question — fast model preferred" };
  }

  /**
   * Tag a model id with capability hints from its name. Explicitly
   * heuristic — the UI labels router reasons as heuristic-based.
   */
  function tagModelCapabilities(modelId) {
    var id = String(modelId == null ? "" : modelId).toLowerCase();
    return {
      vision: /vision|multimodal|llava/i.test(id),
      longContext: /128k|200k|32k|long/i.test(id),
      code: /code|coder|deepseek|starcoder/i.test(id),
      fast: /mini|flash|haiku|turbo|[.\/-]7b|[.\/-]8b/i.test(id),
    };
  }

  /**
   * Pick a model for a classified task from the user's own model list.
   * opts: { kind, models: [{ id, providerId }] }.
   * Returns { modelId, providerId, reason, want, usedFallback } or null when empty.
   * Never invents ids — falls back to the first available model honestly.
   */
  function routeModel(opts) {
    var kind = opts && opts.kind;
    var models = (opts && Array.isArray(opts.models) ? opts.models : [])
      .filter(function (m) { return m && m.id; });
    if (!models.length) return null;
    function firstWith(pred) {
      for (var i = 0; i < models.length; i++) {
        if (pred(tagModelCapabilities(models[i].id))) return models[i];
      }
      return null;
    }
    var pick = null;
    var why = "";
    var want = "";
    if (kind === "vision") {
      want = "vision-capable model";
      pick = firstWith(function (t) { return t.vision; });
      why = pick ? "vision-capable model for attached images"
                 : "no vision-tagged model in your list — using first available";
    } else if (kind === "long") {
      want = "long-context model";
      pick = firstWith(function (t) { return t.longContext; });
      why = pick ? "long-context model for a long input"
                 : "no long-context-tagged model in your list — using first available";
    } else if (kind === "code") {
      want = "coding-strong model";
      pick = firstWith(function (t) { return t.code; });
      why = pick ? "coding-strong model for a code task"
                 : "no coding-tagged model in your list — using first available";
    } else {
      want = "fast model";
      pick = firstWith(function (t) { return t.fast; });
      why = pick ? "fast model for a general question"
                 : "no fast-tagged model in your list — using first available";
    }
    var fallback = !pick;
    if (!pick) pick = models[0];
    return {
      modelId: pick.id,
      providerId: pick.providerId || "",
      reason: why,
      want: want,
      usedFallback: fallback,
    };
  }

  /**
   * Normalize one usage entry. Token counts stay null when the provider
   * did not report them — never zero-filled, never invented.
   */
  function sanitizeUsageEntry(e) {
    if (!e || typeof e !== "object") return null;
    function numOrNull(v) {
      if (v === null || v === undefined || v === "") return null;
      var n = Number(v);
      return isFinite(n) && n >= 0 ? n : null;
    }
    return {
      ts: typeof e.ts === "number" && isFinite(e.ts) ? e.ts : Date.now(),
      provider: String(e.provider == null ? "" : e.provider),
      model: String(e.model == null ? "" : e.model),
      inTok: numOrNull(e.inTok != null ? e.inTok : e.input_tokens),
      outTok: numOrNull(e.outTok != null ? e.outTok : e.output_tokens),
      latencyMs: numOrNull(e.latencyMs),
      ok: e.ok !== false,
    };
  }

  /** Append an entry to the usage log, newest last, capped. Pure. */
  function usageAdd(log, entry, cap) {
    var list = Array.isArray(log) ? log.slice() : [];
    var clean = sanitizeUsageEntry(entry);
    if (clean) list.push(clean);
    var c = typeof cap === "number" && cap > 0 ? Math.floor(cap) : USAGE_CAP;
    return list.length > c ? list.slice(list.length - c) : list;
  }

  /** Start-of-day (local) for a timestamp. */
  function dayStartLocal(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /**
   * Roll up the usage log over the last `days` days (days=1 → today).
   * nowMs injectable for tests.
   */
  function usageRollup(log, days, nowMs) {
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var d = typeof days === "number" && days > 0 ? Math.floor(days) : 1;
    var cutoff = dayStartLocal(now) - (d - 1) * 86400000;
    var list = Array.isArray(log) ? log : [];
    var out = {
      requests: 0, succeeded: 0, failed: 0,
      inTok: 0, outTok: 0, unreported: 0,
      perModel: {}, perProvider: {}, perDay: [],
    };
    var dayMap = {};
    list.forEach(function (raw) {
      var e = sanitizeUsageEntry(raw);
      if (!e || e.ts < cutoff) return;
      out.requests++;
      if (e.ok) out.succeeded++; else out.failed++;
      var hasTok = e.inTok != null || e.outTok != null;
      if (hasTok) {
        out.inTok += e.inTok || 0;
        out.outTok += e.outTok || 0;
      } else {
        out.unreported++;
      }
      function bump(bucket, key, label) {
        var b = bucket[key] || (bucket[key] = { key: key, label: label, requests: 0, inTok: 0, outTok: 0, unreported: 0 });
        b.requests++;
        if (hasTok) { b.inTok += e.inTok || 0; b.outTok += e.outTok || 0; }
        else b.unreported++;
      }
      bump(out.perModel, e.model || "(unknown model)", e.model || "(unknown model)");
      bump(out.perProvider, e.provider || "(unknown provider)", e.provider || "(unknown provider)");
      var ds = dayStartLocal(e.ts);
      if (!dayMap[ds]) dayMap[ds] = { dayStart: ds, requests: 0, inTok: 0, outTok: 0 };
      dayMap[ds].requests++;
      if (hasTok) { dayMap[ds].inTok += e.inTok || 0; dayMap[ds].outTok += e.outTok || 0; }
    });
    out.perDay = Object.keys(dayMap).map(function (k) { return dayMap[k]; })
      .sort(function (a, b) { return a.dayStart - b.dayStart; });
    return out;
  }

  /**
   * Validate a $/1M-tokens rate. Returns the number, or null for
   * empty/invalid. Never negative, never absurd.
   */
  function validateRate(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    if (!isFinite(n) || n < 0 || n > 1000000) return null;
    return n;
  }

  /**
   * Estimate cost in dollars from token counts and a {in,out} $/1M rate.
   * Returns null when anything needed is missing — never a guessed price.
   */
  function estimateCost(inTok, outTok, rate) {
    if (inTok == null && outTok == null) return null;
    if (!rate || rate.in == null || rate.out == null) return null;
    return ((inTok || 0) * rate.in + (outTok || 0) * rate.out) / 1000000;
  }

  /**
   * Budget state for one period. spent/limit in dollars.
   * "unset" when no limit configured; "warn" at >=80%; "over" at >=100%.
   */
  function budgetStatus(spent, limit) {
    var lim = Number(limit);
    if (!isFinite(lim) || lim <= 0) return "unset";
    var s = Number(spent);
    if (!isFinite(s) || s < 0) s = 0;
    if (s >= lim) return "over";
    if (s >= lim * 0.8) return "warn";
    return "ok";
  }

  /**
   * Sum estimated spend over entries, using a rates map keyed by model id:
   * { modelId: { in, out } }. Entries without rates or tokens are skipped.
   * Returns { dollars, costed, skipped }.
   */
  function sumEstimatedSpend(entries, rates) {
    var dollars = 0, costed = 0, skipped = 0;
    (Array.isArray(entries) ? entries : []).forEach(function (raw) {
      var e = sanitizeUsageEntry(raw);
      if (!e || !e.ok) return;
      var r = rates && e.model ? rates[e.model] : null;
      var c = estimateCost(e.inTok, e.outTok, r);
      if (c == null) { skipped++; return; }
      dollars += c;
      costed++;
    });
    return { dollars: dollars, costed: costed, skipped: skipped };
  }

  /** Validate a budget object {daily, monthly} from settings inputs. */
  function sanitizeBudget(b) {
    function one(v) {
      if (v === null || v === "") return null;
      if (v === undefined) return null;
      var n = Number(v);
      return isFinite(n) && n > 0 && n <= 1000000 ? n : null;
    }
    b = b && typeof b === "object" ? b : {};
    return { daily: one(b.daily), monthly: one(b.monthly) };
  }

  /** Validate max output tokens setting. */
  function sanitizeMaxTokens(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Math.floor(Number(v));
    return isFinite(n) && n >= 16 && n <= 128000 ? n : null;
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
    renderMarkdown: renderMarkdown,
    stripMarkdownForSpeech: stripMarkdownForSpeech,
    friendlyChatError: friendlyChatError,
    /* collaboration rooms (Phase 1) */
    normalizeRoomCode: normalizeRoomCode,
    isValidRoomCode: isValidRoomCode,
    collabBackoffMs: collabBackoffMs,
    sanitizeCollabName: sanitizeCollabName,
    sanitizeCollabText: sanitizeCollabText,
    timeAgo: timeAgo,
    /* project brain */
    PROJECT_STORE_VERSION: PROJECT_STORE_VERSION,
    PROJECT_CONTEXT_MAX: PROJECT_CONTEXT_MAX,
    PROJECT_TEXT_SECTIONS: PROJECT_TEXT_SECTIONS,
    PROJECT_LIST_SECTIONS: PROJECT_LIST_SECTIONS,
    newProject: newProject,
    newProjectMemory: newProjectMemory,
    projectGet: projectGet,
    projectRename: projectRename,
    projectDelete: projectDelete,
    projectTouch: projectTouch,
    projectMemory: projectMemory,
    projectMemorySetText: projectMemorySetText,
    projectMemoryAdd: projectMemoryAdd,
    projectMemoryRemove: projectMemoryRemove,
    projectMemoryUpdate: projectMemoryUpdate,
    linkConversation: linkConversation,
    unlinkConversation: unlinkConversation,
    linkRepo: linkRepo,
    unlinkRepo: unlinkRepo,
    sanitizeProject: sanitizeProject,
    mostRecentProjectId: mostRecentProjectId,
    looksLikeSecret: looksLikeSecret,
    scanProjectSecrets: scanProjectSecrets,
    detectProjectStack: detectProjectStack,
    parsePackageJson: parsePackageJson,
    buildProjectContextBlock: buildProjectContextBlock,
    /* conversation workspace */
    CONV_STORE_VERSION: CONV_STORE_VERSION,
    newConversation: newConversation,
    autoTitle: autoTitle,
    convDisplayTitle: convDisplayTitle,
    relativeTime: relativeTime,
    convDayBucket: convDayBucket,
    groupConversations: groupConversations,
    archivedConversations: archivedConversations,
    searchConversations: searchConversations,
    sanitizeConversation: sanitizeConversation,
    migrateLegacyChat: migrateLegacyChat,
    convGet: convGet,
    convSetActive: convSetActive,
    convCreate: convCreate,
    convRename: convRename,
    convSetPinned: convSetPinned,
    convSetArchived: convSetArchived,
    convDelete: convDelete,
    convDuplicate: convDuplicate,
    convTouch: convTouch,
    mostRecentConvId: mostRecentConvId,
    /* universal search + command palette (Phases 14+15) */
    PALETTE_GROUPS: PALETTE_GROUPS,
    PALETTE_COMMAND_DEFS: PALETTE_COMMAND_DEFS,
    paletteGroupDef: paletteGroupDef,
    paletteBuildIndex: paletteBuildIndex,
    paletteScore: paletteScore,
    paletteSnippet: paletteSnippet,
    paletteSearch: paletteSearch,
    paletteFilterCommands: paletteFilterCommands,
    paletteMoveSelection: paletteMoveSelection,
    looksLikeFileQuery: looksLikeFileQuery,
    /* collaborative editing (Phase 2) */
    b64encodeBytes: b64encodeBytes,
    b64decodeBytes: b64decodeBytes,
    encodeSyncFrame: encodeSyncFrame,
    decodeSyncFrame: decodeSyncFrame,
    diffTextToOps: diffTextToOps,
    indexToLineCol: indexToLineCol,
    sanitizeCollabPath: sanitizeCollabPath,
    pickPresenceColor: pickPresenceColor,
    PRESENCE_STALE_MS: PRESENCE_STALE_MS,
    isPresenceStale: isPresenceStale,
    pruneStalePresence: pruneStalePresence,
    buildFileTree: buildFileTree,
    /* voice calls (Phase 3) */
    MAX_VOICE_PARTICIPANTS: MAX_VOICE_PARTICIPANTS,
    DEFAULT_STUN_URLS: DEFAULT_STUN_URLS,
    VOICE_SPEAK_THRESHOLD: VOICE_SPEAK_THRESHOLD,
    shouldInitiateVoiceOffer: shouldInitiateVoiceOffer,
    voicePeerUiState: voicePeerUiState,
    isSpeakingRms: isSpeakingRms,
    diffVoiceMembers: diffVoiceMembers,
    /* AI in rooms (Phase 4) */
    parseRoomEditBlocks: parseRoomEditBlocks,
    diffLineBlocks: diffLineBlocks,
    diffLineStats: diffLineStats,
    parseUnifiedDiff: parseUnifiedDiff,
    parseCompactDiff: parseCompactDiff,
    /* settings model picker */
    buildModelOptions: buildModelOptions,
    /* model router + usage dashboard + cost control (Phases 21/23/31) */
    ROUTER_MODE_KEY: ROUTER_MODE_KEY,
    ROUTER_MODES: ROUTER_MODES,
    USAGE_STORE_KEY: USAGE_STORE_KEY,
    USAGE_CAP: USAGE_CAP,
    RATES_STORE_KEY: RATES_STORE_KEY,
    BUDGET_STORE_KEY: BUDGET_STORE_KEY,
    MAXTOK_STORE_KEY: MAXTOK_STORE_KEY,
    sanitizeRouterMode: sanitizeRouterMode,
    classifyTask: classifyTask,
    tagModelCapabilities: tagModelCapabilities,
    routeModel: routeModel,
    sanitizeUsageEntry: sanitizeUsageEntry,
    usageAdd: usageAdd,
    usageRollup: usageRollup,
    validateRate: validateRate,
    estimateCost: estimateCost,
    budgetStatus: budgetStatus,
    sumEstimatedSpend: sumEstimatedSpend,
    sanitizeBudget: sanitizeBudget,
    sanitizeMaxTokens: sanitizeMaxTokens,
    /* voice output */
    stopSpeechSynthesis: stopSpeechSynthesis,
    /* secret scrubbing for logs */
    redactSecrets: redactSecrets,
    /* GitHub integration (pure client core — DOM lives in github.js) */
    githubApiUrl: githubApiUrl,
    githubAuthHeaders: githubAuthHeaders,
    githubErrorMessage: githubErrorMessage,
    githubRepoUrlOk: githubRepoUrlOk,
    redactGithubToken: redactGithubToken,
    githubRequest: githubRequest,
    /* reports result summary */
    summarizeJobResult: summarizeJobResult,
    /* job history parsing */
    parseJobHistory: parseJobHistory,
    /* project intelligence: AI code review + health (Phases 7/11) */
    REVIEW_CATEGORIES: REVIEW_CATEGORIES,
    REVIEW_DIFF_MAX_CHARS: REVIEW_DIFF_MAX_CHARS,
    buildReviewPrompt: buildReviewPrompt,
    parseReviewFindings: parseReviewFindings,
    compactDiffsToUnified: compactDiffsToUnified,
    computeHealth: computeHealth,
    /* terminal: minimal ANSI SGR → HTML (Phases 8+13) */
    ansiToHtml: ansiToHtml,
    /* task management + notification center + activity timeline (Phases 16/27/28) */
    TASK_STORE_VERSION: TASK_STORE_VERSION,
    TASK_STORE_KEY: TASK_STORE_KEY,
    NOTIF_STORE_KEY: NOTIF_STORE_KEY,
    ROOM_ACTIVITY_KEY: ROOM_ACTIVITY_KEY,
    TASK_STATUSES: TASK_STATUSES,
    TASK_STATUS_LABELS: TASK_STATUS_LABELS,
    TASK_PRIORITIES: TASK_PRIORITIES,
    TASK_PRIORITY_LABELS: TASK_PRIORITY_LABELS,
    NOTIF_CAP: NOTIF_CAP,
    NOTIF_TYPES: NOTIF_TYPES,
    NOTIF_TYPE_LABELS: NOTIF_TYPE_LABELS,
    newTask: newTask,
    sanitizeTask: sanitizeTask,
    taskGet: taskGet,
    taskCreate: taskCreate,
    taskUpdate: taskUpdate,
    taskSetStatus: taskSetStatus,
    taskDelete: taskDelete,
    taskList: taskList,
    taskCounts: taskCounts,
    newTaskId: newTaskId,
    newNotification: newNotification,
    sanitizeNotification: sanitizeNotification,
    notifAdd: notifAdd,
    notifMarkRead: notifMarkRead,
    notifMarkAllRead: notifMarkAllRead,
    notifUnreadCount: notifUnreadCount,
    defaultNotifPrefs: defaultNotifPrefs,
    sanitizeNotifPrefs: sanitizeNotifPrefs,
    notifShouldShow: notifShouldShow,
    newNotifId: newNotifId,
    timelineEvent: timelineEvent,
    timelineMerge: timelineMerge,
    timelineDayLabel: timelineDayLabel,
    timelineGroupByDay: timelineGroupByDay,
    /* onboarding + personal dashboard (Phases 36+37) */
    ONBOARDING_STORE_KEY: ONBOARDING_STORE_KEY,
    ONBOARDING_STEP_COUNT: ONBOARDING_STEP_COUNT,
    DISPLAY_NAME_MAX: DISPLAY_NAME_MAX,
    sanitizeDisplayName: sanitizeDisplayName,
    onboardingInitial: onboardingInitial,
    sanitizeOnboarding: sanitizeOnboarding,
    onboardingNext: onboardingNext,
    onboardingBack: onboardingBack,
    onboardingSkip: onboardingSkip,
    onboardingFinish: onboardingFinish,
    onboardingReplay: onboardingReplay,
    greetingForHour: greetingForHour,
    dashboardGreeting: dashboardGreeting,
    latestItems: latestItems,
    countOpenTasks: countOpenTasks,
    countUnreadNotifs: countUnreadNotifs,
    projectTypeIds: projectTypeIds,
    projectTypeList: projectTypeList,
    projectTypeTemplate: projectTypeTemplate,
  };
});
