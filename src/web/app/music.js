/* NEUTRON Music — a free coding soundtrack inside the app.
 *
 * What it is: a Music section with curated focus stations, play-by-link,
 * best-effort search, a queue, and a persistent mini-player that keeps
 * playing while you navigate the rest of the app.
 *
 * Search works "directly inside the app": the query first goes to the
 * app's own backend (POST /api/chat {action:"music-search"}), which asks
 * YouTube's search API server-to-server — browsers can't call it directly
 * (it 403s cross-origin requests), and public Piped/Invidious instances
 * die regularly. If the backend is unreachable, the client falls back to
 * those public instances in order.
 *
 * What it is not: it is not the AirBeats native Android app (a Kotlin/Gradle
 * project cannot run inside this web app). Playback is via official YouTube
 * embeds, so it is free but needs internet; videos whose owners disabled
 * embedding will not play, and YouTube may show ads. Background/lock-screen
 * playback depends on the OS keeping the WebView alive — inside the app,
 * audio keeps playing across every section.
 *
 * Station IDs were verified live via YouTube oEmbed on 2026-09-30.
 */
(function (root) {
  "use strict";

  /* ---------------- data ---------------- */

  /* Station IDs verified playable in a real browser on 2026-09-30.
     Livestreams die when the stream ends, so dead IDs get replaced here;
     the player also auto-skips any video that fails at play time. */
  var STATIONS = [
    { id: "rFZHOHl-L8A", title: "Lofi Girl — lofi hip hop radio", sub: "beats to relax/study to · 24/7 live" },
    { id: "4xDzrJKXOOY", title: "Lofi Girl — synthwave radio", sub: "beats to chill/game to · 24/7 live" },
    { id: "CBSlu_VMS9U", title: "Lofi Girl — jazz lofi mix", sub: "3 hours relaxing cafe jazz" },
    { id: "sjkrrmBnpGE", title: "Ambient Study Music", sub: "4 hours for concentration · Quiet Quest" },
    { id: "eKFTSSKCzWA", title: "Forest & Waterfall Sounds", sub: "nature ambience for deep focus" }
  ];

  /* Public Piped/Invidious instances: client-side fallback when the app's
     own backend search is unreachable. Tried in order with a short timeout.
     Verified live 2026-09-30: the previous four instances were dead
     (kavin.rocks 526, adminforge 301, nadeko 403, nerdvpn 401). */
  var SEARCH_ENDPOINTS = [
    "https://api.piped.private.coffee/search?q={q}&filter=videos",
    "https://pipedapi.ducks.party/search?q={q}&filter=videos",
    "https://invidious.f5.si/api/v1/search?q={q}&type=video"
  ];

  /* ---------------- small helpers ---------------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  var FA_THUMB = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="12" fill="#1b1b22"/>' +
    '<text x="32" y="44" font-size="30" text-anchor="middle" fill="#e8e8ef">\u266A</text></svg>');

  function thumb(id) {
    /* Free-music tracks (fa:…) have no YouTube thumbnail — use a note icon. */
    if (typeof id === "string" && id.indexOf("fa:") === 0) return FA_THUMB;
    return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
  }

  var ID_RE = /^[A-Za-z0-9_-]{11}$/;

  /** Extract an 11-char YouTube video ID from a raw ID or common URL forms. */
  function parseVideoId(input) {
    var s = String(input || "").trim();
    if (!s) return null;
    if (ID_RE.test(s)) return s;
    var m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
            s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
            s.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function fetchTimeout(url, ms, opts) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error("timeout")); }
      }, ms);
      fetch(url, opts).then(function (r) {
        if (done) return; done = true; clearTimeout(timer);
        if (!r.ok) reject(new Error("http " + r.status));
        else resolve(r.json());
      }, function (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      });
    });
  }

  /* Backend base for the app's own server-side search. Mirrors app.js
     backendBase(): the dev-mode override in localStorage, else same-origin
     (which is the Vercel deployment for the phone app). */
  function backendBase() {
    try { return (localStorage.getItem("neutron_backend_url") || "").replace(/\/+$/, ""); }
    catch (e) { return ""; }
  }

  /** Normalize the backend's {ok, results:[{id,title,artist?}]} payload. */
  function normalizeServerResults(data) {
    var out = [];
    if (!data || data.ok !== true || !Array.isArray(data.results)) return out;
    data.results.forEach(function (r) {
      if (!r || !ID_RE.test(r.id || "") || !String(r.title || "").trim()) return;
      var item = { id: r.id, title: String(r.title) };
      if (String(r.artist || "").trim()) item.artist = String(r.artist);
      out.push(item);
    });
    return out.slice(0, 12);
  }

  /** Server-side search via the app's own backend: YouTube queried directly
      (server-to-server, no CORS/Origin block) with a Piped fallback.
      No third-party instance in the critical path. */
  async function searchViaServer(q) {
    var data = await fetchTimeout(backendBase() + "/api/chat", 12000, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "music-search", q: q })
    });
    if (!data || data.ok !== true) throw new Error((data && data.error) || "server search failed");
    return normalizeServerResults(data);
  }

  /** Normalize Piped ({items:[{url,title}]}) and Invidious ([{videoId,title}]). */
  function normalizeResults(data) {
    var out = [];
    function push(id, title) {
      if (id && ID_RE.test(id) && title) out.push({ id: id, title: String(title) });
    }
    if (data && Array.isArray(data.items)) {
      data.items.forEach(function (it) {
        if (!it) return;
        var id = parseVideoId(it.url || "");
        push(id, it.title);
      });
    } else if (Array.isArray(data)) {
      data.forEach(function (it) {
        if (!it || it.type === "playlist" || it.type === "channel") return;
        push(it.videoId, it.title);
      });
    }
    return out.slice(0, 12);
  }

  /* ---------------- player state ---------------- */

  var queue = [];        // [{id, title}]
  var qi = -1;           // index of current item
  var player = null;     // YT.Player instance
  var apiReady = false;
  var apiFailed = false;
  var apiPromise = null;
  var pendingPlay = null;
  var barEl = null;
  var barTitleEl = null;
  var barThumbEl = null;
  var playPauseBtn = null;
  var expandBtn = null;
  var sectionEls = [];   // live section roots to refresh on state change

  function ensureApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      if (root.YT && root.YT.Player) { apiReady = true; resolve(); return; }
      var tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      tag.onerror = function () { apiFailed = true; reject(new Error("Could not load the YouTube player.")); };
      var prev = root.onYouTubeIframeAPIReady;
      root.onYouTubeIframeAPIReady = function () {
        if (prev) { try { prev(); } catch (e) {} }
        apiReady = true;
        resolve();
        if (pendingPlay) { var p = pendingPlay; pendingPlay = null; createPlayer(p); }
      };
      document.head.appendChild(tag);
      /* If the API never calls back (offline), fail visibly after 15s. */
      setTimeout(function () {
        if (!apiReady && !apiFailed) { apiFailed = true; reject(new Error("YouTube player timed out — check your connection.")); }
      }, 15000);
    });
    return apiPromise;
  }

  function ensureBar() {
    if (barEl) return barEl;
    barEl = el("div", "music-bar hidden");
    barEl.setAttribute("role", "region");
    barEl.setAttribute("aria-label", "Music player");

    var playerWrap = el("div", "music-player-slot");
    playerWrap.id = "neutron-yt-player";
    barEl.appendChild(playerWrap);

    barThumbEl = el("img", "music-thumb");
    barThumbEl.alt = "";
    barEl.appendChild(barThumbEl);

    var meta = el("div", "music-meta");
    barTitleEl = el("div", "music-title", "Nothing playing");
    var sub = el("div", "music-sub muted small", "YouTube · free");
    meta.appendChild(barTitleEl);
    meta.appendChild(sub);
    /* Tap the title area to open the video view. */
    meta.style.cursor = "pointer";
    meta.title = "Show video";
    meta.onclick = function () { setVideoOpen(true); };
    barEl.appendChild(meta);

    var ctrls = el("div", "music-ctrls");
    var prev = el("button", "icon-btn", "⏮");
    prev.setAttribute("aria-label", "Previous");
    prev.onclick = function () { step(-1); };
    playPauseBtn = el("button", "icon-btn", "▶");
    playPauseBtn.setAttribute("aria-label", "Play or pause");
    playPauseBtn.onclick = toggle;
    var next = el("button", "icon-btn", "⏭");
    next.setAttribute("aria-label", "Next");
    next.onclick = function () { step(1); };
    expandBtn = el("button", "icon-btn", "⛶");
    expandBtn.setAttribute("aria-label", "Show video");
    expandBtn.title = "Show video";
    expandBtn.onclick = function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      setVideoOpen(!barEl.classList.contains("video-open"));
    };
    var close = el("button", "icon-btn", "✕");
    close.setAttribute("aria-label", "Stop and close player");
    close.onclick = stopAll;
    ctrls.appendChild(prev);
    ctrls.appendChild(playPauseBtn);
    ctrls.appendChild(next);
    ctrls.appendChild(expandBtn);
    ctrls.appendChild(close);
    barEl.appendChild(ctrls);

    /* Tapping the dark backdrop around the video collapses it. */
    barEl.addEventListener("click", function (ev) {
      if (barEl.classList.contains("video-open") && ev.target === barEl) {
        setVideoOpen(false);
      }
    });
    /* Keep the video sized on rotation / resize. */
    if (root.addEventListener) {
      root.addEventListener("resize", function () {
        if (barEl && barEl.classList.contains("video-open")) sizePlayer(true);
      });
    }

    document.body.appendChild(barEl);
    return barEl;
  }

  function showBar() {
    ensureBar();
    barEl.classList.remove("hidden");
    document.body.classList.add("has-musicbar");
  }

  var consecFails = 0;   /* dead-video guard: stop auto-skipping after 3 in a row */

  function createPlayer(videoId) {
    ensureBar();
    showBar();
    paintBar(); /* clear any "(loading…)" suffix from the pending state */
    if (player && player.loadVideoById) {
      player.loadVideoById(videoId);
      return;
    }
    try {
      player = new root.YT.Player("neutron-yt-player", {
        width: "96",
        height: "54",
        videoId: videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onStateChange: function (ev) { consecFails = 0; onPlayerState(ev); },
          onError: function () {
            consecFails++;
            if (consecFails < 3 && queue.length > 1) {
              note("That video is unavailable — skipping to the next one.");
              step(1);
            } else {
              note("That video can't be played — try another station or link.");
              setPlayIcon(false);
            }
          }
        }
      });
    } catch (e) {
      note("Player failed to start: " + (e && e.message ? e.message : e));
    }
  }

  function onPlayerState(ev) {
    var YTNS = root.YT;
    if (!YTNS) return;
    if (ev.data === YTNS.PlayerState.ENDED) step(1);
    else if (ev.data === YTNS.PlayerState.PLAYING) {
      setPlayIcon(true);
      nativeMusic("playing");
      recordHistory(); /* genuine playback start — not just a click */
    } else if (ev.data === YTNS.PlayerState.PAUSED) {
      setPlayIcon(false);
      nativeMusic("paused");
    }
  }

  /* ---------------- play history + playlists (device-local) ---------------- */

  var HISTORY_KEY = "neutron_music_history";
  var PLAYLISTS_KEY = "neutron_music_playlists";
  var HISTORY_CAP = 100;

  function readHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(function (h) { return h && h.id; }) : [];
    } catch (e) { return []; }
  }

  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_CAP))); }
    catch (e) { /* storage full/blocked — history is best effort */ }
  }

  /** Pure helper: newest-first, de-duplicated by id, capped. */
  function pushHistory(list, item) {
    var out = (list || []).filter(function (h) { return h && h.id !== item.id; });
    out.unshift(item);
    return out.slice(0, HISTORY_CAP);
  }

  /** Newest first, de-duplicated by video id, capped. */
  function recordHistory() {
    var c = current();
    if (!c || !c.id) return;
    saveHistory(pushHistory(readHistory(),
      { id: c.id, title: c.title || "YouTube video", ts: Date.now() }));
    refreshSections();
  }

  function readPlaylists() {
    try {
      var raw = localStorage.getItem(PLAYLISTS_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch (e) { return {}; }
  }

  function savePlaylists(pls) {
    try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(pls)); }
    catch (e) { /* best effort */ }
  }

  function addToPlaylist(name, id, title) {
    var pls = readPlaylists();
    var list = Array.isArray(pls[name]) ? pls[name] : [];
    if (!list.some(function (t) { return t.id === id; })) {
      list.push({ id: id, title: title || "YouTube video" });
    }
    pls[name] = list;
    savePlaylists(pls);
    note("Saved to \u201c" + name + "\u201d.");
    refreshSections();
  }

  function removeFromPlaylist(name, id) {
    var pls = readPlaylists();
    if (!Array.isArray(pls[name])) return;
    pls[name] = pls[name].filter(function (t) { return t.id !== id; });
    savePlaylists(pls);
    refreshSections();
  }

  function deletePlaylist(name) {
    var pls = readPlaylists();
    delete pls[name];
    savePlaylists(pls);
    note("Deleted playlist \u201c" + name + "\u201d.");
    refreshSections();
  }

  /** Inline playlist picker: choose an existing playlist or name a new one. */
  function savePicker(id, title) {
    var wrap = el("div", "music-savepicker");
    var sel = el("select", "input sm");
    sel.setAttribute("aria-label", "Choose playlist");
    var pls = readPlaylists();
    var names = Object.keys(pls);
    var opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = names.length ? "Choose a playlist\u2026" : "No playlists yet \u2014 name one";
    sel.appendChild(opt0);
    names.forEach(function (nm) {
      var o = document.createElement("option");
      o.value = nm;
      o.textContent = nm + " (" + pls[nm].length + ")";
      sel.appendChild(o);
    });
    var inp = el("input", "input sm");
    inp.placeholder = "Or new playlist name\u2026";
    inp.setAttribute("aria-label", "New playlist name");
    var ok = el("button", "btn primary sm", "Save");
    ok.type = "button";
    ok.onclick = function () {
      var name = inp.value.trim() || sel.value;
      if (!name) { note("Pick a playlist or type a new name."); return; }
      addToPlaylist(name, id, title);
      wrap.remove();
    };
    var cancel = el("button", "btn ghost sm", "Cancel");
    cancel.type = "button";
    cancel.onclick = function () { wrap.remove(); };
    wrap.appendChild(sel);
    wrap.appendChild(inp);
    wrap.appendChild(ok);
    wrap.appendChild(cancel);
    return wrap;
  }

  /** Toggle the save picker right below a track row. */
  function toggleSavePicker(row, id, title) {
    var parent = row.parentNode;
    if (!parent) return;
    var old = parent.querySelector(".music-savepicker");
    if (old) old.remove();
    parent.insertBefore(savePicker(id, title), row.nextSibling);
  }

  /**
   * A track row: thumbnail + title, Play / + Queue / Save, plus an optional
   * remove action (history entry or playlist track).
   */
  function trackRow(t, actions) {
    var row = el("div", "music-track");
    var img = el("img", "music-result-thumb");
    img.src = thumb(t.id);
    img.alt = "";
    img.loading = "lazy";
    row.appendChild(img);
    var tcol = el("div", "music-result-text");
    tcol.appendChild(el("div", "music-result-title", t.title || "YouTube video"));
    if (t.ts) {
      var d = new Date(t.ts);
      tcol.appendChild(el("div", "muted small",
        d.toLocaleDateString() + " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
    }
    row.appendChild(tcol);
    var play = el("button", "btn primary sm", "Play");
    play.type = "button";
    play.setAttribute("aria-label", "Play " + (t.title || "track"));
    play.onclick = function () { playId(t.id, t.title); };
    row.appendChild(play);
    var q = el("button", "btn ghost sm", "+ Queue");
    q.type = "button";
    q.onclick = function () { enqueue(t.id, t.title); };
    row.appendChild(q);
    var save = el("button", "btn ghost sm", "Save");
    save.type = "button";
    save.setAttribute("aria-label", "Save to playlist: " + (t.title || "track"));
    save.onclick = function () { toggleSavePicker(row, t.id, t.title); };
    row.appendChild(save);
    if (actions && typeof actions.onRemove === "function") {
      var rm = el("button", "btn ghost sm", actions.removeLabel || "\u2715");
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove " + (t.title || "track"));
      rm.onclick = function () { actions.onRemove(t); };
      row.appendChild(rm);
    }
    return row;
  }

  /**
   * Tells the native shell about playback state so it can keep the music
   * alive in the background (foreground service + media notification).
   * No-op on plain browsers.
   */
  function nativeMusic(state) {
    try {
      var bridge = root.NeutronApp;
      if (!bridge) return;
      if (state === "playing" && typeof bridge.onMusicPlaying === "function") {
        var c = current();
        bridge.onMusicPlaying(c && c.title ? c.title : "NEUTRON Music");
      } else if (state === "paused" && typeof bridge.onMusicPaused === "function") {
        bridge.onMusicPaused();
      } else if (state === "stopped" && typeof bridge.onMusicStopped === "function") {
        bridge.onMusicStopped();
      }
    } catch (e) { /* bridge unavailable — ignore */ }
  }

  /** Expand the mini-player into a large video view (tap ⛶ or the bar). */
  function setVideoOpen(open) {
    ensureBar();
    var isOpen = barEl.classList.contains("video-open");
    if (open === isOpen) return;
    barEl.classList.toggle("video-open", open);
    if (expandBtn) {
      expandBtn.textContent = open ? "🗗" : "⛶";
      expandBtn.setAttribute("aria-label", open ? "Collapse video" : "Show video");
    }
    sizePlayer(open);
  }

  /** Resize the YouTube iframe: large in video view, tiny in the mini bar. */
  function sizePlayer(large) {
    if (!player || !player.setSize) return;
    try {
      if (large) {
        var w = Math.min(Math.max(document.documentElement.clientWidth - 48, 300), 960);
        player.setSize(Math.round(w), Math.round(w * 9 / 16));
      } else {
        player.setSize(96, 54);
      }
    } catch (e) { /* player not ready — ignore */ }
  }

  function setPlayIcon(playing) {
    if (playPauseBtn) {
      playPauseBtn.textContent = playing ? "⏸" : "▶";
      playPauseBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
  }

  function current() {
    return qi >= 0 && qi < queue.length ? queue[qi] : null;
  }

  function paintBar() {
    var c = current();
    if (!c || !barEl) return;
    barTitleEl.textContent = c.title;
    barThumbEl.src = thumb(c.id);
  }

  function refreshSections() {
    sectionEls.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /** Which engine owns playback right now: "yt" (YouTube embed) or "fa" (free-music). */
  var activeEngine = "yt";

  /** Play the queue item at index i (wraps around). */
  function playAt(i) {
    activeEngine = "yt";
    /* Never overlap with the free-music engine: stop its audio first. */
    if (faPlaying || faIndex !== -1) faStop();
    if (!queue.length) return;
    qi = ((i % queue.length) + queue.length) % queue.length;
    var c = queue[qi];
    paintBar();
    refreshSections();
    if (apiFailed) { note("Player unavailable — check your connection."); return; }
    if (!apiReady) {
      pendingPlay = c.id;
      ensureApi().catch(function (e) { note(e.message); });
      showBar();
      barTitleEl.textContent = c.title + " (loading…)";
      return;
    }
    createPlayer(c.id);
    setPlayIcon(true);
  }

  function playId(id, title) {
    /* Free-music tracks route into the licensed-stream engine. */
    if (typeof id === "string" && id.indexOf("fa:") === 0) { FreeAudio.playByFaid(id, title); return; }
    activeEngine = "yt";
    queue = [{ id: id, title: title || "YouTube video" }];
    playAt(0);
  }

  function enqueue(id, title) {
    /* Free-music tracks route into the licensed-stream engine. */
    if (typeof id === "string" && id.indexOf("fa:") === 0) { FreeAudio.enqueueByFaid(id, title); return; }
    queue.push({ id: id, title: title || "YouTube video" });
    if (qi === -1) playAt(0);
    else refreshSections();
    note("Added to queue.");
  }

  function toggle() {
    if (activeEngine === "fa") { faToggle(); return; }
    if (!player || !player.getPlayerState) return;
    var YTNS = root.YT;
    var s = player.getPlayerState();
    if (s === YTNS.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  }

  function step(d) {
    if (activeEngine === "fa") { faStep(d); return; }
    if (queue.length <= 1) {
      if (player && player.seekTo) { player.seekTo(0); player.playVideo(); }
      return;
    }
    playAt(qi + d);
  }

  function stopAll() {
    if (activeEngine === "fa") { faStop(); activeEngine = "yt"; return; }
    try { if (player && player.stopVideo) player.stopVideo(); } catch (e) {}
    queue = []; qi = -1; pendingPlay = null;
    if (barEl) {
      barEl.classList.add("hidden");
      barEl.classList.remove("video-open");
    }
    document.body.classList.remove("has-musicbar");
    setPlayIcon(false);
    nativeMusic("stopped");
    refreshSections();
  }

  var noteTimer = null;
  function note(msg) {
    var n = document.getElementById("music-note");
    if (!n) return;
    n.textContent = msg;
    n.classList.remove("hidden");
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { n.classList.add("hidden"); }, 4000);
  }

  /* ---------------- search ---------------- */

  async function searchMusic(q, onDone) {
    /* 1) The app's own backend searches YouTube directly (server-to-server:
       no CORS block, no volunteer instance to die). */
    try {
      var items = await searchViaServer(q);
      if (items.length) { onDone(null, items); return; }
    } catch (e) { /* fall through to the public-instance chain */ }
    /* 2) Public Piped/Invidious instances, tried in order. */
    var query = encodeURIComponent(q);
    for (var i = 0; i < SEARCH_ENDPOINTS.length; i++) {
      try {
        var data = await fetchTimeout(SEARCH_ENDPOINTS[i].replace("{q}", query), 8000);
        var items2 = normalizeResults(data);
        if (items2.length) { onDone(null, items2); return; }
      } catch (e) { /* try next instance */ }
    }
    onDone(new Error("Search is unreachable right now — paste a YouTube link instead."), []);
  }

  /* ---------------- section UI ---------------- */

  function stationCard(st) {
    var card = el("button", "music-card");
    var img = el("img", "music-card-thumb");
    img.src = thumb(st.id);
    img.alt = "";
    img.loading = "lazy";
    card.appendChild(img);
    var t = el("div", "music-card-title", st.title);
    var s = el("div", "music-card-sub muted small", st.sub);
    card.appendChild(t);
    card.appendChild(s);
    card.onclick = function () { playId(st.id, st.title); };
    return card;
  }

  function resultRow(r) {
    var row = el("div", "music-result");
    var img = el("img", "music-result-thumb");
    img.src = thumb(r.id);
    img.alt = "";
    img.loading = "lazy";
    row.appendChild(img);
    var tcol = el("div", "music-result-text");
    tcol.appendChild(el("div", "music-result-title", r.title));
    if (r.artist) tcol.appendChild(el("div", "music-result-artist muted small", r.artist));
    row.appendChild(tcol);
    var play = el("button", "btn primary sm", "Play");
    play.onclick = function () { playId(r.id, r.title); };
    var add = el("button", "btn ghost sm", "+ Queue");
    add.onclick = function () { enqueue(r.id, r.title); };
    var save = el("button", "btn ghost sm", "Save");
    save.setAttribute("aria-label", "Save to playlist: " + r.title);
    save.onclick = function () { toggleSavePicker(row, r.id, r.title); };
    row.appendChild(play);
    row.appendChild(add);
    row.appendChild(save);
    return row;
  }

  function renderSection(view) {
    /* Fresh view: drop stale repaint callbacks from any previous render. */
    sectionEls.length = 0;

    view.appendChild(el("h1", null, "Music"));
    view.appendChild(el("p", "muted",
      "A free coding soundtrack. Free music streams licensed tracks that keep " +
      "playing with the screen off on the Android app; stations and search below " +
      "play via YouTube embeds. The mini-player keeps playing while you use the rest of the app."));

    var n = el("div", "music-note hidden");
    n.id = "music-note";
    n.setAttribute("role", "status");
    view.appendChild(n);

    /* Licensed free streams (Internet Archive + Jamendo) — native background playback. */
    renderFreeMusicPanel(view);

    /* Focus stations (YouTube) */
    var sp = el("section", "panel");
    sp.appendChild(el("h2", null, "Focus stations"));
    var grid = el("div", "music-grid");
    STATIONS.forEach(function (st) { grid.appendChild(stationCard(st)); });
    sp.appendChild(grid);
    view.appendChild(sp);

    /* Play by link */
    var lp = el("section", "panel");
    lp.appendChild(el("h2", null, "Play a link"));
    var row = el("div", "row");
    var inp = el("input", "input");
    inp.placeholder = "Paste a YouTube URL or video ID…";
    inp.setAttribute("aria-label", "YouTube URL or video ID");
    var go = el("button", "btn primary", "Play");
    function submit() {
      var id = parseVideoId(inp.value);
      if (!id) { note("That doesn't look like a YouTube link or video ID."); return; }
      playId(id, "YouTube video");
      inp.value = "";
    }
    go.onclick = submit;
    inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") submit(); });
    row.appendChild(inp);
    row.appendChild(go);
    lp.appendChild(row);
    view.appendChild(lp);

    /* Search (best-effort) */
    var qp = el("section", "panel");
    qp.appendChild(el("h2", null, "Search"));
    var srow = el("div", "row");
    var sinp = el("input", "input");
    sinp.placeholder = "Song, artist, or vibe…";
    sinp.setAttribute("aria-label", "Search music");
    var sgo = el("button", "btn", "Search");
    var res = el("div", "music-results");
    function doSearch() {
      var q = sinp.value.trim();
      if (!q) return;
      res.innerHTML = "";
      res.appendChild(el("p", "muted small", "Searching…"));
      sgo.disabled = true;
      searchMusic(q, function (err, items) {
        sgo.disabled = false;
        res.innerHTML = "";
        if (err) { res.appendChild(el("p", "muted", err.message)); return; }
        if (!items.length) { res.appendChild(el("p", "muted", "No results.")); return; }
        items.forEach(function (r) { res.appendChild(resultRow(r)); });
      });
    }
    sgo.onclick = doSearch;
    sinp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") doSearch(); });
    srow.appendChild(sinp);
    srow.appendChild(sgo);
    qp.appendChild(srow);
    qp.appendChild(res);
    view.appendChild(qp);

    /* Recently played (device-local history) */
    var hp = el("section", "panel");
    var hhead = el("div", "music-sec-head");
    hhead.appendChild(el("h2", null, "Recently played"));
    var hclear = el("button", "btn ghost sm", "Clear");
    hclear.type = "button";
    hclear.setAttribute("aria-label", "Clear play history");
    hclear.onclick = function () {
      saveHistory([]);
      note("Play history cleared.");
      refreshSections();
    };
    hhead.appendChild(hclear);
    hp.appendChild(hhead);
    var hlist = el("div", "music-history");
    function paintHistory() {
      hlist.innerHTML = "";
      var hist = readHistory();
      if (!hist.length) {
        hlist.appendChild(el("p", "muted small",
          "Nothing here yet — songs you actually play will show up here."));
        return;
      }
      hist.forEach(function (t) {
        hlist.appendChild(trackRow(t, {
          removeLabel: "\u2715",
          onRemove: function (item) {
            saveHistory(readHistory().filter(function (h) { return h.id !== item.id; }));
            refreshSections();
          }
        }));
      });
    }
    sectionEls.push(paintHistory);
    paintHistory();
    hp.appendChild(hlist);
    view.appendChild(hp);

    /* Playlists — save songs for later (device-local) */
    var pp = el("section", "panel");
    pp.appendChild(el("h2", null, "My playlists"));
    var crow = el("div", "row");
    var cinp = el("input", "input");
    cinp.placeholder = "New playlist name\u2026";
    cinp.setAttribute("aria-label", "New playlist name");
    var cbtn = el("button", "btn", "Create");
    cbtn.type = "button";
    function createPlaylist() {
      var name = cinp.value.trim();
      if (!name) { note("Name your playlist first."); return; }
      var pls = readPlaylists();
      if (!pls[name]) pls[name] = [];
      savePlaylists(pls);
      cinp.value = "";
      note("Playlist \u201c" + name + "\u201d ready — use Save on any song to add to it.");
      refreshSections();
    }
    cbtn.onclick = createPlaylist;
    cinp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") createPlaylist(); });
    crow.appendChild(cinp);
    crow.appendChild(cbtn);
    pp.appendChild(crow);
    var plist = el("div", "music-playlists");
    function paintPlaylists() {
      plist.innerHTML = "";
      var pls = readPlaylists();
      var names = Object.keys(pls);
      if (!names.length) {
        plist.appendChild(el("p", "muted small",
          "No playlists yet — tap Save on any song to start a collection."));
        return;
      }
      names.forEach(function (name) {
        var tracks = Array.isArray(pls[name]) ? pls[name] : [];
        var card = el("div", "music-plcard");
        var head = el("div", "music-plhead");
        head.appendChild(el("strong", null, name));
        head.appendChild(el("span", "muted small",
          tracks.length + " track" + (tracks.length === 1 ? "" : "s")));
        var pacts = el("div", "music-placts");
        var playAll = el("button", "btn primary sm", "Play all");
        playAll.type = "button";
        playAll.onclick = function () {
          var ts = readPlaylists()[name] || [];
          if (!ts.length) { note("\u201c" + name + "\u201d is empty."); return; }
          queue = ts.map(function (t) { return { id: t.id, title: t.title }; });
          playAt(0);
        };
        var queueAll = el("button", "btn ghost sm", "+ Queue all");
        queueAll.type = "button";
        queueAll.onclick = function () {
          var ts = readPlaylists()[name] || [];
          ts.forEach(function (t) { queue.push({ id: t.id, title: t.title }); });
          if (qi === -1 && queue.length) playAt(0);
          else refreshSections();
          note("Queued " + ts.length + " from \u201c" + name + "\u201d.");
        };
        var del = el("button", "btn ghost sm", "Delete");
        del.type = "button";
        del.setAttribute("aria-label", "Delete playlist " + name);
        del.onclick = function () { deletePlaylist(name); };
        pacts.appendChild(playAll);
        pacts.appendChild(queueAll);
        pacts.appendChild(del);
        head.appendChild(pacts);
        card.appendChild(head);
        tracks.forEach(function (t) {
          card.appendChild(trackRow(t, {
            removeLabel: "\u2715",
            onRemove: function (item) { removeFromPlaylist(name, item.id); }
          }));
        });
        plist.appendChild(card);
      });
    }
    sectionEls.push(paintPlaylists);
    paintPlaylists();
    pp.appendChild(plist);
    view.appendChild(pp);

    /* Queue */
    var up = el("section", "panel");
    up.appendChild(el("h2", null, "Up next"));
    var qlist = el("div", "music-queue");
    function paintQueue() {
      qlist.innerHTML = "";
      if (!queue.length) {
        qlist.appendChild(el("p", "muted small", "Queue is empty — pick a station or search."));
        return;
      }
      queue.forEach(function (item, i) {
        var r = el("button", "music-qrow" + (i === qi ? " active" : ""));
        r.appendChild(el("span", "music-qnum", String(i + 1)));
        r.appendChild(el("span", "music-qtitle", item.title));
        if (i === qi) r.appendChild(el("span", "music-qnow", "▶ playing"));
        r.onclick = function () { playAt(i); };
        qlist.appendChild(r);
      });
    }
    sectionEls.push(paintQueue);
    paintQueue();
    up.appendChild(qlist);
    view.appendChild(up);

    view.appendChild(el("p", "muted small",
      "Tip: start a station, then switch to any other section — the music keeps playing in the mini-player at the bottom."));
  }

  /* ============ FREE MUSIC ENGINE (licensed streams) ============
     Internet Archive (keyless) + Jamendo (free client ID in Settings).
     Audio plays through the native Android player when available
     (NeutronApp.nativeAudioPlay), so it keeps playing with the screen off;
     plain browsers fall back to an HTML5 <audio> element.
     Track ids are prefixed "fa:archive:<identifier>" / "fa:jamendo:<id>"
     so history and playlists replay through this engine via playId. */

  var FA_JAMENDO_KEY_LS = "neutron_jamendo_client_id";

  function faJamendoKey() {
    try { return (localStorage.getItem(FA_JAMENDO_KEY_LS) || "").trim(); }
    catch (e) { return ""; }
  }

  /** Escape user input for an Archive.org Lucene query. */
  function faEscapeLucene(s) {
    return String(s || "").replace(/([+\-!(){}\[\]^"~*?:\\/])/g, "\\$1");
  }

  /**
   * True when an Archive.org licenseurl is a recognized free license (any
   * Creative Commons license or a public-domain dedication). Items without
   * a verifiable free license are excluded — not every Archive.org upload
   * is freely licensed, so we only present results we can verify.
   */
  function faFreeLicense(url) {
    var u = String(url || "").toLowerCase();
    return u.indexOf("creativecommons.org/licenses/") !== -1 ||
      u.indexOf("creativecommons.org/publicdomain/") !== -1;
  }

  /** Normalize an Archive.org advancedsearch response into track objects. */
  function faParseArchiveSearch(data) {
    var docs = data && data.response && Array.isArray(data.response.docs)
      ? data.response.docs : [];
    var out = [];
    docs.forEach(function (d) {
      if (!d || !d.identifier) return;
      if (!faFreeLicense(d.licenseurl)) return; /* unlicensed uploads excluded */
      out.push({
        kind: "archive",
        faid: "fa:archive:" + d.identifier,
        identifier: d.identifier,
        title: String(d.title || d.identifier),
        artist: String(d.creator || ""),
        license: String(d.licenseurl || ""),
        url: null
      });
    });
    return out;
  }

  /**
   * Pick the best mp3 file from an Archive.org metadata response and build
   * its direct download URL. Skips spectrograms/thumbnails; prefers the
   * original mp3 over low-bitrate derivatives.
   */
  function faPickMp3(meta) {
    if (!meta || !meta.metadata || !meta.metadata.identifier) return null;
    var id = meta.metadata.identifier;
    var files = Array.isArray(meta.files) ? meta.files : [];
    var best = null;
    files.forEach(function (f) {
      if (!f || !f.name) return;
      var name = String(f.name);
      if (!/\.mp3$/i.test(name)) return;
      if (/spectrogram|_thumb|__ia_thumb/i.test(name)) return;
      if (!best) { best = name; return; }
      if (/_vbr\.mp3$/i.test(best) && !/_vbr\.mp3$/i.test(name)) best = name;
    });
    if (!best) return null;
    return "https://archive.org/download/" + encodeURIComponent(id) +
      "/" + encodeURIComponent(best);
  }

  /** Normalize a Jamendo v3.0 /tracks response into track objects. */
  function faParseJamendo(data) {
    var list = data && Array.isArray(data.results) ? data.results : [];
    var out = [];
    list.forEach(function (t) {
      if (!t || t.id == null || !t.audio) return;
      out.push({
        kind: "jamendo",
        faid: "fa:jamendo:" + t.id,
        identifier: String(t.id),
        title: String(t.name || "Jamendo track"),
        artist: String(t.artist_name || ""),
        album: String(t.album_name || ""),
        url: String(t.audio)
      });
    });
    return out;
  }

  async function faSearchArchive(q) {
    /* licenseurl:* keeps only items with license metadata; the client-side
       faFreeLicense check then verifies it is a recognized free license. */
    var query = "mediatype:audio AND licenseurl:* AND (" + faEscapeLucene(q) + ")";
    var url = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(query) +
      "&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=15&output=json";
    return faParseArchiveSearch(await fetchTimeout(url, 10000));
  }

  async function faSearchJamendo(q) {
    var key = faJamendoKey();
    if (!key) return { needsKey: true, tracks: [] };
    var url = "https://api.jamendo.com/v3.0/tracks/?client_id=" + encodeURIComponent(key) +
      "&format=json&limit=15&search=" + encodeURIComponent(q) +
      "&include=musicinfo&audioformat=mp32";
    var data = await fetchTimeout(url, 10000);
    if (data && data.headers && data.headers.status === "failed") {
      var msg = (data.headers.error_message || "Jamendo request failed.");
      throw new Error(msg);
    }
    return { needsKey: false, tracks: faParseJamendo(data) };
  }

  async function faResolveUrl(t) {
    if (t.url) return t.url;
    if (t.kind === "archive") {
      var meta = await fetchTimeout(
        "https://archive.org/metadata/" + encodeURIComponent(t.identifier), 10000);
      var url = faPickMp3(meta);
      if (!url) throw new Error("No playable audio file found for this item.");
      t.url = url;
      return url;
    }
    throw new Error("No stream URL for this track.");
  }

  /* ----- playback state ----- */

  var faQueue = [];
  var faIndex = -1;
  var faPlaying = false;
  var faGen = 0;          /* guards against stale async resolutions */
  var faAudio = null;     /* HTML5 fallback element */
  var faRegistry = {};    /* faid -> track, for history/playlist replay */

  function faRegister(t) { faRegistry[t.faid] = t; return t; }

  function faNative() {
    try {
      var b = root.NeutronApp;
      return (b && typeof b.nativeAudioPlay === "function") ? b : null;
    } catch (e) { return null; }
  }

  function faCurrent() {
    return faIndex >= 0 && faIndex < faQueue.length ? faQueue[faIndex] : null;
  }

  function faLabel(t) {
    return t.title + (t.artist ? " \u2014 " + t.artist : "");
  }

  function faPaintBar() {
    var c = faCurrent();
    if (!c) return;
    ensureBar();
    showBar();
    barTitleEl.textContent = faLabel(c);
    barThumbEl.src = FA_THUMB;
    setPlayIcon(faPlaying);
  }

  function faPlayAt(i) {
    if (!faQueue.length) return;
    faIndex = ((i % faQueue.length) + faQueue.length) % faQueue.length;
    var t = faQueue[faIndex];
    var g = ++faGen;
    activeEngine = "fa";
    /* Never overlap with the YouTube engine: stop its player first. */
    try { if (player && player.stopVideo) player.stopVideo(); } catch (e) {}
    faPlaying = true;
    faPaintBar();
    barTitleEl.textContent = faLabel(t) + " (loading\u2026)";
    setPlayIcon(true);
    faResolveUrl(t).then(function (url) {
      if (g !== faGen) return; /* superseded by a newer play request */
      var bridge = faNative();
      if (bridge) {
        try { bridge.nativeAudioPlay(url, t.title, t.artist || ""); }
        catch (e) { faHtmlFallback(url); }
      } else {
        faHtmlFallback(url);
      }
      faPaintBar();
      pushHistory({ id: t.faid, title: faLabel(t) });
      refreshSections();
    }).catch(function (e) {
      if (g !== faGen) return;
      faPlaying = false;
      setPlayIcon(false);
      note("Couldn't play this track: " + (e && e.message ? e.message : "network error"));
    });
  }

  function faHtmlFallback(url) {
    try {
      if (!faAudio) {
        faAudio = new Audio();
        faAudio.preload = "none";
        faAudio.addEventListener("ended", function () { faStep(1); });
        faAudio.addEventListener("error", function () {
          note("Audio error \u2014 trying the next track.");
          faStep(1);
        });
      } else {
        try { faAudio.pause(); } catch (e2) {}
      }
      faAudio.src = url;
      var p = faAudio.play();
      if (p && p.catch) p.catch(function () { faPlaying = false; setPlayIcon(false); });
    } catch (e) { /* audio unsupported — native path handles Android */ }
  }

  function faToggle() {
    var c = faCurrent();
    if (!c) return;
    var bridge = faNative();
    if (faPlaying) {
      faPlaying = false;
      if (bridge) { try { bridge.nativeAudioPause(); } catch (e) {} }
      else if (faAudio) { try { faAudio.pause(); } catch (e) {} }
    } else {
      faPlaying = true;
      if (bridge) { try { bridge.nativeAudioResume(); } catch (e) {} }
      else if (faAudio) {
        try {
          var p = faAudio.play();
          if (p && p.catch) p.catch(function () { faPlaying = false; setPlayIcon(false); });
        } catch (e) {}
      } else {
        /* Nothing loaded yet (e.g. resumed before first resolve) — replay. */
        faPlayAt(faIndex);
        return;
      }
    }
    setPlayIcon(faPlaying);
  }

  function faStep(d) {
    if (!faQueue.length) return;
    if (faQueue.length <= 1) { faPlayAt(faIndex); return; }
    faPlayAt(faIndex + d);
  }

  function faStop() {
    faGen++;
    faPlaying = false;
    faQueue = [];
    faIndex = -1;
    var bridge = faNative();
    if (bridge) { try { bridge.nativeAudioStop(); } catch (e) {} }
    if (faAudio) {
      try { faAudio.pause(); faAudio.removeAttribute("src"); } catch (e) {}
    }
    if (barEl) {
      barEl.classList.add("hidden");
      barEl.classList.remove("video-open");
    }
    document.body.classList.remove("has-musicbar");
    setPlayIcon(false);
    refreshSections();
  }

  /** Called from MainActivity when the native player reports ended/error. */
  function _onNativeAudioEvent(ev) {
    if (activeEngine !== "fa") return;
    if (ev === "ended") faStep(1);
    else if (ev === "error") {
      note("Stream error \u2014 trying the next track.");
      faStep(1);
    }
  }

  /**
   * Shorten a license URL for display: "CC BY-NC-ND 3.0", "CC0", or
   * "Public domain". Falls back to "Licensed".
   */
  function faLicenseLabel(url) {
    var u = String(url || "").toLowerCase();
    var m = u.match(/creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/);
    if (m) return "CC " + m[1].toUpperCase().replace(/-/g, "-") + " " + m[2];
    if (/creativecommons\.org\/publicdomain\/zero/.test(u)) return "CC0";
    if (/creativecommons\.org\/publicdomain/.test(u)) return "Public domain";
    return "Licensed";
  }

  function faResultRow(t) {
    var row = el("div", "music-result");
    var img = el("img", "music-result-thumb");
    img.src = FA_THUMB;
    img.alt = "";
    img.loading = "lazy";
    row.appendChild(img);
    var tcol = el("div", "music-result-text");
    tcol.appendChild(el("div", "music-result-title", t.title));
    var sub = (t.artist ? t.artist : "Unknown artist") +
      (t.album ? " \u00B7 " + t.album : "") +
      " \u00B7 " + (t.kind === "archive" ? "Internet Archive" : "Jamendo");
    if (t.kind === "archive" && t.license) sub += " \u00B7 " + faLicenseLabel(t.license);
    tcol.appendChild(el("div", "music-result-artist muted small", sub));
    row.appendChild(tcol);
    var play = el("button", "btn primary sm", "Play");
    play.type = "button";
    play.onclick = function () { FreeAudio.play(t); };
    var add = el("button", "btn ghost sm", "+ Queue");
    add.type = "button";
    add.onclick = function () { FreeAudio.enqueue(t); };
    var save = el("button", "btn ghost sm", "Save");
    save.type = "button";
    save.setAttribute("aria-label", "Save to playlist: " + t.title);
    save.onclick = function () { toggleSavePicker(row, t.faid, faLabel(t)); };
    row.appendChild(play);
    row.appendChild(add);
    row.appendChild(save);
    return row;
  }

  function renderFreeMusicPanel(view) {
    var fp = el("section", "panel");
    fp.appendChild(el("h2", null, "Free music"));
    var hasKey = !!faJamendoKey();
    var hasNative = !!faNative();
    fp.appendChild(el("p", "muted small",
      "Licensed and public-domain tracks from the Internet Archive" +
      (hasKey ? " and Jamendo" : "") + ". " +
      (hasNative
        ? "On this Android app they play through the native player, so music keeps going with the screen off."
        : "Plays in the browser here.") +
      (hasKey ? "" : " Add a free Jamendo client ID in Settings for more results.")));
    var srow = el("div", "row");
    var sinp = el("input", "input");
    sinp.placeholder = "Song, artist, or vibe\u2026";
    sinp.setAttribute("aria-label", "Search free music");
    var sgo = el("button", "btn primary", "Search");
    sgo.type = "button";
    var res = el("div", "music-results");
    function doSearch() {
      var q = sinp.value.trim();
      if (!q) return;
      res.innerHTML = "";
      res.appendChild(el("p", "muted small", "Searching free sources\u2026"));
      sgo.disabled = true;
      var jobs = [faSearchArchive(q).catch(function () { return []; })];
      if (hasKey) {
        jobs.push(faSearchJamendo(q).then(function (r) { return r.tracks; })
          .catch(function (e) { note("Jamendo: " + (e && e.message ? e.message : "search failed")); return []; }));
      }
      Promise.all(jobs).then(function (lists) {
        sgo.disabled = false;
        res.innerHTML = "";
        var tracks = [];
        lists.forEach(function (l) {
          l.forEach(function (t) { tracks.push(faRegister(t)); });
        });
        if (!tracks.length) {
          res.appendChild(el("p", "muted", "No freely-licensed tracks found \u2014 try different words."));
          return;
        }
        tracks.forEach(function (t) { res.appendChild(faResultRow(t)); });
      });
    }
    sgo.onclick = doSearch;
    sinp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") doSearch(); });
    srow.appendChild(sinp);
    srow.appendChild(sgo);
    fp.appendChild(srow);
    fp.appendChild(res);
    view.appendChild(fp);
  }

  var FreeAudio = {
    play: function (t) {
      faRegister(t);
      faQueue = [t];
      faPlayAt(0);
    },
    enqueue: function (t) {
      faRegister(t);
      faQueue.push(t);
      if (faIndex === -1) faPlayAt(0);
      else note("Added to queue.");
    },
    playByFaid: function (faid, title) {
      var t = faRegistry[faid];
      if (!t) {
        var m = /^fa:(archive|jamendo):(.+)$/.exec(faid || "");
        if (!m) { note("Couldn't find that track."); return; }
        if (m[1] === "archive") {
          t = { kind: "archive", faid: faid, identifier: m[2],
                title: title || m[2], artist: "", url: null };
        } else {
          note("That Jamendo track needs a fresh search to play.");
          return;
        }
      }
      faQueue = [t];
      faPlayAt(0);
    },
    enqueueByFaid: function (faid, title) {
      var t = faRegistry[faid];
      if (!t) { FreeAudio.playByFaid(faid, title); return; }
      faQueue.push(t);
      if (faIndex === -1) faPlayAt(0);
      else note("Added to queue.");
    },
    toggle: faToggle,
    next: function () { faStep(1); },
    prev: function () { faStep(-1); },
    stop: faStop,
    current: faCurrent,
    /* Test hooks. */
    faEscapeLucene: faEscapeLucene,
    faFreeLicense: faFreeLicense,
    faLicenseLabel: faLicenseLabel,
    faParseArchiveSearch: faParseArchiveSearch,
    faPickMp3: faPickMp3,
    faParseJamendo: faParseJamendo,
    FA_JAMENDO_KEY_LS: FA_JAMENDO_KEY_LS
  };

  /* ---------------- export ---------------- */

  var exp = {
    renderSection: renderSection,
    playId: playId,
    enqueue: enqueue,
    toggle: toggle,
    next: function () { step(1); },
    prev: function () { step(-1); },
    stop: stopAll,
    parseVideoId: parseVideoId,
    STATIONS: STATIONS,
    /* Native-audio events from the Android service (ended / error). */
    _onNativeAudioEvent: _onNativeAudioEvent,
    /* Free-music engine (licensed streams) + test hooks. */
    freeAudio: FreeAudio,
    /* Exposed for tests: server-first search + payload normalizers. */
    searchMusic: searchMusic,
    normalizeResults: normalizeResults,
    normalizeServerResults: normalizeServerResults,
    /* Exposed for tests: history + playlist storage helpers. */
    historyStore: {
      readHistory: readHistory,
      saveHistory: saveHistory,
      pushHistory: pushHistory,
      readPlaylists: readPlaylists,
      savePlaylists: savePlaylists,
      addToPlaylist: addToPlaylist,
      removeFromPlaylist: removeFromPlaylist,
      deletePlaylist: deletePlaylist,
      HISTORY_CAP: HISTORY_CAP
    }
  };
  root.NeutronMusic = exp;
})(typeof window !== "undefined" ? window : this);
