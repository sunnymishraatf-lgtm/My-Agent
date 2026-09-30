/* NEUTRON Music — a free coding soundtrack inside the app.
 *
 * What it is: a Music section with curated focus stations, play-by-link,
 * best-effort search, a queue, and a persistent mini-player that keeps
 * playing while you navigate the rest of the app.
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

  /* Public Piped/Invidious instances for best-effort search (no key needed).
     Tried in order with a short timeout; all failing just disables search.
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

  function thumb(id) {
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

  function fetchTimeout(url, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error("timeout")); }
      }, ms);
      fetch(url).then(function (r) {
        if (done) return; done = true; clearTimeout(timer);
        if (!r.ok) reject(new Error("http " + r.status));
        else resolve(r.json());
      }, function (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      });
    });
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
    var close = el("button", "icon-btn", "✕");
    close.setAttribute("aria-label", "Stop and close player");
    close.onclick = stopAll;
    ctrls.appendChild(prev);
    ctrls.appendChild(playPauseBtn);
    ctrls.appendChild(next);
    ctrls.appendChild(close);
    barEl.appendChild(ctrls);

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
    else if (ev.data === YTNS.PlayerState.PLAYING) setPlayIcon(true);
    else if (ev.data === YTNS.PlayerState.PAUSED) setPlayIcon(false);
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

  /** Play the queue item at index i (wraps around). */
  function playAt(i) {
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
    queue = [{ id: id, title: title || "YouTube video" }];
    playAt(0);
  }

  function enqueue(id, title) {
    queue.push({ id: id, title: title || "YouTube video" });
    if (qi === -1) playAt(0);
    else refreshSections();
    note("Added to queue.");
  }

  function toggle() {
    if (!player || !player.getPlayerState) return;
    var YTNS = root.YT;
    var s = player.getPlayerState();
    if (s === YTNS.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  }

  function step(d) {
    if (queue.length <= 1) {
      if (player && player.seekTo) { player.seekTo(0); player.playVideo(); }
      return;
    }
    playAt(qi + d);
  }

  function stopAll() {
    try { if (player && player.stopVideo) player.stopVideo(); } catch (e) {}
    queue = []; qi = -1; pendingPlay = null;
    if (barEl) barEl.classList.add("hidden");
    document.body.classList.remove("has-musicbar");
    setPlayIcon(false);
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
    var query = encodeURIComponent(q);
    for (var i = 0; i < SEARCH_ENDPOINTS.length; i++) {
      try {
        var data = await fetchTimeout(SEARCH_ENDPOINTS[i].replace("{q}", query), 8000);
        var items = normalizeResults(data);
        if (items.length) { onDone(null, items); return; }
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
    row.appendChild(el("div", "music-result-title", r.title));
    var play = el("button", "btn primary sm", "Play");
    play.onclick = function () { playId(r.id, r.title); };
    var add = el("button", "btn ghost sm", "+ Queue");
    add.onclick = function () { enqueue(r.id, r.title); };
    row.appendChild(play);
    row.appendChild(add);
    return row;
  }

  function renderSection(view) {
    view.appendChild(el("h1", null, "Music"));
    view.appendChild(el("p", "muted",
      "A free coding soundtrack. Playback is via YouTube embeds — free, but needs internet. " +
      "The mini-player keeps playing while you use the rest of the app."));

    var n = el("div", "music-note hidden");
    n.id = "music-note";
    n.setAttribute("role", "status");
    view.appendChild(n);

    /* Stations */
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
    STATIONS: STATIONS
  };
  root.NeutronMusic = exp;
})(typeof window !== "undefined" ? window : this);
