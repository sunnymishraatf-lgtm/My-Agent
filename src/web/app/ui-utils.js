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
    convCreate: convCreate,
    convRename: convRename,
    convSetPinned: convSetPinned,
    convSetArchived: convSetArchived,
    convDelete: convDelete,
    convDuplicate: convDuplicate,
    convTouch: convTouch,
    mostRecentConvId: mostRecentConvId,
  };
});
