/**
 * Phase 3 collaboration tests: voice-call signaling over a real WebSocket —
 * VOICE_JOIN/LEAVE/STATE broadcasts, the 6-participant mesh cap, membership
 * validation on every signal, ICE config advertisement, signaling rate
 * limits, and the pure client voice helpers (offerer rule, peer state
 * machine, speaking detection, member diffing).
 *
 * Browser WebRTC itself cannot run under vitest: RTCPeerConnection,
 * getUserMedia, and audio analysis are exercised by the manual QA checklist
 * in docs/COLLABORATION.md. Everything testable without a browser is tested
 * here.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { RoomManager } from "../src/server/collab/room-manager";
import { CollabServer, MAX_VOICE_PARTICIPANTS } from "../src/server/collab/collab-server";
import { collabIceServers } from "../src/server/server";
import ui from "../src/web/app/ui-utils.js";

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
  /** Drain n queued/broadcast messages (fire-and-forget ordering helper). */
  async drain(n: number): Promise<any[]> {
    const out: any[] = [];
    for (let i = 0; i < n; i++) out.push(await this.next());
    return out;
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
  mgr = new RoomManager(mkdtempSync(join(tmpdir(), "neutron-collab-voice-")), () => t);
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

async function joinRoom(c: TestClient, code: string, name: string): Promise<any> {
  c.send({ type: "ROOM_JOIN", roomId: code, displayName: name });
  const joined = await c.next();
  expect(joined.type).toBe("JOINED");
  return joined;
}

async function joinVoice(c: TestClient): Promise<any[]> {
  c.send({ type: "VOICE_JOIN" });
  const m = await c.next();
  expect(m.type).toBe("VOICE_MEMBERS");
  return m.members;
}

describe("voice membership", () => {
  it("broadcasts VOICE_MEMBERS when members join and leave", async () => {
    const { room } = mgr.createRoom("Voice");
    const a = await connect();
    const joinedA = await joinRoom(a, room.id, "Sunny");
    const b = await connect();
    const joinedB = await joinRoom(b, room.id, "Rahul");
    await a.next(); // drain MEMBERS for b's arrival
    await a.next(); // drain ACTIVITY member_join

    const membersA = await joinVoice(a);
    expect(membersA).toHaveLength(1);
    expect(membersA[0]).toMatchObject({ id: joinedA.you.id, displayName: "Sunny", muted: false });

    // b already received a's join broadcasts; the first is its VOICE_MEMBERS.
    const seenByB = await b.next();
    expect(seenByB.type).toBe("VOICE_MEMBERS");
    expect(seenByB.members).toHaveLength(1);
    await b.next(); // drain ACTIVITY voice_start
    const membersB = await joinVoice(b);
    expect(membersB.map((m: any) => m.displayName).sort()).toEqual(["Rahul", "Sunny"]);

    // a gets the updated broadcast too (after its own ACTIVITY drain).
    await a.next(); // drain ACTIVITY voice_start
    const update = await a.next();
    expect(update.type).toBe("VOICE_MEMBERS");
    expect(update.members).toHaveLength(2);

    // b leaves: a is told.
    b.send({ type: "VOICE_LEAVE" });
    const after = await a.next();
    expect(after.type).toBe("VOICE_MEMBERS");
    expect(after.members.map((m: any) => m.displayName)).toEqual(["Sunny"]);
    expect(joinedB.you.id).not.toBe(joinedA.you.id);
  });

  it("requires room membership for voice messages", async () => {
    const a = await connect();
    a.send({ type: "VOICE_JOIN" });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "NOT_JOINED" });
    a.send({ type: "VOICE_LEAVE" });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "NOT_JOINED" });
    a.send({ type: "VOICE_STATE", muted: true });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "NOT_JOINED" });
  });

  it("broadcasts mute state changes", async () => {
    const { room } = mgr.createRoom("Voice");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const b = await connect();
    await joinRoom(b, room.id, "Rahul");
    await a.next(); // drain MEMBERS
    await a.next(); // drain ACTIVITY member_join
    await joinVoice(a);
    await joinVoice(b);
    await a.next(); // drain ACTIVITY voice_start on a
    await a.next(); // drain b's join broadcast on a
    await b.next(); // drain ACTIVITY voice_start on b
    await b.next(); // drain b's own join broadcast on b

    a.send({ type: "VOICE_STATE", muted: true });
    const update = await b.next();
    expect(update.type).toBe("VOICE_MEMBERS");
    const sunny = update.members.find((m: any) => m.displayName === "Sunny");
    expect(sunny.muted).toBe(true);
    await a.next(); // a's own broadcast echo

    // Invalid mute payload rejected.
    a.send({ type: "VOICE_STATE", muted: "yes" });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_PAYLOAD" });
  });

  it("rejects mute state from someone not in the call", async () => {
    const { room } = mgr.createRoom("Voice");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "VOICE_STATE", muted: true });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_PAYLOAD" });
  });

  it("enforces the mesh voice cap with an honest error", async () => {
    expect(MAX_VOICE_PARTICIPANTS).toBe(6);
    const { room } = mgr.createRoom("Voice");
    const joined: TestClient[] = [];
    for (let i = 0; i < MAX_VOICE_PARTICIPANTS + 1; i++) {
      const c = await connect();
      await joinRoom(c, room.id, "User" + i);
      joined.push(c);
    }
    // Drain queued broadcasts on the first six (each later join broadcasts).
    for (let i = 0; i < MAX_VOICE_PARTICIPANTS; i++) {
      const c = joined[i];
      if (!c) throw new Error("test setup failed");
      c.send({ type: "VOICE_JOIN" });
      // Queued per client i: (6-i) MEMBERS + (6-i) ACTIVITY member_join +
      // i earlier VOICE_MEMBERS (+ 1 ACTIVITY voice_start for i > 0, which
      // arrives after client 0's own broadcast), then its own VOICE_MEMBERS.
      const drainCount = 2 * (MAX_VOICE_PARTICIPANTS - i) + i + (i === 0 ? 1 : 2);
      let m: any;
      for (let j = 0; j < drainCount; j++) m = await c.next();
      expect(m.type).toBe("VOICE_MEMBERS");
      expect(m.members).toHaveLength(i + 1);
    }
    const extra = joined[MAX_VOICE_PARTICIPANTS];
    if (!extra) throw new Error("test setup failed");
    // Drain that client's queued broadcasts from the six joins
    // (6 VOICE_MEMBERS + 1 ACTIVITY voice_start).
    await extra.drain(MAX_VOICE_PARTICIPANTS + 1);
    extra.send({ type: "VOICE_JOIN" });
    expect(await extra.next()).toMatchObject({ type: "ERROR", code: "VOICE_FULL" });
  });

  it("drops voice membership when the socket closes", async () => {
    const { room } = mgr.createRoom("Voice");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const b = await connect();
    await joinRoom(b, room.id, "Rahul");
    await a.next(); // drain MEMBERS
    await a.next(); // drain ACTIVITY member_join
    await joinVoice(a);
    await joinVoice(b);
    await a.next(); // drain ACTIVITY voice_start on a
    await a.next(); // drain b's join broadcast on a
    await b.next(); // drain ACTIVITY voice_start on b
    await b.next(); // drain a's join broadcast on b (stale for b)

    a.close();
    // Give the server a beat to process the close.
    await new Promise((r) => setTimeout(r, 150));
    await b.next(); // drain ACTIVITY member_leave
    const update = await b.next();
    expect(update.type).toBe("VOICE_MEMBERS");
    expect(update.members.map((m: any) => m.displayName)).toEqual(["Rahul"]);
  });

  it("re-joining voice after a reconnect is idempotent", async () => {
    const { room } = mgr.createRoom("Voice");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const first = await joinVoice(a);
    expect(first).toHaveLength(1);
    a.send({ type: "VOICE_JOIN" });
    await a.next(); // drain ACTIVITY voice_start
    const second = await a.next();
    expect(second.type).toBe("VOICE_MEMBERS");
    expect(second.members).toHaveLength(1);
  });
});

