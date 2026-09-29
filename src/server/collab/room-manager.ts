/**
 * NEUTRON collaboration rooms — Phase 1: room registry, membership, chat
 * history, presence bookkeeping, and snapshot persistence.
 *
 * Pure logic + node builtins only (no `ws` here), so the whole module is
 * unit-testable. The WebSocket layer lives in collab-server.ts.
 *
 * Identity model: the app has no accounts (BYOK). Rooms work like shared-doc
 * links: anyone with the room code can join with a display name. The room
 * creator receives a one-time owner token (stored hashed server-side);
 * owner-only operations require it. The client is never trusted for roles.
 */
import { randomBytes, randomInt, createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOM_CODE_PREFIX = "NEUTRON-";
export const ROOM_CODE_RANDOM_LEN = 6;
/** Unambiguous alphabet: no 0/O, 1/I/L. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const MAX_ROOM_NAME = 60;
export const MAX_DISPLAY_NAME = 32;
export const MAX_ACTIVITY_LEN = 80;
export const MAX_CHAT_TEXT = 2000;
export const MAX_CHAT_PER_ROOM = 200;
export const MAX_MEMBERS_PER_ROOM = 50;
export const MAX_ROOMS = 500;
/** A member that has not been heard from for this long is dropped. */
export const PRESENCE_TIMEOUT_MS = 30_000;
/** Trailing-edge delay before a dirty room registry is snapshotted to disk. */
export const SNAPSHOT_DEBOUNCE_MS = 2_000;

export type PresenceStatus = "online" | "idle" | "away";
export type MemberRole = "owner" | "member";

export interface CollabMember {
  id: string;
  displayName: string;
  role: MemberRole;
  status: PresenceStatus;
  activity: string;
  joinedAt: number;
  lastSeen: number;
}

export interface CollabChatMsg {
  id: string;
  memberId: string;
  displayName: string;
  text: string;
  ts: number;
}

/** What the server tells clients about a room (never includes the token hash). */
export interface RoomPublic {
  id: string;
  name: string;
  createdAt: number;
  memberCount: number;
}

export interface MemberPublic {
  id: string;
  displayName: string;
  role: MemberRole;
  status: PresenceStatus;
  activity: string;
}

interface RoomRecord {
  id: string;
  name: string;
  createdAt: number;
  /** SHA-256 hex of the owner token. The raw token is shown once, at creation. */
  ownerTokenHash: string;
  members: Record<string, CollabMember>;
  chat: CollabChatMsg[];
}

interface SnapshotFile {
  version: 1;
  rooms: Array<{ id: string; name: string; createdAt: number; ownerTokenHash: string; chat: CollabChatMsg[] }>;
}

/** Normalize a user-typed room code: trim, drop inner whitespace, uppercase. */
export function normalizeRoomCode(code: unknown): string {
  return String(code ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

export function isValidRoomCode(code: unknown): boolean {
  const c = normalizeRoomCode(code);
  return new RegExp(`^${ROOM_CODE_PREFIX}[${CODE_ALPHABET}]{${ROOM_CODE_RANDOM_LEN}}$`).test(c);
}

export function sanitizeRoomName(name: unknown): string {
  return String(name ?? "").trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0, MAX_ROOM_NAME);
}

export function sanitizeDisplayName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, MAX_DISPLAY_NAME);
}

