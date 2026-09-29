/* NEUTRON relay rooms — serverless collaboration over a public MQTT relay.
 *
 * No accounts, no backend: anyone with the room code joins. The transport is
 * a public MQTT broker used as a dumb relay; every payload is end-to-end
 * encrypted with AES-GCM-256 using a key derived from the room code, and
 * topics are opaque hashes, so the relay operator sees only ciphertext.
 * (The topic hash and the encryption key use different derivation domains,
 * so the visible topic cannot be turned into the key.)
 *
 * Honest limits: live chat, presence, and typing work. Message history is
 * NOT stored anywhere (a session sees only what happens while it is
 * connected). Shared files, voice calls, and room AI need the Node server.
 *
 * Message shapes fed to the UI match the Node collab server protocol
 * (JOINED / MEMBERS / CHAT_MESSAGE / CHAT_DELETED / CHAT_TYPING / ACTIVITY)
 * so the existing paint functions are reused untouched.
 */
(function (root) {
  "use strict";

  var BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://test.mosquitto.org:8081/mqtt",
  ];
  var TOPIC_PREFIX = "nr1/";
  var HEARTBEAT_MS = 30000;
  var PRUNE_AFTER_MS = 120000;

  function te(s) { return new TextEncoder().encode(String(s)); }
  function td(b) { return new TextDecoder().decode(b); }

  function b64encode(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64decode(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += ("0" + bytes[i].toString(16)).slice(-2);
    return s;
  }
  function sha256bytes(s) {
    return crypto.subtle.digest("SHA-256", te(s)).then(function (d) { return new Uint8Array(d); });
  }
  function randomHex(n) {
    var a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return hex(a);
  }
  function randomId(prefix) { return prefix + randomHex(6); }

  /** Room codes match the server format: NEUTRON-XXXXXX (no 0/O, 1/I/L). */
  function generateCode() {
    var ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    var a = new Uint8Array(6);
    crypto.getRandomValues(a);
    var s = "";
    for (var i = 0; i < 6; i++) s += ABC[a[i] % ABC.length];
    return "NEUTRON-" + s;
  }

  function seal(key, obj) {
    var iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, te(JSON.stringify(obj)))
      .then(function (ct) {
        var ctb = new Uint8Array(ct);
        var out = new Uint8Array(12 + ctb.length);
        out.set(iv, 0);
        out.set(ctb, 12);
        return b64encode(out);
      });
  }
  function open(key, sealed) {
    var raw;
    try { raw = b64decode(sealed); } catch (e) { return Promise.resolve(null); }
    if (raw.length < 13) return Promise.resolve(null);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12))
      .then(function (pt) {
        try { return JSON.parse(td(new Uint8Array(pt))); }
        catch (e) { return null; }
      })
      .catch(function () { return null; });
  }

  /**
   * Join a relay room.
   * hooks: { onMessage(obj), onConn(status) } — status: connecting|connected|reconnecting|failed
   * Returns { memberId, leave(), sendChat(text), sendTyping(bool), sendDelete(id) }.
   */
  function joinRelay(code, displayName, hooks) {
    hooks = hooks || {};
    var memberId = randomId("m");
    var name = String(displayName || "Someone").slice(0, 32) || "Someone";
    var mqtt = null, aesKey = null, base = null;
    var roster = {};   // memberId -> { id, displayName, status, activity, joinedAt, lastBeat }
    var seenMsg = {};  // chat msg id -> true (dedupe local echo vs relay echo)
    var seenCount = 0;
    var timers = [];
    var left = false;
    var brokerIdx = 0;

    function emit(obj) { if (hooks.onMessage) { try { hooks.onMessage(obj); } catch (e) {} } }
    function conn(s) { if (hooks.onConn) { try { hooks.onConn(s); } catch (e) {} } }
    function later(fn, ms) { var t = setTimeout(function () { if (!left) fn(); }, ms); timers.push(t); }

    function membersList() {
      return Object.keys(roster).map(function (id) { return roster[id]; })
        .sort(function (a, b) { return a.joinedAt - b.joinedAt; })
        .map(function (m) {
          return { id: m.id, displayName: m.displayName, role: "member", status: m.status, activity: m.activity || "" };
        });
    }
    function emitMembers() { emit({ type: "MEMBERS", members: membersList() }); }
    function noteActivity(kind, by, byName) {
      emit({ type: "ACTIVITY", event: { id: randomId("a"), kind: kind, by: by, byName: byName, ts: Date.now() } });
    }
    function trackSeen(id) {
      if (seenMsg[id]) return true;
      seenMsg[id] = true;
      if (++seenCount > 500) { seenMsg = {}; seenCount = 0; }
      return false;
    }

    function onPresence(pid, payload) {
      if (!payload || !payload.length) {
        // Empty retained payload = member left (graceful leave or Last Will).
        if (roster[pid]) {
          var nm = roster[pid].displayName;
          delete roster[pid];
          emitMembers();
          if (pid !== memberId) noteActivity("member_leave", pid, nm);
        }
        return Promise.resolve();
      }
      return open(aesKey, td(payload)).then(function (p) {
        if (!p || p.id !== pid) return;
        var isNew = !roster[pid];
        roster[pid] = {
          id: pid,
          displayName: String(p.displayName || "Someone").slice(0, 32) || "Someone",
          status: p.status === "away" ? "away" : "online",
          activity: String(p.activity || "").slice(0, 80),
          joinedAt: roster[pid] ? roster[pid].joinedAt : (p.ts || Date.now()),
          lastBeat: Date.now(),
        };
        emitMembers();
        if (isNew && pid !== memberId) noteActivity("member_join", pid, roster[pid].displayName);
      });
    }

    function onMqtt(topic, payload) {
      if (!aesKey || !base || left) return;
      var rel = topic.slice(base.length + 1); // "p/<id>" | "c" | "t"
      if (rel === "c" || rel === "t") {
        open(aesKey, td(payload)).then(function (obj) {
          if (!obj || left) return;
          if (rel === "c") {
            if (obj.kind === "del") {
              if (typeof obj.id === "string" && obj.id) emit({ type: "CHAT_DELETED", id: obj.id });
              return;
            }
            if (!obj.id || trackSeen(obj.id)) return;
            emit({
              type: "CHAT_MESSAGE",
              msg: {
                id: obj.id, memberId: obj.memberId, displayName: obj.displayName,
                text: String(obj.text || "").slice(0, 2000), ts: obj.ts || Date.now(),
              },
            });
          } else {
            if (!obj.memberId || obj.memberId === memberId) return;
            emit({ type: "CHAT_TYPING", memberId: obj.memberId, displayName: obj.displayName, typing: !!obj.typing });
          }
        });
        return;
      }
      if (rel.indexOf("p/") === 0) onPresence(rel.slice(2), payload);
    }

    function publishPresence() {
      if (!mqtt || !aesKey || !base || left) return Promise.resolve();
      return seal(aesKey, { id: memberId, displayName: name, status: "online", activity: "", ts: Date.now() })
        .then(function (s) { mqtt.publish(base + "/p/" + memberId, te(s), true); });
    }

    function connectBroker() {
      if (left) return;
      conn(brokerIdx === 0 ? "connecting" : "reconnecting");
      var url = BROKERS[brokerIdx % BROKERS.length];
      mqtt = root.NeutronMQTT.connect(url, {
        clientId: randomId("neutron-"),
        keepAlive: 45,
        // Empty retained payload on dirty disconnect clears our presence.
        will: { topic: base + "/p/" + memberId, payload: new Uint8Array(0), retain: true },
      });
      mqtt.onConn(function (s) {
        if (left) return;
        if (s === "connected") {
          brokerIdx = 0;
          mqtt.onMessage(onMqtt);
          mqtt.subscribe(base + "/p/+");
          mqtt.subscribe(base + "/c");
          mqtt.subscribe(base + "/t");
          publishPresence();
          conn("connected");
        } else if (s === "failed" || s === "closed" || (typeof s === "string" && s.indexOf("refused") === 0)) {
          try { mqtt.disconnect(); } catch (e) {}
          mqtt = null;
          brokerIdx++;
          conn("reconnecting");
          later(connectBroker, 2500);
        }
      });
    }

    // Derive the opaque topic and the encryption key, then connect.
    sha256bytes("neutron-relay-topic:v1:" + code).then(function (th) {
      return sha256bytes("neutron-relay-key:v1:" + code).then(function (kr) {
        return { topicHash: hex(th).slice(0, 20), keyRaw: kr };
      });
    }).then(function (secrets) {
      if (left) return null;
      return crypto.subtle.importKey("raw", secrets.keyRaw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
        .then(function (k) { return { key: k, topicHash: secrets.topicHash }; });
    }).then(function (r) {
      if (!r || left) return;
      aesKey = r.key;
      base = TOPIC_PREFIX + r.topicHash;
      roster[memberId] = { id: memberId, displayName: name, status: "online", activity: "", joinedAt: Date.now(), lastBeat: Date.now() };
      // Synthesize JOINED so the existing UI paints immediately; the relay fills in members.
      emit({
        type: "JOINED", you: { id: memberId, role: "member" }, room: { name: code },
        members: [], chat: [], activity: [], files: [], ice: [], voice: [],
      });
      emitMembers();
      connectBroker();
      timers.push(setInterval(function () { publishPresence(); }, HEARTBEAT_MS));
      timers.push(setInterval(function () {
        var now = Date.now(), changed = false;
        Object.keys(roster).forEach(function (id) {
          if (id !== memberId && now - (roster[id].lastBeat || roster[id].joinedAt) > PRUNE_AFTER_MS) {
            delete roster[id]; changed = true;
          }
        });
        if (changed) emitMembers();
      }, 60000));
    }).catch(function () { conn("failed"); });

    return {
      memberId: memberId,
      leave: function () {
        left = true;
        timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
        timers = [];
        try { if (mqtt && base) mqtt.publish(base + "/p/" + memberId, new Uint8Array(0), true); } catch (e) {}
        try { if (mqtt) mqtt.disconnect(); } catch (e) {}
        mqtt = null;
      },
      sendChat: function (text) {
        if (!mqtt || !aesKey || !base || left) return false;
        var msg = {
          kind: "msg", id: randomId("c"), memberId: memberId, displayName: name,
          text: String(text).slice(0, 2000), ts: Date.now(),
        };
        trackSeen(msg.id);
        // Local echo first (the relay echo is deduped by id when it arrives).
        emit({ type: "CHAT_MESSAGE", msg: { id: msg.id, memberId: msg.memberId, displayName: msg.displayName, text: msg.text, ts: msg.ts } });
        seal(aesKey, msg).then(function (s) { if (!left && mqtt) mqtt.publish(base + "/c", te(s), false); });
        return true;
      },
      sendTyping: function (typing) {
        if (!mqtt || !aesKey || !base || left) return;
        seal(aesKey, { memberId: memberId, displayName: name, typing: !!typing, ts: Date.now() })
          .then(function (s) { if (!left && mqtt) mqtt.publish(base + "/t", te(s), false); });
      },
      sendDelete: function (id) {
        if (!mqtt || !aesKey || !base || left || typeof id !== "string") return false;
        // Apply locally now; the relay echo deletes it for everyone else.
        emit({ type: "CHAT_DELETED", id: id });
        seal(aesKey, { kind: "del", id: id, memberId: memberId })
          .then(function (s) { if (!left && mqtt) mqtt.publish(base + "/c", te(s), false); });
        return true;
      },
    };
  }

  var api = { joinRelay: joinRelay, generateCode: generateCode };
  root.NeutronRelay = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
