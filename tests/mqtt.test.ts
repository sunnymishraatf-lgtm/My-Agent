/**
 * MQTT codec tests — the minimal client in src/web/app/mqtt.js.
 * Packet encode/decode round-trips; no network needed.
 */
// @ts-ignore - plain JS module with a module.exports fallback
import mqtt from "../src/web/app/mqtt.js";
import { describe, it, expect } from "vitest";

const codec = (mqtt as any)._codec;

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

describe("MQTT remaining length", () => {
  it("round-trips single and multi-byte lengths", () => {
    for (const n of [0, 1, 127, 128, 16383, 16384, 2097151]) {
      const enc = codec.encodeRemainingLength(n);
      const dec = codec.decodeRemainingLength(new Uint8Array(enc), 0);
      expect(dec).not.toBeNull();
      expect(dec.value).toBe(n);
    }
  });
  it("returns null on truncated input", () => {
    expect(codec.decodeRemainingLength(new Uint8Array([0x80]), 0)).toBeNull();
  });
});

describe("MQTT CONNECT", () => {
  it("encodes a well-formed CONNECT with will", () => {
    const pkt = codec.encodeConnect({
      clientId: "test-123",
      keepAlive: 60,
      willTopic: "t/w",
      willPayload: new Uint8Array(0),
      willRetain: true,
    });
    expect(pkt[0]).toBe(0x10);
    // protocol name "MQTT" at offset 4..9
    expect(String.fromCharCode(pkt[4], pkt[5], pkt[6], pkt[7])).toBe("MQTT");
    expect(pkt[8]).toBe(0x04); // protocol level
    // flags: will(0x04) + will-retain(0x20) + clean(0x02) = 0x26
    expect(pkt[9]).toBe(0x26);
  });
});

describe("MQTT PUBLISH round-trip", () => {
  it("encodes and decodes a retained publish", () => {
    const payload = new TextEncoder().encode("hello");
    const pkt = codec.encodePublish("a/b", payload, true);
    const r = codec.decodePacket(pkt, 0);
    expect(r).not.toBeNull();
    expect(r.packet.type).toBe(3);
    expect(r.packet.topic).toBe("a/b");
    expect(r.packet.retain).toBe(true);
    expect(new TextDecoder().decode(r.packet.payload)).toBe("hello");
    expect(r.nextPos).toBe(pkt.length);
  });
  it("handles multi-byte remaining length and back-to-back packets", () => {
    const big = new Uint8Array(300).fill(65);
    const p1 = codec.encodePublish("x", big, false);
    const p2 = codec.encodePingreq();
    const buf = concat([p1, p2]);
    const r1 = codec.decodePacket(buf, 0);
    expect(r1).not.toBeNull();
    expect(r1.packet.payload.length).toBe(300);
    const r2 = codec.decodePacket(buf, r1.nextPos);
    expect(r2).not.toBeNull();
    expect(r2.packet.type).toBe(12); // PINGREQ
    expect(r2.nextPos).toBe(buf.length);
  });
  it("returns null for an incomplete packet", () => {
    const pkt = codec.encodePublish("a", new TextEncoder().encode("hi"), false);
    expect(codec.decodePacket(pkt.slice(0, 3), 0)).toBeNull();
  });
});

describe("MQTT SUBSCRIBE", () => {
  it("uses the 0x82 header and packet id", () => {
    const pkt = codec.encodeSubscribe(7, [{ filter: "nr1/abc/#", qos: 0 }]);
    expect(pkt[0]).toBe(0x82);
    const r = codec.decodePacket(pkt, 0);
    expect(r).not.toBeNull();
    expect(r.packet.type).toBe(8);
  });
});