describe("voice + signaling isolation", () => {
  it("never relays voice signals across rooms", async () => {
    const r1 = mgr.createRoom("One").room;
    const r2 = mgr.createRoom("Two").room;
    const a = await connect();
    const joinedA = await joinRoom(a, r1.id, "Sunny");
    const b = await connect();
    await joinRoom(b, r1.id, "Rahul");
    const c = await connect();
    const joinedC = await joinRoom(c, r2.id, "Priya");
    await a.next(); // drain MEMBERS
    await a.next(); // drain ACTIVITY member_join

    // c is in a different room: relay refused.
    a.send({ type: "WEBRTC_OFFER", to: joinedC.you.id, payload: { sdp: "x" } });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "MEMBER_NOT_FOUND" });
    expect(joinedA.you.id).not.toBe(joinedC.you.id);
  });

  it("rate-limits the signaling bucket", async () => {
    const { room } = mgr.createRoom("Voice");
    const a = await connect();
    const joinedA = await joinRoom(a, room.id, "Sunny");
    const b = await connect();
    const joinedB = await joinRoom(b, room.id, "Rahul");
    await a.next(); // drain MEMBERS
    await a.next(); // drain ACTIVITY member_join
    // 20/min bucket, frozen clock: the 21st signal is rejected.
    for (let i = 0; i < 20; i++) {
      a.send({ type: "WEBRTC_OFFER", to: joinedB.you.id, payload: { sdp: "s" + i } });
    }
    for (let i = 0; i < 20; i++) {
      const m = await b.next();
      expect(m.type).toBe("WEBRTC_OFFER");
    }
    a.send({ type: "WEBRTC_OFFER", to: joinedB.you.id, payload: { sdp: "too-many" } });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "RATE_LIMITED" });
    expect(joinedA.you.id).toBeTruthy();
  });
});

