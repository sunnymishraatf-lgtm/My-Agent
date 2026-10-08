/**
 * NEUTRON Admin Dashboard — notification system.
 *
 * Routes:
 *   #/admin/login               — admin sign-in (email + password)
 *   #/admin                     — dashboard (stats cards)
 *   #/admin/notifications       — compose + send notification
 *   #/admin/notifications/history — sent history with search/filter
 *
 * Security: every admin API call sends the user's Bearer token; the
 * backend independently verifies the ADMIN role. The frontend never
 * decides access — it only hides UI. Direct navigation to #/admin
 * without an admin session redirects to #/admin/login.
 */
(function (root) {
  "use strict";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function toast(msg) {
    if (window.NeutronUI && window.NeutronUI.toast) window.NeutronUI.toast(msg);
  }

  function token() {
    try {
      if (window.NeutronAuth && window.NeutronAuth.getToken) {
        return window.NeutronAuth.getToken() || "";
      }
    } catch (e) {}
    return "";
  }

  /** Authenticated fetch against the resolved auth backend. */
  async function api(method, path, body) {
    var base = "";
    try {
      if (window.NeutronAuth && window.NeutronAuth.resolveAuthBase) {
        base = await window.NeutronAuth.resolveAuthBase();
      }
    } catch (e) {}
    var headers = { "content-type": "application/json" };
    var t = token();
    if (t) headers["authorization"] = "Bearer " + t;
    var res = await fetch(base + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (e3) {}
    if (!res.ok) {
      var err = new Error((data && data.error) || ("HTTP " + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Verify the current session is an admin; otherwise go to login. */
  async function guardAdmin(view) {
    var t = token();
    if (!t) { location.hash = "#/admin/login"; return null; }
    try {
      var me = window.NeutronAuth && window.NeutronAuth.me
        ? await window.NeutronAuth.me() : null;
      if (me && me.role === "admin") return me;
      // Fall back to a cheap admin-only probe.
      await api("GET", "/api/admin/stats");
      return me || { role: "admin" };
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) {
        location.hash = "#/admin/login";
        return null;
      }
      throw e;
    }
  }

  function adminShell(view, active, me, title) {
    view.appendChild(el("h1", null, "NEUTRON Admin"));
    var bar = el("div", "admin-topbar");
    var who = el("div", "admin-who");
    who.appendChild(el("span", "admin-name", (me && (me.displayName || me.username)) || "Admin"));
    var st = el("span", "pill ok", "ADMIN");
    st.style.marginLeft = "8px";
    who.appendChild(st);
    bar.appendChild(who);
    var out = el("button", "btn ghost sm", "Logout");
    out.type = "button";
    out.onclick = function () {
      try {
        if (window.NeutronAuth && window.NeutronAuth.logout) window.NeutronAuth.logout();
      } catch (e) {}
      try { localStorage.removeItem("neutron_auth_token"); } catch (e2) {}
      location.hash = "#/admin/login";
    };
    bar.appendChild(out);
    view.appendChild(bar);

    var nav = el("nav", "admin-nav");
    var links = [
      ["#/admin", "Dashboard", "dashboard"],
      ["#/admin/notifications", "Notifications", "send"],
      ["#/admin/notifications/history", "History", "history"],
    ];
    links.forEach(function (l) {
      var a = el("a", "btn ghost sm" + (active === l[2] ? " active" : ""), l[1]);
      a.href = l[0];
      nav.appendChild(a);
    });
    view.appendChild(nav);
    if (title) view.appendChild(el("h2", null, title));
  }

  /* ---------------- login ---------------- */

  function renderAdminLogin(view) {
    view.appendChild(el("h1", null, "NEUTRON Admin"));
    var p = el("section", "panel admin-login");
    p.appendChild(el("h2", null, "Admin sign in"));
    p.appendChild(el("p", "muted small",
      "Sign in with an administrator account. Admin access is granted to emails listed in NEUTRON_ADMIN_EMAILS."));
    var emailI = el("input", "input");
    emailI.type = "email"; emailI.placeholder = "Admin email";
    emailI.setAttribute("aria-label", "Admin email");
    var passI = el("input", "input");
    passI.type = "password"; passI.placeholder = "Password";
    passI.setAttribute("aria-label", "Password");
    var go = el("button", "btn primary", "Log in");
    var err = el("p", "auth-err hidden");
    p.appendChild(emailI); p.appendChild(passI); p.appendChild(go); p.appendChild(err);
    function fail(m) { err.textContent = m; err.classList.remove("hidden"); }
    async function doLogin() {
      err.classList.add("hidden");
      go.disabled = true;
      try {
        await api("POST", "/api/auth/login", {
          login: emailI.value.trim(), password: passI.value,
        }).then(async function (d) {
          // Persist the token the same way the main auth flow does.
          try {
            if (window.NeutronAuth && window.NeutronAuth.setToken) {
              window.NeutronAuth.setToken(d.token);
            } else {
              localStorage.setItem("neutron_auth_token", d.token);
            }
          } catch (e) {}
          if (!d.user || d.user.role !== "admin") {
            fail("This account is not an administrator.");
            go.disabled = false;
            return;
          }
          location.hash = "#/admin";
        });
      } catch (e) {
        fail(e && e.status === 401 ? "Invalid email or password."
          : e && e.status === 403 ? "Please verify your email first."
          : "Login failed: " + (e && e.message ? e.message : "network error"));
        go.disabled = false;
      }
    }
    go.onclick = doLogin;
    passI.addEventListener("keydown", function (ev) { if (ev.key === "Enter") doLogin(); });
    view.appendChild(p);
  }

  /* ---------------- dashboard ---------------- */

  async function renderAdmin(view) {
    var me;
    try { me = await guardAdmin(view); } catch (e) {
      view.appendChild(el("p", "auth-err", "Couldn't load the dashboard: " + (e.message || e)));
      return;
    }
    if (!me) return;
    adminShell(view, "dashboard", me, "Dashboard");
    var grid = el("div", "admin-cards");
    grid.appendChild(el("p", "muted", "Loading…"));
    view.appendChild(grid);
    try {
      var d = await api("GET", "/api/admin/stats");
      var s = d.stats || {};
      grid.innerHTML = "";
      var cards = [
        ["Total users", s.totalUsers || 0],
        ["Active users", s.activeUsers || 0],
        ["Notifications sent", s.notificationsSent || 0],
        ["Sent today", s.sentToday || 0],
      ];
      cards.forEach(function (c) {
        var card = el("div", "panel admin-card");
        card.appendChild(el("div", "admin-card-num", String(c[1])));
        card.appendChild(el("div", "muted small", c[0]));
        grid.appendChild(card);
      });
    } catch (e) {
      grid.innerHTML = "";
      grid.appendChild(el("p", "auth-err", "Couldn't load stats: " + (e.message || e)));
    }
  }

  /* ---------------- send notification ---------------- */

  var NOTIF_TYPES = [
    ["information", "Information"],
    ["success", "Success"],
    ["warning", "Warning"],
    ["important", "Important"],
    ["system_update", "System Update"],
  ];
  var AUDIENCES = [
    ["all", "All users"],
    ["active", "Active users"],
    ["specific", "Specific users"],
  ];

  async function renderAdminSend(view) {
    var me;
    try { me = await guardAdmin(view); } catch (e) {
      view.appendChild(el("p", "auth-err", "Couldn't load: " + (e.message || e)));
      return;
    }
    if (!me) return;
    adminShell(view, "send", me, "Send notification");

    var p = el("section", "panel");
    var titleI = el("input", "input");
    titleI.placeholder = "Notification title — e.g. NEUTRON Update Available";
    titleI.setAttribute("aria-label", "Notification title");
    titleI.maxLength = 120;
    var msgI = el("textarea", "input");
    msgI.placeholder = "Message — e.g. A new version of NEUTRON is now available.";
    msgI.setAttribute("aria-label", "Notification message");
    msgI.rows = 4;
    msgI.maxLength = 1000;

    var trow = el("div", "row");
    trow.appendChild(el("span", "small", "Type:"));
    var typeS = el("select", "input");
    NOTIF_TYPES.forEach(function (t) {
      var o = el("option", null, t[1]);
      o.value = t[0];
      typeS.appendChild(o);
    });
    trow.appendChild(typeS);

    var arow = el("div", "row");
    arow.appendChild(el("span", "small", "Audience:"));
    var audS = el("select", "input");
    AUDIENCES.forEach(function (a) {
      var o = el("option", null, a[1]);
      o.value = a[0];
      audS.appendChild(o);
    });
    arow.appendChild(audS);

    // Specific-user picker (hidden unless audience === "specific").
    var pickWrap = el("div", "admin-pick hidden");
    var searchI = el("input", "input");
    searchI.placeholder = "Search users…";
    searchI.setAttribute("aria-label", "Search users");
    var userList = el("div", "admin-userlist");
    var selected = {}; // userId -> label
    var selInfo = el("p", "muted small", "No users selected.");
    pickWrap.appendChild(searchI);
    pickWrap.appendChild(userList);
    pickWrap.appendChild(selInfo);

    var selectedIds = function () { return Object.keys(selected); };

    async function searchUsers() {
      var q = searchI.value.trim();
      userList.innerHTML = "";
      userList.appendChild(el("p", "muted small", "Searching…"));
      try {
        var d = await api("GET", "/api/admin/users?search=" + encodeURIComponent(q));
        userList.innerHTML = "";
        (d.users || []).forEach(function (u) {
          var row = el("label", "admin-userrow");
          var cb = el("input", null);
          cb.type = "checkbox";
          cb.checked = !!selected[u.id];
          cb.onchange = function () {
            if (cb.checked) selected[u.id] = u.displayName || u.username;
            else delete selected[u.id];
            var n = selectedIds().length;
            selInfo.textContent = n ? n + " user" + (n === 1 ? "" : "s") + " selected." : "No users selected.";
          };
          row.appendChild(cb);
          row.appendChild(el("span", null,
            (u.displayName || u.username) + " (@" + u.username + ")" + (u.email ? " · " + u.email : "")));
          userList.appendChild(row);
        });
        if (!(d.users || []).length) {
          userList.appendChild(el("p", "muted small", "No users found."));
        }
      } catch (e) {
        userList.innerHTML = "";
        userList.appendChild(el("p", "auth-err small", "Search failed: " + (e.message || e)));
      }
    }
    var searchTimer = null;
    searchI.addEventListener("input", function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(searchUsers, 350);
    });
    audS.onchange = function () {
      var specific = audS.value === "specific";
      pickWrap.classList.toggle("hidden", !specific);
      if (specific) searchUsers();
    };

    var err = el("p", "auth-err hidden");
    var send = el("button", "btn primary", "Send Notification");
    send.type = "button";

    send.onclick = function () {
      err.classList.add("hidden");
      var title = titleI.value.trim();
      var message = msgI.value.trim();
      if (!title) { err.textContent = "Title is required."; err.classList.remove("hidden"); return; }
      if (!message) { err.textContent = "Message is required."; err.classList.remove("hidden"); return; }
      var audience = audS.value;
      var ids = selectedIds();
      if (audience === "specific" && !ids.length) {
        err.textContent = "Select at least one user for a specific audience.";
        err.classList.remove("hidden");
        return;
      }
      var audLabel = audS.options[audS.selectedIndex].text;
      if (!window.confirm("Are you sure you want to send this notification to " +
          (audience === "specific" ? ids.length + " selected user(s)" : audLabel.toLowerCase()) + "?")) {
        return;
      }
      send.disabled = true;
      api("POST", "/api/admin/notifications", {
        title: title, message: message, type: typeS.value,
        audience: audience, userIds: audience === "specific" ? ids : undefined,
      }).then(function (d) {
        toast("✓ " + (d.message || "Notification sent."));
        titleI.value = ""; msgI.value = "";
        selected = {};
        selInfo.textContent = "No users selected.";
        send.disabled = false;
      }).catch(function (e) {
        err.textContent = e && e.message ? e.message : "Send failed.";
        err.classList.remove("hidden");
        send.disabled = false;
      });
    };

    p.appendChild(el("label", "small", "Title"));
    p.appendChild(titleI);
    p.appendChild(el("label", "small", "Message"));
    p.appendChild(msgI);
    p.appendChild(trow);
    p.appendChild(arow);
    p.appendChild(pickWrap);
    p.appendChild(err);
    p.appendChild(send);
    view.appendChild(p);
  }

  /* ---------------- history ---------------- */

  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return ""; }
  }
  function typeLabel(t) {
    var m = { information: "Information", success: "Success", warning: "Warning",
              important: "Important", system_update: "System Update" };
    return m[t] || t;
  }
  function audLabel(a) {
    return a === "all" ? "All Users" : a === "active" ? "Active Users" : "Specific Users";
  }

  async function renderAdminHistory(view) {
    var me;
    try { me = await guardAdmin(view); } catch (e) {
      view.appendChild(el("p", "auth-err", "Couldn't load: " + (e.message || e)));
      return;
    }
    if (!me) return;
    adminShell(view, "history", me, "Notification history");

    var filters = el("div", "row admin-filters");
    var searchI = el("input", "input");
    searchI.placeholder = "Search title/message…";
    searchI.setAttribute("aria-label", "Search notifications");
    var typeS = el("select", "input");
    var allO = el("option", null, "All types"); allO.value = "";
    typeS.appendChild(allO);
    NOTIF_TYPES.forEach(function (t) {
      var o = el("option", null, t[1]); o.value = t[0]; typeS.appendChild(o);
    });
    filters.appendChild(searchI);
    filters.appendChild(typeS);
    view.appendChild(filters);

    var tableWrap = el("div", "panel");
    var pager = el("div", "row admin-pager");
    view.appendChild(tableWrap);
    view.appendChild(pager);

    var page = 1, limit = 20;

    async function load() {
      tableWrap.innerHTML = "";
      tableWrap.appendChild(el("p", "muted", "Loading…"));
      pager.innerHTML = "";
      var qs = "?page=" + page + "&limit=" + limit;
      if (typeS.value) qs += "&type=" + encodeURIComponent(typeS.value);
      if (searchI.value.trim()) qs += "&search=" + encodeURIComponent(searchI.value.trim());
      try {
        var d = await api("GET", "/api/admin/notifications" + qs);
        tableWrap.innerHTML = "";
        var items = d.items || [];
        if (!items.length) {
          tableWrap.appendChild(el("p", "muted", "No notifications yet."));
          return;
        }
        var table = el("table", "admin-table");
        var head = el("tr", null);
        ["Title", "Type", "Audience", "Recipients", "Date", "Status"].forEach(function (h) {
          head.appendChild(el("th", null, h));
        });
        table.appendChild(head);
        items.forEach(function (n) {
          var tr = el("tr", "admin-row");
          tr.appendChild(el("td", null, n.title));
          tr.appendChild(el("td", null, typeLabel(n.type)));
          tr.appendChild(el("td", null, audLabel(n.audience)));
          tr.appendChild(el("td", null, String(n.recipientCount || 0)));
          tr.appendChild(el("td", null, fmtDate(n.createdAt)));
          tr.appendChild(el("td", null, "Sent"));
          tr.style.cursor = "pointer";
          tr.title = "View details";
          tr.onclick = (function (id) {
            return function () { showDetails(id); };
          })(n.id);
          table.appendChild(tr);
        });
        tableWrap.appendChild(table);

        // Pagination.
        var total = d.total || 0;
        var pages = Math.max(1, Math.ceil(total / limit));
        var info = el("span", "muted small",
          "Page " + page + " of " + pages + " · " + total + " total");
        pager.appendChild(info);
        if (page > 1) {
          var prev = el("button", "btn ghost sm", "← Prev");
          prev.type = "button";
          prev.onclick = function () { page--; load(); };
          pager.appendChild(prev);
        }
        if (page < pages) {
          var next = el("button", "btn ghost sm", "Next →");
          next.type = "button";
          next.onclick = function () { page++; load(); };
          pager.appendChild(next);
        }
      } catch (e) {
        tableWrap.innerHTML = "";
        tableWrap.appendChild(el("p", "auth-err", "Couldn't load history: " + (e.message || e)));
      }
    }

    async function showDetails(id) {
      try {
        var d = await api("GET", "/api/admin/notifications/" + encodeURIComponent(id));
        var n = d.notification;
        var overlay = el("div", "modal-overlay");
        var box = el("div", "panel modal-box");
        box.appendChild(el("h2", null, "Notification Details"));
        var rows = [
          ["Title", n.title],
          ["Message", n.message],
          ["Type", typeLabel(n.type)],
          ["Audience", audLabel(n.audience)],
          ["Recipients", String(n.recipientCount || 0)],
          ["Created", fmtDate(n.createdAt)],
          ["Created By", n.createdByEmail || n.createdBy],
          ["Status", "Sent"],
        ];
        rows.forEach(function (r) {
          var row = el("div", "admin-detail-row");
          row.appendChild(el("div", "muted small", r[0]));
          row.appendChild(el("div", null, r[1]));
          box.appendChild(row);
        });
        var close = el("button", "btn", "Close");
        close.type = "button";
        close.onclick = function () { overlay.remove(); };
        box.appendChild(close);
        overlay.appendChild(box);
        overlay.addEventListener("click", function (ev) {
          if (ev.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
      } catch (e) {
        toast("Couldn't load details: " + (e.message || e));
      }
    }

    var deb = null;
    function refetch() {
      page = 1;
      if (deb) clearTimeout(deb);
      deb = setTimeout(load, 350);
    }
    searchI.addEventListener("input", refetch);
    typeS.onchange = refetch;
    load();
  }

  /* ---------------- exports + routes ---------------- */

  root.NeutronAdmin = {
    renderAdminLogin: renderAdminLogin,
    renderAdmin: renderAdmin,
    renderAdminSend: renderAdminSend,
    renderAdminHistory: renderAdminHistory,
  };
})(typeof window !== "undefined" ? window : this);
