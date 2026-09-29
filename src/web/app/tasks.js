/* ==========================================================================
   NEUTRON Tasks + Notification center + Activity timeline (Phases 16/27/28).

   Classic script; uses globals from app.js (el, api, showError, toast,
   announce, openProjModal) and pure helpers on window.NeutronUI.
   All stores are device-local localStorage — the same BYOK trust boundary
   as the API key. Events are real app events only; nothing is invented.

   The global event bus `window.NeutronNotify(type, title, body, link)` lets
   other modules (agent, terminal, rooms, git) emit real notifications.
   ========================================================================== */
(function () {
  "use strict";

  var UI = window.NeutronUI || {};

  /* ---------------- storage ---------------- */

  var taskStore = null;
  var notifItems = null;   /* Array, newest first */
  var notifPrefs = null;   /* Record<string, boolean> */
  var saveErrShown = false;

  function storageError() {
    if (!saveErrShown) {
      saveErrShown = true;
      showError("Changes couldn't be saved — browser storage may be full. Your work is safe in memory for this session.");
    }
  }

  function loadTaskStore() {
    if (taskStore) return taskStore;
    taskStore = { version: UI.TASK_STORE_VERSION || 1, items: {} };
    try {
      var raw = localStorage.getItem(UI.TASK_STORE_KEY || "neutron_tasks");
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.items && typeof p.items === "object") {
          var items = {};
          Object.keys(p.items).forEach(function (id) {
            var t = UI.sanitizeTask(p.items[id]);
            if (t) items[t.id] = t;
          });
          taskStore.items = items;
        }
      }
    } catch (e) { /* corrupt → start empty; never crash */ }
    return taskStore;
  }

  function saveTaskStore() {
    if (!taskStore) return true;
    try {
      var items = {};
      Object.keys(taskStore.items).forEach(function (id) {
        var t = UI.sanitizeTask(taskStore.items[id]);
        items[id] = (t && t.id) ? t : taskStore.items[id];
      });
      localStorage.setItem(UI.TASK_STORE_KEY || "neutron_tasks", JSON.stringify({
        version: UI.TASK_STORE_VERSION || 1, items: items,
      }));
      return true;
    } catch (e) { storageError(); return false; }
  }

  function loadNotifState() {
    if (notifItems) return;
    notifItems = [];
    notifPrefs = UI.defaultNotifPrefs ? UI.defaultNotifPrefs() : {};
    try {
      var raw = localStorage.getItem(UI.NOTIF_STORE_KEY || "neutron_notifications");
      if (raw) {
        var p = JSON.parse(raw);
        if (p && Array.isArray(p.items)) {
          p.items.forEach(function (n) {
            var s = UI.sanitizeNotification(n);
            if (s) notifItems.push(s);
          });
          notifItems.sort(function (a, b) { return b.ts - a.ts; });
        }
        if (p.prefs) notifPrefs = UI.sanitizeNotifPrefs(p.prefs);
      }
    } catch (e) { /* corrupt → start empty */ }
  }

  function saveNotifState() {
    if (!notifItems) return true;
    try {
      localStorage.setItem(UI.NOTIF_STORE_KEY || "neutron_notifications", JSON.stringify({
        version: 1, prefs: notifPrefs, items: notifItems.slice(0, UI.NOTIF_CAP || 100),
      }));
      return true;
    } catch (e) { storageError(); return false; }
  }

  /* ---------------- notification bus ---------------- */

  /**
   * Emit a real event notification. Drops the event when the user disabled
   * its type in preferences. Never throws — notifications must not break
   * the app. Never called for keystrokes or AI streaming chunks.
   */
  function notify(type, title, body, link) {
    try {
      loadNotifState();
      if (!UI.notifShouldShow(notifPrefs, type)) return;
      var n = UI.newNotification(UI.newNotifId(), type, title, body, link, Date.now());
      UI.notifAdd(notifItems, n);
      saveNotifState();
      updateBadge();
      if (typeof announce === "function") announce("Notification: " + n.title);
    } catch (e) { /* best effort */ }
  }
  /* Global bus: other modules (agent, terminal, rooms, git) call this. */
  window.NeutronNotify = notify;

  /* ---------------- bell + panel ---------------- */

  function updateBadge() {
    try {
      loadNotifState();
      var badge = document.getElementById("notif-badge");
      if (!badge) return;
      var c = UI.notifUnreadCount(notifItems);
      badge.textContent = c > 99 ? "99+" : String(c);
      badge.classList.toggle("hidden", c === 0);
    } catch (e) {}
  }

  function closePanel() {
    var p = document.getElementById("notif-panel");
    if (p) p.classList.add("hidden");
    var b = document.getElementById("notif-bell");
    if (b) b.setAttribute("aria-expanded", "false");
  }

  function paintPanel() {
    var p = document.getElementById("notif-panel");
    if (!p) return;
    p.innerHTML = "";
    var head = el("div", "notif-head");
    head.appendChild(el("strong", null, "Notifications"));
    var acts = el("div", "notif-acts");
    var all = el("button", "linklike small", "Mark all read");
    all.type = "button";
    all.onclick = function () { UI.notifMarkAllRead(notifItems); saveNotifState(); updateBadge(); paintPanel(); };
    var clr = el("button", "linklike small", "Clear");
    clr.type = "button";
    clr.onclick = function () { notifItems = []; saveNotifState(); updateBadge(); paintPanel(); };
    acts.appendChild(all);
    acts.appendChild(clr);
    head.appendChild(acts);
    p.appendChild(head);
    var prefRow = el("div", "notif-prefs");
    prefRow.setAttribute("aria-label", "Notification preferences");
    UI.NOTIF_TYPES.forEach(function (t) {
      var lab = el("label", "notif-pref");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = notifPrefs[t] !== false;
      cb.setAttribute("aria-label", "Notify about " + (UI.NOTIF_TYPE_LABELS[t] || t));
      cb.onchange = function () { notifPrefs[t] = cb.checked; saveNotifState(); };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(UI.NOTIF_TYPE_LABELS[t] || t));
      prefRow.appendChild(lab);
    });
    p.appendChild(prefRow);
    var list = el("div", "notif-list");
    if (!notifItems.length) {
      list.appendChild(el("p", "muted small notif-empty",
        "No notifications yet. Real events — agent runs, test results, room activity, task changes — will appear here."));
    }
    notifItems.forEach(function (n) {
      var it = el("button", "notif-item" + (n.read ? "" : " unread"));
      it.type = "button";
      it.setAttribute("aria-label", (n.read ? "" : "Unread: ") + n.title);
      var top = el("div", "notif-top");
      top.appendChild(el("span", "pill tiny", UI.NOTIF_TYPE_LABELS[n.type] || n.type));
      top.appendChild(el("span", "muted small", UI.relativeTime(n.ts, Date.now())));
      it.appendChild(top);
      it.appendChild(el("div", "notif-title", n.title));
      if (n.body) it.appendChild(el("div", "muted small", n.body));
      it.onclick = function () {
        UI.notifMarkRead(notifItems, n.id);
        saveNotifState();
        updateBadge();
        closePanel();
        if (n.link) location.hash = n.link;
      };
      list.appendChild(it);
    });
    p.appendChild(list);
  }

  function initBell() {
    var bell = document.getElementById("notif-bell");
    if (!bell || bell.__wired) return;
    bell.__wired = true;
    bell.onclick = function (ev) {
      ev.stopPropagation();
      var p = document.getElementById("notif-panel");
      if (!p) return;
      var opening = p.classList.contains("hidden");
      closePanel();
      if (opening) {
        loadNotifState();
        paintPanel();
        p.classList.remove("hidden");
        bell.setAttribute("aria-expanded", "true");
      }
    };
    document.addEventListener("click", function (ev) {
      var p = document.getElementById("notif-panel");
      if (p && !p.classList.contains("hidden") &&
          !p.contains(ev.target) && !bell.contains(ev.target)) closePanel();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closePanel();
    });
    updateBadge();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initBell);
  else initBell();

  /* ---------------- project helpers (device-local) ---------------- */

  function readProjects() {
    try {
      var raw = localStorage.getItem("neutron_projects");
      if (!raw) return [];
      var p = JSON.parse(raw);
      return Object.keys(p.items || {}).map(function (id) { return p.items[id]; }).filter(Boolean);
    } catch (e) { return []; }
  }

  function projectNameMap() {
    var map = {};
    readProjects().forEach(function (pr) {
      if (pr && pr.id) map[pr.id] = pr.name || "Untitled project";
    });
    return map;
  }

  function linkedRepos(projects) {
    var set = {};
    projects.forEach(function (pr) {
      (pr.linkedRepoNames || []).forEach(function (n) { if (n) set[n] = true; });
    });
    return Object.keys(set);
  }

  /* ---------------- task board ---------------- */

  function taskCard(t, names, onOpen) {
    var c = el("button", "task-card");
    c.type = "button";
    c.setAttribute("aria-label", "Open task: " + (t.title || "Untitled task"));
    c.appendChild(el("div", "task-card-title", t.title || "Untitled task"));
    var meta = el("div", "task-card-meta");
    meta.appendChild(el("span", "pill tiny prio-" + t.priority,
      UI.TASK_PRIORITY_LABELS[t.priority] || t.priority));
    if (t.assignee) meta.appendChild(el("span", "muted small", "👤 " + t.assignee));
    if (t.projectId && names[t.projectId]) meta.appendChild(el("span", "muted small", "📁 " + names[t.projectId]));
    meta.appendChild(el("span", "muted small", UI.relativeTime(t.updatedAt, Date.now())));
    c.appendChild(meta);
    c.onclick = onOpen;
    return c;
  }

  function renderTasks(view) {
    loadTaskStore();
    view.appendChild(el("h1", null, "Tasks"));
    view.appendChild(el("p", "muted",
      "Track work across chats, agent runs, and projects. Stored only in this browser."));
    var bar = el("div", "task-toolbar");
    var newBtn = el("button", "btn primary", "+ New task");
    newBtn.type = "button";
    bar.appendChild(newBtn);
    var q = el("input", "input task-q");
    q.placeholder = "Search tasks…";
    q.setAttribute("aria-label", "Search tasks");
    bar.appendChild(q);
    var projSel = el("select", "input");
    projSel.setAttribute("aria-label", "Filter by project");
    var oAll = document.createElement("option");
    oAll.value = "";
    oAll.textContent = "All projects";
    projSel.appendChild(oAll);
    readProjects().forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name || "Untitled project";
      projSel.appendChild(o);
    });
    bar.appendChild(projSel);
    view.appendChild(bar);
    var board = el("div", "task-board");
    view.appendChild(board);
    var names = projectNameMap();

    function paint() {
      board.innerHTML = "";
      var counts = UI.taskCounts(taskStore);
      var query = q.value;
      var pid = projSel.value || null;
      UI.TASK_STATUSES.forEach(function (st) {
        var col = el("div", "task-col");
        var h = el("div", "task-col-head");
        h.appendChild(el("strong", null, UI.TASK_STATUS_LABELS[st]));
        h.appendChild(el("span", "pill tiny", String(counts[st] || 0)));
        col.appendChild(h);
        var list = UI.taskList(taskStore, { status: st, q: query, projectId: pid });
        if (!list.length) col.appendChild(el("p", "muted small", "Nothing here."));
        list.forEach(function (t) {
          col.appendChild(taskCard(t, names, function () {
            openTaskDialog({ id: t.id }, paint);
          }));
        });
        board.appendChild(col);
      });
    }
    newBtn.onclick = function () { openTaskDialog({}, paint); };
    var deb = UI.debounce ? UI.debounce(paint, 200) : paint;
    q.oninput = deb;
    projSel.onchange = paint;
    paint();
    /* Deep link: #/tasks/new opens the new-task dialog. */
    try {
      var sub = (location.hash || "").replace(/^#\/?/, "").split("/");
      if (sub.length > 1 && sub[1] === "new") {
        location.hash = "#/tasks";
        openTaskDialog({}, paint);
      }
    } catch (e) {}
  }

  /**
   * Task create/edit dialog. prefill: { id? } for edit, or
   * { title?, description?, projectId?, conversationId?, assignee? } for new.
   * Uses the shared openProjModal from app.js.
   */
  function openTaskDialog(prefill, onSaved) {
    loadTaskStore();
    prefill = prefill || {};
    var existing = prefill.id ? UI.taskGet(taskStore, prefill.id) : null;
    var body = el("div", "task-form");

    body.appendChild(el("label", "fld-label", "Title"));
    var titleIn = el("input", "input");
    titleIn.value = existing ? existing.title : (prefill.title || "");
    titleIn.setAttribute("aria-label", "Task title");
    body.appendChild(titleIn);

    body.appendChild(el("label", "fld-label", "Description"));
    var descIn = document.createElement("textarea");
    descIn.className = "input";
    descIn.rows = 4;
    descIn.setAttribute("aria-label", "Task description");
    descIn.value = existing ? existing.description : (prefill.description || "");
    body.appendChild(descIn);

    var row = el("div", "row");
    var stWrap = el("div", "task-fld");
    stWrap.appendChild(el("label", "fld-label", "Status"));
    var stSel = el("select", "input");
    stSel.setAttribute("aria-label", "Task status");
    UI.TASK_STATUSES.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s;
      o.textContent = UI.TASK_STATUS_LABELS[s];
      stSel.appendChild(o);
    });
    stSel.value = existing ? existing.status : (prefill.status || "todo");
    stWrap.appendChild(stSel);
    row.appendChild(stWrap);
    var prWrap = el("div", "task-fld");
    prWrap.appendChild(el("label", "fld-label", "Priority"));
    var prSel = el("select", "input");
    prSel.setAttribute("aria-label", "Task priority");
    UI.TASK_PRIORITIES.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s;
      o.textContent = UI.TASK_PRIORITY_LABELS[s];
      prSel.appendChild(o);
    });
    prSel.value = existing ? existing.priority : (prefill.priority || "medium");
    prWrap.appendChild(prSel);
    row.appendChild(prWrap);
    body.appendChild(row);

    body.appendChild(el("label", "fld-label", "Assignee (free text — there is no user directory)"));
    var asIn = el("input", "input");
    asIn.setAttribute("aria-label", "Assignee name");
    asIn.placeholder = "e.g. Sunny";
    asIn.value = existing ? existing.assignee : (prefill.assignee || "");
    body.appendChild(asIn);

    body.appendChild(el("label", "fld-label", "Project"));
    var pjSel = el("select", "input");
    pjSel.setAttribute("aria-label", "Linked project");
    var o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "No project";
    pjSel.appendChild(o0);
    readProjects().forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name || "Untitled project";
      pjSel.appendChild(o);
    });
    pjSel.value = existing ? existing.projectId : (prefill.projectId || "");
    body.appendChild(pjSel);

    var convId = existing ? existing.conversationId : (prefill.conversationId || "");
    if (convId) {
      var lk = el("div", "small task-conv-link");
      var a = document.createElement("a");
      a.href = "#/chat/" + encodeURIComponent(convId);
      a.textContent = "Open linked chat";
      lk.appendChild(a);
      body.appendChild(lk);
    }
    if (existing) {
      body.appendChild(el("p", "muted small",
        "Created " + UI.relativeTime(existing.createdAt, Date.now()) +
        (existing.completedAt ? " · completed " + UI.relativeTime(existing.completedAt, Date.now()) : "")));
    }

    var actions = [];
    if (existing) {
      actions.push({
        label: "Delete", kind: "ghost", onClick: function () {
          if (!window.confirm("Delete this task?\n\n\"" + (existing.title || "Untitled task") + "\"\n\nThis cannot be undone.")) return false;
          UI.taskDelete(taskStore, existing.id);
          saveTaskStore();
          toast("Task deleted.");
          if (onSaved) onSaved();
          return true;
        },
      });
    }
    actions.push({ label: "Cancel", kind: "ghost", onClick: function () { return true; } });
    actions.push({
      label: existing ? "Save" : "Create task", kind: "primary", onClick: function () {
        var now = Date.now();
        var title = titleIn.value.replace(/\s+/g, " ").trim();
        if (!title) { showError("Task needs a title."); try { titleIn.focus(); } catch (e) {} return false; }
        if (existing) {
          var prevStatus = existing.status;
          UI.taskUpdate(taskStore, existing.id, {
            title: title, description: descIn.value,
            priority: prSel.value, assignee: asIn.value,
            projectId: pjSel.value,
          }, now);
          if (stSel.value !== prevStatus) {
            UI.taskSetStatus(taskStore, existing.id, stSel.value, now);
            notify("tasks", "Task " + (UI.TASK_STATUS_LABELS[stSel.value] || stSel.value).toLowerCase() + ": " + title, "", "#/tasks");
          }
        } else {
          var t = UI.taskCreate(taskStore, UI.newTaskId(), now);
          UI.taskUpdate(taskStore, t.id, {
            title: title, description: descIn.value,
            priority: prSel.value, assignee: asIn.value,
            projectId: pjSel.value, conversationId: convId,
          }, now);
          if (stSel.value !== "todo") UI.taskSetStatus(taskStore, t.id, stSel.value, now);
          notify("tasks", "Task created: " + title, "", "#/tasks");
        }
        saveTaskStore();
        toast(existing ? "Task saved." : "Task created.");
        if (onSaved) onSaved();
        return true;
      },
    });
    openProjModal(existing ? "Edit task" : "New task", body, actions, null);
  }

  /* ---------------- activity timeline ---------------- */

  function toTs(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && v) {
      var p = Date.parse(v);
      return isFinite(p) ? p : 0;
    }
    return 0;
  }

  function timelineIcon(source) {
    return source === "tasks" ? "✓"
      : source === "agent" ? "🤖"
      : source === "checkpoints" ? "🕘"
      : source === "git" ? "⑂"
      : source === "rooms" ? "👥" : "•";
  }

  function roomActivityText(a) {
    var who = a.byName || "Someone";
    var p = a.path || "";
    switch (a.kind) {
      case "member_join": return who + " joined the room";
      case "member_leave": return who + " left the room";
      case "file_create": return who + " created " + p;
      case "file_rename": return who + " renamed " + p;
      case "file_delete": return who + " deleted " + p;
      case "file_edit": return who + " edited " + p;
      case "version_restore": return who + " restored a version of " + p;
      case "voice_start": return who + " started a voice call";
      case "voice_end": return "Voice call ended";
      case "ai_apply": return who + " applied an AI change to " + p;
      default: return who + " — " + (a.kind || "activity");
    }
  }

  /** Capped device-local log of room events, so the timeline can show them. */
  function logRoomActivity(code, roomName, ev) {
    try {
      var raw = localStorage.getItem(UI.ROOM_ACTIVITY_KEY || "neutron_room_activity");
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
      arr.push({
        code: String(code || ""),
        roomName: String(roomName || ""),
        kind: ev && ev.kind,
        byName: ev && ev.byName,
        path: ev && ev.path,
        ts: Date.now(),
      });
      while (arr.length > 200) arr.shift();
      localStorage.setItem(UI.ROOM_ACTIVITY_KEY || "neutron_room_activity", JSON.stringify(arr));
    } catch (e) { /* best effort — never break rooms */ }
  }

  async function renderTimeline(view) {
    view.appendChild(el("h1", null, "Activity timeline"));
    view.appendChild(el("p", "muted",
      "Real events from your tasks, agent runs, checkpoints, git history, and rooms — newest first."));
    var bar = el("div", "task-toolbar");
    var sel = el("select", "input");
    sel.setAttribute("aria-label", "Project");
    var projects = readProjects();
    var oAll = document.createElement("option");
    oAll.value = "";
    oAll.textContent = "All projects";
    sel.appendChild(oAll);
    projects.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name || "Untitled project";
      sel.appendChild(o);
    });
    bar.appendChild(sel);
    view.appendChild(bar);
    var list = el("div", "timeline");
    view.appendChild(list);

    async function paint() {
      list.innerHTML = "";
      list.appendChild(el("p", "muted", "Loading activity…"));
      var pid = sel.value || null;
      var pros = pid ? projects.filter(function (p) { return p.id === pid; }) : projects;
      var pname = {};
      pros.forEach(function (p) { pname[p.id] = p.name || "Untitled project"; });
      var lists = [];
      var notes = [];

      /* Tasks (device-local). */
      loadTaskStore();
      var te = [];
      UI.taskList(taskStore, pid ? { projectId: pid } : null).forEach(function (t) {
        te.push(UI.timelineEvent("tasks", "task_created",
          "Task created: " + (t.title || "Untitled task"),
          pname[t.projectId] || "", t.createdAt, "#/tasks"));
        if (t.completedAt) {
          te.push(UI.timelineEvent("tasks", "task_completed",
            "Task completed: " + (t.title || "Untitled task"),
            pname[t.projectId] || "", t.completedAt, "#/tasks"));
        }
      });
      lists.push(te);

      /* Server sources: Node only. */
      var health = null;
      try { health = await api("GET", "/api/health"); } catch (e) { health = null; }
      var repos = linkedRepos(pros);
      if (health && !health.serverless) {
        try {
          var rr = await api("GET", "/api/agent/runs");
          var re = [];
          (rr.runs || []).forEach(function (run) {
            if (pid && repos.indexOf(run.repo) === -1) return;
            re.push(UI.timelineEvent("agent", "agent_" + run.status,
              "Agent run " + run.status + ": " + String(run.goal || "").slice(0, 100),
              run.repo || "", toTs(run.createdAt), "#/agent"));
          });
          lists.push(re);
        } catch (e) { /* runs unavailable — timeline stays honest without them */ }
        for (var i = 0; i < repos.length; i++) {
          var repo = repos[i];
          try {
            var cr = await api("GET", "/api/checkpoints?repo=" + encodeURIComponent(repo));
            var ce = [];
            (cr.checkpoints || []).forEach(function (c) {
              ce.push(UI.timelineEvent("checkpoints", "checkpoint",
                "Checkpoint: " + (c.label || c.id || "snapshot"),
                repo + " · " + (c.fileCount != null ? c.fileCount + " files" : ""),
                toTs(c.at), "#/repos"));
            });
            lists.push(ce);
          } catch (e) {}
          try {
            var gr = await api("GET", "/api/git/log?repo=" + encodeURIComponent(repo) + "&n=30");
            var ge = [];
            (gr.commits || []).forEach(function (c) {
              ge.push(UI.timelineEvent("git", "commit",
                "Commit " + (c.shortSha || "") + ": " + String(c.message || "").split("\n")[0],
                (c.author || "") + " · " + repo, toTs(c.date), "#/repos"));
            });
            lists.push(ge);
          } catch (e) {}
        }
        if (!repos.length) {
          notes.push("Link a repo to a project (Repositories → project → linked repos) to see checkpoints and git history here.");
        }
      } else {
        notes.push("Agent runs, checkpoints, and git history need the Node server — this view is showing device-local activity only.");
      }

      /* Room events (device-local log; shown in the all-projects view). */
      if (!pid) {
        try {
          var raw = localStorage.getItem(UI.ROOM_ACTIVITY_KEY || "neutron_room_activity");
          if (raw) {
            var rae = [];
            (JSON.parse(raw) || []).forEach(function (a) {
              if (!a) return;
              rae.push(UI.timelineEvent("rooms", a.kind || "room_event",
                roomActivityText(a), a.roomName || "",
                toTs(a.ts), a.code ? "#room=" + a.code : "#/rooms"));
            });
            lists.push(rae);
          }
        } catch (e) {}
      }

      var merged = UI.timelineMerge(lists);
      list.innerHTML = "";
      notes.forEach(function (n) { list.appendChild(el("p", "muted small", n)); });
      if (!merged.length) {
        var emp = el("div", "panel");
        emp.appendChild(el("p", null, "No activity yet."));
        emp.appendChild(el("p", "muted small",
          "Create a task, run the agent, or make a checkpoint and it will appear here."));
        list.appendChild(emp);
        return;
      }
      UI.timelineGroupByDay(merged, Date.now()).forEach(function (g) {
        list.appendChild(el("h3", "tl-day", g.label));
        var ul = el("ul", "tl-events");
        g.events.forEach(function (e) {
          var li = el("li", "tl-event");
          li.appendChild(el("span", "tl-ico", timelineIcon(e.source)));
          var bd = el("div", "tl-body");
          bd.appendChild(el("div", "tl-title", e.title));
          bd.appendChild(el("div", "muted small",
            (e.detail ? e.detail + " · " : "") + UI.relativeTime(e.ts, Date.now())));
          li.appendChild(bd);
          if (e.link) {
            li.setAttribute("role", "link");
            li.setAttribute("tabindex", "0");
            li.setAttribute("aria-label", e.title + " — open");
            var go = function () { location.hash = e.link; };
            li.onclick = go;
            li.onkeydown = function (ev) { if (ev.key === "Enter") go(); };
          }
          ul.appendChild(li);
        });
        list.appendChild(ul);
      });
    }
    sel.onchange = paint;
    paint();
  }

  window.NeutronTasks = {
    renderTasks: renderTasks,
    renderTimeline: renderTimeline,
    openTaskDialog: openTaskDialog,
    logRoomActivity: logRoomActivity,
    notify: notify,
    closePanel: closePanel,
    loadTaskStore: loadTaskStore,
    getNotifications: function () { loadNotifState(); return (notifItems || []).slice(); },
  };
})();
