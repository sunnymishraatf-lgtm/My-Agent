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
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  RoomManager,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeChatText,
  sanitizeRoomName,
  type MemberPublic,
  type RoomPublic,
  type CollabChatMsg,
  type PresenceStatus,
} from "./room-manager";
import {
  CollabFileStore,
  MAX_UPDATE_BYTES,
  MAX_FILE_CHARS,
  type CollabFileMeta,
  type CollabVersion,
  type FileOpError,
} from "./file-store";

export const COLLAB_WS_PATH = "/collab";
/**
 * 2MB: the collab socket carries Yjs sync payloads (initial step-2 diffs can
 * approach the 500KB file cap). Per-message application caps (chat text,
 * single-update size, base64 lengths) still apply on top.
 */
const MAX_WS_PAYLOAD = 2 * 1024 * 1024;
const HEARTBEAT_MS = 15_000;
const SWEEP_MS = 10_000;
/** Sync frame types, mirroring y-protocols semantics (0/1/2). */
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;
/** Max base64 chars accepted for a sync payload (≈1MB of bytes). */
const MAX_SYNC_B64 = 1_420_000;

// ----- y-protocols-compatible sync framing ---------------------------------
// Frame: varuint(messageType) varuint8array(payload), base64'd inside JSON.
// Implemented here (not via y-protocols) so the wire stays dependency-free;
// semantics match y-websocket: both sides exchange step1, reply step2.

function writeVarUint(num: number, out: number[]): void {
  let n = num >>> 0;
  while (n > 127) {
    out.push(128 | (127 & n));
    n >>>= 7;
  }
  out.push(n);
}

function readVarUint(buf: Uint8Array, pos: { i: number }): number | null {
  let num = 0;
  let mult = 1;
  for (let k = 0; k < 5; k++) {
    if (pos.i >= buf.length) return null;
    const b: number | undefined = buf[pos.i++];
    if (b === undefined) return null;
    num += (b & 127) * mult;
    mult *= 128;
    if (b < 128) return num >>> 0;
  }
  return null;
}

export function encodeSyncFrame(type: number, payload: Uint8Array): Uint8Array {
  const out: number[] = [];
  writeVarUint(type, out);
  writeVarUint(payload.length, out);
  const res = new Uint8Array(out.length + payload.length);
  res.set(out, 0);
  res.set(payload, out.length);
  return res;
}

export function decodeSyncFrame(buf: Uint8Array): { type: number; payload: Uint8Array } | null {
  const pos = { i: 0 };
  const type = readVarUint(buf, pos);
  if (type === null) return null;
  const len = readVarUint(buf, pos);
  if (len === null || len < 0 || pos.i + len > buf.length) return null;
  return { type, payload: buf.slice(pos.i, pos.i + len) };
}

function b64encode(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64");
}

