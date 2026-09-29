/* ==========================================================================
   NEUTRON Rooms — real-time collaboration, Phase 1 (rooms + presence + chat
   + WebRTC signaling relay). Classic script; uses globals from app.js
   (el, api, showError, clearError, toast, announce, backendBase) and the
   pure helpers on window.NeutronUI. Loaded after ui-utils.js, before app.js
   only needs window.NeutronRooms at render time.
   ========================================================================== */
(function () {
  "use strict";

  var UI = window.NeutronUI || {};
  var ROOMS_KEY = "neutron_rooms_v1";
  var NAME_KEY_PREFIX = "neutron_room_name_";
  var MAX_RECONNECT = 8;

  /* Module state. Reset by teardown() when leaving the rooms route. */
  var S = freshState();

  function freshState() {
    return {
      screen: "list", // "list" | "workspace"
      code: null,
      roomName: "",
      ownerToken: null,
      ws: null,
      joined: false,
      conn: "idle", // idle|connecting|connected|reconnecting|failed
      memberId: null,
      displayName: "",
      role: "member",
      members: [],
      chat: [],
      typing: {}, // memberId -> displayName
      reconnectAttempt: 0,
      reconnectTimer: null,
      heartbeatTimer: null,
      typingTimer: null,
      typingSent: false,
      presenceStatus: "online",
    };
  }

  /* ---------- tiny storage helpers ---------- */

  function loadKnownRooms() {
    try {
      var raw = localStorage.getItem(ROOMS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveKnownRooms(arr) {
    try {
      localStorage.setItem(ROOMS_KEY, JSON.stringify(arr.slice(0, 50)));
    } catch (e) { /* private mode / quota — best effort */ }
  }

  function upsertKnownRoom(ref) {
    var arr = loadKnownRooms().filter(function (r) { return r.code !== ref.code; });
    arr.unshift(ref);
    saveKnownRooms(arr);
  }

  function knownRoom(code) {
    var arr = loadKnownRooms();
    for (var i = 0; i < arr.length; i++) if (arr[i].code === code) return arr[i];
    return null;
  }

  function forgetKnownRoom(code) {
    saveKnownRooms(loadKnownRooms().filter(function (r) { return r.code !== code; }));
  }

  function storedDisplayName(code) {
    try { return localStorage.getItem(NAME_KEY_PREFIX + code) || ""; } catch (e) { return ""; }
  }

  function setStoredDisplayName(code, name) {
    try { localStorage.setItem(NAME_KEY_PREFIX + code, name); } catch (e) { /* ignore */ }
  }

  /* ---------- connection ---------- */

  function collabWsUrl() {
    var base = (typeof backendBase === "function" ? backendBase() : "").replace(/\/+$/, "");
    if (!base) {
      var proto = location.protocol === "https:" ? "wss://" : "ws://";
      return proto + location.host + "/collab";
    }
    return base.replace(/^http/, "ws") + "/collab";
  }

  function inviteLink(code) {
    return location.origin + "/app#room=" + code;
  }

  function teardown() {
    stopTimers();
    closeSocket();
    S = freshState();
  }

  function stopTimers() {
    if (S.reconnectTimer) { clearTimeout(S.reconnectTimer); S.reconnectTimer = null; }
    if (S.heartbeatTimer) { clearInterval(S.heartbeatTimer); S.heartbeatTimer = null; }
    if (S.typingTimer) { clearTimeout(S.typingTimer); S.typingTimer = null; }
  }

  function closeSocket() {
    stopTimers();
    var ws = S.ws;
    S.ws = null;
    S.joined = false;
    if (ws) {
      try { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.onopen = null; } catch (e) {}
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ROOM_LEAVE" })); } catch (e) {}
      try { ws.close(); } catch (e) {}
    }
  }

  function sendMsg(obj) {
    if (S.ws && S.ws.readyState === 1) {
      try { S.ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    return false;
  }

  function setConn(status) {
    S.conn = status;
    var dot = document.getElementById("rm-conn-dot");
    var label = document.getElementById("rm-conn-label");
    if (dot) dot.className = "rm-dot " + (status === "connected" ? "on" : status === "failed" ? "off" : "busy");
    if (label) {
      label.textContent = status === "connected" ? "Connected"
        : status === "connecting" ? "Connecting…"
        : status === "reconnecting" ? "Reconnecting…"
        : status === "failed" ? "Disconnected" : "Idle";
    }
    var retry = document.getElementById("rm-retry");
    if (retry) retry.classList.toggle("hidden", status !== "failed");
  }

  function connect() {
    closeSocket();
    setConn("connecting");
    var ws;
    try {
      ws = new WebSocket(collabWsUrl());
    } catch (e) {
      onSocketClose();
      return;
    }
    S.ws = ws;
    ws.onopen = function () {
      var join = { type: "ROOM_JOIN", roomId: S.code, displayName: S.displayName };
      if (S.ownerToken) join.ownerToken = S.ownerToken;
      try { ws.send(JSON.stringify(join)); } catch (e) { /* close follows */ }
    };
    ws.onmessage = function (ev) { onServerMessage(ev.data); };
    ws.onclose = function () { onSocketClose(); };
    ws.onerror = function () { /* onclose follows */ };
  }

  function onSocketClose() {
    var was = S.ws;
    S.ws = null;
    S.joined = false;
    if (S.screen !== "workspace" || !S.code) return;
    if (was && S.reconnectAttempt >= MAX_RECONNECT) {
      setConn("failed");
      showError("Lost connection to the room. Check the server and retry.");
      return;
    }
    setConn("reconnecting");
    var delay = UI.collabBackoffMs ? UI.collabBackoffMs(S.reconnectAttempt) : 1000;
    S.reconnectAttempt++;
    S.reconnectTimer = setTimeout(function () {
      S.reconnectTimer = null;
      if (S.screen === "workspace" && S.code) connect();
    }, delay);
  }

  function onServerMessage(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "JOINED":
        S.joined = true;
        S.reconnectAttempt = 0;
        S.memberId = msg.you && msg.you.id;
        S.role = (msg.you && msg.you.role) || "member";
        if (msg.room && msg.room.name) {
          S.roomName = msg.room.name;
          var kr = knownRoom(S.code);
          if (kr && kr.name !== msg.room.name) { kr.name = msg.room.name; upsertKnownRoom(kr); }
          var title = document.getElementById("rm-room-title");
          if (title) title.textContent = msg.room.name;
        }
        S.members = Array.isArray(msg.members) ? msg.members : [];
        S.chat = Array.isArray(msg.chat) ? msg.chat.slice(-200) : [];
        setConn("connected");
        startHeartbeat();
        paintMembers();
        paintChat(true);
        if (typeof announce === "function") announce("Joined room " + S.roomName + ". " + S.members.length + " members online.");
        break;
      case "LEFT":
        break;
      case "MEMBERS":
        S.members = Array.isArray(msg.members) ? msg.members : [];
        paintMembers();
        break;
      case "CHAT_MESSAGE":
        if (msg.msg) {
          S.chat.push(msg.msg);
          if (S.chat.length > 200) S.chat.splice(0, S.chat.length - 200);
          appendChatMsg(msg.msg, true);
        }
        break;
      case "CHAT_TYPING":
        if (msg.memberId && msg.memberId !== S.memberId) {
          if (msg.typing) S.typing[msg.memberId] = msg.displayName || "Someone";
          else delete S.typing[msg.memberId];
          paintTyping();
        }
        break;
      case "ERROR":
        handleServerError(msg);
        break;
      /* WEBRTC_* relays arrive here in Phase 3; ignore until then. */
      default:
        break;
    }
  }

  function handleServerError(msg) {
    var code = msg.code || "";
    if (code === "ROOM_NOT_FOUND") {
      showError("Room not found. It may have been deleted on the server.");
      leaveToList();
    } else if (code === "ROOM_FULL") {
      showError("This room has reached its member limit.");
      setConn("failed");
    } else {
      showError(msg.message || "The room server reported an error.");
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    var beat = function () {
      if (!S.joined) return;
      sendMsg({ type: "PRESENCE_UPDATE", status: S.presenceStatus, activity: "In room chat" });
    };
    beat();
    S.heartbeatTimer = setInterval(beat, 15000);
  }

  function stopHeartbeat() {
    if (S.heartbeatTimer) { clearInterval(S.heartbeatTimer); S.heartbeatTimer = null; }
  }

  /* ---------- paint ---------- */

  function paintMembers() {
    var list = document.getElementById("rm-members");
    var count = document.getElementById("rm-count");
    if (count) count.textContent = String(S.members.length);
    if (!list) return;
    list.innerHTML = "";
    if (!S.members.length) {
      list.appendChild(el("div", "rm-empty", "No one else is here yet."));
      return;
    }
    S.members.forEach(function (m) {
      var row = el("div", "rm-member");
      var dot = el("span", "rm-dot " + (m.status === "online" ? "on" : m.status === "away" ? "busy" : "idle"));
      dot.setAttribute("aria-hidden", "true");
      row.appendChild(dot);
      var who = el("div", "rm-member-who");
      var nm = el("span", "rm-member-name", m.displayName || "Someone");
      who.appendChild(nm);
      if (m.id === S.memberId) who.appendChild(el("span", "rm-you", "you"));
      else if (m.role === "owner") who.appendChild(el("span", "rm-role", "owner"));
      var sub = m.activity ? m.activity : (m.status === "online" ? "Online" : m.status);
      who.appendChild(el("div", "rm-member-sub", sub));
      row.appendChild(who);
      list.appendChild(row);
    });
  }

  function chatMsgEl(m) {
    var wrap = el("div", "rm-msg" + (m.memberId === S.memberId ? " mine" : ""));
    var head = el("div", "rm-msg-head");
    head.appendChild(el("span", "rm-msg-name", m.displayName || "Someone"));
    var ts = m.ts && UI.fmtTime ? UI.fmtTime(m.ts) : "";
    if (ts) head.appendChild(el("span", "rm-msg-time", ts));
    wrap.appendChild(head);
    wrap.appendChild(el("div", "rm-msg-text", m.text || ""));
    return wrap;
  }

  function paintChat(scroll) {
    var log = document.getElementById("rm-chat-log");
    if (!log) return;
    log.innerHTML = "";
    if (!S.chat.length) {
      log.appendChild(el("div", "rm-empty", "No messages yet. Say hello!"));
      return;
    }
    S.chat.forEach(function (m) { log.appendChild(chatMsgEl(m)); });
    if (scroll) log.scrollTop = log.scrollHeight;
  }

  function appendChatMsg(m, scroll) {
    var log = document.getElementById("rm-chat-log");
    if (!log) return;
    var empty = log.querySelector(".rm-empty");
    if (empty) empty.remove();
    // Keep the DOM bounded for very long sessions.
    while (log.children.length >= 200) log.removeChild(log.firstChild);
    log.appendChild(chatMsgEl(m));
    if (scroll !== false) {
      var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
      if (nearBottom || m.memberId === S.memberId) log.scrollTop = log.scrollHeight;
    }
  }

  function paintTyping() {
    var t = document.getElementById("rm-typing");
    if (!t) return;
    var names = Object.keys(S.typing).map(function (k) { return S.typing[k]; });
    t.textContent = !names.length ? "" : names.length === 1 ? names[0] + " is typing…"
      : names.length === 2 ? names[0] + " and " + names[1] + " are typing…"
      : names[0] + " and " + (names.length - 1) + " others are typing…";
  }

  /* ---------- screens ---------- */

  function renderServerlessNote(view) {
    var p = el("div", "panel rm-note");
    p.appendChild(el("h2", null, "Rooms need the Node server"));
    p.appendChild(el("p", "muted",
      "Real-time collaboration rooms use WebSocket connections, which serverless hosting can't hold. " +
      "Run the Node server and open this page there:"));
    var cmd = el("code", "rm-cmd", "node dist/cli-entry.js web --no-open");
    p.appendChild(cmd);
    p.appendChild(el("p", "muted small",
      "Then open http://127.0.0.1:4096/app (or your configured host) and return to Rooms."));
    view.appendChild(p);
  }

  function renderList(view, pendingCode) {
    var grid = el("div", "rm-grid");
    /* create */
    var create = el("div", "panel");
    create.appendChild(el("h2", null, "Create a room"));
    create.appendChild(el("p", "muted small", "You'll get a code and an invite link to share."));
    var nameInput = el("input", "input");
    nameInput.placeholder = "Room name (e.g. Website Builder)";
    nameInput.setAttribute("aria-label", "Room name");
    nameInput.maxLength = 60;
    create.appendChild(nameInput);
    var createBtn = el("button", "btn primary", "Create room");
    create.appendChild(createBtn);
    var createdBox = el("div", "rm-created hidden");
    create.appendChild(createdBox);
    createBtn.onclick = function () { doCreate(nameInput.value.trim(), createdBox); };
    nameInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); doCreate(nameInput.value.trim(), createdBox); }
    });
    grid.appendChild(create);
    /* join */
    var join = el("div", "panel");
    join.appendChild(el("h2", null, "Join a room"));
    join.appendChild(el("p", "muted small", "Enter the code someone shared with you."));
    var codeInput = el("input", "input rm-code-input");
    codeInput.placeholder = "NEUTRON-XXXXXX";
    codeInput.setAttribute("aria-label", "Room code");
    codeInput.autocapitalize = "characters";
    codeInput.spellcheck = false;
    if (pendingCode) codeInput.value = pendingCode;
    join.appendChild(codeInput);
    var joinBtn = el("button", "btn primary", "Join room");
    join.appendChild(joinBtn);
    var doJoin = function () { doJoinCode(codeInput.value); };
    joinBtn.onclick = doJoin;
    codeInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); doJoin(); }
    });
    grid.appendChild(join);
    view.appendChild(grid);
    /* known rooms */
    var known = loadKnownRooms();
    var listPanel = el("div", "panel rm-known");
    listPanel.appendChild(el("h2", null, "Your rooms"));
    if (!known.length) {
      listPanel.appendChild(el("p", "muted", "No rooms yet. Create one or join with a code."));
    } else {
      var ul = el("div", "rm-room-list");
      known.forEach(function (r) {
        var item = el("div", "rm-room-item");
        var open = el("button", "rm-room-open");
        open.setAttribute("aria-label", "Open room " + r.name);
        open.appendChild(el("div", "rm-room-name", r.name || r.code));
        var sub = (r.code || "") + (r.lastSeen && UI.timeAgo ? " · " + UI.timeAgo(r.lastSeen, Date.now()) : "");
        open.appendChild(el("div", "rm-room-sub", sub));
        open.onclick = function () { openWorkspace(r.code); };
        var forget = el("button", "btn ghost sm", "Remove");
        forget.setAttribute("aria-label", "Remove " + (r.name || r.code) + " from this list");
        forget.onclick = function (ev) {
          ev.stopPropagation();
          forgetKnownRoom(r.code);
          render();
        };
        item.appendChild(open);
        item.appendChild(forget);
        ul.appendChild(item);
      });
      listPanel.appendChild(ul);
    }
    view.appendChild(listPanel);
    /* deep link: auto-join */
    if (pendingCode && UI.isValidRoomCode && UI.isValidRoomCode(pendingCode)) {
      doJoinCode(pendingCode);
    }
  }

  async function doCreate(name, box) {
    clearError();
    box.innerHTML = "";
    box.classList.add("hidden");
    var res;
    try {
      res = await api("POST", "/api/collab/rooms", { name: name || "Untitled room" });
    } catch (e) {
      showError("Couldn't create the room: " + (e && e.message ? e.message : "network error"));
      return;
    }
    if (!res || !res.ok || !res.room) {
      showError("Couldn't create the room. Is the Node server running?");
      return;
    }
    var ref = {
      code: res.room.id,
      name: res.room.name,
      ownerToken: res.ownerToken || null,
      displayName: storedDisplayName(res.room.id),
      lastSeen: Date.now(),
    };
    upsertKnownRoom(ref);
    box.classList.remove("hidden");
    box.appendChild(el("div", "rm-created-title", "Room created"));
    var codeRow = el("div", "rm-code-row");
    codeRow.appendChild(el("code", "rm-code-big", ref.code));
    var copyCode = el("button", "btn sm", "Copy code");
    copyCode.onclick = function () { copyText(ref.code, "Room code copied"); };
    codeRow.appendChild(copyCode);
    box.appendChild(codeRow);
    var linkRow = el("div", "rm-code-row");
    var linkInput = el("input", "input");
    linkInput.value = inviteLink(ref.code);
    linkInput.readOnly = true;
    linkInput.setAttribute("aria-label", "Invite link");
    linkRow.appendChild(linkInput);
    var copyLink = el("button", "btn sm", "Copy link");
    copyLink.onclick = function () { copyText(inviteLink(ref.code), "Invite link copied"); };
    linkRow.appendChild(copyLink);
    box.appendChild(linkRow);
    var openBtn = el("button", "btn primary", "Open room");
    openBtn.onclick = function () { openWorkspace(ref.code); };
    box.appendChild(openBtn);
    if (typeof announce === "function") announce("Room created: " + ref.code);
  }

  function copyText(text, okMsg) {
    var done = function (ok) { toast(ok ? okMsg : "Copy failed"); };
    if (UI.copyText) UI.copyText(text).then(done, function () { done(false); });
    else done(false);
  }

  async function doJoinCode(rawCode) {
    clearError();
    var code = UI.normalizeRoomCode ? UI.normalizeRoomCode(rawCode) : String(rawCode || "").trim().toUpperCase();
    if (!UI.isValidRoomCode || !UI.isValidRoomCode(code)) {
      showError("That doesn't look like a room code. Codes look like NEUTRON-AB12CD.");
      return;
    }
    var res;
    try {
      res = await api("GET", "/api/collab/rooms/" + encodeURIComponent(code));
    } catch (e) {
      showError("Couldn't reach the server: " + (e && e.message ? e.message : "network error"));
      return;
    }
    if (!res || !res.exists) {
      showError("Room not found. Check the code and try again.");
      return;
    }
    openWorkspace(code);
  }

  function openWorkspace(code) {
    var kr = knownRoom(code);
    S = freshState();
    S.screen = "workspace";
    S.code = code;
    S.roomName = kr ? kr.name : code;
    S.ownerToken = kr ? kr.ownerToken : null;
    S.displayName = storedDisplayName(code) || (kr ? kr.displayName : "") || "";
    upsertKnownRoom({ code: code, name: S.roomName, ownerToken: S.ownerToken, displayName: S.displayName, lastSeen: Date.now() });
    render();
  }

  function leaveToList() {
    var code = S.code;
    if (code) {
      var kr = knownRoom(code);
      if (kr) { kr.lastSeen = Date.now(); upsertKnownRoom(kr); }
    }
    closeSocket();
    S = freshState();
    render();
  }

  /* ---------- workspace ---------- */

  function renderWorkspace(view) {
    /* Reuse a live connection when the view re-renders for the same room. */
    var reuse = S.ws && S.ws.readyState === 1 && S.joined && S.code;

    var head = el("div", "rm-head panel");
    var back = el("button", "btn ghost sm", "← Rooms");
    back.setAttribute("aria-label", "Back to room list");
    back.onclick = function () { closeSocket(); S = freshState(); render(); };
    head.appendChild(back);
    var titleEl = el("h2", "rm-title", S.roomName || S.code);
    titleEl.id = "rm-room-title";
    head.appendChild(titleEl);
    var connPill = el("span", "rm-conn");
    var dot = el("span", "rm-dot busy");
    dot.id = "rm-conn-dot";
    dot.setAttribute("aria-hidden", "true");
    var connLabel = el("span", null, "Connecting…");
    connLabel.id = "rm-conn-label";
    connPill.appendChild(dot);
    connPill.appendChild(connLabel);
    connPill.setAttribute("role", "status");
    head.appendChild(connPill);
    var countWrap = el("span", "rm-count-wrap");
    var countNum = el("span", "rm-count", "0");
    countNum.id = "rm-count";
    countWrap.appendChild(countNum);
    countWrap.appendChild(document.createTextNode(" online"));
    head.appendChild(countWrap);
    var inviteBtn = el("button", "btn sm", "Invite");
    inviteBtn.onclick = function () { showInvite(); };
    head.appendChild(inviteBtn);
    var leaveBtn = el("button", "btn ghost sm", "Leave");
    leaveBtn.onclick = function () { leaveToList(); };
    head.appendChild(leaveBtn);
    view.appendChild(head);

    /* Name gate: ask once, remember per room. */
    if (!S.displayName) {
      renderNameGate(view);
      setConn("idle");
      return;
    }

    var tabs = el("div", "rm-tabs");
    var tabChat = el("button", "rm-tab on", "Chat");
    var tabMembers = el("button", "rm-tab", "Members");
    tabs.appendChild(tabChat);
    tabs.appendChild(tabMembers);
    view.appendChild(tabs);

    var body = el("div", "rm-body");
    body.id = "rm-body";
    var membersPanel = el("aside", "rm-members-panel panel");
    membersPanel.setAttribute("aria-label", "Room members");
    membersPanel.appendChild(el("h3", null, "Members"));
    var mlist = el("div", "rm-members");
    mlist.id = "rm-members";
    membersPanel.appendChild(mlist);

    var chatPanel = el("section", "rm-chat-panel panel");
    chatPanel.setAttribute("aria-label", "Room chat");
    var log = el("div", "rm-chat-log");
    log.id = "rm-chat-log";
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-label", "Room chat messages");
    chatPanel.appendChild(log);
    var typing = el("div", "rm-typing");
    typing.id = "rm-typing";
    typing.setAttribute("aria-live", "polite");
    chatPanel.appendChild(typing);
    var form = el("form", "rm-chat-form");
    var input = el("input", "input");
    input.id = "rm-chat-input";
    input.placeholder = "Message the room…";
    input.setAttribute("aria-label", "Message the room");
    input.autocomplete = "off";
    input.maxLength = 2000;
    var sendBtn = el("button", "btn primary sm", "Send");
    sendBtn.type = "submit";
    form.appendChild(input);
    form.appendChild(sendBtn);
    chatPanel.appendChild(form);
    var retry = el("button", "btn sm hidden", "Retry connection");
    retry.id = "rm-retry";
    retry.onclick = function () { S.reconnectAttempt = 0; connect(); };
    chatPanel.appendChild(retry);

    body.appendChild(membersPanel);
    body.appendChild(chatPanel);
    view.appendChild(body);

    tabChat.onclick = function () {
      tabChat.classList.add("on"); tabMembers.classList.remove("on");
      body.classList.remove("rm-show-members");
    };
    tabMembers.onclick = function () {
      tabMembers.classList.add("on"); tabChat.classList.remove("on");
      body.classList.add("rm-show-members");
    };

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      sendChat(input);
    });
    input.addEventListener("input", function () {
      if (!S.joined) return;
      if (!S.typingSent) {
        S.typingSent = true;
        sendMsg({ type: "CHAT_TYPING", typing: true });
      }
      if (S.typingTimer) clearTimeout(S.typingTimer);
      S.typingTimer = setTimeout(function () {
        S.typingSent = false;
        S.typingTimer = null;
        sendMsg({ type: "CHAT_TYPING", typing: false });
      }, 2000);
    });

    document.addEventListener("visibilitychange", onVisibility);

    paintMembers();
    paintChat(false);
    if (reuse) {
      setConn("connected");
    } else {
      connect();
    }
  }

  function onVisibility() {
    var next = document.hidden ? "away" : "online";
    if (next === S.presenceStatus) return;
    S.presenceStatus = next;
    if (S.joined) sendMsg({ type: "PRESENCE_UPDATE", status: next, activity: "In room chat" });
  }

  function renderNameGate(view) {
    var p = el("div", "panel rm-note");
    p.appendChild(el("h2", null, "Pick a display name"));
    p.appendChild(el("p", "muted small", "This is the name other members will see in " + (S.roomName || "this room") + "."));
    var input = el("input", "input");
    input.placeholder = "Your name";
    input.maxLength = 32;
    input.setAttribute("aria-label", "Display name");
    p.appendChild(input);
    var row = el("div", "rm-row");
    var ok = el("button", "btn primary", "Join room");
    var cancel = el("button", "btn ghost", "Back");
    row.appendChild(ok);
    row.appendChild(cancel);
    p.appendChild(row);
    view.appendChild(p);
    var submit = function () {
      var name = UI.sanitizeCollabName ? UI.sanitizeCollabName(input.value) : input.value.trim();
      if (!name) { showError("Please enter a display name."); input.focus(); return; }
      S.displayName = name;
      setStoredDisplayName(S.code, name);
      var kr = knownRoom(S.code);
      if (kr) { kr.displayName = name; upsertKnownRoom(kr); }
      render();
    };
    ok.onclick = submit;
    cancel.onclick = function () { S = freshState(); render(); };
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); submit(); }
    });
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }

  function sendChat(input) {
    var text = UI.sanitizeCollabText ? UI.sanitizeCollabText(input.value) : input.value.trim();
    if (!text) return;
    if (!S.joined || !sendMsg({ type: "CHAT_MESSAGE", text: text })) {
      showError(S.conn === "connected" ? "Couldn't send. Try again." : "Not connected yet — wait for the green dot.");
      return;
    }
    input.value = "";
    if (S.typingSent) {
      S.typingSent = false;
      if (S.typingTimer) { clearTimeout(S.typingTimer); S.typingTimer = null; }
      sendMsg({ type: "CHAT_TYPING", typing: false });
    }
  }

  function showInvite() {
    closeModal();
    var back = el("div", "rm-modal-back");
    var modal = el("div", "rm-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Invite to room");
    modal.appendChild(el("div", "rm-modal-title", "Invite to " + (S.roomName || "room")));
    modal.appendChild(el("p", "muted small", "Anyone with the code or link can join."));
    var codeRow = el("div", "rm-code-row");
    codeRow.appendChild(el("code", "rm-code-big", S.code));
    var copyCode = el("button", "btn sm", "Copy code");
    copyCode.onclick = function () { copyText(S.code, "Room code copied"); };
    codeRow.appendChild(copyCode);
    modal.appendChild(codeRow);
    var linkRow = el("div", "rm-code-row");
    var linkInput = el("input", "input");
    linkInput.value = inviteLink(S.code);
    linkInput.readOnly = true;
    linkInput.setAttribute("aria-label", "Invite link");
    linkRow.appendChild(linkInput);
    var copyLink = el("button", "btn sm", "Copy link");
    copyLink.onclick = function () { copyText(inviteLink(S.code), "Invite link copied"); };
    linkRow.appendChild(copyLink);
    modal.appendChild(linkRow);
    var done = el("button", "btn primary", "Done");
    done.onclick = closeModal;
    modal.appendChild(done);
    back.appendChild(modal);
    back.addEventListener("click", function (ev) { if (ev.target === back) closeModal(); });
    document.body.appendChild(back);
    document.addEventListener("keydown", escCloses, { once: true });
    try { done.focus(); } catch (e) {}
  }

  function escCloses(ev) {
    if (ev.key === "Escape") closeModal();
    else document.addEventListener("keydown", escCloses, { once: true });
  }

  function closeModal() {
    var back = document.querySelector(".rm-modal-back");
    if (back && back.parentNode) back.parentNode.removeChild(back);
  }

  /* ---------- route entry ---------- */

  async function renderRooms(view) {
    var pending = window.__neutronPendingRoom || null;
    window.__neutronPendingRoom = null;
    if (pending && UI.normalizeRoomCode) pending = UI.normalizeRoomCode(pending);
    /* Deep link to a different room while a workspace is open: drop the
       current room first so the pending code takes over below. */
    if (pending && S.screen === "workspace" && pending !== S.code) {
      closeSocket();
      S = freshState();
    }
    view.appendChild(el("h1", null, "Rooms"));
    view.appendChild(el("p", "muted", "Real-time collaboration rooms. Create one, share the code, and chat live."));
    var health = null;
    try {
      health = await api("GET", "/api/health");
    } catch (e) { health = null; }
    if (!health || health.serverless) {
      renderServerlessNote(view);
      return;
    }
    if (S.screen === "workspace" && S.code) {
      renderWorkspace(view);
      return;
    }
    renderList(view, pending);
  }

  window.NeutronRooms = {
    renderRooms: renderRooms,
    teardown: teardown,
  };
})();
