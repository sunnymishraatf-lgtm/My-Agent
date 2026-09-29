/* NEUTRON minimal MQTT 3.1.1 client over WebSocket.
 *
 * A tiny, dependency-free client implementing just what relay rooms need:
 * CONNECT (with Last Will), SUBSCRIBE (QoS 0), PUBLISH (QoS 0, retained
 * flag), PINGREQ/PINGRESP, DISCONNECT. Binary WebSocket frames only.
 *
 * Used by rooms-relay.js to reach public MQTT relays without any backend.
 * The packet codec is exposed as NeutronMQTT._codec for unit tests.
 */
(function (root) {
  "use strict";

  var TE = new TextEncoder();
  var TD = new TextDecoder();

  function utf8Encode(s) { return TE.encode(String(s)); }
  function utf8Decode(b) { return TD.decode(b); }

  function encodeRemainingLength(len) {
    var out = [];
    do {
      var digit = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) digit |= 0x80;
      out.push(digit);
    } while (len > 0);
    return out;
  }

  function decodeRemainingLength(buf, pos) {
    var multiplier = 1, value = 0, bytes = 0, b;
    do {
      if (pos + bytes >= buf.length) return null;
      b = buf[pos + bytes];
      value += (b & 127) * multiplier;
      multiplier *= 128;
      bytes++;
      if (bytes > 4) return null; // malformed
    } while (b & 128);
    return { value: value, bytes: bytes };
  }

  function encodeString(s) {
    var b = utf8Encode(s);
    var out = new Uint8Array(2 + b.length);
    out[0] = (b.length >> 8) & 0xff;
    out[1] = b.length & 0xff;
    out.set(b, 2);
    return out;
  }

  function concatBytes(parts) {
    var total = 0, i;
    for (i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  function withHeader(type, flags, body) {
    var rl = encodeRemainingLength(body.length);
    var out = new Uint8Array(1 + rl.length + body.length);
    out[0] = ((type << 4) | flags) & 0xff;
    for (var i = 0; i < rl.length; i++) out[1 + i] = rl[i];
    out.set(body, 1 + rl.length);
    return out;
  }

  /**
   * o: { clientId, keepAlive, clean, willTopic, willPayload(Uint8Array|string),
   *      willRetain, username, password }
   */
  function encodeConnect(o) {
    o = o || {};
    var flags = 0;
    if (o.username) flags |= 0x80;
    if (o.password) flags |= 0x40;
    if (o.willTopic) {
      flags |= 0x04; // will flag
      if (o.willRetain) flags |= 0x20;
    }
    if (o.clean !== false) flags |= 0x02; // clean session
    var ka = o.keepAlive || 60;
    var parts = [
      concatBytes([encodeString("MQTT"), new Uint8Array([0x04, flags, (ka >> 8) & 0xff, ka & 0xff])]),
      encodeString(o.clientId || ""),
    ];
    if (o.willTopic) {
      parts.push(encodeString(o.willTopic));
      var wp = o.willPayload;
      if (typeof wp === "string") wp = utf8Encode(wp);
      wp = wp || new Uint8Array(0);
      var wl = new Uint8Array(2 + wp.length);
      wl[0] = (wp.length >> 8) & 0xff;
      wl[1] = wp.length & 0xff;
      wl.set(wp, 2);
      parts.push(wl);
    }
    if (o.username) parts.push(encodeString(o.username));
    if (o.password) parts.push(encodeString(o.password));
    return withHeader(1, 0, concatBytes(parts));
  }

  function encodeSubscribe(packetId, subs) {
    var parts = [new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff])];
    subs.forEach(function (s) {
      parts.push(encodeString(s.filter));
      parts.push(new Uint8Array([s.qos || 0]));
    });
    return withHeader(8, 0x02, concatBytes(parts));
  }

  function encodePublish(topic, payload, retain) {
    var p = payload;
    if (typeof p === "string") p = utf8Encode(p);
    p = p || new Uint8Array(0);
    return withHeader(3, retain ? 0x01 : 0x00, concatBytes([encodeString(topic), p]));
  }

  function encodePingreq() { return new Uint8Array([0xc0, 0x00]); }
  function encodeDisconnect() { return new Uint8Array([0xe0, 0x00]); }

  /**
   * Parse one packet at buf[pos]. Returns { packet, nextPos } or null when
   * the buffer does not yet hold a complete packet.
   * packet: { type, body } + decoded fields for CONNACK(2)/SUBACK(9)/PUBLISH(3).
   */
  function decodePacket(buf, pos) {
    if (pos + 2 > buf.length) return null;
    var type = buf[pos] >> 4;
    var rl = decodeRemainingLength(buf, pos + 1);
    if (!rl) return null;
    var start = pos + 1 + rl.bytes;
    if (start + rl.value > buf.length) return null;
    var body = buf.slice(start, start + rl.value);
    var packet = { type: type, body: body };
    if (type === 2) {
      packet.returnCode = body.length >= 2 ? body[1] : 255;
    } else if (type === 9) {
      packet.packetId = body.length >= 2 ? ((body[0] << 8) | body[1]) : 0;
    } else if (type === 3) {
      if (body.length < 2) return null;
      var tl = (body[0] << 8) | body[1];
      if (2 + tl > body.length) return null;
      packet.topic = utf8Decode(body.slice(2, 2 + tl));
      packet.payload = body.slice(2 + tl);
      packet.retain = (buf[pos] & 0x01) === 0x01;
    }
    return { packet: packet, nextPos: start + rl.value };
  }

  var pidCounter = 1;
  function nextPid() { pidCounter = (pidCounter % 65535) + 1; return pidCounter; }

  function randomClientId(prefix) {
    var r = "";
    try {
      var a = new Uint8Array(8);
      (root.crypto || {}).getRandomValues(a);
      for (var i = 0; i < a.length; i++) r += "0123456789abcdef"[a[i] % 16];
    } catch (e) { r = String(Math.random()).slice(2, 18); }
    return (prefix || "nc-") + r;
  }

  function deadClient() {
    var messageCb = null, connCb = null;
    return {
      onMessage: function (fn) { messageCb = fn; return this; },
      onConn: function (fn) { connCb = fn; return this; },
      subscribe: function () { return false; },
      publish: function () { return false; },
      disconnect: function () {},
      _fireMessage: function (t, p, r) { if (messageCb) messageCb(t, p, r); },
      _fireConn: function (s) { if (connCb) connCb(s); },
    };
  }

  /**
   * Connect to a broker. opts: { clientId, keepAlive, will:{topic,payload,retain},
   * username, password }. The "mqtt" subprotocol is required by most brokers.
   * Returns { onMessage(fn), onConn(fn), subscribe(filter), publish(topic,payload,retain), disconnect() }.
   */
  function connect(url, opts) {
    opts = opts || {};
    var api = deadClient();
    var WS = root.WebSocket;
    if (typeof WS === "undefined") {
      setTimeout(function () { api._fireConn("failed"); }, 0);
      return api;
    }
    var clientId = opts.clientId || randomClientId("neutron-");
    var keepAlive = opts.keepAlive || 60;
    var buf = new Uint8Array(0);
    var opened = false, connacked = false, dead = false;
    var pingTimer = null;
    var ws;
    try {
      ws = new WS(url, ["mqtt"]);
    } catch (e) {
      setTimeout(function () { api._fireConn("failed"); }, 0);
      return api;
    }
    ws.binaryType = "arraybuffer";

    function send(bytes) {
      if (ws.readyState === 1) { try { ws.send(bytes); return true; } catch (e) { return false; } }
      return false;
    }
    function startPing() {
      stopPing();
      pingTimer = setInterval(function () { send(encodePingreq()); },
        Math.max(10000, Math.floor(keepAlive * 700)));
    }
    function stopPing() { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } }

    ws.onopen = function () {
      opened = true;
      var willPayload = opts.will ? opts.will.payload : null;
      if (typeof willPayload === "string") willPayload = utf8Encode(willPayload);
      send(encodeConnect({
        clientId: clientId,
        keepAlive: keepAlive,
        willTopic: opts.will ? opts.will.topic : null,
        willPayload: willPayload,
        willRetain: !!(opts.will && opts.will.retain),
        username: opts.username,
        password: opts.password,
      }));
    };
    ws.onmessage = function (ev) {
      var chunk = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : utf8Encode(String(ev.data));
      var nb = new Uint8Array(buf.length + chunk.length);
      nb.set(buf, 0); nb.set(chunk, buf.length); buf = nb;
      var pos = 0, guard = 0;
      while (guard++ < 64) {
        var r = decodePacket(buf, pos);
        if (!r) break;
        pos = r.nextPos;
        var p = r.packet;
        if (p.type === 2) { // CONNACK
          if (p.returnCode === 0) {
            connacked = true;
            startPing();
            api._fireConn("connected");
          } else {
            api._fireConn("refused:" + p.returnCode);
            try { ws.close(); } catch (e) {}
          }
        } else if (p.type === 3) { // PUBLISH (QoS 0)
          api._fireMessage(p.topic, p.payload, p.retain);
        }
        // 9 SUBACK, 13 PINGRESP: nothing to do
      }
      buf = buf.slice(pos);
    };
    ws.onerror = function () { /* onclose follows with the real signal */ };
    ws.onclose = function () {
      stopPing();
      if (!dead) {
        dead = true;
        api._fireConn(!opened ? "failed" : "closed");
      }
    };

    api.subscribe = function (filter) {
      return send(encodeSubscribe(nextPid(), [{ filter: filter, qos: 0 }]));
    };
    api.publish = function (topic, payload, retain) {
      return send(encodePublish(topic, payload, retain));
    };
    api.disconnect = function () {
      dead = true;
      stopPing();
      send(encodeDisconnect());
      try { ws.close(); } catch (e) {}
    };
    return api;
  }

  var api = {
    connect: connect,
    _codec: {
      encodeConnect: encodeConnect,
      encodeSubscribe: encodeSubscribe,
      encodePublish: encodePublish,
      encodePingreq: encodePingreq,
      encodeDisconnect: encodeDisconnect,
      decodePacket: decodePacket,
      encodeRemainingLength: encodeRemainingLength,
      decodeRemainingLength: decodeRemainingLength,
    },
  };
  root.NeutronMQTT = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