describe("ICE advertisement", () => {
  it("JOINED carries server-configured ICE servers", async () => {
    const ice = [
      { urls: ["stun:stun.example.com:3478"] },
      { urls: ["turn:turn.example.com:3478"], username: "u", credential: "p" },
    ];
    const m2 = new RoomManager(mkdtempSync(join(tmpdir(), "neutron-collab-ice-")), () => t);
    const collab2 = new CollabServer({ manager: m2, now: () => t, iceServers: ice, heartbeatMs: 60_000, sweepMs: 60_000 });
    const srv2 = createServer();
    collab2.attach(srv2);
    await new Promise<void>((res) => srv2.listen(0, "127.0.0.1", () => res()));
    const port2 = (srv2.address() as AddressInfo).port;
    const c = new TestClient(`ws://127.0.0.1:${port2}/collab`);
    clients.push(c);
    await c.open();
    const { room } = m2.createRoom("Ice");
    c.send({ type: "ROOM_JOIN", roomId: room.id, displayName: "Sunny" });
    const joined = await c.next();
    expect(joined.type).toBe("JOINED");
    expect(joined.ice).toEqual(ice);
    expect(joined.voice).toEqual([]);
    collab2.close();
    await new Promise<void>((res) => srv2.close(() => res()));
  });

  it("JOINED defaults to an empty ICE list when nothing is configured", async () => {
    const { room } = mgr.createRoom("Ice");
    const a = await connect();
    const joined = await joinRoom(a, room.id, "Sunny");
    expect(joined.ice).toEqual([]);
  });
});