function b64decode(s: string): Uint8Array | null {
  if (typeof s !== "string" || s.length > MAX_SYNC_B64) return null;
  try {
    const buf = Buffer.from(s, "base64");
    if (buf.length > MAX_UPDATE_BYTES + 1024) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

function isValidFileId(id: unknown): boolean {
  return typeof id === "string" && /^f_[0-9a-f]{16}$/.test(id);
}

function isValidHexColor(c: unknown): boolean {
  return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
}

interface CursorPos {
  index: number;
  line: number;
  col: number;
}

function isValidCursor(c: unknown): c is CursorPos {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return (
    Number.isInteger(o.index) &&
    (o.index as number) >= 0 &&
    (o.index as number) <= MAX_FILE_CHARS &&
    Number.isInteger(o.line) &&
    (o.line as number) >= 1 &&
    (o.line as number) <= 100_000 &&
    Number.isInteger(o.col) &&
    (o.col as number) >= 1 &&
    (o.col as number) <= 100_000
  );
}

function isValidSelection(s: unknown): s is { anchor: number; head: number } | null | undefined {
  if (s === null || s === undefined) return true;
  if (typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    Number.isInteger(o.anchor) &&
    (o.anchor as number) >= 0 &&
    (o.anchor as number) <= MAX_FILE_CHARS &&
    Number.isInteger(o.head) &&
    (o.head as number) >= 0 &&
    (o.head as number) <= MAX_FILE_CHARS
  );
}

// ----- wire protocol -------------------------------------------------------

export type ClientMessage =
  | { type: "ROOM_JOIN"; roomId: string; displayName: string; ownerToken?: string }
  | { type: "ROOM_LEAVE" }
  | { type: "ROOM_RENAME"; name: string }
  | { type: "ROOM_DELETE" }
  | { type: "PRESENCE_UPDATE"; status: PresenceStatus; activity?: string }
  | { type: "CHAT_MESSAGE"; text: string }
  | { type: "CHAT_TYPING"; typing: boolean }
  | { type: "WEBRTC_OFFER" | "WEBRTC_ANSWER" | "WEBRTC_ICE"; to: string; payload: unknown }
  | { type: "FILE_LIST" }
  | { type: "FILE_CREATE"; path: string }
  | { type: "FILE_RENAME"; fileId: string; newPath: string }
  | { type: "FILE_DELETE"; fileId: string }
  | { type: "FILE_OPEN"; fileId: string }
  | { type: "FILE_CLOSE"; fileId: string }
  | { type: "FILE_SNAPSHOT_REQ"; fileId: string }
  | { type: "YJS_SYNC"; fileId: string; kind: "step1" | "step2" | "update"; data: string }
  | {
      type: "AWARENESS_UPDATE";
      fileId: string;
      cursor: CursorPos;
      selection?: { anchor: number; head: number } | null;
      color: string;
    }
  | { type: "VERSION_LIST"; fileId: string }
  | { type: "VERSION_TEXT"; fileId: string; ts: number }
  | { type: "VERSION_RESTORE"; fileId: string; ts: number };

export type ServerMessage =
  | { type: "JOINED"; room: RoomPublic; you: { id: string; displayName: string; role: string }; members: MemberPublic[]; chat: CollabChatMsg[]; files: CollabFileMeta[] }
  | { type: "LEFT" }
  | { type: "MEMBERS"; members: MemberPublic[] }
  | { type: "CHAT_MESSAGE"; msg: CollabChatMsg }
  | { type: "CHAT_TYPING"; memberId: string; displayName: string; typing: boolean }
  | { type: "WEBRTC_OFFER" | "WEBRTC_ANSWER" | "WEBRTC_ICE"; from: string; fromName: string; payload: unknown }
  | { type: "FILE_LIST_RESULT"; files: CollabFileMeta[] }
  | { type: "FILE_EVENT"; event: "created" | "renamed" | "deleted"; file?: CollabFileMeta; fileId?: string }
  | { type: "YJS_SYNC"; fileId: string; kind: "step1" | "step2" | "update"; data: string }
  | {
      type: "AWARENESS";
      fileId: string;
      memberId: string;
      displayName: string;
      color: string;
      cursor: CursorPos;
      selection?: { anchor: number; head: number } | null;
    }
  | { type: "ROOM_RENAMED"; name: string }
  | { type: "ROOM_DELETED" }
  | { type: "FILE_SNAPSHOT"; fileId: string; ok: boolean; ts: number }
  | { type: "VERSIONS"; fileId: string; versions: CollabVersion[] }
  | { type: "VERSION_TEXT"; fileId: string; ts: number; text: string }
  | { type: "ERROR"; code: string; message: string };

export type ErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_PAYLOAD"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_JOINED"
  | "ALREADY_JOINED"
  | "MEMBER_NOT_FOUND"
  | "NOT_OWNER"
  | "FILE_NOT_FOUND"
  | "FILE_EXISTS"
  | "INVALID_PATH"
  | "FILE_TOO_LARGE"
  | "UPDATE_TOO_LARGE"
  | "VERSION_NOT_FOUND"
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
  yjs: TokenBucket; // burst 30, 30 per second
  fileop: TokenBucket; // 10/min
  awareness: TokenBucket; // burst 8, 4 per second
}

function makeBuckets(now: number): Buckets {
  return {
    join: new TokenBucket(5, 5 / 60_000, now),
    chat: new TokenBucket(5, 1 / 500, now),
    presence: new TokenBucket(3, 1 / 2_000, now),
    signal: new TokenBucket(20, 20 / 60_000, now),
    yjs: new TokenBucket(30, 30 / 1_000, now),
    fileop: new TokenBucket(10, 10 / 60_000, now),
    awareness: new TokenBucket(8, 4 / 1_000, now),
  };
}

interface ConnState {
  id: string;
  roomCode: string | null;
  displayName: string;
  role: string;
  buckets: Buckets;
  alive: boolean;
  /** Files this connection currently has open (for targeted sync broadcast). */
  openFiles: Set<string>;
}

export interface CollabServerOptions {
  manager: RoomManager;
  path?: string;
  /** Data root for the shared-file store. Defaults to the manager's root. */
  dataRoot?: string;
  /** Inject a file store (tests). */
  fileStore?: CollabFileStore;
  /** Log sink for operational events. Never receives tokens or message text. */
  log?: (msg: string) => void;
  now?: () => number;
  heartbeatMs?: number;
  sweepMs?: number;
}

const FILE_OP_ERROR_TEXT: Record<FileOpError, ErrorCode> = {
  INVALID_PATH: "INVALID_PATH",
  FILE_EXISTS: "FILE_EXISTS",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UPDATE_TOO_LARGE: "UPDATE_TOO_LARGE",
  VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
};

const ERROR_TEXT: Record<ErrorCode, string> = {
  INVALID_MESSAGE: "That message was not understood.",
  INVALID_PAYLOAD: "Some fields were missing or invalid.",
  ROOM_NOT_FOUND: "Room not found. Check the code and try again.",
  ROOM_FULL: "This room has reached its member limit.",
  NOT_JOINED: "Join a room first.",
  ALREADY_JOINED: "Already in this room.",
  MEMBER_NOT_FOUND: "That member is not in the room.",
  NOT_OWNER: "Only the room owner can do that.",
  FILE_NOT_FOUND: "That file doesn't exist in this room.",
  FILE_EXISTS: "A file with that path already exists.",
  INVALID_PATH: "That file path isn't valid. Use a relative path like docs/notes.md.",
  FILE_TOO_LARGE: "That file exceeded the 500KB shared-editing limit.",
  UPDATE_TOO_LARGE: "That update was too large.",
  VERSION_NOT_FOUND: "That version is no longer available.",
  RATE_LIMITED: "You're sending messages too fast. Slow down a little.",
};

export class CollabServer {
  private wss: WebSocketServer;
  private conns = new Map<WebSocket, ConnState>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private path: string;
  private log: (msg: string) => void;
  private now: () => number;
  private files: CollabFileStore;

  constructor(private opts: CollabServerOptions) {
    this.path = opts.path ?? COLLAB_WS_PATH;
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.files = opts.fileStore ?? new CollabFileStore(opts.dataRoot ?? join(process.cwd(), ".neutron-data"), opts.now);
    // Honest save state: tell the whole room when a debounced snapshot lands
    // (openers show it in the editor status bar; others just track recency).
    this.files.onSnapshot = (roomCode, fileId, ok) => {
      this.broadcast(roomCode, { type: "FILE_SNAPSHOT", fileId, ok, ts: this.now() });
    };
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
      openFiles: new Set<string>(),
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
      case "ROOM_RENAME":
        this.handleRoomRename(ws, state, msg, now);
        break;
      case "ROOM_DELETE":
        this.handleRoomDelete(ws, state, now);
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
      case "FILE_LIST":
        this.handleFileList(ws, state);
        break;
      case "FILE_CREATE":
        this.handleFileCreate(ws, state, msg, now);
        break;
      case "FILE_RENAME":
        this.handleFileRename(ws, state, msg, now);
        break;
      case "FILE_DELETE":
        this.handleFileDelete(ws, state, msg, now);
        break;
      case "FILE_OPEN":
        this.handleFileOpen(ws, state, msg);
        break;
      case "FILE_CLOSE":
        this.handleFileClose(state, msg);
        break;
      case "FILE_SNAPSHOT_REQ":
        this.handleSnapshotReq(ws, state, msg, now);
        break;
      case "YJS_SYNC":
        this.handleYjsSync(ws, state, msg, now);
        break;
      case "AWARENESS_UPDATE":
        this.handleAwareness(ws, state, msg, now);
        break;
      case "VERSION_LIST":
        this.handleVersionList(ws, state, msg);
        break;
      case "VERSION_TEXT":
        this.handleVersionText(ws, state, msg);
        break;
      case "VERSION_RESTORE":
        this.handleVersionRestore(ws, state, msg, now);
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
      files: this.files.listFiles(roomId),
    });
    this.broadcast(roomId, { type: "MEMBERS", members: this.opts.manager.listMembers(roomId) }, ws);
    this.log(`join room=${roomId} members=${res.members.length + 1}`);
  }

  /** Snapshot + drop in-memory Yjs docs once nobody is left in the room. */
  private maybeReleaseRoom(code: string): void {
    const room = this.opts.manager.getRoom(code);
    if (room && room.memberCount === 0) {
      this.files.releaseRoom(code);
      this.log(`release room=${code}`);
    }
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
    state.openFiles.clear();
    if (notifySelf) this.send(ws, { type: "LEFT" });
    this.broadcast(code, { type: "MEMBERS", members: this.opts.manager.listMembers(code) });
    this.maybeReleaseRoom(code);
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

  /** Broadcast to room members that currently have a file open. */
  private broadcastFileOpeners(roomCode: string, fileId: string, msg: ServerMessage, exclude?: WebSocket): void {
    const body = JSON.stringify(msg);
    for (const [ws, st] of this.conns) {
      if (st.roomCode !== roomCode || !st.openFiles.has(fileId) || ws === exclude) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(body);
      } catch {
        /* ignore */
      }
    }
  }

  private requireOwner(ws: WebSocket, state: ConnState, code: string): boolean {
    // Role was derived server-side from the owner token at join; the client
    // is never trusted for it.
    if (state.role !== "owner" || !this.opts.manager.isRoomOwner(code, state.id)) {
      this.fail(ws, "NOT_OWNER");
      return false;
    }
    return true;
  }

  private failFileOp(ws: WebSocket, err: FileOpError): void {
    this.fail(ws, FILE_OP_ERROR_TEXT[err]);
  }

  // ----- room management (Phase 2) ---------------------------------------

  private handleRoomRename(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "ROOM_RENAME" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.fileop.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    if (!this.requireOwner(ws, state, code)) return;
    const clean = sanitizeRoomName(msg.name);
    if (!clean) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    if (!this.opts.manager.renameRoomByOwner(code, clean)) {
      this.fail(ws, "ROOM_NOT_FOUND");
      return;
    }
    this.broadcast(code, { type: "ROOM_RENAMED", name: clean });
    this.log(`room rename room=${code}`);
  }

  private handleRoomDelete(ws: WebSocket, state: ConnState, now: number): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.fileop.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    if (!this.requireOwner(ws, state, code)) return;
    if (!this.opts.manager.deleteRoomByOwner(code)) {
      this.fail(ws, "ROOM_NOT_FOUND");
      return;
    }
    this.files.deleteRoomData(code);
    this.broadcast(code, { type: "ROOM_DELETED" });
    // Drop every connection from the deleted room.
    for (const [cand, st] of this.conns) {
      if (st.roomCode === code) {
        st.roomCode = null;
        st.openFiles.clear();
      }
    }
    this.log(`room delete room=${code}`);
  }

  // ----- shared files (Phase 2) ------------------------------------------

  private handleFileList(ws: WebSocket, state: ConnState): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    this.send(ws, { type: "FILE_LIST_RESULT", files: this.files.listFiles(code) });
  }

  private handleFileCreate(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "FILE_CREATE" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.fileop.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    const res = this.files.createFile(code, msg.path, state.id, state.displayName);
    if ("error" in res) {
      this.failFileOp(ws, res.error);
      return;
    }
    this.broadcast(code, { type: "FILE_EVENT", event: "created", file: res.meta });
    this.log(`file create room=${code} path=${res.meta.path}`);
  }

  private handleFileRename(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "FILE_RENAME" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.fileop.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    if (!this.requireOwner(ws, state, code)) return;
    if (!isValidFileId(msg.fileId)) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    const res = this.files.renameFile(code, msg.fileId, msg.newPath);
    if ("error" in res) {
      this.failFileOp(ws, res.error);
      return;
    }
    this.broadcast(code, { type: "FILE_EVENT", event: "renamed", file: res.meta });
    this.log(`file rename room=${code} path=${res.meta.path}`);
  }

  private handleFileDelete(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "FILE_DELETE" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.fileop.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    if (!this.requireOwner(ws, state, code)) return;
    if (!isValidFileId(msg.fileId)) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    if (!this.files.deleteFile(code, msg.fileId)) {
      this.fail(ws, "FILE_NOT_FOUND");
      return;
    }
    // Close the file for everyone who had it open.
    for (const [, st] of this.conns) {
      if (st.roomCode === code) st.openFiles.delete(msg.fileId);
    }
    this.broadcast(code, { type: "FILE_EVENT", event: "deleted", fileId: msg.fileId });
    this.log(`file delete room=${code}`);
  }

  private handleFileOpen(ws: WebSocket, state: ConnState, msg: Extract<ClientMessage, { type: "FILE_OPEN" }>): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!isValidFileId(msg.fileId)) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    const sv = this.files.stateVector(code, msg.fileId);
    if (!sv) {
      this.fail(ws, "FILE_NOT_FOUND");
      return;
    }
    state.openFiles.add(msg.fileId);
    // y-websocket handshake, server side first: send our state vector.
    this.send(ws, { type: "YJS_SYNC", fileId: msg.fileId, kind: "step1", data: b64encode(encodeSyncFrame(SYNC_STEP1, sv)) });
  }

  private handleFileClose(state: ConnState, msg: Extract<ClientMessage, { type: "FILE_CLOSE" }>): void {
    if (isValidFileId(msg.fileId)) state.openFiles.delete(msg.fileId);
  }

  private handleSnapshotReq(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "FILE_SNAPSHOT_REQ" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.fileop.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    if (!isValidFileId(msg.fileId)) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    this.files.snapshotNow(code, msg.fileId);
  }

  private handleYjsSync(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "YJS_SYNC" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.yjs.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    if (!isValidFileId(msg.fileId) || !state.openFiles.has(msg.fileId)) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    const raw = b64decode(msg.data);
    if (!raw) {
      this.fail(ws, "UPDATE_TOO_LARGE");
      return;
    }
    const frame = decodeSyncFrame(raw);
    if (!frame) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }

    if (msg.kind === "step1") {
      // Client asks what it's missing → reply with the diff (step 2).
      if (frame.type !== SYNC_STEP1) {
        this.fail(ws, "INVALID_PAYLOAD");
        return;
      }
      const diff = this.files.diffUpdate(code, msg.fileId, frame.payload);
      if (diff === undefined) {
        this.fail(ws, "FILE_NOT_FOUND");
        return;
      }
      this.send(ws, {
        type: "YJS_SYNC",
        fileId: msg.fileId,
        kind: "step2",
        data: b64encode(encodeSyncFrame(SYNC_STEP2, diff)),
      });
      return;
    }

    if (msg.kind === "step2" || msg.kind === "update") {
      const wantType = msg.kind === "step2" ? SYNC_STEP2 : SYNC_UPDATE;
      if (frame.type !== wantType) {
        this.fail(ws, "INVALID_PAYLOAD");
        return;
      }
      const res = this.files.applyClientUpdate(code, msg.fileId, frame.payload, state.id, state.displayName);
      if ("error" in res) {
        this.failFileOp(ws, res.error);
        return;
      }
      // Relay the applied update to every other opener (CRDT merge on arrival).
      this.broadcastFileOpeners(
        code,
        msg.fileId,
        { type: "YJS_SYNC", fileId: msg.fileId, kind: "update", data: b64encode(encodeSyncFrame(SYNC_UPDATE, res.update)) },
        ws,
      );
      return;
    }

    this.fail(ws, "INVALID_PAYLOAD");
  }

  private handleAwareness(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "AWARENESS_UPDATE" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.awareness.take(now)) return; // ephemeral; drop silently
    if (!isValidFileId(msg.fileId) || !state.openFiles.has(msg.fileId)) return;
    if (!isValidCursor(msg.cursor) || !isValidSelection(msg.selection) || !isValidHexColor(msg.color)) return;
    // Relay only — awareness is never persisted.
    this.broadcastFileOpeners(
      code,
      msg.fileId,
      {
        type: "AWARENESS",
        fileId: msg.fileId,
        memberId: state.id,
        displayName: state.displayName,
        color: msg.color,
        cursor: msg.cursor,
        selection: msg.selection ?? null,
      },
      ws,
    );
  }

  private handleVersionList(ws: WebSocket, state: ConnState, msg: Extract<ClientMessage, { type: "VERSION_LIST" }>): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!isValidFileId(msg.fileId)) {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    this.send(ws, { type: "VERSIONS", fileId: msg.fileId, versions: this.files.listVersions(code, msg.fileId) });
  }

  private handleVersionText(ws: WebSocket, state: ConnState, msg: Extract<ClientMessage, { type: "VERSION_TEXT" }>): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!isValidFileId(msg.fileId) || typeof msg.ts !== "number") {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    const text = this.files.versionText(code, msg.fileId, msg.ts);
    if (text === undefined) {
      this.fail(ws, "VERSION_NOT_FOUND");
      return;
    }
    // Cap previews so a huge version can't blow the socket budget.
    this.send(ws, { type: "VERSION_TEXT", fileId: msg.fileId, ts: msg.ts, text: text.slice(0, 100_000) });
  }

  private handleVersionRestore(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "VERSION_RESTORE" }>,
    now: number,
  ): void {
    const code = this.requireRoom(ws, state);
    if (!code) return;
    if (!state.buckets.fileop.take(now)) {
      this.fail(ws, "RATE_LIMITED");
      return;
    }
    if (!this.requireOwner(ws, state, code)) return;
    if (!isValidFileId(msg.fileId) || typeof msg.ts !== "number") {
      this.fail(ws, "INVALID_PAYLOAD");
      return;
    }
    const res = this.files.restoreVersion(code, msg.fileId, msg.ts, state.id, state.displayName);
    if ("error" in res) {
      this.failFileOp(ws, res.error);
      return;
    }
    // The restore is a normal Yjs update: every opener merges it via CRDT.
    if (res.update.length > 0) {
      this.broadcastFileOpeners(code, msg.fileId, {
        type: "YJS_SYNC",
        fileId: msg.fileId,
        kind: "update",
        data: b64encode(encodeSyncFrame(SYNC_UPDATE, res.update)),
      });
    }
    this.log(`version restore room=${code} ts=${msg.ts}`);
  }

  private onClose(ws: WebSocket, state: ConnState): void {
    this.conns.delete(ws);
    state.openFiles.clear();
    if (state.roomCode) {
      const code = state.roomCode;
      this.opts.manager.leaveRoom(code, state.id);
      state.roomCode = null;
      this.broadcast(code, { type: "MEMBERS", members: this.opts.manager.listMembers(code) });
      this.maybeReleaseRoom(code);
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
          this.maybeReleaseRoom(code);
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
          st.openFiles.clear();
          this.send(ws, { type: "ERROR", code: "NOT_JOINED", message: ERROR_TEXT.NOT_JOINED });
        }
      }
      this.maybeReleaseRoom(r.roomId);
    }
  }
}
