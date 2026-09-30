/* ==========================================================================
   NEUTRON Friends — add friends, invite them to rooms, call them to
   collaborate on the same project.

   Friends are a local contact list (no account system — rooms are joined
   by code). "Call" creates a voice-ready room and opens it; "Invite"
   shares the room's link through the Android share sheet (or clipboard).
   Voice itself runs in the room via the existing relay WebRTC stack.
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

  function loadFriends() {
    try {
      var raw = localStorage.getItem(FRIENDS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveFriends(arr) {
    try { localStorage.setItem(FRIENDS_KEY, JSON.stringify(arr.slice(0, 200))); }
    catch (e) { /* private mode / quota — best effort */ }
  }

  function addFriend(name) {
    var arr = loadFriends();
    arr.unshift({
      id: "f" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      name: name,
      addedAt: Date.now(),
    });
    saveFriends(arr);
  }

  function removeFriend(id) {
    saveFriends(loadFriends().filter(function (f) { return f.id !== id; }));
  }

  function shareInvite(text) {
    try {
      var bridge = window.NeutronApp;
      if (bridge && typeof bridge.shareText === "function") {
        bridge.shareText("Invite to NEUTRON", text);
        return true;
      }
    } catch (e) { /* fall through to clipboard */ }
    return false;
  }

  function copyText(text, msg) {
    function done() { if (window.NeutronUI && window.NeutronUI.toast) window.NeutronUI.toast(msg || "Copied."); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); });
        return;
      }
    } catch (e) { /* fall through */ }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      try { ta.select(); document.execCommand("copy"); } catch (e2) {}
      document.body.removeChild(ta);
      done();
    }
    fallback();
  }

  function toast(msg) {
    if (window.NeutronUI && window.NeutronUI.toast) window.NeutronUI.toast(msg);
  }

  /** Create a room for calling a friend and open it. */
  function callFriend(friend) {
    var R = window.NeutronRooms;
    if (!R || typeof R.createRelayRoom !== "function") {
      toast("Rooms unavailable.");
      return;
    }
    var code = R.createRelayRoom("Call with " + friend.name);
    if (!code) { toast("Couldn't create a room."); return; }
    // Remember who this call is for (shown in the room UI via the name).
    try {
      var known = R.listKnownRooms ? R.listKnownRooms() : [];
      for (var i = 0; i < known.length; i++) {
        if (known[i].code === code) { known[i].callWith = friend.name; break; }
      }
      localStorage.setItem("neutron_rooms_v1", JSON.stringify(known.slice(0, 50)));
    } catch (e) { /* best effort */ }
    R.openRelayRoom(code);
    // Switch to the rooms route so the workspace renders.
    if (location.hash !== "#/rooms") location.hash = "#/rooms";
    else if (R.renderRooms) { /* already there — room opened above */ }
    toast("Room created. Tap the phone icon for voice, then Invite " + friend.name + ".");
    // Offer the invite link immediately.
    setTimeout(function () { inviteFriend(friend, code); }, 600);
  }

  /** Share a room invite for a friend (creates a room if none given). */
  function inviteFriend(friend, code) {
    var R = window.NeutronRooms;
    if (!R || typeof R.inviteLink !== "function") { toast("Rooms unavailable."); return; }
    if (!code) {
      code = R.createRelayRoom ? R.createRelayRoom("Room with " + friend.name) : null;
      if (!code) { toast("Couldn't create a room."); return; }
    }
    var link = R.inviteLink(code);
    var text = "Join me on NEUTRON (" + friend.name + "): " + link + " — code " + code;
    if (!shareInvite(text)) {
      copyText(link, "Invite link copied — send it to " + friend.name + ".");
    }
  }

  function renderFriends(view) {
    // Teardown rooms rendering if we came from there.
    try {
      if (window.NeutronRooms && window.NeutronRooms.teardown) window.NeutronRooms.teardown();
    } catch (e) {}
    // Teardown friends from other modules is not needed (stateless render).

    view.appendChild(el("h1", null, "Friends"));
    view.appendChild(el("p", "muted",
      "Your collaborators. Call a friend to open a voice room you can both join, " +
      "or send them an invite link to work on the same project."));

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
      addFriend(n);
      nameInput.value = "";
      renderFriends(view);
      toast("Friend added.");
    };
    addBtn.onclick = doAdd;
    nameInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); doAdd(); }
    });
    view.appendChild(addRow);

    var list = loadFriends();
    if (!list.length) {
      var empty = el("div", "panel");
      empty.appendChild(el("p", "muted",
        "No friends yet. Add someone above, then call or invite them to collaborate."));
      view.appendChild(empty);
      return;
    }
    var ul = el("div", "friend-list");
    list.forEach(function (f) {
      var row = el("div", "panel friend-row");
      var info = el("div", "friend-info");
      info.appendChild(el("div", "friend-name", f.name));
      var meta = el("div", "muted small", "Added " + new Date(f.addedAt).toLocaleDateString());
      info.appendChild(meta);
      row.appendChild(info);
      var actions = el("div", "friend-actions");
      var callBtn = el("button", "btn primary sm", "\u260E Call");
      callBtn.setAttribute("aria-label", "Call " + f.name);
      callBtn.onclick = function () { callFriend(f); };
      actions.appendChild(callBtn);
      var inviteBtn = el("button", "btn sm", "Invite");
      inviteBtn.setAttribute("aria-label", "Invite " + f.name);
      inviteBtn.onclick = function () { inviteFriend(f); };
      actions.appendChild(inviteBtn);
      var delBtn = el("button", "btn ghost sm", "Remove");
      delBtn.setAttribute("aria-label", "Remove " + f.name);
      delBtn.onclick = function () {
        if (window.confirm ? confirm("Remove " + f.name + " from friends?") : true) {
          removeFriend(f.id);
          renderFriends(view);
        }
      };
      actions.appendChild(delBtn);
      row.appendChild(actions);
      ul.appendChild(row);
    });
    view.appendChild(ul);
  }

  function teardown() { /* stateless — nothing to clean up */ }

  window.NeutronFriends = {
    renderFriends: renderFriends,
    teardown: teardown,
    listFriends: loadFriends,
  };
})();
