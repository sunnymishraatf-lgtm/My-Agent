/**
 * Relay rooms tests — src/web/app/rooms-relay.js against an in-memory
 * loopback MQTT broker. Verifies the E2E-encrypted chat/presence protocol
 * end to end, and that the wire carries only ciphertext.
 */
// @ts-ignore - plain JS module with a module.exports fallback
import relayModule from "../src/web/app/rooms-relay.js";
import { describe, it, expect, beforeEach } from "vitest";

const relay: any = (relayModule as any).default || relayModule;

function makeLoopbackBroker() {
  const subs: { filter: string; cb: (t: string, p: Uint8Array, r: boolean) => void }[] = [];
  const retained = new Map<string, Uint8Array>();
  const wire: { topic: string; payload: Uint8Array; retain: boolean }[] = [];
  function match(filter: string, topic: string): boolean {
    const f = filter.split("/");
    const t = topic.split("/");
    for (let i = 0; i < f.length; i++) {
      if (f[i] === "#") return true;
      if (f[i] === "+") { if (i >= t.length) return false; continue; }
      if (f[i] !== t[i]) return false;
    }
    return f.length === t.length;
  }
  (globalThis as any).NeutronMQTT = {
    connect(_url: string, _opts: any) {
      const cbs: { msg?: (t: string, p: Uint8Array, r: boolean) => void; conn?: (s: string) => void } = {};
      const client = {
        onMessage(fn: any) { cbs.msg = fn; return client; },
        onConn(fn: any) { cbs.conn = fn; setTimeout(() => cbs.conn && cbs.conn("connected"), 5); return client; },
        subscribe(filter: string) {
          const cb = (t: string, p: Uint8Array, r: boolean) => cbs.msg && cbs.msg(t, p, r);
          subs.push({ filter, cb });
          retained.forEach((p, t) => { if (match(filter, t)) setTimeout(() => cb(t, p, true), 0); });
          return true;
        },
        publish(topic: string, payload: Uint8Array, retain?: boolean) {
          const p = payload instanceof Uint8Array ? payload : new TextEncoder().encode(String(payload));
          wire.push({ topic, payload: p, retain: !!retain });
          if (retain) { if (p.length === 0) retained.delete(topic); else retained.set(topic, p); }
          subs.forEach((s) => { if (match(s.filter, topic)) setTimeout(() => s.cb(topic, p, false), 0); });
          return true;
        },
        disconnect() {},
      };
      return client;
    },
  };
  return { wire };
}

async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("relay rooms", () => {
  let broker: ReturnType<typeof makeLoopbackBroker>;

  beforeEach(() => {
    broker = makeLoopbackBroker();
  });

  it("generates valid room codes", () => {
    for (let i = 0; i < 20; i++) {
      expect(relay.generateCode()).toMatch(/^NEUTRON-[A-Z2-9]{6}$/);
    }
  });

  it("two members see each other and chat", async () => {
    const code = relay.generateCode();
    const aMsgs: any[] = [];
    const bMsgs: any[] = [];
    const a = relay.joinRelay(code, "Alice", { onMessage: (m: any) => aMsgs.push(m), onConn: () => {} });
    const b = relay.joinRelay(code, "Bob", { onMessage: (m: any) => bMsgs.push(m), onConn: () => {} });

    await waitFor(() => {
      const m = aMsgs.filter((x) => x.type === "MEMBERS").pop();
      return m && m.members.length === 2;
    });
    const aMembers = aMsgs.filter((x) => x.type === "MEMBERS").pop().members;
    expect(aMembers.map((m: any) => m.displayName).sort()).toEqual(["Alice", "Bob"]);

    expect(a.sendChat("hello bob")).toBe(true);
    await waitFor(() => bMsgs.some((x) => x.type === "CHAT_MESSAGE" && x.msg.text === "hello bob"));
    const got = bMsgs.filter((x) => x.type === "CHAT_MESSAGE").pop();
    expect(got.msg.displayName).toBe("Alice");

    // Typing indicator flows.
    b.sendTyping(true);
    await waitFor(() => aMsgs.some((x) => x.type === "CHAT_TYPING" && x.typing === true));

    // Leaving clears presence for the other member.
    b.leave();
    await waitFor(() => {
      const m = aMsgs.filter((x) => x.type === "MEMBERS").pop();
      return m && m.members.length === 1;
    });
    a.leave();
  });

  it("the wire carries ciphertext, never plaintext", async () => {
    const code = relay.generateCode();
    const seen: any[] = [];
    const a = relay.joinRelay(code, "Alice", { onMessage: (m: any) => seen.push(m), onConn: () => {} });
    await waitFor(() => seen.some((x) => x.type === "JOINED"));
    const secret = "s3cr3t-plans-for-world-domination";
    a.sendChat(secret);
    await waitFor(() => seen.some((x) => x.type === "CHAT_MESSAGE" && x.msg.text === secret));
    // Every payload published to the relay must not contain the plaintext.
    expect(broker.wire.length).toBeGreaterThan(0);
    for (const w of broker.wire) {
      const asText = new TextDecoder().decode(w.payload);
      expect(asText).not.toContain(secret);
      expect(asText).not.toContain("Alice");
    }
    // …but the topic must not leak the room code either.
    for (const w of broker.wire) {
      expect(w.topic).not.toContain(code);
    }
    a.leave();
  });

  it("message deletion propagates", async () => {
    const code = relay.generateCode();
    const aMsgs: any[] = [];
    const bMsgs: any[] = [];
    const a = relay.joinRelay(code, "Alice", { onMessage: (m: any) => aMsgs.push(m), onConn: () => {} });
    const b = relay.joinRelay(code, "Bob", { onMessage: (m: any) => bMsgs.push(m), onConn: () => {} });
    await waitFor(() => bMsgs.some((x) => x.type === "MEMBERS" && x.members.length === 2));
    a.sendChat("to be deleted");
    let id = "";
    await waitFor(() => {
      const m = bMsgs.filter((x) => x.type === "CHAT_MESSAGE" && x.msg.text === "to be deleted").pop();
      if (m) id = m.msg.id;
      return !!id;
    });
    a.sendDelete(id);
    await waitFor(() => bMsgs.some((x) => x.type === "CHAT_DELETED" && x.id === id));
    a.leave(); b.leave();
  });
});
