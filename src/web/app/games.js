/* NEUTRON Games — offline game arcade.
 *
 * 22 games, zero backend: every game runs entirely in the browser.
 * - "Solo": single player vs AI or endless. Works with no connection
 *   at all once the page is loaded.
 * - "2P": two players on this device (pass-and-play / split controls).
 *   Fully offline.
 * - "Online": turn-based games (chess, checkers, tic-tac-toe, connect-4)
 *   over the encrypted MQTT relay (same transport as relay Rooms).
 *   Needs internet on both phones; no accounts, just a room code.
 *
 * Honest limits: this is a web app, so the page itself must load once
 * (internet). After that, solo + 2P games need no further network.
 * Real-time action games (racing, boxing, shooter) are solo/2P-only —
 * relay latency makes them unfair online, so they are not offered there.
 */
(function (root) {
  "use strict";

  var registry = [];
  var active = null; // { cleanup: fn }

  /* ---------------- small DOM helpers ---------------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function on(elm, ev, fn) {
    elm.addEventListener(ev, fn);
    return function () { elm.removeEventListener(ev, fn); };
  }

  /** Current theme colors for canvas games (follows the active theme). */
  function themeColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fb) {
      var s = cs.getPropertyValue(name).trim();
      return s || fb;
    }
    return {
      bg: v("--bg", "#0E1013"),
      bgSoft: v("--bg-soft", "#15181D"),
      text: v("--text", "#111827"),
      text2: v("--text-2", "#4B5563"),
      text3: v("--text-3", "#9CA3AF"),
      primary: v("--primary", "#CC8066"),
      border: v("--border", "#E5E7EB"),
      surface: v("--surface", "#191C21"),
      green: v("--green", "#16A34A"),
      red: v("--red", "#DC2626"),
      amber: v("--amber", "#D97706"),
    };
  }

  /** Canvas with devicePixelRatio scaling. Returns {cv, ctx, W, H, resize}. */
  function makeCanvas(w, h) {
    var cv = el("canvas", "game-canvas");
    var ctx = cv.getContext("2d");
    var api = { cv: cv, ctx: ctx, W: w, H: h };
    api.resize = function () {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = "100%";
      cv.style.height = "auto";
      cv.style.aspectRatio = w + " / " + h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    api.resize();
    return api;
  }

  /** requestAnimationFrame loop with dt seconds. Returns stop(). */
  function loop(fn) {
    var raf = 0, last = 0, dead = false;
    function frame(t) {
      if (dead) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0.016);
      last = t;
      try { fn(dt, t / 1000); } catch (e) { /* game bug: stop loop */ dead = true; return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return function () { dead = true; cancelAnimationFrame(raf); };
  }

  /** Keyboard state tracker. Returns {down:Set, pressed:Set(cleared per frame), detach()}. */
  function keys() {
    var down = {}, pressed = {};
    function kd(e) {
      var k = e.key.toLowerCase();
      if (!down[k]) pressed[k] = true;
      down[k] = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].indexOf(k) !== -1) e.preventDefault();
    }
    function ku(e) { down[e.key.toLowerCase()] = false; }
    function blur() { down = {}; }
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    return {
      isDown: function (k) { return !!down[String(k).toLowerCase()]; },
      pressed: function (k) { return !!pressed[String(k).toLowerCase()]; },
      clearPressed: function () { pressed = {}; },
      detach: function () {
        window.removeEventListener("keydown", kd);
        window.removeEventListener("keyup", ku);
        window.removeEventListener("blur", blur);
      },
    };
  }

  /** Tiny WebAudio bleeps. */
  var actx = null, muted = false;
  function beep(freq, dur, type) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "square";
      o.frequency.value = freq || 440;
      g.gain.setValueAtTime(0.06, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + (dur || 0.08));
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + (dur || 0.08));
    } catch (e) { /* audio unavailable */ }
  }

  /** Fullscreen-style overlay inside the game area (messages, game over). */
  function overlay(container, html, buttons) {
    var ov = el("div", "game-overlay");
    var box = el("div", "game-overlay-box");
    if (typeof html === "string") box.innerHTML = html;
    else box.appendChild(html);
    var row = el("div", "game-overlay-btns");
    (buttons || []).forEach(function (b) {
      var btn = el("button", "btn", b.label);
      btn.onclick = function () { b.onClick(); };
      row.appendChild(btn);
    });
    box.appendChild(row);
    ov.appendChild(box);
    container.appendChild(ov);
    return function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
  }

  /** Score / status bar above the play area. Returns {set(html)}. */
  function statusBar(container) {
    var bar = el("div", "game-status");
    container.appendChild(bar);
    return { set: function (html) { bar.innerHTML = html; }, el: bar };
  }

  /* ---------------- game network (relay, turn-based) ---------------- */

  var BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://test.mosquitto.org:8081/mqtt"];

  function te(s) { return new TextEncoder().encode(String(s)); }
  function b64e(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64d(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += ("0" + b[i].toString(16)).slice(-2);
    return s;
  }
  function sha(s) {
    return crypto.subtle.digest("SHA-256", te(s)).then(function (d) { return new Uint8Array(d); });
  }
  function genCode() {
    var ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", a = new Uint8Array(6), s = "";
    crypto.getRandomValues(a);
    for (var i = 0; i < 6; i++) s += ABC[a[i] % ABC.length];
    return "GAME-" + s;
  }
  function seal(key, obj) {
    var iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, te(JSON.stringify(obj)))
      .then(function (ct) {
        var cb = new Uint8Array(ct), out = new Uint8Array(12 + cb.length);
        out.set(iv, 0); out.set(cb, 12);
        return b64e(out);
      });
  }
  function open(key, sealed) {
    try {
      var raw = b64d(sealed);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12))
        .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  /**
   * NetGame: encrypted relay channel for one turn-based game.
   * host(code) / join(code, onEvent). Events: onPeer (peer joined/left),
   * onMsg(obj). send(obj). Same key-derivation idea as relay rooms:
   * topic hash and AES key use different domains.
   */
  function netSession(code, isHost, onEvent) {
    var id = "p" + Math.random().toString(36).slice(2, 9);
    var mqtt = null, key = null, base = null, dead = false;
    var timers = [];
    function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }

    function publish(kind, d) {
      if (dead || !mqtt || !key) return;
      seal(key, { from: id, kind: kind, d: d || null }).then(function (s) {
        if (!dead && mqtt) mqtt.publish(base, te(s), false);
      });
    }

    function tryBroker(i) {
      if (dead) return;
      if (i >= BROKERS.length) { onEvent({ t: "net", ok: false }); return; }
      try {
        mqtt = root.NeutronMQTT.connect(BROKERS[i], {
          clientId: "ng-" + id + "-" + Date.now().toString(36),
          onMessage: function (topic, payload) {
            open(key, new TextDecoder().decode(payload)).then(function (m) {
              if (!m || m.from === id || dead) return;
              if (m.kind === "hello") { onEvent({ t: "peer", id: m.from }); if (isHost) publish("hi", {}); }
              else if (m.kind === "hi") { onEvent({ t: "peer", id: m.from }); }
              else if (m.kind === "bye") { onEvent({ t: "left", id: m.from }); }
              else if (m.kind === "move") { onEvent({ t: "move", d: m.d }); }
            });
          },
        });
        var to = later(function () { try { if (mqtt) mqtt.disconnect(); } catch (e) {} tryBroker(i + 1); }, 9000);
        // mqtt.js resolves via internal state; poll for readiness by subscribing.
        var tries = 0;
        var iv = setInterval(function () {
          timers.push(iv);
          if (dead) { clearInterval(iv); return; }
          tries++;
          try {
            if (mqtt.subscribe(base)) {
              clearInterval(iv); clearTimeout(to);
              onEvent({ t: "net", ok: true });
              publish("hello", {});
              if (isHost) later(function () { if (!dead) publish("hello", {}); }, 2500);
            } else if (tries > 40) { clearInterval(iv); clearTimeout(to); tryBroker(i + 1); }
          } catch (e) { clearInterval(iv); clearTimeout(to); tryBroker(i + 1); }
        }, 250);
      } catch (e) { tryBroker(i + 1); }
    }

    sha("neutron-game-topic:" + code).then(function (h) {
      base = "ng1/" + hex(h).slice(0, 20) + "/g";
      return sha("neutron-game-key:" + code);
    }).then(function (h) {
      return crypto.subtle.importKey("raw", h, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    }).then(function (k) {
      key = k;
      if (!dead) tryBroker(0);
    }).catch(function () { onEvent({ t: "net", ok: false }); });

    return {
      code: code,
      send: function (d) { publish("move", d); },
      close: function () {
        dead = true;
        timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
        try { publish("bye", {}); } catch (e) {}
        try { if (mqtt) mqtt.disconnect(); } catch (e) {}
        mqtt = null;
      },
    };
  }

  function hostGame(onEvent) { return netSession(genCode(), true, onEvent); }
  function joinGame(code, onEvent) {
    return netSession(String(code || "").toUpperCase().replace(/[^A-Z0-9-]/g, ""), false, onEvent);
  }

  /* ---------------- hub ---------------- */

  var MODE_LABEL = { solo: "Solo", "2p": "2 Players", online: "Online" };
  var MODE_HINT = {
    solo: "vs AI / endless — works offline",
    "2p": "two players, this device — works offline",
    online: "vs a friend over the relay — needs internet on both phones",
  };

  function gameById(id) {
    for (var i = 0; i < registry.length; i++) if (registry[i].id === id) return registry[i];
    return null;
  }

  function renderGames(view) {
    stopActive();
    view.innerHTML = "";
    var wrap = el("div", "games-wrap");
    var head = el("div", "games-head");
    head.appendChild(el("h1", "", "Games"));
    head.appendChild(el("p", "games-sub",
      "22 offline-first games. Solo and 2-player modes need no connection once loaded. " +
      "Online mode plays turn-based games with a friend over an encrypted relay — no accounts, just a code."));
    wrap.appendChild(head);

    var grid = el("div", "games-grid");
    registry.forEach(function (g) {
      var card = el("button", "game-card");
      card.type = "button";
      card.innerHTML =
        '<span class="game-icon">' + g.icon + "</span>" +
        '<span class="game-name">' + g.name + "</span>" +
        '<span class="game-modes">' + g.modes.map(function (m) {
          return '<i title="' + MODE_HINT[m] + '">' + MODE_LABEL[m] + "</i>";
        }).join("") + "</span>";
      card.onclick = function () { openGame(view, g.id, null); };
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    view.appendChild(wrap);
  }

  function openGame(view, id, presetMode) {
    var g = gameById(id);
    if (!g) return;
    stopActive();
    view.innerHTML = "";
    var wrap = el("div", "games-wrap game-screen");
    var bar = el("div", "game-topbar");
    var back = el("button", "btn game-back", "← Games");
    back.onclick = function () { renderGames(view); };
    bar.appendChild(back);
    bar.appendChild(el("span", "game-title", g.icon + " " + g.name));
    var muteBtn = el("button", "btn game-mute", muted ? "🔇" : "🔊");
    muteBtn.title = "Toggle sound";
    muteBtn.onclick = function () { muted = !muted; muteBtn.textContent = muted ? "🔇" : "🔊"; };
    bar.appendChild(muteBtn);
    wrap.appendChild(bar);

    var body = el("div", "game-body");
    wrap.appendChild(body);
    view.appendChild(wrap);

    if (!presetMode && g.modes.length > 1) {
      var pick = el("div", "game-modepick");
      pick.appendChild(el("h2", "", "Choose mode"));
      g.modes.forEach(function (m) {
        var b = el("button", "btn game-modebtn");
        b.innerHTML = "<b>" + MODE_LABEL[m] + "</b><small>" + MODE_HINT[m] + "</small>";
        b.onclick = function () { startMode(body, g, m); };
        pick.appendChild(b);
      });
      body.appendChild(pick);
      active = { cleanup: function () {} };
    } else {
      startMode(body, g, presetMode || g.modes[0]);
    }
    wrap.scrollIntoView();
  }

  function startMode(body, g, mode) {
    body.innerHTML = "";
    var badge = el("div", "game-modebadge", MODE_LABEL[mode] + " · " + MODE_HINT[mode]);
    body.appendChild(badge);
    var stage = el("div", "game-stage");
    body.appendChild(stage);
    var cleanup = function () {};
    try {
      cleanup = g.start(stage, mode, api()) || function () {};
    } catch (e) {
      stage.appendChild(el("p", "game-err", "This game hit an error: " + (e && e.message)));
    }
    active = { cleanup: cleanup };
  }

  function stopActive() {
    if (active && active.cleanup) {
      try { active.cleanup(); } catch (e) {}
    }
    active = null;
  }

  function teardown() { stopActive(); }

  function api() {
    return {
      el: el, on: on, theme: themeColors, canvas: makeCanvas, loop: loop,
      keys: keys, beep: beep, overlay: overlay, status: statusBar,
      host: hostGame, join: joinGame,
    };
  }

  var exp = {
    reg: function (def) { registry.push(def); },
    renderGames: renderGames,
    openGame: openGame,
    teardown: teardown,
    api: api,
  };
  root.NeutronGames = exp;
  if (typeof module !== "undefined" && module.exports) module.exports = exp;
})(typeof window !== "undefined" ? window : globalThis);
