/* ==========================================================================
   NEUTRON Friends — your real connections, unified.

   When logged in, shows your accepted account connections (real users)
   with Call / Invite / Remove. When logged out, falls back to the local
   contact list. "Call" creates a voice-ready room; "Invite" shares the
   room link through the Android share sheet (or clipboard).
   ========================================================================== */
(function () {
  "use strict";

  var FRIENDS_KEY = "neutron_friends";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function toast(msg) {
    if (window.NeutronUI && window.NeutronUI.toast) window.NeutronUI.toast(msg);
  }

  /* ---------- local fallback list (logged out) ---------- */

  function loadLocalFriends() {
    try {
      var raw = localStorage.getItem(FRIENDS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveLocalFriends(arr) {
    try { localStorage.setItem(FRIENDS_KEY, JSON.stringify(arr.slice(0, 200))); }
    catch (e) { /* best effort */ }
    // Mirror to native storage so it survives reinstalls.
    try {
      var b = window.NeutronApp;
      if (b && typeof b.nativeSave === "function") {
        b.nativeSave(FRIENDS_KEY, JSON.stringify(arr.slice(0, 200)));
      }
    } catch (e2) {}
  }

  /* ---------- rooms: call + invite ---------- */

  /** Create a room for calling someone and open it. */
  function callPerson(displayName) {
    var R = window.NeutronRooms;
    if (!R || typeof R.createRelayRoom !== "function") {
      toast("Rooms unavailable.");
      return;
    }
    var code = R.createRelayRoom("Call with " + displayName);
    if (!code) { toast("Couldn't create a room."); return; }
    R.openRelayRoom(code);
    if (location.hash !== "#/rooms") location.hash = "#/rooms";
    toast("Room created. Tap the phone icon for voice, then Invite " + displayName + ".");
    setTimeout(function () { invitePerson(displayName, code); }, 600);
  }

  /** Share a room invite (creates a room if none given). */
  function invitePerson(displayName, code) {
    var R = window.NeutronRooms;
    if (!R || typeof R.inviteLink !== "function") { toast("Rooms unavailable."); return; }
    if (!code) {
      code = R.createRelayRoom ? R.createRelayRoom("Room with " + displayName) : null;
      if (!code) { toast("Couldn't create a room."); return; }
    }
    var link = R.inviteLink(code);
    var text = "Join me on NEUTRON (" + displayName + "): " + link + " — code " + code;
    var shared = false;
    try {
      var bridge = window.NeutronApp;
      if (bridge && typeof bridge.shareText === "function") {
        bridge.shareText("Invite to NEUTRON", text);
        toast("Opening share…");
        shared = true;
      }
    } catch (e) {}
    if (!shared) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(function () {
            toast("Invite link copied — send it to " + displayName + ".");
          }).catch(function () { toast(text); });
        } else toast(text);
      } catch (e2) { toast(text); }
    }
  }

  /* ---------- render ---------- */

  function personRow(displayName, sub, onCall, onRemove, removeLabel) {
    var row = el("div", "panel friend-row");
    var info = el("div", "friend-info");
    info.appendChild(el("div", "friend-name", displayName));
    if (sub) info.appendChild(el("div", "muted small", sub));
    row.appendChild(info);
    var actions = el("div", "friend-actions");
    var callBtn = el("button", "btn primary sm", "☎ Call");
    callBtn.setAttribute("aria-label", "Call " + displayName);
    callBtn.onclick = onCall;
    actions.appendChild(callBtn);
    var inviteBtn = el("button", "btn sm", "Invite");
    inviteBtn.setAttribute("aria-label", "Invite " + displayName);
    inviteBtn.onclick = function () { invitePerson(displayName); };
    actions.appendChild(inviteBtn);
    if (onRemove) {
      var delBtn = el("button", "btn ghost sm", removeLabel || "Remove");
      delBtn.setAttribute("aria-label", (removeLabel || "Remove") + " " + displayName);
      delBtn.onclick = onRemove;
      actions.appendChild(delBtn);
    }
    row.appendChild(actions);
    return row;
  }

  function renderFriends(view) {
    try {
      if (window.NeutronRooms && window.NeutronRooms.teardown) window.NeutronRooms.teardown();
    } catch (e) {}
    view.innerHTML = "";

    view.appendChild(el("h1", null, "Friends"));
    view.appendChild(el("p", "muted",
      "People you're connected with. Call to open a voice room, or send an invite link."));

    var auth = window.NeutronAuth;
    var loggedIn = auth && typeof auth.getToken === "function" && auth.getToken();

    if (loggedIn && auth.apiAuth) {
      renderConnectedFriends(view, auth);
    } else {
      renderLocalFriends(view);
    }
  }

  /** Logged in: show real account connections. */
  function renderConnectedFriends(view, auth) {
    var list = el("div", "friend-list");
    list.appendChild(el("p", "muted small", "Loading your connections…"));
    view.appendChild(list);

    auth.apiAuth("GET", "/api/connections").then(function (d) {
      list.innerHTML = "";
      var conns = (d.connections || []).filter(function (c) { return c.status === "accepted"; });
      if (!conns.length) {
        var empty = el("div", "panel");
        empty.appendChild(el("p", "muted",
          "No connections yet. Go to Account → Find people, search for a username, " +
          "and send a friend request."));
        var goBtn = el("button", "btn primary sm", "Go to Account");
        goBtn.onclick = function () { location.hash = "#/account"; };
        empty.appendChild(goBtn);
        list.appendChild(empty);
        return;
      }
      conns.forEach(function (c) {
        var u = c.user || {};
        var name = u.displayName || u.username || "Unknown";
        var sub = "@" + (u.username || "?");
        list.appendChild(personRow(name, sub,
          function () { callPerson(name); },
          function () {
            if (!window.confirm || confirm("Remove @" + u.username + " from friends?")) {
              auth.apiAuth("POST", "/api/connections/remove", { connectionId: c.id })
                .then(function () { toast("Removed."); renderFriends(view); })
                .catch(function (e) { toast(String((e && e.message) || e)); });
            }
          }));
      });
    }).catch(function () {
      list.innerHTML = "";
      list.appendChild(el("p", "auth-err", "Couldn't load connections."));
    });
  }

  /** Logged out: local contact list fallback. */
  function renderLocalFriends(view) {
    view.appendChild(el("p", "muted small",
      "Log in (Account) to see your real connections here. Below is your on-device list."));

    var addRow = el("div", "panel friend-add");
    var nameInput = el("input", "input");
    nameInput.placeholder = "Friend's name";
    nameInput.setAttribute("aria-label", "Friend's name");
    nameInput.maxLength = 40;
    addRow.appendChild(nameInput);
    var addBtn = el("button", "btn primary", "Add friend");
    addRow.appendChild(addBtn);
    var doAdd = function () {
      var n = nameInput.value.trim();
      if (!n) { toast("Enter a name first."); return; }
      var arr = loadLocalFriends();
      arr.unshift({ id: "f" + Date.now().toString(36), name: n, addedAt: Date.now() });
      saveLocalFriends(arr);
      renderFriends(view);
      toast("Friend added.");
    };
    addBtn.onclick = doAdd;
    nameInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); doAdd(); }
    });
    view.appendChild(addRow);

    var list = loadLocalFriends();
    if (!list.length) {
      var empty = el("div", "panel");
      empty.appendChild(el("p", "muted", "No local friends yet."));
      view.appendChild(empty);
      return;
    }
    var ul = el("div", "friend-list");
    list.forEach(function (f) {
      ul.appendChild(personRow(f.name,
        "Added " + new Date(f.addedAt).toLocaleDateString(),
        function () { callPerson(f.name); },
        function () {
          if (!window.confirm || confirm("Remove " + f.name + "?")) {
            saveLocalFriends(loadLocalFriends().filter(function (x) { return x.id !== f.id; }));
            renderFriends(view);
          }
        }));
    });
    view.appendChild(ul);
  }

  function teardown() { /* stateless */ }

  window.NeutronFriends = {
    renderFriends: renderFriends,
    teardown: teardown,
    listFriends: loadLocalFriends,
  };
})();
