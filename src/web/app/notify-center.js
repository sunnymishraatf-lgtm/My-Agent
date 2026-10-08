/**
 * NEUTRON user notification center — admin broadcasts.
 *
 * - Polls /api/notifications/unread-count and merges with the task
 *   notification badge.
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
    refreshBadge();
    pollTimer = setInterval(refreshBadge, POLL_MS);
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
