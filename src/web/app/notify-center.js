/**
 * NEUTRON user notification center — admin broadcasts.
 *
 * - Realtime: opens an authenticated WebSocket to
 *   /api/notifications/stream for instant delivery + badge updates.
 * - Fallback: polls /api/notifications/unread-count every 45s when the
 *   socket isn't live (e.g. serverless hosts can't hold WebSockets).
 * - Merges the admin unread count with the task notification badge.
 * - Renders the "Announcements" section on the #/notifications page.
 * - Mark individual as read / mark all as read.
 *
 * Works offline-first: notifications are persisted server-side; the
 * center fetches them when the user comes online.
 */
(function (root) {
  "use strict";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function token() {
    try {
      if (window.NeutronAuth && window.NeutronAuth.getToken) {
        return window.NeutronAuth.getToken() || "";
      }
    } catch (e) {}
    return "";
  }

  async function api(method, path, body) {
    var base = "";
    try {
      if (window.NeutronAuth && window.NeutronAuth.resolveAuthBase) {
        base = await window.NeutronAuth.resolveAuthBase();
      }
    } catch (e) {}
    var t = token();
    if (!t) return null; // not logged in — no notifications
    var res = await fetch(base + path, {
      method: method,
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + t,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    try { return await res.json(); } catch (e2) { return null; }
  }

  var POLL_MS = 45000;
  var pollTimer = null;

  /* ----- realtime stream (WebSocket) -----
     The Node backend pushes deliveries instantly over
     /api/notifications/stream. 45s polling stays as the fallback for
     hosts that can't hold WebSocket connections (e.g. Vercel serverless). */
  var WS_PATH = "/api/notifications/stream";
  var ws = null;
  var wsToken = null; // token the current socket authenticated with
  var wsAlive = false; // authenticated + open
  var wsRetryMs = 1000;
  var wsRetryTimer = null;
  var WS_MAX_RETRY_MS = 30000;

  function nudgeBadge() {
    try {
      if (window.NeutronTasks && window.NeutronTasks.updateBadge) {
        window.NeutronTasks.updateBadge();
      }
    } catch (e) {}
  }

  function notifyToast(n) {
    var msg = "New announcement: " + (n.title || "NEUTRON");
    try {
      if (window.NeutronUI && window.NeutronUI.toast) { window.NeutronUI.toast(msg); return; }
    } catch (e) {}
    try {
      if (typeof window.toast === "function") { window.toast(msg); return; }
    } catch (e2) {}
  }

  function wsUrl(base) {
    var b = String(base || "").replace(/\/+$/, "");
    if (!b) b = location.protocol + "//" + location.host; // same-origin fallback
    return b.replace(/^http/i, "ws") + WS_PATH;
  }

  function scheduleWsRetry() {
    if (wsRetryTimer) return;
    wsRetryTimer = setTimeout(function () {
      wsRetryTimer = null;
      wsRetryMs = Math.min(WS_MAX_RETRY_MS, wsRetryMs * 2);
      ensureSocket();
    }, wsRetryMs);
  }

  function closeSocket() {
    wsAlive = false;
    wsToken = null;
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }
  }

  /** Connect when logged in; tear down on logout. Idempotent. */
  function ensureSocket() {
    var t = token();
    if (!t) { closeSocket(); return; }
    if (typeof WebSocket === "undefined") return;
    // Account switched while a socket is open: drop it and reconnect.
    if (ws && wsToken !== t) closeSocket();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (wsRetryTimer) return;
    var myToken = t;
    wsToken = t;
    var baseP = null;
    try {
      baseP = window.NeutronAuth && window.NeutronAuth.resolveAuthBase
        ? window.NeutronAuth.resolveAuthBase() : Promise.resolve("");
    } catch (e) { baseP = Promise.resolve(""); }
    Promise.resolve(baseP).then(function (base) {
      if (token() !== myToken) return; // logged out/switched meanwhile
      var url;
      try { url = wsUrl(base); } catch (e) { return; }
      var sock;
      try { sock = new WebSocket(url); } catch (e) { scheduleWsRetry(); return; }
      ws = sock;
      sock.onopen = function () {
        // Token goes in the first frame, never in the URL (no access-log leak).
        try { sock.send(JSON.stringify({ type: "auth", token: myToken })); } catch (e) {}
      };
      sock.onmessage = function (ev) { onSocketMessage(sock, ev); };
      sock.onclose = function () {
        if (ws === sock) {
          ws = null;
          wsAlive = false;
          if (token()) scheduleWsRetry(); // reconnect while still logged in
        }
      };
      sock.onerror = function () { /* onclose follows */ };
    });
  }

  function onSocketMessage(sock, ev) {
    var msg = null;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      wsAlive = true;
      wsRetryMs = 1000; // reset backoff on success
      if (typeof msg.unreadCount === "number") {
        window.__neutronAdminUnread = msg.unreadCount;
        nudgeBadge();
      }
      return;
    }
    if (msg.type === "pong") return;
    if (msg.type === "notification" && msg.notification) {
      if (typeof msg.unreadCount === "number") window.__neutronAdminUnread = msg.unreadCount;
      else window.__neutronAdminUnread = (window.__neutronAdminUnread || 0) + 1;
      nudgeBadge();
      notifyToast(msg.notification);
      // Refresh the announcements list if it's on screen.
      try {
        if ((location.hash || "").indexOf("#/notifications") === 0 &&
            window.NeutronApp && window.NeutronApp.rerender) {
          window.NeutronApp.rerender();
        }
      } catch (e) {}
    }
  }

  function typeLabel(t) {
    var m = { information: "Information", success: "Success", warning: "Warning",
              important: "Important", system_update: "System Update" };
    return m[t] || t;
  }

  function timeAgo(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  /**
   * Refresh the admin unread count. The value is published on
   * window.__neutronAdminUnread; tasks.js updateBadge() adds it to the
   * task count for the combined bell badge.
   */
  async function refreshBadge() {
    try {
      var d = await api("GET", "/api/notifications/unread-count");
      var c = d && typeof d.count === "number" ? d.count : 0;
      window.__neutronAdminUnread = c;
      // Nudge tasks.js to repaint the combined badge if it's loaded.
      try {
        if (window.NeutronTasks && window.NeutronTasks.updateBadge) {
          window.NeutronTasks.updateBadge();
        }
      } catch (e) {}
    } catch (e) {}
  }

  function startPolling() {
    if (pollTimer) return;
    window.__neutronAdminUnread = 0;
    tick();
    pollTimer = setInterval(tick, POLL_MS);
  }

  /**
   * One loop tick: keep the realtime socket in the right state, and poll
   * the unread count only when the socket isn't delivering it live.
   */
  function tick() {
    ensureSocket();
    if (!wsAlive) refreshBadge();
  }

  /** Render the Announcements section into the notifications page. */
  async function renderAnnouncements(view) {
    var sec = el("section", "panel");
    sec.appendChild(el("h2", null, "Announcements"));
    var list = el("div", "announce-list");
    list.appendChild(el("p", "muted small", "Loading…"));
    sec.appendChild(list);
    view.insertBefore(sec, view.firstChild);

    var d = await api("GET", "/api/notifications?limit=50");
    list.innerHTML = "";
    var items = (d && d.items) || [];
    if (!items.length) {
      list.appendChild(el("p", "muted small", "No announcements yet."));
      return;
    }

    var markAll = el("button", "btn ghost sm", "Mark all as read");
    markAll.type = "button";
    markAll.onclick = async function () {
      markAll.disabled = true;
      await api("POST", "/api/notifications/read-all");
      refreshBadge();
      renderAnnouncementsRefresh(view);
    };
    sec.insertBefore(markAll, list);

    items.forEach(function (n) {
      var card = el("div", "announce" + (n.read ? "" : " unread"));
      var head = el("div", "announce-title");
      if (!n.read) head.appendChild(el("span", "announce-dot"));
      head.appendChild(el("span", null, n.title));
      head.appendChild(el("span", "announce-type", typeLabel(n.type)));
      card.appendChild(head);
      card.appendChild(el("p", null, n.message));
      var foot = el("div", "row");
      foot.appendChild(el("span", "muted small announce-time", timeAgo(n.createdAt)));
      if (!n.read) {
        var mr = el("button", "btn ghost sm", "Mark as read");
        mr.type = "button";
        mr.onclick = async function () {
          mr.disabled = true;
          await api("POST", "/api/notifications/" + encodeURIComponent(n.notificationId) + "/read");
          refreshBadge();
          renderAnnouncementsRefresh(view);
        };
        foot.appendChild(mr);
      }
      var del = el("button", "btn ghost sm danger", "Delete");
      del.type = "button";
      del.title = "Delete this announcement";
      del.onclick = async function () {
        if (!window.confirm("Delete this announcement?\n\nIt will be permanently removed from your inbox.")) return;
        del.disabled = true;
        try {
          await api("DELETE", "/api/notifications/" + encodeURIComponent(n.notificationId));
          refreshBadge();
          renderAnnouncementsRefresh(view);
        } catch (e) {
          del.disabled = false;
          window.alert("Couldn't delete: " + (e.message || e));
        }
      };
      foot.appendChild(del);
      card.appendChild(foot);
      list.appendChild(card);
    });
  }

  /** Re-render announcements by re-invoking on the notifications view. */
  function renderAnnouncementsRefresh(view) {
    // Simplest reliable refresh: re-run the route render.
    try {
      if (window.NeutronApp && window.NeutronApp.rerender) window.NeutronApp.rerender();
      else location.reload();
    } catch (e) { location.reload(); }
  }

  root.NeutronNotifyCenter = {
    startPolling: startPolling,
    refreshBadge: refreshBadge,
    renderAnnouncements: renderAnnouncements,
  };

  // Start polling once the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { startPolling(); });
  } else {
    startPolling();
  }
})(typeof window !== "undefined" ? window : this);
