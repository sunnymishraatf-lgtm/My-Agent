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

  /** Phase 4: Ask-AI panel state (per room session, not persisted). */
  function freshAiState() {
    return {
      mode: "file", // context: file|snippet|list
      q: "",
      busy: false,
      stripped: "", // last answer with edit blocks removed (rendered as markdown)
      cards: [], // [{path, content, state: "pending"|"applied"|"rejected"|"unknown"}]
      err: "",
    };
  }

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
      presenceTimer: null,
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
      /* Phase 4: AI + activity */
      sidetab: "chat", // side column tab: chat|ai|activity|members
      activity: [], // CollabActivity[] (server broadcast, last 50)
      ai: freshAiState(),
      editorWaiters: {}, // fileId -> [cb] waiting for the Y.Doc binding
      /* Phase 3: voice calls */
      iceServers: [], // server-advertised STUN/TURN (from JOINED)
      voice: {
        want: false, // user asked to be in the call (survives socket reconnects)
        active: false, // server currently has us in the voice set
        joining: false, // getUserMedia() in flight
        muted: false,
        mic: null, // local MediaStream — requested ONLY at join time
        members: [], // VoiceMemberPublic[] from the server
        peers: {}, // memberId -> {pc, ui, stream, analyser, buf, speaking, holdUntil}
        audioCtx: null, // shared AudioContext for speaking detection (analysis only)
        speakTimer: null,
        err: "", // join error text shown in the strip
      },
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
    leaveVoice(true);
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
    flushEditorWaiters(fileId, null);
    try { ed.doc.destroy(); } catch (e) {}
    if (ed.awareTimer) { clearInterval(ed.awareTimer); ed.awareTimer = null; }
  }

  function stopTimers() {
    if (S.reconnectTimer) { clearTimeout(S.reconnectTimer); S.reconnectTimer = null; }
    if (S.heartbeatTimer) { clearInterval(S.heartbeatTimer); S.heartbeatTimer = null; }
    if (S.presenceTimer) { clearInterval(S.presenceTimer); S.presenceTimer = null; }
    if (S.typingTimer) { clearTimeout(S.typingTimer); S.typingTimer = null; }
  }

  function closeSocket() {
    stopTimers();
    disposeAllEditors();
    dropVoicePeers(); // keep the mic: a reconnect rejoins the call seamlessly
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

  /**
   * Ask the server for room file context. The server reads the text from its
   * own file store and only returns files in this room, for members — the
   * client never invents paths or trusts its own copy. Resolves with the
   * AI_CONTEXT message ({ ok, path, text, truncated, files, code }).
   */
  function requestAiContext(req) {
    return new Promise(function (resolve) {
      var requestId = "r" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      var waiters = S.aiCtxWaiters || (S.aiCtxWaiters = {});
      var timer = setTimeout(function () {
        if (waiters[requestId]) {
          delete waiters[requestId];
          resolve({ ok: false, code: "TIMEOUT" });
        }
      }, 10000);
      waiters[requestId] = { resolve: resolve, timer: timer };
      var m = { type: "AI_CONTEXT_REQUEST", requestId: requestId, mode: req.mode };
      if (req.fileId) m.fileId = req.fileId;
      if (typeof req.selStart === "number") m.selStart = req.selStart;
      if (typeof req.selEnd === "number") m.selEnd = req.selEnd;
      if (!sendMsg(m)) {
        delete waiters[requestId];
        clearTimeout(timer);
        resolve({ ok: false, code: "NOT_CONNECTED" });
      }
    });
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
    // Voice peer connections are bound to this socket's signaling session.
    // The mic stays open so a reconnect can rejoin the call seamlessly.
    dropVoicePeers();
    S.voice.active = false;
    paintVoice();
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
        S.activity = Array.isArray(msg.activity) ? msg.activity.slice(-50) : [];
        S.files = Array.isArray(msg.files) ? msg.files : [];
        S.iceServers = Array.isArray(msg.ice) ? msg.ice : [];
        onVoiceMembers(msg.voice, true);
        setConn("connected");
        startHeartbeat();
        paintMembers();
        paintChat(true);
        paintActivity();
        paintFiles();
        paintRoomAdmin();
        paintVoice();
        // Rejoin an in-progress voice call after a socket reconnect. The mic
        // stays open across reconnects; ordered delivery means the server
        // adds us to the voice set before applying our restored mute state.
        if (S.voice.want && S.voice.mic && !S.voice.active) {
          sendMsg({ type: "VOICE_JOIN" });
          sendMsg({ type: "VOICE_STATE", muted: S.voice.muted });
        }
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
      case "CHAT_DELETED":
        if (typeof msg.id === "string" && msg.id) {
          S.chat = S.chat.filter(function (x) { return x.id !== msg.id; });
          removeChatMsgEl(msg.id);
        }
        break;
      case "CHAT_TYPING":
        if (msg.memberId && msg.memberId !== S.memberId) {
          if (msg.typing) S.typing[msg.memberId] = msg.displayName || "Someone";
          else delete S.typing[msg.memberId];
          paintTyping();
        }
        break;
      case "ACTIVITY":
        onActivity(msg);
        break;
      case "AI_CONTEXT": {
        var waiter = S.aiCtxWaiters && S.aiCtxWaiters[msg.requestId];
        if (waiter) {
          delete S.aiCtxWaiters[msg.requestId];
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
        }
        break;
      }
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
      case "VOICE_MEMBERS":
        onVoiceMembers(msg.members, false);
        break;
      case "WEBRTC_OFFER":
        onVoiceOffer(msg);
        break;
      case "WEBRTC_ANSWER":
        onVoiceAnswer(msg);
        break;
      case "WEBRTC_ICE":
        onVoiceIce(msg);
        break;
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
    } else if (code === "VOICE_FULL") {
      showError("Voice is full in this room (6 max). Try again later.");
      abortVoiceJoin();
    } else if (code === "FILE_TOO_LARGE" && msg.fileId) {
      /* The server refused the open handshake: tear down the optimistic
         editor tab instead of leaving a dead tab behind. */
      var fid = msg.fileId;
      S.openFileIds = S.openFileIds.filter(function (id) { return id !== fid; });
      disposeEditor(fid);
      if (S.activeFileId === fid) {
        S.activeFileId = S.openFileIds.length ? S.openFileIds[S.openFileIds.length - 1] : null;
      }
      paintEdTabs();
      paintEditor();
      showError(msg.message || "That file is too large for shared editing.");
      if (typeof announce === "function") announce("File too large to open.");
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
    // Sweep stale presence chips every 5s: paintPresenceChips otherwise only
    // runs on incoming awareness, so a departed member's chip could linger
    // until the next message arrived. Cheap: one small DOM repaint.
    if (S.presenceTimer) clearInterval(S.presenceTimer);
    S.presenceTimer = setInterval(function () {
      if (!S.joined) return;
      if (document.getElementById("rm-ed-presence")) paintPresenceChips();
    }, 5000);
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
    if (m.id) wrap.setAttribute("data-mid", m.id);
    var head = el("div", "rm-msg-head");
    head.appendChild(el("span", "rm-msg-name", m.displayName || "Someone"));
    var ts = m.ts && UI.fmtTime ? UI.fmtTime(m.ts) : "";
    if (ts) head.appendChild(el("span", "rm-msg-time", ts));
    /* Authors can delete their own messages; the owner can moderate any. */
    if (m.id && (m.memberId === S.memberId || isOwner())) {
      var del = el("button", "rm-msg-del", "×");
      del.setAttribute("aria-label", "Delete message");
      del.title = "Delete message";
      del.onclick = function () {
        openConfirmDialog({
          title: "Delete this message?",
          body: "It will be removed for everyone in the room.",
          okText: "Delete",
          danger: true,
          onOk: function () { sendMsg({ type: "CHAT_DELETE", id: m.id }); },
        });
      };
      head.appendChild(del);
    }
    wrap.appendChild(head);
    wrap.appendChild(el("div", "rm-msg-text", m.text || ""));
    return wrap;
  }

  /** Remove a deleted message's DOM node (id-matched; never trust selectors). */
  function removeChatMsgEl(id) {
    var log = document.getElementById("rm-chat-log");
    if (!log || !id) return;
    var kids = log.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].getAttribute("data-mid") === id) {
        log.removeChild(kids[i]);
        break;
      }
    }
    if (!log.children.length) {
      log.appendChild(el("div", "rm-empty", "No messages yet. Say hello!"));
    }
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

  /* ---------- activity feed (Phase 4) ---------- */

  function onActivity(msg) {
    if (!msg || !msg.event || typeof msg.event.kind !== "string") return;
    S.activity.push(msg.event);
    if (S.activity.length > 50) S.activity.splice(0, S.activity.length - 50);
    paintActivity();
  }

  function activityIcon(kind) {
    return kind === "member_join" ? "👋"
      : kind === "member_leave" ? "🚪"
      : kind === "file_create" ? "📄"
      : kind === "file_rename" ? "✏️"
      : kind === "file_delete" ? "🗑️"
      : kind === "file_edit" ? "📝"
      : kind === "version_restore" ? "🕘"
      : kind === "voice_start" ? "🎙️"
      : kind === "voice_end" ? "🔇"
      : kind === "ai_apply" ? "🤖" : "•";
  }

  function activityText(ev) {
    var who = ev.byName || "Someone";
    var p = ev.path || "";
    switch (ev.kind) {
      case "member_join": return who + " joined the room";
      case "member_leave": return who + " left the room";
      case "file_create": return who + " created " + p;
      case "file_rename": return who + " renamed " + (ev.extra ? ev.extra + " → " : "") + p;
      case "file_delete": return who + " deleted " + p;
      case "file_edit": return who + " edited " + p;
      case "version_restore": return who + " restored a version of " + p;
      case "voice_start": return who + " started a voice call";
      case "voice_end": return "Voice call ended";
      case "ai_apply": return who + " applied an AI change to " + p;
      default: return who + " — " + ev.kind;
    }
  }

  function buildActivityPanel() {
    var panel = el("aside", "rm-activity-panel");
    panel.setAttribute("aria-label", "Room activity");
    panel.appendChild(el("h3", null, "Activity"));
    var list = el("div", "rm-activity-list");
    list.id = "rm-activity-list";
    list.setAttribute("role", "log");
    list.setAttribute("aria-label", "Room activity feed");
    panel.appendChild(list);
    return panel;
  }

  function paintActivity() {
    var list = document.getElementById("rm-activity-list");
    if (!list) return;
    list.innerHTML = "";
    if (!S.activity.length) {
      list.appendChild(el("div", "rm-empty", "No activity yet."));
      return;
    }
    S.activity.slice().reverse().forEach(function (ev) {
      var row = el("div", "rm-activity-row");
      var icon = el("span", "rm-activity-icon", activityIcon(ev.kind));
      icon.setAttribute("aria-hidden", "true");
      row.appendChild(icon);
      var body = el("div", "rm-activity-body");
      body.appendChild(el("div", "rm-activity-text", activityText(ev)));
      if (ev.ts && UI.timeAgo) body.appendChild(el("div", "rm-activity-time", UI.timeAgo(ev.ts, Date.now())));
      row.appendChild(body);
      list.appendChild(row);
    });
  }

  /* ---------- Ask AI (Phase 4) ---------- */

  var AI_QUICK = [
    ["Explain code", "Explain what this code does, section by section, in plain language."],
    ["Find bug", "Find bugs in this code. For each bug, quote the line or expression involved, explain why it is wrong, and propose a fix."],
    ["Refactor", "Refactor this code for clarity and maintainability without changing its behavior. Explain each change briefly."],
    ["Generate tests", "Generate unit tests for this code, covering the main cases and edge cases."],
    ["Write docs", "Write concise documentation for this code: purpose, inputs/outputs, and any non-obvious behavior."],
  ];

  var AI_SYSTEM =
    "You are NEUTRON, an AI pair programmer inside a shared real-time collaboration room. " +
    "Answer concisely and use markdown. " +
    "If you want to propose changing a shared file, output the COMPLETE new file content in a fenced block like this:\n" +
    "```neutron-room-edit\npath: relative/path/from/the/context\n<full new file content>\n```\n" +
    "Rules: propose edits only for files listed in the context; one block per file; " +
    "never invent file paths; put explanations outside the fenced blocks.";

  var AI_CTX_LABELS = { file: "Current file", snippet: "Selected text", list: "File list" };

  function buildAiPanel() {
    var panel = el("section", "rm-ai-panel");
    panel.setAttribute("aria-label", "Ask AI");
    panel.appendChild(el("h3", null, "Ask AI"));
    panel.appendChild(el("p", "muted small",
      "Uses your Settings API key and model (your key, your provider). Only this room's files are sent as context."));

    var ctxRow = el("div", "rm-ai-ctx");
    ctxRow.id = "rm-ai-ctx";
    ctxRow.setAttribute("role", "group");
    ctxRow.setAttribute("aria-label", "AI context");
    Object.keys(AI_CTX_LABELS).forEach(function (mode) {
      var b = el("button", "btn ghost sm", AI_CTX_LABELS[mode]);
      b.setAttribute("data-mode", mode);
      b.setAttribute("aria-pressed", "false");
      b.onclick = function () { S.ai.mode = mode; paintAi(); };
      ctxRow.appendChild(b);
    });
    panel.appendChild(ctxRow);

    var quick = el("div", "rm-ai-quick");
    quick.setAttribute("aria-label", "Quick actions");
    AI_QUICK.forEach(function (pair) {
      var b = el("button", "btn ghost sm", pair[0]);
      b.onclick = function () {
        S.ai.q = pair[1];
        var q = document.getElementById("rm-ai-q");
        if (q) { q.value = S.ai.q; q.focus(); }
        paintAi();
      };
      quick.appendChild(b);
    });
    panel.appendChild(quick);

    var q = el("textarea", "input rm-ai-q");
    q.id = "rm-ai-q";
    q.rows = 3;
    q.placeholder = "Ask about the room's code…";
    q.setAttribute("aria-label", "Ask the AI about this room");
    q.addEventListener("input", function () { S.ai.q = q.value; });
    panel.appendChild(q);

    var ask = el("button", "btn primary sm", "Ask AI");
    ask.id = "rm-ai-ask";
    ask.onclick = askAi;
    panel.appendChild(ask);

    var err = el("div", "rm-ai-err hidden");
    err.id = "rm-ai-err";
    err.setAttribute("role", "alert");
    panel.appendChild(err);

    var res = el("div", "rm-ai-result");
    res.id = "rm-ai-result";
    res.setAttribute("aria-live", "polite");
    res.setAttribute("aria-label", "AI answer");
    panel.appendChild(res);
    return panel;
  }

  function paintAi() {
    var st = S.ai;
    var ask = document.getElementById("rm-ai-ask");
    if (ask) {
      ask.disabled = st.busy || !S.joined;
      ask.textContent = st.busy ? "Asking…" : "Ask AI";
    }
    var q = document.getElementById("rm-ai-q");
    if (q && document.activeElement !== q && q.value !== st.q) q.value = st.q;
    var ctxBtns = document.querySelectorAll("#rm-ai-ctx [data-mode]");
    for (var i = 0; i < ctxBtns.length; i++) {
      var on = ctxBtns[i].getAttribute("data-mode") === st.mode;
      ctxBtns[i].classList.toggle("on", on);
      ctxBtns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var err = document.getElementById("rm-ai-err");
    if (err) {
      err.textContent = st.err || "";
      err.classList.toggle("hidden", !st.err);
    }
    var res = document.getElementById("rm-ai-result");
    if (!res) return;
    res.innerHTML = "";
    if (st.busy && !st.stripped && !st.cards.length) {
      res.appendChild(el("div", "rm-ai-busy", "Thinking…"));
      return;
    }
    if (st.stripped) {
      var div = el("div", "rm-ai-answer");
      // renderMarkdown escapes all HTML first — safe for innerHTML.
      div.innerHTML = UI.renderMarkdown ? UI.renderMarkdown(st.stripped) : "";
      res.appendChild(div);
    }
    st.cards.forEach(function (card) { res.appendChild(aiCardEl(card)); });
    if (!st.stripped && !st.cards.length && !st.err) {
      res.appendChild(el("div", "rm-empty", "Ask about the room's code. If the AI proposes file changes, they appear here for your review — nothing is applied silently."));
    }
  }

  /** Review card for one AI-proposed file change (approval gate). */
  function aiCardEl(card) {
    var meta = null;
    for (var i = 0; i < S.files.length; i++) {
      if (S.files[i].path === card.path) { meta = S.files[i]; break; }
    }
    var wrap = el("div", "rm-ai-card");
    var head = el("div", "rm-ai-card-head");
    head.appendChild(el("span", "rm-ai-card-path", "📄 " + card.path));
    if (meta && S.editors[meta.id]) {
      var stats = UI.diffLineStats ? UI.diffLineStats(S.editors[meta.id].ytext.toString(), card.content) : null;
      if (stats) head.appendChild(el("span", "rm-ai-card-stats", "+" + stats.added + " −" + stats.removed));
    } else if (!meta) {
      head.appendChild(el("span", "rm-ai-card-warn", "unknown file — cannot apply"));
    }
    wrap.appendChild(head);

    var actions = el("div", "rm-ai-card-actions");
    if (card.state === "applied") {
      actions.appendChild(el("span", "rm-ai-card-done", "Applied ✓ — collaborators received it via the shared document."));
    } else if (card.state === "rejected") {
      actions.appendChild(el("span", "muted small", "Rejected — nothing changed."));
    } else if (!meta) {
      actions.appendChild(el("span", "muted small", "The AI proposed a file that isn't in this room. Nothing was applied."));
    } else {
      var review = el("button", "btn sm", card.showDiff ? "Hide changes" : "Review changes");
      review.onclick = function () {
        if (card.showDiff) { card.showDiff = false; paintAi(); return; }
        withEditorForFile(meta.id, function (ed) {
          if (!ed) { toast("Couldn't open the file for preview."); return; }
          card.showDiff = true;
          paintAi();
        });
      };
      var apply = el("button", "btn primary sm", "Apply");
      apply.setAttribute("aria-label", "Apply AI change to " + card.path);
      apply.onclick = function () { applyAiCard(card, meta); };
      var reject = el("button", "btn ghost sm", "Reject");
      reject.onclick = function () { card.state = "rejected"; paintAi(); };
      actions.appendChild(review);
      actions.appendChild(apply);
      actions.appendChild(reject);
    }
    wrap.appendChild(actions);

    if (card.showDiff && meta && card.state === "pending") {
      var ed = S.editors[meta.id];
      if (ed && UI.diffLineBlocks && window.NeutronDiff) {
        var rows = UI.diffLineBlocks(ed.ytext.toString(), card.content);
        var holder = el("div", "rm-ai-diff");
        window.NeutronDiff.renderRows(holder, rows, {
          maxLines: 400,
          ariaLabel: "Proposed changes to " + card.path,
          classes: { add: "rm-ai-diff-add", del: "rm-ai-diff-del", ctx: "rm-ai-diff-ctx", note: "rm-ai-diff-ctx" },
        });
        wrap.appendChild(holder);
      }
    }
    return wrap;
  }

  /**
   * Apply an approved AI change through the Yjs document as a normal local
   * edit: onDocUpdate broadcasts it as a YJS_SYNC update and every
   * collaborator merges it via CRDT — never a silent overwrite.
   */
  function applyAiCard(card, meta) {
    withEditorForFile(meta.id, function (ed) {
      if (!ed || ed.disposed) {
        showError("The editor isn't ready. Reopen the file and try again.");
        return;
      }
      var oldText = ed.ytext.toString();
      var ops = UI.diffTextToOps ? UI.diffTextToOps(oldText, card.content) : [];
      if (!ops.length) {
        card.state = "applied";
        paintAi();
        toast("No changes to apply — the file already matches.");
        return;
      }
      try {
        ed.doc.transact(function () { applyOpsToYText(ed.ytext, ops); }, "ai-apply");
      } catch (e) {
        showError("Couldn't apply the change. Reopen the file and try again.");
        return;
      }
      card.state = "applied";
      card.showDiff = false;
      // Tell the server so the room's activity feed records it.
      sendMsg({ type: "AI_APPLY", fileId: meta.id });
      paintAi();
      if (typeof announce === "function") announce("AI change applied to " + card.path);
    });
  }

  /** Run cb with the Y.Doc editor for a file, opening the tab first if needed. */
  function withEditorForFile(fileId, cb) {
    var ed = S.editors[fileId];
    // Only run against a synced document: a freshly created editor is empty
    // until the Yjs step2 handshake completes. Unsynced editors queue the
    // callback; it fires after step2 marks the editor synced.
    if (ed && !ed.disposed && ed.synced) { cb(ed); return; }
    var list = S.editorWaiters[fileId] || (S.editorWaiters[fileId] = []);
    list.push(cb);
    if (!ed || ed.disposed) openFileTab(fileId, true);
  }

  function flushEditorWaiters(fileId, ed) {
    var list = S.editorWaiters[fileId];
    if (!list) return;
    delete S.editorWaiters[fileId];
    list.forEach(function (cb) { try { cb(ed); } catch (e) {} });
  }

  async function askAi() {
    var st = S.ai;
    if (st.busy) return;
    if (!S.joined) { showError("Not connected yet — wait for the green dot."); return; }
    var question = (st.q || "").trim();
    if (!question) { showError("Type a question for the AI first."); return; }
    var key = (typeof storedApiKey === "function") ? storedApiKey() : "";
    var prov = (typeof storedProvider === "function") ? storedProvider() : "";
    if (!key || !prov) {
      st.err = "Ask AI needs your API key and provider — set them in Settings first. Your key never leaves this browser except to your own provider.";
      paintAi();
      return;
    }
    var ed = S.activeFileId ? S.editors[S.activeFileId] : null;
    var selStart = -1, selEnd = -1;
    if (st.mode === "snippet") {
      if (ed && ed.ta) {
        try {
          selStart = ed.ta.selectionStart || 0;
          selEnd = ed.ta.selectionEnd || 0;
        } catch (e) {}
      }
      if (!(selEnd > selStart)) {
        st.err = "Select some text in the editor first, or switch the context to “Current file”.";
        paintAi();
        return;
      }
    } else if (st.mode === "file" && !S.activeFileId) {
      st.err = "Open a file first, or switch the context to “File list”.";
      paintAi();
      return;
    }
    st.busy = true;
    st.err = "";
    st.stripped = "";
    st.cards = [];
    paintAi();
    // Server-authorized context: the server reads the room file from its own
    // store and only returns content for files in THIS room, for members.
    // Selection indices go to the server; the client never extracts text
    // itself and never invents paths.
    var ctxReq = { mode: st.mode };
    if (st.mode === "file" || st.mode === "snippet") ctxReq.fileId = S.activeFileId;
    if (st.mode === "snippet") { ctxReq.selStart = selStart; ctxReq.selEnd = selEnd; }
    var ctxRes = await requestAiContext(ctxReq);
    if (!ctxRes || !ctxRes.ok) {
      st.busy = false;
      st.err = ctxRes && ctxRes.code === "FILE_NOT_FOUND"
        ? "That file is no longer in the room — pick another from the file list."
        : "Couldn't get room context from the server (" + ((ctxRes && ctxRes.code) || "unknown") + "). Rejoin the room and try again.";
      paintAi();
      return;
    }
    var ctxText;
    if (ctxRes.files) {
      ctxText = "Files in this room:\n" + ctxRes.files.map(function (f) { return "- " + f.path; }).join("\n");
    } else if (st.mode === "snippet") {
      ctxText = "Selected code from " + (ctxRes.path || "the file") + ":\n```\n" + (ctxRes.text || "") + "\n```";
    } else {
      ctxText = "File " + (ctxRes.path || "") + ":\n```\n" + (ctxRes.text || "") + "\n```";
    }
    if (ctxRes.truncated) ctxText += "\n(Context truncated to fit.)";
    var body = {
      messages: [
        { role: "system", content: AI_SYSTEM },
        {
          role: "user",
          content: "Context from the shared room:\n\n" + ctxText +
            "\n\nQuestion: " + question,
        },
      ],
    };
    var cm = (typeof storedModel === "function") ? storedModel() : "";
    if (cm) body.model = cm;
    try {
      var res = await api("POST", "/api/chat", body);
      var parsed = UI.parseRoomEditBlocks ? UI.parseRoomEditBlocks(res.text || "") : { blocks: [], stripped: res.text || "" };
      st.stripped = parsed.stripped;
      st.cards = parsed.blocks.map(function (b) {
        return { path: b.path, content: b.content, state: "pending", showDiff: false };
      });
      if (typeof announce === "function") {
        announce("AI answered" + (st.cards.length ? " with " + st.cards.length + " file change proposal" + (st.cards.length === 1 ? "" : "s") + " to review." : "."));
      }
    } catch (e) {
      st.err = (e && e.message) || "The AI request failed.";
    }
    st.busy = false;
    paintAi();
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
    leaveVoice(true);
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
    back.onclick = function () { leaveVoice(true); closeSocket(); S = freshState(); render(); };
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

    /* Mobile main tabs: Files | Editor | Chat | Members | Voice. */
    var mtabs = el("div", "rm-tabs rm-maintabs");
    mtabs.setAttribute("role", "tablist");
    mtabs.setAttribute("aria-label", "Room panels");
    var mtabBtns = {};
    ["files", "editor", "chat", "members", "voice"].forEach(function (name) {
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
      // Mobile: the "members" tab pins the side column to members; the "chat"
      // tab shows chat/AI/activity with the sub-tab bar.
      if (name === "members") setSideTab("members");
      else if (name === "chat" && S.sidetab === "members") setSideTab("chat");
    }

    var body = el("div", "rm-body");
    body.id = "rm-body";
    body.dataset.mtab = S.mtab;

    /* Voice strip: spans all columns on desktop; the voice "panel" on mobile. */
    var vstrip = el("div", "rm-voice-strip");
    vstrip.id = "rm-voice-strip";
    vstrip.setAttribute("aria-label", "Voice call");
    body.appendChild(vstrip);

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

    /* Side column: chat / AI / activity / members with their own sub-tabs. */
    var side = el("div", "rm-side panel");
    side.id = "rm-side";
    var subtabs = el("div", "rm-tabs rm-subtabs");
    subtabs.setAttribute("role", "tablist");
    subtabs.setAttribute("aria-label", "Side panels");
    var sideTabs = {};
    [["chat", "Chat"], ["ai", "AI"], ["activity", "Activity"], ["members", "Members"]].forEach(function (pair) {
      (function (name, label) {
        var b = el("button", "rm-tab", label);
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", "false");
        b.onclick = function () { setSideTab(name); };
        sideTabs[name] = b;
        subtabs.appendChild(b);
      })(pair[0], pair[1]);
    });
    side.appendChild(subtabs);

    function setSideTab(name) {
      if (["chat", "ai", "activity", "members"].indexOf(name) === -1) name = "chat";
      S.sidetab = name;
      var sideEl = document.getElementById("rm-side");
      if (sideEl) {
        sideEl.classList.toggle("rm-show-ai", name === "ai");
        sideEl.classList.toggle("rm-show-activity", name === "activity");
        sideEl.classList.toggle("rm-show-members", name === "members");
      }
      Object.keys(sideTabs).forEach(function (k) {
        var on = k === name;
        sideTabs[k].classList.toggle("on", on);
        sideTabs[k].setAttribute("aria-selected", on ? "true" : "false");
      });
      if (name === "ai") paintAi();
      if (name === "activity") paintActivity();
    }

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
    side.appendChild(buildAiPanel());
    side.appendChild(buildActivityPanel());
    body.appendChild(side);
    view.appendChild(body);

    setSideTab(S.sidetab || "chat");

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
    paintVoice();
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
        // False until the Yjs step2 handshake applies the server's state;
        // editor waiters (e.g. AI Apply) only run after this flips true.
        synced: false,
        awareTimer: null,
        lastAwareSent: 0,
        composing: false, // IME composition in progress — don't diff or re-render yet
        remotePending: false, // remote update arrived mid-composition; flush on compositionend
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
    // IME composition fires input events for every intermediate keystroke.
    // Diffing those would spam noisy ops and fight the composition; the
    // compositionend handler flushes the final text instead.
    if (ed.composing) return;
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
    if (origin === "local" || origin === "ai-apply") {
      // Keystrokes and approved AI changes both travel as normal Yjs
      // updates — collaborators merge them via CRDT, never as overwrites.
      // (The textarea didn't make the AI edit, so it needs re-rendering.)
      if (origin === "ai-apply") renderRemoteText(ed);
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
    if (!ta) { ed.lastText = text; return; }
    // Never yank the textarea out from under an active IME session —
    // programmatic value changes cancel composition and lose input.
    // Defer until compositionend, keeping lastText at the pre-remote base
    // so the compositionend flush diffs cleanly.
    if (ed.composing) { ed.remotePending = true; return; }
    ed.lastText = text;
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
      // The document now holds the server's state: mark synced and run any
      // waiters (AI Apply) that were queued while the handshake was in flight.
      if (!ed.synced) {
        ed.synced = true;
        flushEditorWaiters(ed.fileId, ed);
      }
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
    // IME (CJK etc.): hold local diffs during composition and never
    // re-render remote text mid-composition — both kill the IME session.
    // On compositionend, apply the composed text first (diffs against the
    // pre-remote base), then flush any deferred remote re-render so the
    // CRDT merge is what the user finally sees.
    ta.addEventListener("compositionstart", function () { ed.composing = true; ed.remotePending = false; });
    ta.addEventListener("compositionend", function () {
      ed.composing = false;
      onLocalInput(ed);
      if (ed.remotePending) { ed.remotePending = false; renderRemoteText(ed); }
    });
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
    // Drop members whose awareness went stale (closed tab, lost network).
    // Without the sweep timer below this only ran on incoming messages,
    // so a departed member's chip could linger indefinitely.
    var map = UI.pruneStalePresence
      ? UI.pruneStalePresence(S.awareness[S.activeFileId], now)
      : (S.awareness[S.activeFileId] || {});
    S.awareness[S.activeFileId] = map;
    var any = false;
    Object.keys(map).forEach(function (mid) {
      var a = map[mid];
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

  /* ---------- voice calls (Phase 3) --------------------------------------
     Mesh WebRTC audio: one RTCPeerConnection per other voice member
     (cap 6). Signaling (offer/answer/ICE) rides the existing server relay;
     VOICE_JOIN/LEAVE/STATE broadcasts carry call membership + mute state.
     Non-trickle ICE: the full candidate set travels inside the SDP, so the
     20/min signaling bucket is never the bottleneck.
     ---------------------------------------------------------------------- */

  var VOICE_ICE_TIMEOUT_MS = 3500;

  /** Server-advertised ICE entries, shape-validated (never trust blindly). */
  function voiceTurnServers() {
    var out = [];
    (S.iceServers || []).forEach(function (s) {
      if (!s || !s.urls) return;
      var urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(function (u) {
        return typeof u === "string" && /^(stun|turn|turns):/i.test(u);
      });
      if (!urls.length) return;
      var entry = { urls: urls };
      if (typeof s.username === "string" && s.username) entry.username = s.username;
      if (typeof s.credential === "string" && s.credential) entry.credential = s.credential;
      out.push(entry);
    });
    return out;
  }

  function voiceIceConfig() {
    var cfg = [{ urls: (UI.DEFAULT_STUN_URLS || []).slice() }];
    voiceTurnServers().forEach(function (s) { cfg.push(s); });
    return cfg;
  }

  function voiceMicErrorText(err) {
    var name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError")
      return "Microphone blocked. Click the lock/tune icon in the address bar, allow the microphone for this site, then try again.";
    if (name === "NotFoundError" || name === "OverconstrainedError")
      return "No microphone found. Connect a microphone and try again.";
    if (name === "NotReadableError")
      return "The microphone is busy in another app. Close that app and try again.";
    return "Couldn't access the microphone (" + (name || "unknown error") + "). Check the browser's site settings and try again.";
  }

  function joinVoice() {
    var v = S.voice;
    if (v.joining || v.want) return;
    if (!S.joined) { showError("Not connected yet — wait for the green dot."); return; }
    if (typeof RTCPeerConnection === "undefined") {
      v.err = "Voice calls aren't supported in this browser. Try a recent Chrome, Edge, Firefox, or Safari.";
      paintVoice();
      return;
    }
    var maxV = UI.MAX_VOICE_PARTICIPANTS || 6;
    if (v.members.length >= maxV) {
      showError("Voice is full in this room (" + maxV + " max). Try again later.");
      return;
    }
    var gUM = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
    if (!gUM) {
      v.err = "Voice calls need microphone support. Try a recent Chrome, Edge, Firefox, or Safari.";
      paintVoice();
      return;
    }
    // Mic permission is requested ONLY here, at join time — never before.
    // The AudioContext is created inside this user gesture so speaking
    // detection can actually run (a suspended context analyzes silence).
    ensureVoiceAudio();
    v.joining = true;
    v.err = "";
    paintVoice();
    if (typeof announce === "function") announce("Requesting microphone access…");
    gUM({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .then(function (stream) {
        if (S.screen !== "workspace" || !S.voice) {
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          return;
        }
        v.mic = stream;
        v.joining = false;
        v.want = true;
        v.muted = false;
        v.err = "";
        stream.getAudioTracks().forEach(function (t) {
          t.onended = function () {
            // Mic unplugged or permission revoked mid-call: leave cleanly.
            showError("Microphone disconnected. You left the voice call.");
            leaveVoice(true);
          };
        });
        sendMsg({ type: "VOICE_JOIN" });
        paintVoice();
        if (typeof announce === "function") announce("Microphone on. Joining voice…");
      })
      .catch(function (err) {
        v.joining = false;
        v.want = false;
        v.err = voiceMicErrorText(err);
        paintVoice();
        showError(v.err);
      });
  }

  /** Give up on a join that the server rejected (e.g. VOICE_FULL). */
  function abortVoiceJoin() {
    var v = S.voice;
    v.joining = false;
    v.want = false;
    v.err = "";
    stopMic();
    dropVoicePeers();
    paintVoice();
  }

  /**
   * Leave the call. silent=true skips the VOICE_LEAVE send (socket already
   * dead or we're tearing down) — the server drops voice membership on
   * socket close anyway.
   */
  function leaveVoice(silent) {
    var v = S.voice;
    var wasIn = v.want || v.active;
    v.want = false;
    v.active = false;
    v.joining = false;
    v.muted = false;
    v.err = "";
    if (!silent && wasIn) sendMsg({ type: "VOICE_LEAVE" });
    dropVoicePeers();
    stopMic();
    paintVoice();
    if (wasIn && typeof announce === "function") announce("You left the voice call.");
  }

  /** Close peer connections + analysers, but keep the mic for reconnects. */
  function dropVoicePeers() {
    var v = S.voice;
    Object.keys(v.peers).forEach(closePeerSilent);
    v.peers = {};
    if (v.speakTimer) { clearInterval(v.speakTimer); v.speakTimer = null; }
    if (v.audioCtx) { try { v.audioCtx.close(); } catch (e) {} v.audioCtx = null; }
  }

  function closePeerSilent(memberId) {
    var v = S.voice;
    var peer = v.peers[memberId];
    if (!peer) return;
    delete v.peers[memberId];
    try { peer.pc.close(); } catch (e) {}
  }

  function closePeer(memberId) {
    closePeerSilent(memberId);
    paintVoice();
  }

  function stopMic() {
    var v = S.voice;
    if (v.mic) {
      try {
        v.mic.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      } catch (e) {}
      v.mic = null; // the OS mic indicator goes off here
    }
  }

  function toggleVoiceMute() {
    var v = S.voice;
    if (!v.active || !v.mic) return;
    v.muted = !v.muted;
    try {
      v.mic.getAudioTracks().forEach(function (t) { t.enabled = !v.muted; });
    } catch (e) {}
    sendMsg({ type: "VOICE_STATE", muted: v.muted });
    paintVoice();
    if (typeof announce === "function") announce(v.muted ? "You are muted." : "You are unmuted.");
  }

  function retryVoicePeer(memberId) {
    closePeerSilent(memberId);
    var v = S.voice;
    if (v.active && v.mic && typeof RTCPeerConnection !== "undefined") createVoicePeer(memberId);
    paintVoice();
  }

  /* ----- membership ----- */

  function voiceDisplayName(memberId) {
    var v = S.voice;
    for (var i = 0; i < v.members.length; i++) {
      if (v.members[i].id === memberId) return v.members[i].displayName || "Someone";
    }
    return "Someone";
  }

  function onVoiceMembers(members, silent) {
    var v = S.voice;
    var next = Array.isArray(members) ? members : [];
    var prev = v.members;
    v.members = next;
    var me = null;
    next.forEach(function (m) { if (m && m.id === S.memberId) me = m; });
    v.active = !!me;
    if (!silent && typeof announce === "function" && UI.diffVoiceMembers) {
      var diff = UI.diffVoiceMembers(prev, next);
      diff.joined.forEach(function (m) {
        if (m.id !== S.memberId) announce((m.displayName || "Someone") + " joined the voice call.");
      });
      diff.left.forEach(function (m) {
        announce((m.displayName || "Someone") + " left the voice call.");
      });
    }
    syncVoicePeers();
    paintVoice();
  }

  /** Rebuild the peer set from the authoritative server member list. */
  function syncVoicePeers() {
    var v = S.voice;
    if (!v.active || !v.mic || typeof RTCPeerConnection === "undefined") return;
    var seen = {};
    v.members.forEach(function (m) {
      if (!m || !m.id || m.id === S.memberId) return;
      seen[m.id] = true;
      if (!v.peers[m.id]) createVoicePeer(m.id);
    });
    Object.keys(v.peers).forEach(function (id) {
      if (!seen[id]) closePeerSilent(id);
    });
  }

  /* ----- peer connections ----- */

  function createVoicePeer(memberId) {
    var v = S.voice;
    if (v.peers[memberId] || !v.mic || typeof RTCPeerConnection === "undefined") return null;
    var pc;
    try {
      pc = new RTCPeerConnection({ iceServers: voiceIceConfig() });
    } catch (e) {
      showError("Couldn't start the voice connection (WebRTC unavailable).");
      return null;
    }
    var peer = {
      pc: pc, ui: "connecting", stream: null,
      analyser: null, buf: null, speaking: false, holdUntil: 0,
    };
    v.peers[memberId] = peer;
    try {
      v.mic.getAudioTracks().forEach(function (t) { pc.addTrack(t, v.mic); });
    } catch (e) {}
    pc.ontrack = function (ev) {
      var stream = ev.streams && ev.streams[0];
      if (stream) attachRemoteStream(memberId, stream);
    };
    pc.onconnectionstatechange = function () {
      var p = S.voice.peers[memberId];
      if (!p) return;
      p.ui = UI.voicePeerUiState ? UI.voicePeerUiState(pc.connectionState) : "connecting";
      paintVoice();
    };
    // Deterministic offerer rule (smaller member id offers): both sides agree,
    // so there is never signaling glare.
    if (UI.shouldInitiateVoiceOffer && UI.shouldInitiateVoiceOffer(S.memberId, memberId)) {
      makeVoiceOffer(memberId);
    }
    return peer;
  }

  function waitIceComplete(pc, timeoutMs) {
    return new Promise(function (resolve) {
      if (!pc || pc.iceGatheringState === "complete") { resolve(); return; }
      var done = false;
      var onCh = function () { if (pc.iceGatheringState === "complete") finish(); };
      var finish = function () {
        if (done) return;
        done = true;
        try { pc.removeEventListener("icegatheringstatechange", onCh); } catch (e) {}
        resolve();
      };
      try { pc.addEventListener("icegatheringstatechange", onCh); } catch (e) {}
      setTimeout(finish, timeoutMs || VOICE_ICE_TIMEOUT_MS);
    });
  }

  function makeVoiceOffer(memberId) {
    var v = S.voice;
    var peer = v.peers[memberId];
    if (!peer || !peer.pc) return;
    var pc = peer.pc;
    peer.ui = "connecting";
    pc.createOffer()
      .then(function (offer) { return pc.setLocalDescription(offer); })
      .then(function () { return waitIceComplete(pc, VOICE_ICE_TIMEOUT_MS); })
      .then(function () {
        // Non-trickle: the full candidate set travels inside the SDP.
        var cur = S.voice.peers[memberId];
        if (!cur || cur.pc !== pc) return; // superseded by a retry
        sendMsg({ type: "WEBRTC_OFFER", to: memberId, payload: { sdp: pc.localDescription } });
      })
      .catch(function () {
        var cur = S.voice.peers[memberId];
        if (cur && cur.pc === pc) { cur.ui = "failed"; paintVoice(); }
      });
  }

  function onVoiceOffer(msg) {
    var v = S.voice;
    if (!v.active || !v.mic || !msg.from || !msg.payload || !msg.payload.sdp) return;
    if (typeof RTCPeerConnection === "undefined" || typeof RTCSessionDescription === "undefined") return;
    // Glare guard: with the deterministic id rule we should never receive an
    // offer from a peer we were supposed to offer to — but ignore it if so.
    if (UI.shouldInitiateVoiceOffer && UI.shouldInitiateVoiceOffer(S.memberId, msg.from)) return;
    var peer = v.peers[msg.from] || createVoicePeer(msg.from);
    if (!peer) return;
    var pc = peer.pc;
    peer.ui = "connecting";
    paintVoice();
    Promise.resolve()
      .then(function () { return pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp)); })
      .then(function () { return pc.createAnswer(); })
      .then(function (answer) { return pc.setLocalDescription(answer); })
      .then(function () { return waitIceComplete(pc, VOICE_ICE_TIMEOUT_MS); })
      .then(function () {
        var cur = S.voice.peers[msg.from];
        if (!cur || cur.pc !== pc) return;
        sendMsg({ type: "WEBRTC_ANSWER", to: msg.from, payload: { sdp: pc.localDescription } });
      })
      .catch(function () {
        var cur = S.voice.peers[msg.from];
        if (cur && cur.pc === pc) { cur.ui = "failed"; paintVoice(); }
      });
  }

  function onVoiceAnswer(msg) {
    var v = S.voice;
    var peer = msg.from && v.peers[msg.from];
    if (!peer || !msg.payload || !msg.payload.sdp) return;
    if (typeof RTCSessionDescription === "undefined") return;
    var pc = peer.pc;
    if (pc.signalingState !== "have-local-offer") return; // stale/duplicate answer
    pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp)).catch(function () {
      peer.ui = "failed";
      paintVoice();
    });
  }

  function onVoiceIce(msg) {
    // We use non-trickle ICE and never send candidates, but accept them for
    // forward compatibility with trickle clients.
    var v = S.voice;
    var peer = msg.from && v.peers[msg.from];
    if (!peer || !msg.payload || !msg.payload.candidate) return;
    if (typeof RTCIceCandidate === "undefined") return;
    try {
      peer.pc.addIceCandidate(new RTCIceCandidate(msg.payload.candidate)).catch(function () {});
    } catch (e) {}
  }

  /* ----- speaking detection (analysis only, nothing leaves the browser) ----- */

  function ensureVoiceAudio() {
    var v = S.voice;
    if (v.audioCtx) return v.audioCtx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      v.audioCtx = new AC();
      if (v.audioCtx.state === "suspended") {
        try {
          var r = v.audioCtx.resume();
          if (r && r.catch) r.catch(function () {});
        } catch (e) {}
      }
    } catch (e) {
      v.audioCtx = null;
    }
    if (v.audioCtx && !v.speakTimer) v.speakTimer = setInterval(pollSpeaking, 160);
    return v.audioCtx;
  }

  function attachRemoteStream(memberId, stream) {
    var v = S.voice;
    var peer = v.peers[memberId];
    if (!peer) return;
    peer.stream = stream;
    var ctx = ensureVoiceAudio();
    if (!ctx) return;
    try {
      var src = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      src.connect(analyser); // analyser only — never to destination (no feedback)
      peer.analyser = analyser;
      peer.buf = new Uint8Array(analyser.fftSize);
    } catch (e) {
      peer.analyser = null;
    }
  }

  function pollSpeaking() {
    var v = S.voice;
    var now = Date.now();
    Object.keys(v.peers).forEach(function (id) {
      var p = v.peers[id];
      var speaking = false;
      if (p.analyser && p.buf) {
        try {
          p.analyser.getByteTimeDomainData(p.buf);
          var sum = 0;
          for (var i = 0; i < p.buf.length; i++) {
            var d = (p.buf[i] - 128) / 128;
            sum += d * d;
          }
          var rms = Math.sqrt(sum / p.buf.length);
          if (UI.isSpeakingRms && UI.isSpeakingRms(rms)) p.holdUntil = now + 600;
          speaking = now < p.holdUntil;
        } catch (e) {
          speaking = false;
        }
      }
      if (speaking !== p.speaking) {
        p.speaking = speaking;
        paintVoiceChip(id);
      }
    });
  }

  /* ----- voice strip UI ----- */

  function voiceDotClass(ui) {
    return ui === "connected" ? "on" : ui === "failed" ? "off" : ui === "idle" ? "idle" : "busy";
  }

  function voiceUiText(ui) {
    return ui === "connected" ? "Connected"
      : ui === "reconnecting" ? "Reconnecting…"
      : ui === "failed" ? "Connection failed — use Retry"
      : ui === "idle" ? "Idle" : "Connecting…";
  }

  function voiceChipEl(m) {
    var v = S.voice;
    var chip = el("span", "rm-voice-chip");
    chip.setAttribute("data-vpeer", m.id);
    var isSelf = m.id === S.memberId;
    var peer = !isSelf ? v.peers[m.id] : null;
    if (peer && peer.speaking) chip.classList.add("speaking");
    var dot = el("span", "rm-dot " + (isSelf ? "on" : voiceDotClass(peer ? peer.ui : "connecting")));
    dot.setAttribute("aria-hidden", "true");
    chip.appendChild(dot);
    chip.appendChild(el("span", "rm-voice-name", (m.displayName || "Someone") + (isSelf ? " (you)" : "")));
    if (m.muted) {
      var mu = el("span", "rm-voice-muted", "🔇");
      mu.title = "Muted";
      mu.setAttribute("aria-label", "muted");
      chip.appendChild(mu);
    }
    if (peer) {
      chip.title = voiceDisplayName(m.id) + " — " + voiceUiText(peer.ui);
      if (peer.ui === "failed") {
        var rb = el("button", "btn ghost sm", "Retry");
        rb.setAttribute("aria-label", "Retry voice connection to " + voiceDisplayName(m.id));
        rb.onclick = function (ev) { ev.stopPropagation(); retryVoicePeer(m.id); };
        chip.appendChild(rb);
      }
    }
    return chip;
  }

  function paintVoiceChip(memberId) {
    var chip = document.querySelector('#rm-voice-chips [data-vpeer="' + memberId + '"]');
    if (!chip) return;
    var peer = S.voice.peers[memberId];
    chip.classList.toggle("speaking", !!(peer && peer.speaking));
  }

  function paintVoice() {
    var strip = document.getElementById("rm-voice-strip");
    if (!strip) return;
    var v = S.voice;
    strip.innerHTML = "";
    var label = el("span", "rm-voice-label", "🎙 Voice");
    label.setAttribute("aria-hidden", "true");
    strip.appendChild(label);

    if (v.joining) {
      strip.appendChild(el("span", "rm-voice-hint", "Requesting microphone…"));
      return;
    }
    if (v.err && !v.want) {
      var err = el("span", "rm-voice-err", v.err);
      err.setAttribute("role", "alert");
      strip.appendChild(err);
      var tryAgain = el("button", "btn sm", "Try again");
      tryAgain.setAttribute("aria-label", "Try joining voice again");
      tryAgain.onclick = function () { v.err = ""; paintVoice(); joinVoice(); };
      strip.appendChild(tryAgain);
      return;
    }
    if (!v.active) {
      if (v.want) {
        // Mid-reconnect: mic is held, waiting for the socket to come back.
        strip.appendChild(el("span", "rm-voice-hint",
          S.conn === "failed" ? "Voice paused — retry the connection to rejoin." : "Reconnecting voice…"));
        return;
      }
      var others = v.members.filter(function (m) { return m.id !== S.memberId; }).length;
      if (others > 0) {
        strip.appendChild(el("span", "rm-voice-hint",
          others + (others === 1 ? " person" : " people") + " in the call"));
      }
      var join = el("button", "btn sm", "Join voice");
      join.setAttribute("aria-label", "Join voice call");
      join.onclick = joinVoice;
      strip.appendChild(join);
      return;
    }
    // In the call.
    var chips = el("div", "rm-voice-chips");
    chips.id = "rm-voice-chips";
    chips.setAttribute("role", "list");
    chips.setAttribute("aria-label", "Voice call participants");
    v.members.forEach(function (m) {
      var c = voiceChipEl(m);
      c.setAttribute("role", "listitem");
      chips.appendChild(c);
    });
    strip.appendChild(chips);
    var muteBtn = el("button", "btn sm", v.muted ? "Unmute" : "Mute");
    muteBtn.setAttribute("aria-label", v.muted ? "Unmute microphone" : "Mute microphone");
    muteBtn.setAttribute("aria-pressed", v.muted ? "true" : "false");
    muteBtn.onclick = toggleVoiceMute;
    strip.appendChild(muteBtn);
    var leave = el("button", "btn sm rm-danger-btn", "Leave");
    leave.setAttribute("aria-label", "Leave voice call");
    leave.onclick = function () { leaveVoice(false); };
    strip.appendChild(leave);
  }

  /* ---------- route entry ---------- */

  async function renderRooms(view) {
    var pending = window.__neutronPendingRoom || null;
    window.__neutronPendingRoom = null;
    if (pending && UI.normalizeRoomCode) pending = UI.normalizeRoomCode(pending);
    /* Deep link to a different room while a workspace is open: drop the
       current room first so the pending code takes over below. */
    if (pending && S.screen === "workspace" && pending !== S.code) {
      leaveVoice(true);
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