describe("collabIceServers env wiring", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ["NEUTRON_STUN_URL", "NEUTRON_TURN_URL", "NEUTRON_TURN_USERNAME", "NEUTRON_TURN_CREDENTIAL"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  it("returns [] with no env configured", () => {
    expect(collabIceServers()).toEqual([]);
  });
  it("advertises a custom STUN server", () => {
    process.env.NEUTRON_STUN_URL = "stun:stun.example.com:3478";
    expect(collabIceServers()).toEqual([{ urls: ["stun:stun.example.com:3478"] }]);
  });
  it("advertises TURN with credentials", () => {
    process.env.NEUTRON_TURN_URL = "turn:turn.example.com:3478";
    process.env.NEUTRON_TURN_USERNAME = "user";
    process.env.NEUTRON_TURN_CREDENTIAL = "secret";
    expect(collabIceServers()).toEqual([
      { urls: ["turn:turn.example.com:3478"], username: "user", credential: "secret" },
    ]);
  });
  it("advertises TURN without credentials when not set", () => {
    process.env.NEUTRON_TURN_URL = "turn:turn.example.com:3478";
    expect(collabIceServers()).toEqual([{ urls: ["turn:turn.example.com:3478"] }]);
  });
});

describe("client voice helpers", () => {
  it("shouldInitiateVoiceOffer picks a deterministic offerer (no glare)", () => {
    expect(ui.shouldInitiateVoiceOffer("m_aaa", "m_bbb")).toBe(true);
    expect(ui.shouldInitiateVoiceOffer("m_bbb", "m_aaa")).toBe(false);
    expect(ui.shouldInitiateVoiceOffer("m_aaa", "m_aaa")).toBe(false);
    expect(ui.shouldInitiateVoiceOffer("", "m_bbb")).toBe(false);
    expect(ui.shouldInitiateVoiceOffer("m_aaa", "")).toBe(false);
    // Symmetry: exactly one side offers for any pair.
    const p = ui.shouldInitiateVoiceOffer("m_x1", "m_y9");
    expect(ui.shouldInitiateVoiceOffer("m_y9", "m_x1")).toBe(!p);
  });
  it("voicePeerUiState maps RTC states to UI vocabulary", () => {
    expect(ui.voicePeerUiState("new")).toBe("connecting");
    expect(ui.voicePeerUiState("connecting")).toBe("connecting");
    expect(ui.voicePeerUiState("connected")).toBe("connected");
    expect(ui.voicePeerUiState("disconnected")).toBe("reconnecting");
    expect(ui.voicePeerUiState("failed")).toBe("failed");
    expect(ui.voicePeerUiState("closed")).toBe("idle");
    expect(ui.voicePeerUiState("bogus")).toBe("connecting");
    expect(ui.voicePeerUiState(undefined)).toBe("connecting");
  });
  it("isSpeakingRms thresholds analyser levels", () => {
    expect(ui.isSpeakingRms(0.05)).toBe(true);
    expect(ui.isSpeakingRms(0.02)).toBe(true);
    expect(ui.isSpeakingRms(0.019)).toBe(false);
    expect(ui.isSpeakingRms(0)).toBe(false);
    expect(ui.isSpeakingRms(NaN)).toBe(false);
    expect(ui.isSpeakingRms(-1)).toBe(false);
    expect(ui.isSpeakingRms(0.1, 0.2)).toBe(false);
    expect(ui.isSpeakingRms(0.3, 0.2)).toBe(true);
    expect(ui.VOICE_SPEAK_THRESHOLD).toBe(0.02);
  });
  it("diffVoiceMembers reports joins and leaves by id", () => {
    const a = { id: "m_1", displayName: "Sunny" };
    const b = { id: "m_2", displayName: "Rahul" };
    const d1 = ui.diffVoiceMembers([], [a, b]);
    expect(d1.joined).toHaveLength(2);
    expect(d1.left).toHaveLength(0);
    const d2 = ui.diffVoiceMembers([a, b], [b]);
    expect(d2.joined).toHaveLength(0);
    expect(d2.left.map((m: any) => m.id)).toEqual(["m_1"]);
    expect(ui.diffVoiceMembers([a], [a]).joined).toHaveLength(0);
  });
  it("exposes the mesh cap and STUN defaults", () => {
    expect(ui.MAX_VOICE_PARTICIPANTS).toBe(6);
    expect(ui.DEFAULT_STUN_URLS).toHaveLength(2);
    expect(ui.DEFAULT_STUN_URLS[0]).toMatch(/^stun:/);
  });
});
