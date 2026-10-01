/**
 * NEUTRON auth user store.
 *
 * Users, sessions, and connections. Two backends:
 *  - Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + TOKEN are set —
 *    persistent, survives Render free-tier sleeps.
 *  - JSON file fallback (data dir) — fine for local dev; EPHEMERAL on
 *    Render free tier (filesystem wipes on sleep). The API reports which
 *    backend is active via /api/auth/status so the UI can warn honestly.
 *
 * All secrets (password hashes) use scrypt. Sessions are opaque random
 * tokens with expiry. Usernames are unique (case-insensitive).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface User {
  id: string;
  username: string; // unique, case-insensitive; 3-24 chars [a-z0-9_.]
  displayName: string;
  provider: "google" | "email" | "guest";
  email?: string;
  passwordHash?: string; // scrypt, email provider only
  googleSub?: string; // google provider only
  avatarUrl?: string;
  createdAt: number;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface Connection {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending" | "accepted";
  createdAt: number;
}

interface DbShape {
  users: Record<string, User>;
  usernames: Record<string, string>; // lower(username) -> userId
  emails: Record<string, string>; // lower(email) -> userId
  googleSubs: Record<string, string>; // sub -> userId
  sessions: Record<string, Session>;
  connections: Record<string, Connection>;
}

const EMPTY: DbShape = {
  users: {}, usernames: {}, emails: {}, googleSubs: {}, sessions: {}, connections: {},
};

function redisCfg(): { url: string; token: string } | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

async function redis(cmd: (string | number)[]): Promise<any> {
  const cfg = redisCfg();
  if (!cfg) throw new Error("redis not configured");
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const data = (await res.json()) as { result?: any; error?: string };
  if (data.error) throw new Error(`redis: ${data.error}`);
  return data.result;
}

const REDIS_KEY = "neutron:auth:db:v1";

export class AuthStore {
  private mem: DbShape | null = null;
  private filePath: string;
  readonly persistent: boolean;

  constructor(dataDir: string) {
    this.persistent = redisCfg() !== null;
    try { mkdirSync(dataDir, { recursive: true }); } catch { /* ignore */ }
    this.filePath = join(dataDir, "auth.json");
  }

  /** Load the whole DB (small scale: users are few). */
  private async load(): Promise<DbShape> {
    if (this.persistent) {
      try {
        const raw = await redis(["GET", REDIS_KEY]);
        if (raw) {
          const db = JSON.parse(String(raw)) as DbShape;
          return { ...structuredClone(EMPTY), ...db };
        }
      } catch { /* fall through to empty */ }
      return structuredClone(EMPTY);
    }
    if (this.mem) return this.mem;
    try {
      if (existsSync(this.filePath)) {
        const db = JSON.parse(readFileSync(this.filePath, "utf8")) as DbShape;
        this.mem = { ...structuredClone(EMPTY), ...db };
        return this.mem;
      }
    } catch { /* corrupt -> start fresh */ }
    this.mem = structuredClone(EMPTY);
    return this.mem;
  }

  private async save(db: DbShape): Promise<void> {
    // Prune expired sessions on every write (cheap, keeps the DB small).
    const now = Date.now();
    for (const [t, s] of Object.entries(db.sessions)) {
      if (s.expiresAt <= now) delete db.sessions[t];
    }
    if (this.persistent) {
      await redis(["SET", REDIS_KEY, JSON.stringify(db)]);
      return;
    }
    this.mem = db;
    try { writeFileSync(this.filePath, JSON.stringify(db)); } catch { /* ignore */ }
  }

  private newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  // ----- users -----

  async findByUsername(username: string): Promise<User | null> {
    const db = await this.load();
    const id = db.usernames[username.toLowerCase()];
    return (id && db.users[id]) || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const db = await this.load();
    const id = db.emails[email.toLowerCase()];
    return (id && db.users[id]) || null;
  }

  async findByGoogleSub(sub: string): Promise<User | null> {
    const db = await this.load();
    const id = db.googleSubs[sub];
    return (id && db.users[id]) || null;
  }

  async findById(id: string): Promise<User | null> {
    const db = await this.load();
    return db.users[id] || null;
  }

  async usernameTaken(username: string): Promise<boolean> {
    const db = await this.load();
    return username.toLowerCase() in db.usernames;
  }

  /** Create a user; throws on duplicate username/email. */
  async createUser(u: Omit<User, "id" | "createdAt">): Promise<User> {
    const db = await this.load();
    const uname = u.username.toLowerCase();
    if (uname in db.usernames) throw new Error("username taken");
    if (u.email && u.email.toLowerCase() in db.emails) throw new Error("email taken");
    if (u.googleSub && u.googleSub in db.googleSubs) throw new Error("google account taken");
    const user: User = { ...u, id: this.newId("u"), createdAt: Date.now() };
    db.users[user.id] = user;
    db.usernames[uname] = user.id;
    if (user.email) db.emails[user.email.toLowerCase()] = user.id;
    if (user.googleSub) db.googleSubs[user.googleSub] = user.id;
    await this.save(db);
    return user;
  }

  async updateUser(id: string, patch: Partial<Pick<User, "displayName" | "avatarUrl" | "username">>): Promise<User | null> {
    const db = await this.load();
    const user = db.users[id];
    if (!user) return null;
    if (patch.username && patch.username.toLowerCase() !== user.username.toLowerCase()) {
      const uname = patch.username.toLowerCase();
      if (uname in db.usernames) throw new Error("username taken");
      delete db.usernames[user.username.toLowerCase()];
      db.usernames[uname] = id;
      user.username = patch.username;
    }
    if (patch.displayName !== undefined) user.displayName = patch.displayName;
    if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl;
    await this.save(db);
    return user;
  }

  // ----- sessions -----

  async createSession(userId: string, ttlMs = 30 * 24 * 3600 * 1000): Promise<Session> {
    const db = await this.load();
    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const s: Session = { token, userId, createdAt: now, expiresAt: now + ttlMs };
    db.sessions[token] = s;
    await this.save(db);
    return s;
  }

  async getSession(token: string): Promise<{ session: Session; user: User } | null> {
    const db = await this.load();
    const s = db.sessions[token];
    if (!s || s.expiresAt <= Date.now()) return null;
    const user = db.users[s.userId];
    if (!user) return null;
    return { session: s, user };
  }

  async deleteSession(token: string): Promise<void> {
    const db = await this.load();
    delete db.sessions[token];
    await this.save(db);
  }

  // ----- connections -----

  /** Send a friend request by username. Returns the connection or throws. */
  async requestConnection(fromUserId: string, toUsername: string): Promise<Connection> {
    const db = await this.load();
    const to = db.users[db.usernames[toUsername.toLowerCase()] || ""];
    if (!to) throw new Error("user not found");
    if (to.id === fromUserId) throw new Error("cannot connect to yourself");
    for (const c of Object.values(db.connections)) {
      const same = (c.fromUserId === fromUserId && c.toUserId === to.id) ||
        (c.fromUserId === to.id && c.toUserId === fromUserId);
      if (same) throw new Error(c.status === "accepted" ? "already connected" : "request pending");
    }
    const conn: Connection = {
      id: this.newId("c"), fromUserId, toUserId: to.id, status: "pending", createdAt: Date.now(),
    };
    db.connections[conn.id] = conn;
    await this.save(db);
    return conn;
  }

  async listConnections(userId: string): Promise<{ connection: Connection; peer: User }[]> {
    const db = await this.load();
    const out: { connection: Connection; peer: User }[] = [];
    for (const c of Object.values(db.connections)) {
      if (c.status !== "accepted") continue;
      const peerId = c.fromUserId === userId ? c.toUserId : c.toUserId === userId ? c.fromUserId : null;
      if (peerId && db.users[peerId]) out.push({ connection: c, peer: db.users[peerId] });
    }
    out.sort((a, b) => b.connection.createdAt - a.connection.createdAt);
    return out;
  }

  async listRequests(userId: string): Promise<{ connection: Connection; peer: User }[]> {
    const db = await this.load();
    const out: { connection: Connection; peer: User }[] = [];
    for (const c of Object.values(db.connections)) {
      if (c.status !== "pending" || c.toUserId !== userId) continue;
      const peer = db.users[c.fromUserId];
      if (peer) out.push({ connection: c, peer });
    }
    out.sort((a, b) => b.connection.createdAt - a.connection.createdAt);
    return out;
  }

  async respondToRequest(userId: string, connectionId: string, accept: boolean): Promise<Connection> {
    const db = await this.load();
    const c = db.connections[connectionId];
    if (!c || c.toUserId !== userId || c.status !== "pending") throw new Error("request not found");
    if (accept) {
      c.status = "accepted";
    } else {
      delete db.connections[connectionId];
    }
    await this.save(db);
    return c;
  }

  async removeConnection(userId: string, connectionId: string): Promise<void> {
    const db = await this.load();
    const c = db.connections[connectionId];
    if (!c || (c.fromUserId !== userId && c.toUserId !== userId)) throw new Error("not found");
    delete db.connections[connectionId];
    await this.save(db);
  }

  /** Public profile lookup by username (safe fields only). */
  async publicProfile(username: string): Promise<Pick<User, "id" | "username" | "displayName" | "avatarUrl" | "provider" | "createdAt"> | null> {
    const u = await this.findByUsername(username);
    if (!u) return null;
    return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, provider: u.provider, createdAt: u.createdAt };
  }

  /** Search users by username (partial, case-insensitive). Safe fields only. */
  async searchUsers(query: string, excludeUserId?: string, limit = 10): Promise<Pick<User, "username" | "displayName" | "avatarUrl" | "provider">[]> {
    const db = await this.load();
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    const out: Pick<User, "username" | "displayName" | "avatarUrl" | "provider">[] = [];
    for (const u of Object.values(db.users)) {
      if (excludeUserId && u.id === excludeUserId) continue;
      if (u.username.toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q)) {
        out.push({ username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, provider: u.provider });
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}

/** Validate a username: 3-24 chars, letters/numbers/underscore/dot. */
export function validUsername(u: string): boolean {
  return /^[a-zA-Z0-9_.]{3,24}$/.test(u);
}

/** Strip secrets before sending a user to the client. */
export function safeUser(u: User): Omit<User, "passwordHash"> {
  const { passwordHash: _drop, ...rest } = u;
  return rest;
}
