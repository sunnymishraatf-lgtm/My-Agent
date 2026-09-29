/**
 * NEUTRON collaboration WebSocket server — Phase 1.
 *
 * Mounted on the Node HTTP server at /collab (Vercel serverless cannot hold
 * WebSocket connections, so this never runs there). Owns the wire protocol,
 * per-connection rate limiting, heartbeats, presence sweeps, and broadcast.
 * Room state itself lives in RoomManager (room-manager.ts).
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  RoomManager,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeChatText,
  type MemberPublic,
  type RoomPublic,
  type CollabChatMsg,
  type PresenceStatus,
} from "./room-manager";

export const COLLAB_WS_PATH = "/collab";
/** Reject absurdly large frames early. */
const MAX_WS_PAYLOAD = 64 * 1024;
const HEARTBEAT_MS = 15_000;
const SWEEP_MS = 10_000;

// ----- wire protocol -------------------------------------------------------

export type ClientMessage =
  | { type: "ROOM_JOIN"; roomId: string; displayName: string; ownerToken?: string }
  | { type: "ROOM_LEAVE" }
  | { type: "PRESENCE_UPDATE"; status: PresenceStatus; activity?: string }
  | { type: "CHAT_MESSAGE"; text: string }
  | { type: "CHAT_TYPING"; typing: boolean }
  | { type: "WEBRTC_OFFER" | "WEBRTC_ANSWER" | "WEBRTC_ICE"; to: string; payload: unknown };

export type ServerMessage =
  | { type: "JOINED"; room: RoomPublic; you: { id: string; displayName: string; role: string }; members: MemberPublic[]; chat: CollabChatMsg[] }
  | { type: "LEFT" }
  | { type: "MEMBERS"; members: MemberPublic[] }
  | { type: "CHAT_MESSAGE"; msg: CollabChatMsg }
  | { type: "CHAT_TYPING"; memberId: string; displayName: string; typing: boolean }
  | { type: "WEBRTC_OFFER" | "WEBRTC_ANSWER" | "WEBRTC_ICE"; from: string; fromName: string; payload: unknown }
  | { type: "ERROR"; code: string; message: string };

export type ErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_PAYLOAD"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_JOINED"
  | "ALREADY_JOINED"
  | "MEMBER_NOT_FOUND"
  | "RATE_LIMITED";

// ----- rate limiting -------------------------------------------------------

/** Simple token bucket. Exported for tests. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private capacity: number,
    private refillPerMs: number,
    now?: number,
  ) {
    this.tokens = capacity;
    this.last = now ?? Date.now();
  }
  take(now?: number): boolean {
    const t = now ?? Date.now();
    const elapsed = Math.max(0, t - this.last);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

interface Buckets {
  join: TokenBucket; // 5/min
  chat: TokenBucket; // burst 5, 1 per 500ms
  presence: TokenBucket; // burst 3, 1 per 2s
  signal: TokenBucket; // 20/min
}

function makeBuckets(now: number): Buckets {
  return {
    join: new TokenBucket(5, 5 / 60_000, now),
    chat: new TokenBucket(5, 1 / 500, now),
    presence: new TokenBucket(3, 1 / 2_000, now),
    signal: new TokenBucket(20, 20 / 60_000, now),
  };
}

interface ConnState {
  id: string;
  roomCode: string | null;
  displayName: string;
  role: string;
  buckets: Buckets;
  alive: boolean;
}

export interface CollabServerOptions {
  manager: RoomManager;
  path?: string;
  /** Log sink for operational events. Never receives tokens or message text. */
  log?: (msg: string) => void;
  now?: () => number;
  heartbeatMs?: number;
  sweepMs?: number;
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  INVALID_MESSAGE: "That message was not understood.",
  INVALID_PAYLOAD: "Some fields were missing or invalid.",
  ROOM_NOT_FOUND: "Room not found. Check the code and try again.",
  ROOM_FULL: "This room has reached its member limit.",
  NOT_JOINED: "Join a room first.",
  ALREADY_JOINED: "Already in this room.",
  MEMBER_NOT_FOUND: "That member is not in the room.",
  RATE_LIMITED: "You're sending messages too fast. Slow down a little.",
};

export class CollabServer {
  private wss: WebSocketServer;
  private conns = new Map<WebSocket, ConnState>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private path: string;
  private log: (msg: string) => void;
  private now: () => number;

