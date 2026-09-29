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

  return {
    CHAT_RENDER_CAP: CHAT_RENDER_CAP,
    debounce: debounce,
    cappedSlice: cappedSlice,
    shouldRefreshPill: shouldRefreshPill,
  };
});
