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
import { randomBytes } from "node:crypto";

export interface User {
  id: string;
  username: string; // unique, case-insensitive; 3-24 chars [a-z0-9_.]
  displayName: string;
  bio?: string; // short profile bio, max 160 chars
  provider: "google" | "email" | "guest";
  email?: string;
  emailVerified?: boolean; // email provider: true after clicking the verify link
  passwordHash?: string; // scrypt, email provider only
  googleSub?: string; // google provider only
  avatarUrl?: string;
  role: "user" | "admin"; // default "user"; admins via NEUTRON_ADMIN_EMAILS
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

export type NotificationType = "information" | "success" | "warning" | "important" | "system_update";
export type NotificationAudience = "all" | "active" | "specific";

export interface AdminNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  audience: NotificationAudience;
  targetUserIds?: string[]; // audience === "specific"
  createdBy: string; // admin userId
  createdByEmail?: string | undefined;
  recipientCount: number;
  createdAt: number;
  status: "sent";
}

export interface UserNotification {
  id: string; // `${userId}:${notificationId}`
  userId: string;
  notificationId: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  readAt: number | null;
  deliveredAt: number;
  createdAt: number;
}

export interface AuditEntry {
  id: string;
  adminId: string;
  adminEmail?: string | undefined;
  action: "SEND_NOTIFICATION";
  notificationId?: string;
  timestamp: number;
  details?: string;
}

export interface ProfileView {
  viewerId: string;
  viewedAt: number;
}

export interface EmailVerification {
  token: string;
  userId: string;
  createdAt: number;
}

export interface PasswordReset {
  token: string;
  userId: string;
  createdAt: number;
}

interface DbShape {
  users: Record<string, User>;
  usernames: Record<string, string>; // lower(username) -> userId
  emails: Record<string, string>; // lower(email) -> userId
  googleSubs: Record<string, string>; // sub -> userId
  sessions: Record<string, Session>;
  connections: Record<string, Connection>;
  profileViews: Record<string, ProfileView[]>; // viewedUserId -> views (newest first)
  verifications: Record<string, EmailVerification>; // token -> verification
  passwordResets: Record<string, PasswordReset>; // token -> reset request
  notifications: Record<string, AdminNotification>; // id -> notification
  userNotifications: Record<string, UserNotification>; // `${userId}:${notificationId}` -> entry
  auditLog: AuditEntry[]; // newest last; capped
}

const EMPTY: DbShape = {
  users: {}, usernames: {}, emails: {}, googleSubs: {}, sessions: {}, connections: {},
  profileViews: {}, verifications: {}, passwordResets: {},
  notifications: {}, userNotifications: {}, auditLog: [],
};

