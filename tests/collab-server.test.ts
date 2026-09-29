/**
 * Phase 1 collaboration tests: CollabServer over a real WebSocket —
 * join/auth, chat broadcast, per-message membership checks, rate limiting,
 * WebRTC relay validation, reconnect resync. Deterministic clock injected.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { RoomManager } from "../src/server/collab/room-manager";
import { CollabServer, TokenBucket } from "../src/server/collab/collab-server";
import { startServer } from "../src/server/server";

class TestClient {
  ws: WebSocket;
  private queue: any[] = [];
  private waiters: Array<(m: any) => void> = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      const w = this.waiters.shift();
      if (w) w(m);
      else this.queue.push(m);
    });
  }
  async open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", (e) => rej(e));
    });
  }
  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }
  sendRaw(text: string): void {
    this.ws.send(text);
  }
  next(timeoutMs = 4000): Promise<any> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("timed out waiting for server message")), timeoutMs);
      this.waiters.push((m) => {
        clearTimeout(timer);
        res(m);
      });
    });
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

let server: Server;
let collab: CollabServer;
let mgr: RoomManager;
let url: string;
let t: number;
const clients: TestClient[] = [];

beforeEach(async () => {
  t = 1_000_000;
  mgr = new RoomManager(mkdtempSync(join(tmpdir(), "neutron-collab-srv-")), () => t);
  collab = new CollabServer({ manager: mgr, now: () => t, heartbeatMs: 60_000, sweepMs: 60_000 });
  server = createServer();
  collab.attach(server);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  const port = (server.address() as AddressInfo).port;
  url = `ws://127.0.0.1:${port}/collab`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  collab.close();
  await new Promise<void>((res) => server.close(() => res()));
});

async function connect(): Promise<TestClient> {
  const c = new TestClient(url);
  clients.push(c);
  await c.open();
  return c;
}

async function joinRoom(c: TestClient, code: string, name: string, ownerToken?: string): Promise<any> {
  c.send({ type: "ROOM_JOIN", roomId: code, displayName: name, ...(ownerToken ? { ownerToken } : {}) });
  const joined = await c.next();
  expect(joined.type).toBe("JOINED");
  return joined;
}

describe("join", () => {
  it("JOINED carries room, self, members, and chat history", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    const joined = await joinRoom(a, room.id, "Sunny");
    expect(joined.room.name).toBe("Team");
    expect(joined.you.displayName).toBe("Sunny");
    expect(joined.you.role).toBe("member");
    expect(joined.members).toHaveLength(1);
    expect(joined.chat).toEqual([]);
  });
  it("rejects unknown rooms and bad payloads", async () => {
    const a = await connect();
    a.send({ type: "ROOM_JOIN", roomId: "NEUTRON-ZZZZZZ", displayName: "Sunny" });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "ROOM_NOT_FOUND" });
    const { room } = mgr.createRoom("Team");
    a.send({ type: "ROOM_JOIN", roomId: room.id, displayName: "   " });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_PAYLOAD" });
    a.send({ type: "ROOM_JOIN", roomId: "bogus", displayName: "Sunny" });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_PAYLOAD" });
  });
  it("rejects garbage frames", async () => {
    const a = await connect();
    a.sendRaw("not json");
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_MESSAGE" });
    a.sendRaw('{"nope":1}');
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_MESSAGE" });
  });
  it("broadcasts MEMBERS when a second member joins", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const b = await connect();
    const joinedB = joinRoom(b, room.id, "Rahul");
    const membersOnA = await a.next();
    expect(membersOnA.type).toBe("MEMBERS");
    expect(membersOnA.members.map((m: any) => m.displayName).sort()).toEqual(["Rahul", "Sunny"]);
    await joinedB;
  });
  it("grants the owner role with a valid owner token", async () => {
    const { room, ownerToken } = mgr.createRoom("Team");
    const a = await connect();
    const joined = await joinRoom(a, room.id, "Sunny", ownerToken);
    expect(joined.you.role).toBe("owner");
    const b = await connect();
    b.send({ type: "ROOM_JOIN", roomId: room.id, displayName: "Rahul", ownerToken: "wrong" });
    const joinedB = await b.next();
    expect(joinedB.type).toBe("JOINED");
    expect(joinedB.you.role).toBe("member");
  });
});

describe("chat", () => {
  it("requires joining first", async () => {
    const a = await connect();
    a.send({ type: "CHAT_MESSAGE", text: "hello" });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "NOT_JOINED" });
  });
  it("broadcasts messages to every member of the room", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const b = await connect();
    await joinRoom(b, room.id, "Rahul");
    await a.next(); // MEMBERS broadcast from B joining (drain)
    await a.next(); // ACTIVITY member_join broadcast (drain)
    a.send({ type: "CHAT_MESSAGE", text: "hello room" });
    const onA = await a.next();
    const onB = await b.next();
    expect(onA).toMatchObject({ type: "CHAT_MESSAGE" });
    expect(onA.msg.text).toBe("hello room");
    expect(onA.msg.displayName).toBe("Sunny");
    expect(onB.msg.text).toBe("hello room");
  });
  it("rejects empty messages", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "CHAT_MESSAGE", text: "   " });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_PAYLOAD" });
  });
  it("rate-limits chat bursts", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    for (let i = 0; i < 5; i++) {
      a.send({ type: "CHAT_MESSAGE", text: "m" + i });
      expect(await a.next()).toMatchObject({ type: "CHAT_MESSAGE" });
    }
    a.send({ type: "CHAT_MESSAGE", text: "too fast" });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "RATE_LIMITED" });
  });
  it("typing indicator reaches others, not the sender", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const b = await connect();
    await joinRoom(b, room.id, "Rahul");
    await a.next(); // drain MEMBERS
    a.send({ type: "CHAT_TYPING", typing: true });
    const t = await b.next();
    expect(t).toMatchObject({ type: "CHAT_TYPING", typing: true, displayName: "Sunny" });
  });
});

describe("webrtc relay (Phase 3 plumbing)", () => {
  it("relays offers only to members of the same room", async () => {
    const r1 = mgr.createRoom("One").room;
    const r2 = mgr.createRoom("Two").room;
    const a = await connect();
    const joinedA = await joinRoom(a, r1.id, "Sunny");
    const b = await connect();
    const joinedB = await joinRoom(b, r1.id, "Rahul");
    await a.next(); // drain MEMBERS
    await a.next(); // drain ACTIVITY member_join
    const c = await connect();
    const joinedC = await joinRoom(c, r2.id, "Priya");

    a.send({ type: "WEBRTC_OFFER", to: joinedB.you.id, payload: { sdp: "fake-offer" } });
    const relayed = await b.next();
    expect(relayed).toMatchObject({
      type: "WEBRTC_OFFER",
      from: joinedA.you.id,
      fromName: "Sunny",
      payload: { sdp: "fake-offer" },
    });

    // Unknown member id.
    a.send({ type: "WEBRTC_OFFER", to: "m_nope", payload: { sdp: "x" } });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "MEMBER_NOT_FOUND" });

    // Member of a DIFFERENT room: must not relay.
    a.send({ type: "WEBRTC_ICE", to: joinedC.you.id, payload: { c: 1 } });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "MEMBER_NOT_FOUND" });

    // Non-object payload rejected.
    a.send({ type: "WEBRTC_ANSWER", to: joinedB.you.id, payload: "not-an-object" });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_PAYLOAD" });
  });
});

describe("reconnect", () => {
  it("rejoining resyncs chat history and members", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "CHAT_MESSAGE", text: "before disconnect" });
    await a.next();
    a.close();
    await new Promise((r) => setTimeout(r, 150)); // let the server process close

    const a2 = await connect();
    const rejoined = await joinRoom(a2, room.id, "Sunny");
    expect(rejoined.chat.map((m: any) => m.text)).toContain("before disconnect");
    expect(rejoined.members.map((m: any) => m.displayName)).toEqual(["Sunny"]);
  });
});

describe("HTTP wiring via startServer", () => {
  it("POST /api/collab/rooms creates a room; GET checks existence; WS lives on the same server", async () => {
    const root = mkdtempSync(join(tmpdir(), "neutron-collab-http-"));
    const running = await startServer({ root, port: 0, host: "127.0.0.1" });
    try {
      const base = `http://127.0.0.1:${running.port}`;
      const created = (await (
        await fetch(base + "/api/collab/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "HTTP room" }),
        })
      ).json()) as any;
      expect(created.ok).toBe(true);
      expect(created.room.id).toMatch(/^NEUTRON-/);
      expect(typeof created.ownerToken).toBe("string");
      expect(created.room.name).toBe("HTTP room");

      const check = (await (await fetch(base + "/api/collab/rooms/" + created.room.id)).json()) as any;
      expect(check).toMatchObject({ ok: true, exists: true, name: "HTTP room" });
      const missing = (await (await fetch(base + "/api/collab/rooms/NEUTRON-ZZZZZZ")).json()) as any;
      expect(missing).toMatchObject({ ok: true, exists: false });

      // The WebSocket endpoint is live on the same server; owner token works end to end.
      const c = new TestClient(`ws://127.0.0.1:${running.port}/collab`);
      clients.push(c);
      await c.open();
      const joined = await joinRoom(c, created.room.id, "HttpUser", created.ownerToken);
      expect(joined.you.role).toBe("owner");
      expect(joined.room.name).toBe("HTTP room");
    } finally {
      await running.close();
    }
  });
});

describe("TokenBucket", () => {  it("allows bursts then refills over time", () => {
    let t = 0;
    const b = new TokenBucket(2, 1 / 1000, t);
    expect(b.take(t)).toBe(true);
    expect(b.take(t)).toBe(true);
    expect(b.take(t)).toBe(false);
    t += 1000;
    expect(b.take(t)).toBe(true);
    expect(b.take(t)).toBe(false);
  });
});
