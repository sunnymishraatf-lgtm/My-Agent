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
      /* Phase 2: collaborative editing */
      files: [], // CollabFileMeta[] from the server
      openFileIds: [], // ordered open tabs
      activeFileId: null,
      editors: {}, // fileId -> editor state (Y.Doc binding)
      saveState: {}, // fileId -> "saved" | "saving" | "failed"
      awareness: {}, // fileId -> memberId -> {name,color,cursor,selection,ts}
      versions: {}, // fileId -> [{ts, author, authorName}]
      mtab: "editor", // mobile tab: files|editor|chat|members
      collapsedDirs: {}, // dir path -> true
      editAnnounce: {}, // fileId -> timestamp of last aria-live edit note
      myColor: null,
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
    disposeAllEditors();
    S = freshState();
  }

  /** Dispose every Y.Doc binding (socket drop / leaving the route). */
  function disposeAllEditors() {
    Object.keys(S.editors).forEach(function (fid) { disposeEditor(fid); });
    S.editors = {};
  }

  function disposeEditor(fileId) {
    var ed = S.editors[fileId];
    if (!ed) return;
    ed.disposed = true;
    delete S.editors[fileId];
    try { ed.doc.destroy(); } catch (e) {}
    if (ed.awareTimer) { clearInterval(ed.awareTimer); ed.awareTimer = null; }
  }

  function stopTimers() {
    if (S.reconnectTimer) { clearTimeout(S.reconnectTimer); S.reconnectTimer = null; }
    if (S.heartbeatTimer) { clearInterval(S.heartbeatTimer); S.heartbeatTimer = null; }
    if (S.typingTimer) { clearTimeout(S.typingTimer); S.typingTimer = null; }
  }

  function closeSocket() {
    stopTimers();
    disposeAllEditors();
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
    // Yjs docs are bound to this socket's sync session; drop them but keep
    // the tab list so a reconnect re-opens the same files.
    disposeAllEditors();
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
        S.myColor = UI.pickPresenceColor ? UI.pickPresenceColor(S.memberId) : "#CC8066";
        if (msg.room && msg.room.name) {
          S.roomName = msg.room.name;
          var kr = knownRoom(S.code);
          if (kr && kr.name !== msg.room.name) { kr.name = msg.room.name; upsertKnownRoom(kr); }
          var title = document.getElementById("rm-room-title");
          if (title) title.textContent = msg.room.name;
        }
        S.members = Array.isArray(msg.members) ? msg.members : [];
        S.chat = Array.isArray(msg.chat) ? msg.chat.slice(-200) : [];
        S.files = Array.isArray(msg.files) ? msg.files : [];
        setConn("connected");
        startHeartbeat();
        paintMembers();
        paintChat(true);
        paintFiles();
        paintRoomAdmin();
        // Re-open the tabs that were open before a reconnect.
        var reopen = S.openFileIds.slice();
        S.openFileIds = [];
        S.activeFileId = null;
        reopen.forEach(function (fid) { openFileTab(fid, true); });
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
      case "FILE_LIST_RESULT":
        if (Array.isArray(msg.files)) { S.files = msg.files; paintFiles(); }
        break;
      case "FILE_EVENT":
        onFileEvent(msg);
        break;
      case "YJS_SYNC":
        onYjsSync(msg);
        break;
      case "AWARENESS":
        onAwareness(msg);
        break;
      case "ROOM_RENAMED":
        if (msg.name) {
          S.roomName = msg.name;
          var t2 = document.getElementById("rm-room-title");
          if (t2) t2.textContent = msg.name;
          var kr2 = knownRoom(S.code);
          if (kr2) { kr2.name = msg.name; upsertKnownRoom(kr2); }
          if (typeof announce === "function") announce("Room renamed to " + msg.name);
        }
        break;
      case "ROOM_DELETED":
        toast("This room was deleted by its owner.");
        leaveToList();
        break;
      case "FILE_SNAPSHOT":
        if (msg.fileId) setSaveState(msg.fileId, msg.ok ? "saved" : "failed");
        break;
      case "VERSIONS":
        if (msg.fileId && Array.isArray(msg.versions)) {
          S.versions[msg.fileId] = msg.versions;
          renderVersionsModal(msg.fileId);
        }
        break;
      case "VERSION_TEXT":
        if (msg.fileId) renderVersionPreview(msg.fileId, msg.ts, msg.text || "");
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
    var adminSlot = el("span", "rm-admin");
    adminSlot.id = "rm-admin";
    head.appendChild(adminSlot);
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

    /* Mobile main tabs: Files | Editor | Chat | Members. */
    var mtabs = el("div", "rm-tabs rm-maintabs");
    mtabs.setAttribute("role", "tablist");
    mtabs.setAttribute("aria-label", "Room panels");
    var mtabBtns = {};
    ["files", "editor", "chat", "members"].forEach(function (name) {
      var b = el("button", "rm-tab" + (S.mtab === name ? " on" : ""), name.charAt(0).toUpperCase() + name.slice(1));
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", S.mtab === name ? "true" : "false");
      b.onclick = function () { setMtab(name); };
      mtabBtns[name] = b;
      mtabs.appendChild(b);
    });
    view.appendChild(mtabs);

    function setMtab(name) {
      S.mtab = name;
      var bodyEl = document.getElementById("rm-body");
      if (bodyEl) bodyEl.dataset.mtab = name;
      Object.keys(mtabBtns).forEach(function (k) {
        mtabBtns[k].classList.toggle("on", k === name);
        mtabBtns[k].setAttribute("aria-selected", k === name ? "true" : "false");
      });
    }

    var body = el("div", "rm-body");
    body.id = "rm-body";
    body.dataset.mtab = S.mtab;

    /* Files panel. */
    var filesPanel = el("aside", "rm-files-panel panel");
    filesPanel.setAttribute("aria-label", "Shared files");
    var filesHead = el("div", "rm-files-head");
    filesHead.appendChild(el("h3", null, "Files"));
    var newFileBtn = el("button", "btn ghost sm", "+ New");
    newFileBtn.setAttribute("aria-label", "Create a new shared file");
    newFileBtn.onclick = function () {
      openPromptDialog({
        title: "New file",
        label: "File path",
        value: "",
        placeholder: "docs/notes.md",
        okText: "Create",
        onOk: function (v) { doCreateFile(v); },
      });
    };
    filesHead.appendChild(newFileBtn);
    filesPanel.appendChild(filesHead);
    var tree = el("div", "rm-files-tree");
    tree.id = "rm-files-tree";
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "Shared files");
    filesPanel.appendChild(tree);
    body.appendChild(filesPanel);

    /* Editor panel. */
    var editorPanel = el("section", "rm-editor-panel panel");
    editorPanel.setAttribute("aria-label", "Shared editor");
    var edTabs = el("div", "rm-ed-tabs");
    edTabs.id = "rm-ed-tabs";
    edTabs.setAttribute("role", "tablist");
    edTabs.setAttribute("aria-label", "Open files");
    editorPanel.appendChild(edTabs);
    var edWrap = el("div", "rm-ed-wrap");
    edWrap.id = "rm-editor";
    editorPanel.appendChild(edWrap);
    body.appendChild(editorPanel);

    /* Side column: members + chat with their own sub-tabs. */
    var side = el("div", "rm-side panel");
    side.id = "rm-side";
    var subtabs = el("div", "rm-tabs rm-subtabs");
    var tabChat = el("button", "rm-tab on", "Chat");
    var tabMembers = el("button", "rm-tab", "Members");
    subtabs.appendChild(tabChat);
    subtabs.appendChild(tabMembers);
    side.appendChild(subtabs);

    var membersPanel = el("aside", "rm-members-panel");
    membersPanel.setAttribute("aria-label", "Room members");
    membersPanel.appendChild(el("h3", null, "Members"));
    var mlist = el("div", "rm-members");
    mlist.id = "rm-members";
    membersPanel.appendChild(mlist);

    var chatPanel = el("section", "rm-chat-panel");
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

    side.appendChild(membersPanel);
    side.appendChild(chatPanel);
    body.appendChild(side);
    view.appendChild(body);

    tabChat.onclick = function () {
      tabChat.classList.add("on"); tabMembers.classList.remove("on");
      side.classList.remove("rm-show-members");
    };
    tabMembers.onclick = function () {
      tabMembers.classList.add("on"); tabChat.classList.remove("on");
      side.classList.add("rm-show-members");
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
    paintFiles();
    paintEdTabs();
    paintEditor();
    paintRoomAdmin();
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

  /* ---------- collaborative editing (Phase 2) ---------- */

  var YJS_URL = "/src/web/app/vendor/yjs.bundle.js";
  var yjsLoading = false;
  var yjsWaiters = [];

  /** Lazily load the yjs browser bundle (only on the Rooms route). */
  function ensureYjs(cb) {
    if (window.Y && window.Y.Doc) { cb(true); return; }
    yjsWaiters.push(cb);
    if (yjsLoading) return;
    yjsLoading = true;
    var s = document.createElement("script");
    s.src = YJS_URL;
    s.async = true;
    s.onload = function () {
      yjsLoading = false;
      var ok = !!(window.Y && window.Y.Doc);
      var ws = yjsWaiters.splice(0);
      ws.forEach(function (fn) { try { fn(ok); } catch (e) {} });
      if (!ok) showError("Couldn't load the collaborative editor. Run npm run build on the server.");
    };
    s.onerror = function () {
      yjsLoading = false;
      var ws = yjsWaiters.splice(0);
      ws.forEach(function (fn) { try { fn(false); } catch (e) {} });
      showError("Couldn't load the collaborative editor (yjs bundle missing). Run npm run build on the server.");
    };
    document.head.appendChild(s);
  }

  function yjsFrame(kind, payload) {
    // kind: 0 step1, 1 step2, 2 update
    return UI.b64encodeBytes(UI.encodeSyncFrame(kind, payload));
  }

  function fileById(fileId) {
    for (var i = 0; i < S.files.length; i++) {
      if (S.files[i].id === fileId) return S.files[i];
    }
    return null;
  }

  function isOwner() { return S.role === "owner"; }

  /* ----- editor lifecycle ----- */

  function openFileTab(fileId, quiet) {
    var meta = fileById(fileId);
    if (!meta) return;
    if (S.editors[fileId]) { setActiveFile(fileId); return; }
    ensureYjs(function (ok) {
      if (!ok) return;
      if (S.editors[fileId] || !S.joined) return;
      var doc = new window.Y.Doc();
      var ytext = doc.getText("content");
      var ed = {
        fileId: fileId,
        doc: doc,
        ytext: ytext,
        ta: null,
        lastText: "",
        disposed: false,
        awareTimer: null,
        lastAwareSent: 0,
      };
      doc.on("update", function (update, origin) { onDocUpdate(ed, update, origin); });
      S.editors[fileId] = ed;
      if (S.openFileIds.indexOf(fileId) === -1) S.openFileIds.push(fileId);
      setActiveFile(fileId);
      // y-websocket handshake, client side: ask the server for its state.
      sendMsg({ type: "FILE_OPEN", fileId: fileId });
      if (!quiet && typeof announce === "function") announce("Opened " + meta.path);
    });
  }

  function setActiveFile(fileId) {
    S.activeFileId = fileId;
    paintEdTabs();
    paintEditor();
  }

  function closeFileTab(fileId) {
    sendMsg({ type: "FILE_CLOSE", fileId: fileId });
    disposeEditor(fileId);
    S.openFileIds = S.openFileIds.filter(function (id) { return id !== fileId; });
    delete S.saveState[fileId];
    delete S.awareness[fileId];
    if (S.activeFileId === fileId) {
      S.activeFileId = S.openFileIds.length ? S.openFileIds[S.openFileIds.length - 1] : null;
    }
    paintEdTabs();
    paintEditor();
  }

  /** Apply Y.Text ops from a local textarea edit (origin "local"). */
  function applyOpsToYText(ytext, ops) {
    var index = 0;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.retain) index += op.retain;
      if (op.delete) ytext.delete(index, op.delete);
      if (op.insert) { ytext.insert(index, op.insert); index += op.insert.length; }
    }
  }

  function onLocalInput(ed) {
    var ta = ed.ta;
    if (!ta || ed.disposed) return;
    var next = ta.value;
    if (next === ed.lastText) return;
    var ops = UI.diffTextToOps(ed.lastText, next);
    ed.lastText = next;
    if (!ops.length) return;
    try {
      ed.doc.transact(function () { applyOpsToYText(ed.ytext, ops); }, "local");
    } catch (e) {
      showError("Couldn't apply your edit. Reopen the file and try again.");
    }
  }

  /** Y.Doc update handler: broadcast local edits, render remote ones. */
  function onDocUpdate(ed, update, origin) {
    if (ed.disposed) return;
    if (origin === "local") {
      sendMsg({ type: "YJS_SYNC", fileId: ed.fileId, kind: "update", data: yjsFrame(2, update) });
    } else {
      renderRemoteText(ed);
      noteRemoteEdit(ed.fileId);
    }
    setSaveState(ed.fileId, "saving");
  }

  /** Re-render the textarea after a remote update, preserving the caret. */
  function renderRemoteText(ed) {
    var ta = ed.ta;
    var text = ed.ytext.toString();
    ed.lastText = text;
    if (!ta) return;
    if (ta.value === text) return;
    var focused = false;
    var s = 0, e = 0;
    try {
      focused = document.activeElement === ta;
      s = ta.selectionStart || 0;
      e = ta.selectionEnd || 0;
    } catch (err) {}
    ta.value = text;
    if (focused) {
      try { ta.setSelectionRange(Math.min(s, text.length), Math.min(e, text.length)); } catch (err2) {}
    }
    updateCursorStatus(ed);
  }

  /** Throttled screen-reader note for remote edits ("Rahul edited app.ts"). */
  function noteRemoteEdit(fileId) {
    var now = Date.now();
    if (now - (S.editAnnounce[fileId] || 0) < 5000) return;
    S.editAnnounce[fileId] = now;
    var meta = fileById(fileId);
    if (typeof announce === "function" && meta) announce("Remote edit received in " + meta.path);
  }

  /* ----- sync protocol (mirrors y-websocket semantics) ----- */

  function onYjsSync(msg) {
    if (!msg.fileId || typeof msg.data !== "string") return;
    var ed = S.editors[msg.fileId];
    if (!ed || ed.disposed || !window.Y) return;
    var raw = UI.b64decodeBytes(msg.data);
    if (!raw) return;
    var frame = UI.decodeSyncFrame(raw);
    if (!frame) return;
    var Y = window.Y;

    if (msg.kind === "step1" && frame.type === 0) {
      // Server asks what it's missing: reply step2 with our diff...
      var diff = Y.encodeStateAsUpdate(ed.doc, frame.payload);
      sendMsg({ type: "YJS_SYNC", fileId: ed.fileId, kind: "step2", data: yjsFrame(1, diff) });
      // ...and send our own step1 so the server tells us what WE are missing.
      var sv = Y.encodeStateVector(ed.doc);
      sendMsg({ type: "YJS_SYNC", fileId: ed.fileId, kind: "step1", data: yjsFrame(0, sv) });
    } else if (msg.kind === "step2" && frame.type === 1) {
      try { Y.applyUpdate(ed.doc, frame.payload, "sync"); }
      catch (e) { /* corrupt update — the next handshake repairs */ }
    } else if (msg.kind === "update" && frame.type === 2) {
      try { Y.applyUpdate(ed.doc, frame.payload, "remote"); }
      catch (e) { /* ignore malformed updates */ }
    }
  }

  /* ----- file events ----- */

  function onFileEvent(msg) {
    if (msg.event === "created" && msg.file) {
      if (!fileById(msg.file.id)) S.files.push(msg.file);
      paintFiles();
      if (typeof announce === "function") announce("File created: " + msg.file.path);
    } else if (msg.event === "renamed" && msg.file) {
      var m = fileById(msg.file.id);
      if (m) { m.path = msg.file.path; m.updatedAt = msg.file.updatedAt; }
      paintFiles();
      paintEdTabs();
      if (typeof announce === "function") announce("File renamed to " + msg.file.path);
    } else if (msg.event === "deleted" && msg.fileId) {
      S.files = S.files.filter(function (f) { return f.id !== msg.fileId; });
      if (S.editors[msg.fileId]) {
        toast("A file you had open was deleted by the owner.");
        closeFileTab(msg.fileId);
      }
      paintFiles();
      if (typeof announce === "function") announce("A file was deleted.");
    }
  }

  function doCreateFile(path) {
    var clean = UI.sanitizeCollabPath ? UI.sanitizeCollabPath(path) : null;
    if (!clean) {
      showError("That path isn't valid. Use a relative path like docs/notes.md.");
      return;
    }
    if (!sendMsg({ type: "FILE_CREATE", path: clean })) {
      showError("Not connected. Wait for the green dot and try again.");
    }
  }

  function doRenameFile(fileId, newPath) {
    var clean = UI.sanitizeCollabPath ? UI.sanitizeCollabPath(newPath) : null;
    if (!clean) {
      showError("That path isn't valid. Use a relative path like docs/notes.md.");
      return;
    }
    sendMsg({ type: "FILE_RENAME", fileId: fileId, newPath: clean });
  }

  function doDeleteFile(fileId) {
    var meta = fileById(fileId);
    openConfirmDialog({
      title: "Delete file?",
      body: "Delete \"" + (meta ? meta.path : fileId) + "\" for everyone in this room? This can't be undone.",
      okText: "Delete",
      danger: true,
      onOk: function () { sendMsg({ type: "FILE_DELETE", fileId: fileId }); },
    });
  }

  /* ----- dialogs (prompt / confirm) ----- */

  function openDialogShell(title, labelledBy) {
    closeModal();
    var back = el("div", "rm-modal-back");
    var modal = el("div", "rm-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", title);
    if (labelledBy) modal.setAttribute("aria-labelledby", labelledBy);
    modal.appendChild(el("div", "rm-modal-title", title));
    back.appendChild(modal);
    back.addEventListener("click", function (ev) { if (ev.target === back) closeModal(); });
    document.body.appendChild(back);
    document.addEventListener("keydown", escCloses, { once: true });
    return { back: back, modal: modal };
  }

  function openPromptDialog(opts) {
    // opts: {title, label, value, placeholder, okText, onOk(value)}
    var shell = openDialogShell(opts.title);
    var modal = shell.modal;
    var input = el("input", "input");
    input.value = opts.value || "";
    input.placeholder = opts.placeholder || "";
    input.setAttribute("aria-label", opts.label || opts.title);
    modal.appendChild(input);
    var row = el("div", "rm-row");
    var ok = el("button", "btn primary", opts.okText || "Save");
    var cancel = el("button", "btn ghost", "Cancel");
    row.appendChild(ok);
    row.appendChild(cancel);
    modal.appendChild(row);
    var done = false;
    var submit = function () {
      if (done) return;
      done = true;
      var v = input.value;
      closeModal();
      opts.onOk(v);
    };
    ok.onclick = submit;
    cancel.onclick = closeModal;
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); submit(); }
    });
    setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 50);
  }

  function openConfirmDialog(opts) {
    // opts: {title, body, okText, danger, onOk}
    var shell = openDialogShell(opts.title);
    var modal = shell.modal;
    modal.appendChild(el("p", "muted", opts.body || ""));
    var row = el("div", "rm-row");
    var ok = el("button", opts.danger ? "btn danger" : "btn primary", opts.okText || "Confirm");
    var cancel = el("button", "btn ghost", "Cancel");
    row.appendChild(ok);
    row.appendChild(cancel);
    modal.appendChild(row);
    ok.onclick = function () { closeModal(); opts.onOk(); };
    cancel.onclick = closeModal;
    setTimeout(function () { try { cancel.focus(); } catch (e) {} }, 50);
  }

  /* ----- file explorer ----- */

  function paintFiles() {
    var tree = document.getElementById("rm-files-tree");
    if (!tree) return;
    tree.innerHTML = "";
    if (!S.files.length) {
      tree.appendChild(el("div", "rm-empty", "No files yet. Create the first one."));
      return;
    }
    var nodes = UI.buildFileTree ? UI.buildFileTree(S.files) : [];
    nodes.forEach(function (n) { tree.appendChild(treeNodeEl(n, 0)); });
  }

  function treeNodeEl(node, depth) {
    if (node.dir) {
      var wrap = el("div", "rm-dir");
      var collapsed = !!S.collapsedDirs[node.path];
      var head = el("button", "rm-dir-head" + (collapsed ? " closed" : ""));
      head.style.paddingLeft = (8 + depth * 14) + "px";
      head.setAttribute("aria-expanded", collapsed ? "false" : "true");
      var caret = el("span", "rm-caret", collapsed ? "▸" : "▾");
      caret.setAttribute("aria-hidden", "true");
      head.appendChild(caret);
      head.appendChild(el("span", "rm-dir-name", "📁 " + node.name));
      head.onclick = function () {
        S.collapsedDirs[node.path] = !S.collapsedDirs[node.path];
        paintFiles();
      };
      wrap.appendChild(head);
      if (!collapsed) {
        node.children.forEach(function (c) { wrap.appendChild(treeNodeEl(c, depth + 1)); });
      }
      return wrap;
    }
    var row = el("div", "rm-file" + (S.activeFileId === node.id ? " active" : ""));
    var open = el("button", "rm-file-open");
    open.style.paddingLeft = (8 + depth * 14) + "px";
    open.setAttribute("aria-label", "Open file " + node.path);
    var icon = el("span", "rm-file-icon", "📄");
    icon.setAttribute("aria-hidden", "true");
    open.appendChild(icon);
    open.appendChild(el("span", "rm-file-name", node.name));
    open.onclick = function () { openFileTab(node.id); };
    row.appendChild(open);
    if (isOwner()) {
      var menu = el("button", "rm-file-menu", "⋮");
      menu.setAttribute("aria-label", "File actions for " + node.path);
      menu.setAttribute("aria-haspopup", "menu");
      menu.onclick = function (ev) { ev.stopPropagation(); showFileMenu(node, menu); };
      row.appendChild(menu);
    } else {
      var lock = el("span", "rm-file-lock", "🔒");
      lock.title = "Only the room owner can rename or delete files";
      lock.setAttribute("aria-label", "Only the room owner can rename or delete files");
      row.appendChild(lock);
    }
    return row;
  }

  function showFileMenu(node, anchor) {
    closeFileMenu();
    var menu = el("div", "rm-ctx-menu");
    menu.setAttribute("role", "menu");
    var rename = el("button", "rm-ctx-item", "Rename");
    rename.setAttribute("role", "menuitem");
    rename.onclick = function () {
      closeFileMenu();
      openPromptDialog({
        title: "Rename file",
        label: "New path",
        value: node.path,
        placeholder: "docs/notes.md",
        okText: "Rename",
        onOk: function (v) { doRenameFile(node.id, v); },
      });
    };
    var del = el("button", "rm-ctx-item danger", "Delete");
    del.setAttribute("role", "menuitem");
    del.onclick = function () { closeFileMenu(); doDeleteFile(node.id); };
    menu.appendChild(rename);
    menu.appendChild(del);
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = Math.min(r.bottom + 4, window.innerHeight - 120) + "px";
    menu.style.left = Math.max(8, r.right - 140) + "px";
    menu.id = "rm-file-menu-el";
    setTimeout(function () {
      document.addEventListener("click", closeFileMenu, { once: true });
      document.addEventListener("keydown", function esc(ev) {
        if (ev.key === "Escape") { closeFileMenu(); }
        else document.addEventListener("keydown", esc, { once: true });
      }, { once: true });
    }, 0);
    rename.focus();
  }

  function closeFileMenu() {
    var m = document.getElementById("rm-file-menu-el");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  /* ----- editor ----- */

  function paintEdTabs() {
    var tabs = document.getElementById("rm-ed-tabs");
    if (!tabs) return;
    tabs.innerHTML = "";
    S.openFileIds.forEach(function (fid) {
      var meta = fileById(fid);
      if (!meta) return;
      var tab = el("div", "rm-ed-tab" + (S.activeFileId === fid ? " active" : ""));
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", S.activeFileId === fid ? "true" : "false");
      var label = el("button", "rm-ed-tab-label", meta.path.split("/").pop());
      label.title = meta.path;
      label.setAttribute("aria-label", "Switch to " + meta.path);
      label.onclick = function () { setActiveFile(fid); };
      var x = el("button", "rm-ed-tab-x", "×");
      x.setAttribute("aria-label", "Close " + meta.path);
      x.onclick = function (ev) { ev.stopPropagation(); closeFileTab(fid); };
      tab.appendChild(label);
      tab.appendChild(x);
      tabs.appendChild(tab);
    });
  }

  function paintEditor() {
    var wrap = document.getElementById("rm-editor");
    if (!wrap) return;
    wrap.innerHTML = "";
    var fid = S.activeFileId;
    var ed = fid ? S.editors[fid] : null;
    var meta = fid ? fileById(fid) : null;
    if (!ed || !meta) {
      var empty = el("div", "rm-ed-empty");
      empty.appendChild(el("div", "rm-ed-empty-title", S.files.length ? "Open a file to start editing together" : "No files yet"));
      empty.appendChild(el("p", "muted small", S.files.length
        ? "Pick a file from the explorer. Edits sync live via CRDT — no overwrites."
        : "Create the first file from the explorer panel."));
      wrap.appendChild(empty);
      updateCursorStatus(null);
      return;
    }
    // Presence chips: who's here, with cursor positions.
    var chips = el("div", "rm-ed-presence");
    chips.id = "rm-ed-presence";
    wrap.appendChild(chips);
    paintPresenceChips();

    var ta = el("textarea", "rm-ed-area");
    ta.id = "rm-ed-area";
    ta.value = ed.ytext.toString();
    ed.lastText = ta.value;
    ta.setAttribute("aria-label", "Shared editor for " + meta.path);
    ta.spellcheck = false;
    ta.autocapitalize = "off";
    ta.autocomplete = "off";
    ta.wrap = "off";
    wrap.appendChild(ta);
    ed.ta = ta;

    ta.addEventListener("input", function () { onLocalInput(ed); });
    var aware = function () { sendAwareness(ed); };
    ta.addEventListener("keyup", aware);
    ta.addEventListener("click", aware);
    ta.addEventListener("select", aware);
    ta.addEventListener("keyup", function () { updateCursorStatus(ed); });
    ta.addEventListener("click", function () { updateCursorStatus(ed); });

    // Status bar.
    var bar = el("div", "rm-ed-status");
    var save = el("span", "rm-ed-save");
    save.id = "rm-ed-save";
    bar.appendChild(save);
    var path = el("span", "rm-ed-path", meta.path);
    bar.appendChild(path);
    var cursor = el("span", "rm-ed-cursor");
    cursor.id = "rm-ed-cursor";
    bar.appendChild(cursor);
    var vers = el("button", "btn ghost sm", "Versions");
    vers.setAttribute("aria-label", "Version history for " + meta.path);
    vers.onclick = function () { sendMsg({ type: "VERSION_LIST", fileId: fid }); };
    bar.appendChild(vers);
    wrap.appendChild(bar);
    paintSaveState(fid);
    updateCursorStatus(ed);
  }

  function updateCursorStatus(ed) {
    var c = document.getElementById("rm-ed-cursor");
    if (!c) return;
    if (!ed || !ed.ta) { c.textContent = ""; return; }
    try {
      var pos = ed.ta.selectionStart || 0;
      var lc = UI.indexToLineCol ? UI.indexToLineCol(ed.ta.value, pos) : { line: 1, col: 1 };
      c.textContent = "Ln " + lc.line + ", Col " + lc.col;
    } catch (e) { c.textContent = ""; }
  }

  function paintSaveState(fileId) {
    var save = document.getElementById("rm-ed-save");
    if (!save || S.activeFileId !== fileId) return;
    var st = S.saveState[fileId] || "saved";
    save.className = "rm-ed-save " + st;
    if (st === "saved") {
      save.textContent = "🟢 Saved";
    } else if (st === "saving") {
      save.textContent = "🟡 Saving…";
    } else {
      save.textContent = "";
      save.appendChild(el("span", null, "🔴 Save failed "));
      var retry = el("button", "btn ghost sm", "Retry save");
      retry.onclick = function () {
        setSaveState(fileId, "saving");
        sendMsg({ type: "FILE_SNAPSHOT_REQ", fileId: fileId });
      };
      save.appendChild(retry);
    }
    save.setAttribute("role", "status");
  }

  function setSaveState(fileId, st) {
    S.saveState[fileId] = st;
    paintSaveState(fileId);
  }

  /* ----- awareness (cursor presence) ----- */

  function sendAwareness(ed) {
    if (!S.joined || ed.disposed || !ed.ta) return;
    var now = Date.now();
    if (now - ed.lastAwareSent < 250) return; // ~4/s max
    ed.lastAwareSent = now;
    var ta = ed.ta;
    var idx = 0;
    try { idx = ta.selectionStart || 0; } catch (e) {}
    var lc = UI.indexToLineCol ? UI.indexToLineCol(ta.value, idx) : { line: 1, col: 1 };
    var sel = null;
    try {
      if (ta.selectionStart !== ta.selectionEnd) sel = { anchor: ta.selectionStart, head: ta.selectionEnd };
    } catch (e) {}
    sendMsg({
      type: "AWARENESS_UPDATE",
      fileId: ed.fileId,
      cursor: { index: idx, line: lc.line, col: lc.col },
      selection: sel,
      color: S.myColor || "#CC8066",
    });
  }

  function onAwareness(msg) {
    if (!msg.fileId || !msg.memberId || msg.memberId === S.memberId) return;
    if (!S.awareness[msg.fileId]) S.awareness[msg.fileId] = {};
    S.awareness[msg.fileId][msg.memberId] = {
      name: msg.displayName || "Someone",
      color: msg.color || "#888",
      cursor: msg.cursor,
      ts: Date.now(),
    };
    if (S.activeFileId === msg.fileId) paintPresenceChips();
  }

  function paintPresenceChips() {
    var chips = document.getElementById("rm-ed-presence");
    if (!chips || !S.activeFileId) return;
    chips.innerHTML = "";
    var now = Date.now();
    var map = S.awareness[S.activeFileId] || {};
    var any = false;
    Object.keys(map).forEach(function (mid) {
      var a = map[mid];
      if (now - a.ts > 10_000) { delete map[mid]; return; } // stale
      any = true;
      var chip = el("span", "rm-presence-chip");
      var dot = el("span", "rm-presence-dot");
      dot.style.background = a.color;
      dot.setAttribute("aria-hidden", "true");
      chip.appendChild(dot);
      var label = (a.name || "Someone") + (a.cursor ? " · Ln " + a.cursor.line + ", Col " + a.cursor.col : "");
      chip.appendChild(el("span", null, label));
      chip.title = label;
      chips.appendChild(chip);
    });
    if (!any) {
      chips.appendChild(el("span", "rm-presence-none", "Only you are viewing this file."));
    }
  }

  /* ----- versions ----- */

  function renderVersionsModal(fileId) {
    closeModal();
    var meta = fileById(fileId);
    var list = S.versions[fileId] || [];
    var shell = openDialogShell("Version history" + (meta ? " — " + meta.path : ""));
    var modal = shell.modal;
    if (!list.length) {
      modal.appendChild(el("p", "muted", "No versions saved yet. Versions are recorded automatically as you edit."));
    } else {
      var ul = el("div", "rm-versions");
      // Newest first.
      list.slice().reverse().forEach(function (v) {
        var row = el("div", "rm-version");
        var info = el("button", "rm-version-info");
        var when = UI.timeAgo ? UI.timeAgo(v.ts, Date.now()) : new Date(v.ts).toLocaleString();
        info.appendChild(el("div", "rm-version-when", when));
        info.appendChild(el("div", "rm-version-who", "by " + (v.authorName || "someone")));
        info.setAttribute("aria-label", "Preview version from " + when);
        info.onclick = function () { sendMsg({ type: "VERSION_TEXT", fileId: fileId, ts: v.ts }); };
        row.appendChild(info);
        if (isOwner()) {
          var restore = el("button", "btn sm", "Restore");
          restore.setAttribute("aria-label", "Restore version from " + when);
          restore.onclick = function (ev) {
            ev.stopPropagation();
            openConfirmDialog({
              title: "Restore this version?",
              body: "This applies the old version as a new edit — everyone in the room will receive it. The current content becomes a new version too.",
              okText: "Restore",
              onOk: function () { sendMsg({ type: "VERSION_RESTORE", fileId: fileId, ts: v.ts }); },
            });
          };
          row.appendChild(restore);
        }
        ul.appendChild(row);
      });
      modal.appendChild(ul);
    }
    var done = el("button", "btn primary", "Close");
    done.onclick = closeModal;
    modal.appendChild(done);
    setTimeout(function () { try { done.focus(); } catch (e) {} }, 50);
  }

  function renderVersionPreview(fileId, ts, text) {
    var shell = openDialogShell("Version preview");
    var modal = shell.modal;
    var meta = fileById(fileId);
    modal.appendChild(el("p", "muted small", (meta ? meta.path + " · " : "") + new Date(ts).toLocaleString()));
    var ta = el("textarea", "rm-version-preview");
    ta.value = text;
    ta.readOnly = true;
    ta.setAttribute("aria-label", "Read-only version preview");
    modal.appendChild(ta);
    var row = el("div", "rm-row");
    if (isOwner()) {
      var restore = el("button", "btn primary", "Restore this version");
      restore.onclick = function () {
        closeModal();
        openConfirmDialog({
          title: "Restore this version?",
          body: "This applies the old version as a new edit — everyone in the room will receive it.",
          okText: "Restore",
          onOk: function () { sendMsg({ type: "VERSION_RESTORE", fileId: fileId, ts: ts }); },
        });
      };
      row.appendChild(restore);
    }
    var back = el("button", "btn ghost", "Back");
    back.onclick = function () { renderVersionsModal(fileId); };
    row.appendChild(back);
    modal.appendChild(row);
  }

  /* ----- room admin (owner) ----- */

  function paintRoomAdmin() {
    var admin = document.getElementById("rm-admin");
    if (!admin) return;
    admin.innerHTML = "";
    if (!isOwner()) return;
    var rename = el("button", "btn ghost sm", "Rename room");
    rename.onclick = function () {
      openPromptDialog({
        title: "Rename room",
        label: "Room name",
        value: S.roomName,
        placeholder: "Room name",
        okText: "Rename",
        onOk: function (v) {
          var name = v.trim();
          if (name) sendMsg({ type: "ROOM_RENAME", name: name });
        },
      });
    };
    var del = el("button", "btn ghost sm rm-danger", "Delete room");
    del.onclick = function () {
      openConfirmDialog({
        title: "Delete room?",
        body: "Delete \"" + S.roomName + "\" for everyone? Files, chat history, and versions will be removed from the server.",
        okText: "Delete room",
        danger: true,
        onOk: function () { sendMsg({ type: "ROOM_DELETE" }); },
      });
    };
    admin.appendChild(rename);
    admin.appendChild(del);
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