/** Migrate older DB shapes: default missing user roles, ensure collections. */
function migrate(db: DbShape): DbShape {
  for (const u of Object.values(db.users)) {
    if (u.role !== "admin" && u.role !== "user") u.role = "user";
  }
  if (!db.notifications) db.notifications = {};
  if (!db.userNotifications) db.userNotifications = {};
  if (!Array.isArray(db.auditLog)) db.auditLog = [];
  return db;
}

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
          return migrate({ ...structuredClone(EMPTY), ...db });
        }
      } catch { /* fall through to empty */ }
      return structuredClone(EMPTY);
    }
    if (this.mem) return this.mem;
    try {
      if (existsSync(this.filePath)) {
        const db = JSON.parse(readFileSync(this.filePath, "utf8")) as DbShape;
        this.mem = migrate({ ...structuredClone(EMPTY), ...db });
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
  async createUser(u: Omit<User, "id" | "createdAt" | "role"> & { role?: User["role"] }): Promise<User> {
    const db = await this.load();
    const uname = u.username.toLowerCase();
    if (uname in db.usernames) throw new Error("username taken");
    if (u.email && u.email.toLowerCase() in db.emails) throw new Error("email taken");
    if (u.googleSub && u.googleSub in db.googleSubs) throw new Error("google account taken");
    const user: User = { ...u, role: u.role || "user", id: this.newId("u"), createdAt: Date.now() };
    db.users[user.id] = user;
    db.usernames[uname] = user.id;
    if (user.email) db.emails[user.email.toLowerCase()] = user.id;
    if (user.googleSub) db.googleSubs[user.googleSub] = user.id;
    await this.save(db);
    return user;
  }

  async updateUser(id: string, patch: Partial<Pick<User, "displayName" | "avatarUrl" | "username" | "bio">>): Promise<User | null> {
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
    if (patch.bio !== undefined) user.bio = patch.bio.slice(0, 160);
    await this.save(db);
    return user;
  }

  /** Record that viewerId viewed targetUserId's profile. */
  async recordProfileView(viewerId: string, targetUsername: string): Promise<void> {
    const db = await this.load();
    const target = db.users[db.usernames[targetUsername.toLowerCase()] || ""];
    if (!target || target.id === viewerId) return; // no self-views
    const views = (db.profileViews[target.id] = db.profileViews[target.id] || []);
    // Move existing view to front (dedupe), or add new.
    const existing = views.findIndex((v) => v.viewerId === viewerId);
    if (existing >= 0) views.splice(existing, 1);
    views.unshift({ viewerId, viewedAt: Date.now() });
    // Keep last 50 views.
    if (views.length > 50) views.length = 50;
    await this.save(db);
  }

  /** Who viewed my profile (newest first), with safe user fields. */
  async getProfileViews(userId: string): Promise<{ viewer: Pick<User, "username" | "displayName" | "avatarUrl">; viewedAt: number }[]> {
    const db = await this.load();
    const views = db.profileViews[userId] || [];
    const out: { viewer: Pick<User, "username" | "displayName" | "avatarUrl">; viewedAt: number }[] = [];
    for (const v of views) {
      const u = db.users[v.viewerId];
      if (u) out.push({ viewer: { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl }, viewedAt: v.viewedAt });
    }
    return out;
  }

  /** Create (or replace) an email verification token for a user. */
  async createEmailVerification(userId: string): Promise<string> {
    const db = await this.load();
    // Remove any existing tokens for this user.
    for (const [tok, v] of Object.entries(db.verifications)) {
      if (v.userId === userId) delete db.verifications[tok];
    }
    const token = "ev_" + randomBytes(24).toString("hex");
    db.verifications[token] = { token, userId, createdAt: Date.now() };
    await this.save(db);
    return token;
  }

  /** Verify an email token. Returns the user if valid, null if not. */
  async verifyEmailToken(token: string): Promise<User | null> {
    const db = await this.load();
    const v = db.verifications[token];
    if (!v) return null;
    // Tokens expire after 24 hours.
    if (Date.now() - v.createdAt > 24 * 60 * 60 * 1000) {
      delete db.verifications[token];
      await this.save(db);
      return null;
    }
    const user = db.users[v.userId];
    if (!user) {
      delete db.verifications[token];
      await this.save(db);
      return null;
    }
    user.emailVerified = true;
    delete db.verifications[token];
    await this.save(db);
    return user;
  }

  /** Create (or replace) a password-reset token for a user. 1-hour expiry. */
  async createPasswordReset(userId: string): Promise<string> {
    const db = await this.load();
    // Remove any existing reset tokens for this user.
    for (const [tok, v] of Object.entries(db.passwordResets)) {
      if (v.userId === userId) delete db.passwordResets[tok];
    }
    const token = "pr_" + randomBytes(24).toString("hex");
    db.passwordResets[token] = { token, userId, createdAt: Date.now() };
    await this.save(db);
    return token;
  }

  /**
   * Consume a password-reset token: validates it, sets the new password
   * hash, and deletes the token (single-use). Returns the user, or null
   * when the token is missing/expired.
   */
  async consumePasswordReset(token: string, newPasswordHash: string): Promise<User | null> {
    const db = await this.load();
    const r = db.passwordResets[token];
    if (!r) return null;
    // Tokens expire after 1 hour.
    if (Date.now() - r.createdAt > 60 * 60 * 1000) {
      delete db.passwordResets[token];
      await this.save(db);
      return null;
    }
    const user = db.users[r.userId];
    if (!user || user.provider !== "email") {
      delete db.passwordResets[token];
      await this.save(db);
      return null;
    }
    user.passwordHash = newPasswordHash;
    delete db.passwordResets[token];
    // A password reset revokes every existing session.
    for (const [tok, s] of Object.entries(db.sessions)) {
      if (s.userId === user.id) delete db.sessions[tok];
    }
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

  /** Revoke every session for a user (used after a password reset). */
  async deleteSessionsForUser(userId: string): Promise<number> {
    const db = await this.load();
    let n = 0;
    for (const [tok, s] of Object.entries(db.sessions)) {
      if (s.userId === userId) { delete db.sessions[tok]; n++; }
    }
    if (n) await this.save(db);
    return n;
  }

  // ----- admin notifications -----

  /** Promote/demote a user. Returns the updated user or null. */
  async setUserRole(userId: string, role: "user" | "admin"): Promise<User | null> {
    const db = await this.load();
    const u = db.users[userId];
    if (!u) return null;
    u.role = role;
    await this.save(db);
    return u;
  }

  /** Emails listed in NEUTRON_ADMIN_EMAILS get the admin role on login/register. */
  adminEmails(): string[] {
    return (process.env.NEUTRON_ADMIN_EMAILS || "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  /** Ensure the user's role reflects NEUTRON_ADMIN_EMAILS. Returns true if changed. */
  async syncAdminRole(user: User): Promise<boolean> {
    if (!user.email) return false;
    const shouldBeAdmin = this.adminEmails().includes(user.email.toLowerCase());
    const isAdmin = user.role === "admin";
    // Only auto-promote; never auto-demote (demotion is a manual admin action).
    if (shouldBeAdmin && !isAdmin) {
      await this.setUserRole(user.id, "admin");
      return true;
    }
    return false;
  }

  async createNotification(n: Omit<AdminNotification, "id" | "createdAt" | "status" | "recipientCount"> & { recipientCount: number }): Promise<AdminNotification> {
    const db = await this.load();
    const notif: AdminNotification = {
      ...n, id: this.newId("n"), createdAt: Date.now(), status: "sent",
    };
    db.notifications[notif.id] = notif;
    await this.save(db);
    return notif;
  }

  async getNotification(id: string): Promise<AdminNotification | null> {
    const db = await this.load();
    return db.notifications[id] || null;
  }

  async listNotifications(opts: { type?: string; search?: string; limit?: number; offset?: number } = {}): Promise<{ items: AdminNotification[]; total: number }> {
    const db = await this.load();
    let items = Object.values(db.notifications).sort((a, b) => b.createdAt - a.createdAt);
    if (opts.type) items = items.filter((n) => n.type === opts.type);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      items = items.filter((n) =>
        n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q));
    }
    const total = items.length;
    const offset = Math.max(0, opts.offset || 0);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    return { items: items.slice(offset, offset + limit), total };
  }

  /** Fan out a notification to user IDs; returns the recipient count. */
  async deliverNotification(notif: AdminNotification, userIds: string[]): Promise<number> {
    const db = await this.load();
    const now = Date.now();
    let n = 0;
    for (const uid of userIds) {
      if (!db.users[uid]) continue;
      const un: UserNotification = {
        id: `${uid}:${notif.id}`,
        userId: uid,
        notificationId: notif.id,
        title: notif.title,
        message: notif.message,
        type: notif.type,
        read: false,
        readAt: null,
        deliveredAt: now,
        createdAt: notif.createdAt,
      };
      db.userNotifications[un.id] = un;
      n++;
    }
    await this.save(db);
    return n;
  }

  /** Resolve the target user IDs for an audience. */
  async resolveAudience(audience: NotificationAudience, specificIds?: string[]): Promise<string[]> {
    const db = await this.load();
    const ids = Object.keys(db.users);
    if (audience === "all") return ids;
    if (audience === "specific") {
      const set = new Set(specificIds || []);
      return ids.filter((id) => set.has(id));
    }
    // "active": logged in (session created) within the last 30 days.
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const active = new Set<string>();
    for (const s of Object.values(db.sessions)) {
      if (s.createdAt >= cutoff) active.add(s.userId);
    }
    return ids.filter((id) => active.has(id));
  }

  async getUserNotifications(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<UserNotification[]> {
    const db = await this.load();
    let items = Object.values(db.userNotifications)
      .filter((un) => un.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (opts.unreadOnly) items = items.filter((un) => !un.read);
    const limit = Math.min(100, Math.max(1, opts.limit || 50));
    return items.slice(0, limit);
  }

  async getUnreadCount(userId: string): Promise<number> {
    const db = await this.load();
    let n = 0;
    for (const un of Object.values(db.userNotifications)) {
      if (un.userId === userId && !un.read) n++;
    }
    return n;
  }

  /** Mark one notification read. Returns false if it doesn't belong to the user. */
  async markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
    const db = await this.load();
    const un = db.userNotifications[`${userId}:${notificationId}`];
    if (!un) return false;
    if (!un.read) {
      un.read = true;
      un.readAt = Date.now();
      await this.save(db);
    }
    return true;
  }

  async markAllNotificationsRead(userId: string): Promise<number> {
    const db = await this.load();
    let n = 0;
    const now = Date.now();
    for (const un of Object.values(db.userNotifications)) {
      if (un.userId === userId && !un.read) {
        un.read = true;
        un.readAt = now;
        n++;
      }
    }
    if (n) await this.save(db);
    return n;
  }

  async logAudit(e: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    const db = await this.load();
    const entry: AuditEntry = { ...e, id: this.newId("a"), timestamp: Date.now() };
    db.auditLog.push(entry);
    // Cap the log at 1000 entries.
    if (db.auditLog.length > 1000) db.auditLog.splice(0, db.auditLog.length - 1000);
    await this.save(db);
    return entry;
  }

  /** Dashboard stats: total users, active users, notifications sent, sent today. */
  async adminStats(): Promise<{ totalUsers: number; activeUsers: number; notificationsSent: number; sentToday: number }> {
    const db = await this.load();
    const totalUsers = Object.keys(db.users).length;
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const active = new Set<string>();
    for (const s of Object.values(db.sessions)) {
      if (s.createdAt >= cutoff) active.add(s.userId);
    }
    const notifs = Object.values(db.notifications);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return {
      totalUsers,
      activeUsers: active.size,
      notificationsSent: notifs.length,
      sentToday: notifs.filter((n) => n.createdAt >= dayStart.getTime()).length,
    };
  }

  /** Lightweight user list for admin targeting/search. */
  async adminUserList(search?: string, limit = 50): Promise<Array<Pick<User, "id" | "username" | "displayName" | "email" | "role" | "createdAt">>> {
    const db = await this.load();
    let users = Object.values(db.users).sort((a, b) => b.createdAt - a.createdAt);
    if (search) {
      const q = search.toLowerCase();
      users = users.filter((u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q));
    }
    return users.slice(0, Math.min(100, Math.max(1, limit))).map((u) => ({
      id: u.id, username: u.username, displayName: u.displayName,
      email: u.email, role: u.role, createdAt: u.createdAt,
    }));
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
  async publicProfile(username: string): Promise<Pick<User, "id" | "username" | "displayName" | "bio" | "avatarUrl" | "provider" | "createdAt"> | null> {
    const u = await this.findByUsername(username);
    if (!u) return null;
    return { id: u.id, username: u.username, displayName: u.displayName, bio: u.bio, avatarUrl: u.avatarUrl, provider: u.provider, createdAt: u.createdAt };
  }

  /** Search users by username (partial, case-insensitive). Safe fields only. */
  async searchUsers(query: string, excludeUserId?: string, limit = 10): Promise<Pick<User, "username" | "displayName" | "bio" | "avatarUrl" | "provider">[]> {
    const db = await this.load();
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    const out: Pick<User, "username" | "displayName" | "bio" | "avatarUrl" | "provider">[] = [];
    for (const u of Object.values(db.users)) {
      if (excludeUserId && u.id === excludeUserId) continue;
      if (u.username.toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q)) {
        out.push({ username: u.username, displayName: u.displayName, bio: u.bio, avatarUrl: u.avatarUrl, provider: u.provider });
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