  constructor(private opts: CollabServerOptions) {
    this.path = opts.path ?? COLLAB_WS_PATH;
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  get manager(): RoomManager {
    return this.opts.manager;
  }

  /** Test helper: how many sockets are currently tracked. */
  connectionCount(): number {
    return this.conns.size;
  }

  attach(http: HttpServer): void {
    http.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      let pathname = "";
      try {
        pathname = new URL(req.url || "", "http://localhost").pathname;
      } catch {
        /* fall through to 404 */
      }
      if (pathname !== this.path) {
        // Not ours — answer 404 so the socket doesn't hang.
        try {
          socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        } catch {
          /* ignore */
        }
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
    });

    const hbMs = this.opts.heartbeatMs ?? HEARTBEAT_MS;
    const swMs = this.opts.sweepMs ?? SWEEP_MS;
    const hb = setInterval(() => this.heartbeat(), hbMs);
    const sw = setInterval(() => this.sweep(), swMs);
    for (const t of [hb, sw]) {
      const u = t as unknown as { unref?: () => void };
      if (typeof u.unref === "function") u.unref();
      this.timers.push(t);
    }
  }

  close(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const ws of this.conns.keys()) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    try {
      this.wss.close();
    } catch {
      /* ignore */
    }
  }

  // ----- internals ---------------------------------------------------------

  private onConnection(ws: WebSocket): void {
    const now = this.now();
    const state: ConnState = {
      id: randomUUID(),
      roomCode: null,
      displayName: "",
      role: "member",
      buckets: makeBuckets(now),
      alive: true,
    };
    this.conns.set(ws, state);
    ws.on("pong", () => {
      state.alive = true;
    });
    ws.on("message", (data) => this.onMessage(ws, state, data));
    ws.on("close", () => this.onClose(ws, state));
    ws.on("error", () => {
      /* close event follows; nothing to do */
    });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private fail(ws: WebSocket, code: ErrorCode): void {
    this.send(ws, { type: "ERROR", code, message: ERROR_TEXT[code] });
  }

  private broadcast(roomCode: string, msg: ServerMessage, exclude?: WebSocket): void {
    const body = JSON.stringify(msg);
    for (const [ws, st] of this.conns) {
      if (st.roomCode !== roomCode || ws === exclude) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(body);
      } catch {
        /* ignore */
      }
    }
  }

  private onMessage(ws: WebSocket, state: ConnState, data: unknown): void {
    const now = this.now();
    state.alive = true;
    this.opts.manager.heartbeat(state.roomCode ?? "", state.id);
    let msg: ClientMessage;
    try {
      const text = typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8");
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
        this.fail(ws, "INVALID_MESSAGE");
        return;
      }
      msg = parsed as ClientMessage;
    } catch {
      this.fail(ws, "INVALID_MESSAGE");
      return;
    }

    switch (msg.type) {
      case "ROOM_JOIN":
        this.handleJoin(ws, state, msg, now);
        break;
      case "ROOM_LEAVE":
        this.handleLeave(ws, state, true);
        break;
      case "PRESENCE_UPDATE":
        this.handlePresence(ws, state, msg, now);
        break;
      case "CHAT_MESSAGE":
        this.handleChat(ws, state, msg, now);
        break;
      case "CHAT_TYPING":
        this.handleTyping(ws, state, msg, now);
        break;
      case "WEBRTC_OFFER":
      case "WEBRTC_ANSWER":
      case "WEBRTC_ICE":
        this.handleSignal(ws, state, msg, now);
        break;
      default:
        this.fail(ws, "INVALID_MESSAGE");
    }
  }

  private handleJoin(ws: WebSocket, state: ConnState, msg: Extract<ClientMessage, { type: "ROOM_JOIN" }>, now: number): void {
    if (!state.buckets.join.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    const roomId = normalizeRoomCode(msg.roomId);
    if (!isValidRoomCode(roomId) || typeof msg.displayName !== "string") {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    if (state.roomCode === roomId) {
      this.fail(ws, "ALREADY_JOINED");
      return;
    }
    // Leave any previous room first (one room per connection).
    if (state.roomCode) this.handleLeave(ws, state, false);

    const res = this.opts.manager.joinRoom(roomId, msg.displayName, typeof msg.ownerToken === "string" ? msg.ownerToken : undefined);
    if ("error" in res) {
      this.fail(ws, res.error === "ROOM_FULL" ? "ROOM_FULL" : res.error === "BAD_NAME" ? "INVALID_PAYLOAD" : "ROOM_NOT_FOUND");
      return;
    }
    state.roomCode = roomId;
    // Adopt the manager's member id so every later call (leave, chat,
    // presence, heartbeat) addresses the same membership record.
    state.id = res.member.id;
    state.displayName = res.member.displayName;
    state.role = res.member.role;
    const room = this.opts.manager.getRoom(roomId);
    this.send(ws, {
      type: "JOINED",
      room: room!,
      you: { id: res.member.id, displayName: res.member.displayName, role: res.member.role },
      members: this.opts.manager.listMembers(roomId),
      chat: this.opts.manager.getChat(roomId),
    });
    this.broadcast(roomId, { type: "MEMBERS", members: this.opts.manager.listMembers(roomId) }, ws);
    this.log(`join room=${roomId} members=${res.members.length + 1}`);
  }

  private handleLeave(ws: WebSocket, state: ConnState, notifySelf: boolean): void {
    const code = state.roomCode;
    if (!code) {
      if (notifySelf) this.send(ws, { type: "LEFT" });
      return;
    }
    // IMPORTANT: look up membership by the connection's own member id, never
    // trust a client-supplied id.
    this.opts.manager.leaveRoom(code, state.id);
    state.roomCode = null;
    if (notifySelf) this.send(ws, { type: "LEFT" });
    this.broadcast(code, { type: "MEMBERS", members: this.opts.manager.listMembers(code) });
    this.log(`leave room=${code}`);
  }

  private requireRoom(ws: WebSocket, state: ConnState): string | null {
    if (!state.roomCode) {
      this.fail(ws, "NOT_JOINED");
      return null;
    }
    return state.roomCode;
  }

  private handlePresence(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "PRESENCE_UPDATE" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.presence.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    const ok = this.opts.manager.setPresence(code, state.id, msg.status, msg.activity);
    if (!ok) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    this.broadcast(code, { type: "MEMBERS", members: this.opts.manager.listMembers(code) });
  }

  private handleChat(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "CHAT_MESSAGE" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.chat.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    const clean = sanitizeChatText(msg.text);
    if (!clean) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    const posted = this.opts.manager.postChat(code, state.id, clean);
    if (!posted) {
      // Membership vanished mid-flight (e.g. swept) — treat as not joined.
      this.fail(ws, "NOT_JOINED");
      return;
    }
    this.broadcast(code, { type: "CHAT_MESSAGE", msg: posted });
    // Message text is never logged.
    this.log(`chat room=${code} n=1`);
  }

  private handleTyping(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "CHAT_TYPING" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.presence.take(now)) return; // typing is cheap; drop silently
    if (typeof msg.typing !== "boolean") return;
    this.broadcast(
      code,
      { type: "CHAT_TYPING", memberId: state.id, displayName: state.displayName, typing: msg.typing },
      ws,
    );
  }

  private handleSignal(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "WEBRTC_OFFER" | "WEBRTC_ANSWER" | "WEBRTC_ICE" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.signal.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    if (typeof msg.to !== "string" || msg.to === state.id || msg.payload === undefined) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    let payloadSize = 0;
    try {
      payloadSize = JSON.stringify(msg.payload).length;
    } catch {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    if (payloadSize > 16 * 1024 || typeof msg.payload !== "object" || msg.payload === null) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    // Relay only to a member of the SAME room. Never trust client routing.
    let target: WebSocket | undefined;
    for (const [cand, st] of this.conns) {
      if (st.roomCode === code && st.id === msg.to && cand.readyState === WebSocket.OPEN) {
        target = cand;
        break;
      }
    }
    if (!target) {
      this.fail(ws, "MEMBER_NOT_FOUND");
      return;
    }
    this.send(target, { type: msg.type, from: state.id, fromName: state.displayName, payload: msg.payload });
  }

  private onClose(ws: WebSocket, state: ConnState): void {
    this.conns.delete(ws);
    if (state.roomCode) {
      const code = state.roomCode;
      this.opts.manager.leaveRoom(code, state.id);
      state.roomCode = null;
      this.broadcast(code, { type: "MEMBERS", members: this.opts.manager.listMembers(code) });
      this.log(`disconnect room=${code}`);
    }
  }

  private heartbeat(): void {
    for (const [ws, state] of this.conns) {
      if (!state.alive) {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        this.conns.delete(ws);
        if (state.roomCode) {
          const code = state.roomCode;
          this.opts.manager.leaveRoom(code, state.id);
          this.broadcast(code, { type: "MEMBERS", members: this.opts.manager.listMembers(code) });
        }
        continue;
      }
      state.alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }

  private sweep(): void {
    const removed = this.opts.manager.sweepPresence(this.now());
    for (const r of removed) {
      this.broadcast(r.roomId, { type: "MEMBERS", members: this.opts.manager.listMembers(r.roomId) });
      // Drop any connections whose membership was swept.
      for (const [ws, st] of this.conns) {
        if (st.roomCode === r.roomId && r.removed.includes(st.id)) {
          st.roomCode = null;
          this.send(ws, { type: "ERROR", code: "NOT_JOINED", message: ERROR_TEXT.NOT_JOINED });
        }
      }
    }
  }
}