export function sanitizeChatText(text: unknown): string {
  return String(text ?? "").trim().slice(0, MAX_CHAT_TEXT);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function randomCodeSegment(): string {
  let s = "";
  for (let i = 0; i < ROOM_CODE_RANDOM_LEN; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function toPublicMember(m: CollabMember): MemberPublic {
  return { id: m.id, displayName: m.displayName, role: m.role, status: m.status, activity: m.activity };
}

export class RoomManager {
  private rooms = new Map<string, RoomRecord>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private now: () => number;

  /**
   * @param dataRoot  server data root; snapshots live in `<dataRoot>/.agent/collab/rooms.json`.
   * @param now       injectable clock (tests).
   */
  constructor(private dataRoot: string, now?: () => number) {
    this.now = now ?? Date.now;
  }

  get snapshotPath(): string {
    return join(this.dataRoot, ".agent", "collab", "rooms.json");
  }

  roomCount(): number {
    return this.rooms.size;
  }

  // ----- rooms -----------------------------------------------------------

  createRoom(name: string): { room: RoomPublic; ownerToken: string } {
    const clean = sanitizeRoomName(name) || "Untitled room";
    if (this.rooms.size >= MAX_ROOMS) throw new Error("ROOM_LIMIT_REACHED");
    let id = "";
    for (let i = 0; i < 20; i++) {
      const candidate = ROOM_CODE_PREFIX + randomCodeSegment();
      if (!this.rooms.has(candidate)) {
        id = candidate;
        break;
      }
    }
    if (!id) throw new Error("ROOM_CODE_COLLISION");
    const ownerToken = randomBytes(24).toString("hex");
    const rec: RoomRecord = {
      id,
      name: clean,
      createdAt: this.now(),
      ownerTokenHash: hashToken(ownerToken),
      members: {},
      chat: [],
    };
    this.rooms.set(id, rec);
    this.scheduleSave();
    return { room: this.publicRoom(rec), ownerToken };
  }

  getRoom(code: unknown): RoomPublic | undefined {
    const rec = this.rooms.get(normalizeRoomCode(code));
    return rec ? this.publicRoom(rec) : undefined;
  }

  isOwner(code: unknown, token: unknown): boolean {
    const rec = this.rooms.get(normalizeRoomCode(code));
    if (!rec || typeof token !== "string" || !token) return false;
    return tokensEqual(hashToken(token), rec.ownerTokenHash);
  }

  renameRoom(code: unknown, token: unknown, name: unknown): boolean {
    const rec = this.rooms.get(normalizeRoomCode(code));
    if (!rec || !this.isOwner(rec.id, token)) return false;
    const clean = sanitizeRoomName(name);
    if (!clean) return false;
    rec.name = clean;
    this.scheduleSave();
    return true;
  }

  deleteRoom(code: unknown, token: unknown): boolean {
    const id = normalizeRoomCode(code);
    const rec = this.rooms.get(id);
    if (!rec || !this.isOwner(id, token)) return false;
    this.rooms.delete(id);
    this.scheduleSave();
    return true;
  }

  private publicRoom(rec: RoomRecord): RoomPublic {
    return { id: rec.id, name: rec.name, createdAt: rec.createdAt, memberCount: Object.keys(rec.members).length };
  }

  // ----- membership ------------------------------------------------------

  joinRoom(
    code: unknown,
    displayName: unknown,
    ownerToken?: unknown,
  ): { member: CollabMember; members: MemberPublic[] } | { error: "ROOM_NOT_FOUND" | "ROOM_FULL" | "BAD_NAME" } {
    const id = normalizeRoomCode(code);
    const rec = this.rooms.get(id);
    if (!rec) return { error: "ROOM_NOT_FOUND" };
    const name = sanitizeDisplayName(displayName);
    if (!name) return { error: "BAD_NAME" };
    if (Object.keys(rec.members).length >= MAX_MEMBERS_PER_ROOM) return { error: "ROOM_FULL" };
    const now = this.now();
    const member: CollabMember = {
      id: randomId("m"),
      displayName: name,
      role: this.isOwner(id, ownerToken) ? "owner" : "member",
      status: "online",
      activity: "",
      joinedAt: now,
      lastSeen: now,
    };
    rec.members[member.id] = member;
    return { member, members: this.listMembers(id) };
  }

  leaveRoom(code: unknown, memberId: string): boolean {
    const rec = this.rooms.get(normalizeRoomCode(code));
    if (!rec || !rec.members[memberId]) return false;
    delete rec.members[memberId];
    return true;
  }

  /** Drop members silent for longer than PRESENCE_TIMEOUT_MS. Returns removals per room. */
  sweepPresence(now?: number): Array<{ roomId: string; removed: string[] }> {
    const t = now ?? this.now();
    const out: Array<{ roomId: string; removed: string[] }> = [];
    for (const rec of this.rooms.values()) {
      const removed: string[] = [];
      for (const [mid, m] of Object.entries(rec.members)) {
        if (t - m.lastSeen > PRESENCE_TIMEOUT_MS) {
          delete rec.members[mid];
          removed.push(mid);
        }
      }
      if (removed.length) out.push({ roomId: rec.id, removed });
    }
    return out;
  }

  heartbeat(code: unknown, memberId: string): boolean {
    const m = this.memberOf(code, memberId);
    if (!m) return false;
    m.lastSeen = this.now();
    return true;
  }

  setPresence(code: unknown, memberId: string, status: PresenceStatus, activity: unknown): boolean {
    const m = this.memberOf(code, memberId);
    if (!m) return false;
    if (status !== "online" && status !== "idle" && status !== "away") return false;
    m.status = status;
    m.activity = String(activity ?? "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, MAX_ACTIVITY_LEN);
    m.lastSeen = this.now();
    return true;
  }

  listMembers(code: unknown): MemberPublic[] {
    const rec = this.rooms.get(normalizeRoomCode(code));
    if (!rec) return [];
    return Object.values(rec.members)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(toPublicMember);
  }

  memberDisplayName(code: unknown, memberId: string): string | undefined {
    return this.memberOf(code, memberId)?.displayName;
  }

  memberIds(code: unknown): string[] {
    const rec = this.rooms.get(normalizeRoomCode(code));
    return rec ? Object.keys(rec.members) : [];
  }

  private memberOf(code: unknown, memberId: string): CollabMember | undefined {
    const rec = this.rooms.get(normalizeRoomCode(code));
    return rec?.members[memberId];
  }

  // ----- chat ------------------------------------------------------------

  postChat(code: unknown, memberId: string, text: unknown): CollabChatMsg | undefined {
    const rec = this.rooms.get(normalizeRoomCode(code));
    const m = rec?.members[memberId];
    if (!rec || !m) return undefined;
    const clean = sanitizeChatText(text);
    if (!clean) return undefined;
    const msg: CollabChatMsg = {
      id: randomId("c"),
      memberId: m.id,
      displayName: m.displayName,
      text: clean,
      ts: this.now(),
    };
    rec.chat.push(msg);
    if (rec.chat.length > MAX_CHAT_PER_ROOM) rec.chat.splice(0, rec.chat.length - MAX_CHAT_PER_ROOM);
    this.scheduleSave();
    return msg;
  }

  getChat(code: unknown): CollabChatMsg[] {
    const rec = this.rooms.get(normalizeRoomCode(code));
    return rec ? rec.chat.slice() : [];
  }

  // ----- persistence -----------------------------------------------------

  scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.saveNow();
      } catch {
        /* snapshot failure must never break the live server */
      }
    }, SNAPSHOT_DEBOUNCE_MS);
    // Don't hold the process open for a pending snapshot in tests.
    if (typeof this.saveTimer === "object" && typeof (this.saveTimer as unknown as { unref?: () => void }).unref === "function") {
      (this.saveTimer as unknown as { unref: () => void }).unref();
    }
  }

  saveNow(): void {
    const snap: SnapshotFile = {
      version: 1,
      // ownerTokenHash is a SHA-256 of a 192-bit random secret: safe to persist,
      // and it lets the creator still be recognized as owner after a restart.
      rooms: [...this.rooms.values()].map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        ownerTokenHash: r.ownerTokenHash,
        chat: r.chat,
      })),
    };
    const path = this.snapshotPath;
    mkdirSync(join(this.dataRoot, ".agent", "collab"), { recursive: true });
    writeFileSync(path, JSON.stringify(snap), "utf8");
  }

  /** Load a snapshot written by saveNow(). Members are session state and are NOT restored. */
  load(): void {
    const path = this.snapshotPath;
    if (!existsSync(path)) return;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return;
    }
    let snap: SnapshotFile;
    try {
      snap = JSON.parse(raw) as SnapshotFile;
    } catch {
      return; // corrupt snapshot — start fresh rather than crash
    }
    if (!snap || snap.version !== 1 || !Array.isArray(snap.rooms)) return;
    for (const r of snap.rooms) {
      if (!r || !isValidRoomCode(r.id) || typeof r.name !== "string") continue;
      if (this.rooms.has(r.id)) continue;
      this.rooms.set(r.id, {
        id: r.id,
        name: sanitizeRoomName(r.name) || "Untitled room",
        createdAt: typeof r.createdAt === "number" ? r.createdAt : this.now(),
        ownerTokenHash: typeof r.ownerTokenHash === "string" ? r.ownerTokenHash : "",
        members: {},
        chat: Array.isArray(r.chat) ? r.chat.slice(-MAX_CHAT_PER_ROOM) : [],
      });
    }
  }
}
