/**
 * Admin notification system tests.
 *
 * Covers:
 * - Auth: unauthenticated (401), normal user (403), admin (200)
 * - Notifications: create, save, delivery, unread count, mark read/all
 * - Security: isolation between users, input validation
 *
 * Uses the real AuthStore (temp dir) and drives the real HTTP handlers
 * with mock req/res — no mocked notifications, no fake users.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { AuthStore } from "../src/server/auth/store";
import { handleAdminApi, handleNotifyApi } from "../src/server/auth/notify-api";
import { setAuthStore } from "../src/server/auth/api";

function freshStore(): AuthStore {
  return new AuthStore(mkdtempSync(join(tmpdir(), "neutron-admin-")));
}

/** Minimal mock of IncomingMessage (async-iterable body). */
function mockReq(method: string, body?: unknown, token?: string): any {
  const raw = body !== undefined ? JSON.stringify(body) : "";
  const s = new Readable({
    read() {
      this.push(raw);
      this.push(null);
    },
  });
  (s as any).method = method;
  (s as any).headers = token ? { authorization: `Bearer ${token}` } : {};
  (s as any).socket = { remoteAddress: "127.0.0.1" };
  (s as any).url = "/";
  return s;
}

/** Minimal mock of ServerResponse capturing status + JSON body. */
function mockRes(): any {
  const chunks: Buffer[] = [];
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers;
    },
    end(data?: unknown) {
      if (data) chunks.push(Buffer.from(String(data)));
      res.text = Buffer.concat(chunks).toString("utf8");
      try { res.json = JSON.parse(res.text); } catch { res.json = null; }
      if (res.onEnd) res.onEnd();
    },
  };
  return res;
}

async function callAdmin(
  st: AuthStore, method: string, path: string, opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; json: any }> {
  setAuthStore(st);
  const req = mockReq(method, opts.body, opts.token);
  const res = mockRes();
  await handleAdminApi(undefined, req, res, new URL(`http://x${path}`));
  setAuthStore(null);
  return { status: res.statusCode, json: res.json };
}

async function callNotify(
  st: AuthStore, method: string, path: string, opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; json: any }> {
  setAuthStore(st);
  const req = mockReq(method, opts.body, opts.token);
  const res = mockRes();
  await handleNotifyApi(undefined, req, res, new URL(`http://x${path}`));
  setAuthStore(null);
  return { status: res.statusCode, json: res.json };
}

async function makeUsers(st: AuthStore) {
  const admin = await st.createUser({
    username: "boss", displayName: "Boss", provider: "email",
    email: "boss@test.com", role: "admin",
  });
  const alice = await st.createUser({
    username: "alice", displayName: "Alice", provider: "email",
    email: "alice@test.com",
  });
  const bob = await st.createUser({
    username: "bob", displayName: "Bob", provider: "email",
    email: "bob@test.com",
  });
  const adminTok = (await st.createSession(admin.id)).token;
  const aliceTok = (await st.createSession(alice.id)).token;
  const bobTok = (await st.createSession(bob.id)).token;
  return { admin, alice, bob, adminTok, aliceTok, bobTok };
}

describe("admin auth", () => {
  let st: AuthStore;
  beforeEach(() => { st = freshStore(); });

  it("rejects unauthenticated admin API calls (401)", async () => {
    const r = await callAdmin(st, "GET", "/api/admin/stats");
    expect(r.status).toBe(401);
  });

  it("rejects normal users from admin APIs (403)", async () => {
    const { aliceTok } = await makeUsers(st);
    const r = await callAdmin(st, "GET", "/api/admin/stats", { token: aliceTok });
    expect(r.status).toBe(403);
  });

  it("rejects invalid tokens (401)", async () => {
    const r = await callAdmin(st, "GET", "/api/admin/stats", { token: "bogus" });
    expect(r.status).toBe(401);
  });

  it("allows admins (200) with real stats", async () => {
    const { adminTok } = await makeUsers(st);
    const r = await callAdmin(st, "GET", "/api/admin/stats", { token: adminTok });
    expect(r.status).toBe(200);
    expect(r.json.stats.totalUsers).toBe(3);
  });

  it("normal users cannot send notifications (403)", async () => {
    const { aliceTok } = await makeUsers(st);
    const r = await callAdmin(st, "POST", "/api/admin/notifications", {
      token: aliceTok,
      body: { title: "X", message: "Y", type: "information", audience: "all" },
    });
    expect(r.status).toBe(403);
  });
});

describe("admin send + delivery", () => {
  let st: AuthStore;
  beforeEach(() => { st = freshStore(); });

  it("sends to all users and reports recipients", async () => {
    const { adminTok, alice, bob } = await makeUsers(st);
    const r = await callAdmin(st, "POST", "/api/admin/notifications", {
      token: adminTok,
      body: { title: "Hello", message: "World", type: "information", audience: "all" },
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.recipients).toBe(3); // admin + alice + bob

    // Both users received it.
    const au = await st.getUserNotifications(alice.id);
    const bu = await st.getUserNotifications(bob.id);
    expect(au).toHaveLength(1);
    expect(bu).toHaveLength(1);
    expect(au[0]!.title).toBe("Hello");
    expect(au[0]!.read).toBe(false);
  });

  it("sends to specific users only", async () => {
    const { adminTok, alice, bob } = await makeUsers(st);
    const r = await callAdmin(st, "POST", "/api/admin/notifications", {
      token: adminTok,
      body: {
        title: "DM", message: "Hi Alice", type: "success",
        audience: "specific", userIds: [alice.id],
      },
    });
    expect(r.json.recipients).toBe(1);
    expect(await st.getUserNotifications(alice.id)).toHaveLength(1);
    expect(await st.getUserNotifications(bob.id)).toHaveLength(0);
  });

  it("rejects invalid input", async () => {
    const { adminTok } = await makeUsers(st);
    const bad = [
      { title: "", message: "x", type: "information", audience: "all" },
      { title: "x", message: "", type: "information", audience: "all" },
      { title: "x", message: "y", type: "bogus", audience: "all" },
      { title: "x", message: "y", type: "information", audience: "bogus" },
      { title: "x", message: "y", type: "information", audience: "specific", userIds: [] },
      { title: "x", message: "y", type: "information", audience: "specific", userIds: ["not-a-user"] },
    ];
    for (const body of bad) {
      const r = await callAdmin(st, "POST", "/api/admin/notifications", { token: adminTok, body });
      expect(r.status).toBe(400);
    }
  });

  it("writes an audit entry", async () => {
    const { adminTok, admin } = await makeUsers(st);
    await callAdmin(st, "POST", "/api/admin/notifications", {
      token: adminTok,
      body: { title: "T", message: "M", type: "warning", audience: "all" },
    });
    const db = (st as any).mem || {};
    // Read via a fresh load to see persisted state.
    const items = await st.listNotifications({});
    expect(items.total).toBe(1);
    expect(items.items[0]!.createdBy).toBe(admin.id);
  });
});

describe("user notification center", () => {
  let st: AuthStore;
  beforeEach(() => { st = freshStore(); });

  it("unread count increases and mark-read works", async () => {
    const { adminTok, aliceTok, alice } = await makeUsers(st);
    await callAdmin(st, "POST", "/api/admin/notifications", {
      token: adminTok,
      body: { title: "A", message: "B", type: "information", audience: "all" },
    });

    let r = await callNotify(st, "GET", "/api/notifications/unread-count", { token: aliceTok });
    expect(r.json.count).toBe(1);

    const list = await callNotify(st, "GET", "/api/notifications", { token: aliceTok });
    const nid = list.json.items[0].notificationId;

    r = await callNotify(st, "PATCH", `/api/notifications/${nid}/read`, { token: aliceTok });
    expect(r.status).toBe(200);

    r = await callNotify(st, "GET", "/api/notifications/unread-count", { token: aliceTok });
    expect(r.json.count).toBe(0);
    expect(await st.getUnreadCount(alice.id)).toBe(0);
  });

  it("mark all as read works", async () => {
    const { adminTok, aliceTok } = await makeUsers(st);
    for (let i = 0; i < 3; i++) {
      await callAdmin(st, "POST", "/api/admin/notifications", {
        token: adminTok,
        body: { title: `T${i}`, message: "M", type: "information", audience: "all" },
      });
    }
    let r = await callNotify(st, "GET", "/api/notifications/unread-count", { token: aliceTok });
    expect(r.json.count).toBe(3);
    r = await callNotify(st, "PATCH", "/api/notifications/read-all", { token: aliceTok });
    expect(r.json.marked).toBe(3);
    r = await callNotify(st, "GET", "/api/notifications/unread-count", { token: aliceTok });
    expect(r.json.count).toBe(0);
  });

  it("users cannot read each other's notifications", async () => {
    const { adminTok, aliceTok, bobTok } = await makeUsers(st);
    await callAdmin(st, "POST", "/api/admin/notifications", {
      token: adminTok,
      body: { title: "T", message: "M", type: "information", audience: "all" },
    });
    const list = await callNotify(st, "GET", "/api/notifications", { token: aliceTok });
    const nid = list.json.items[0].notificationId;
    // Bob tries to mark Alice's notification read — the ID is the same
    // notification, but Bob's own user-notification row is separate.
    const r = await callNotify(st, "PATCH", `/api/notifications/${nid}/read`, { token: bobTok });
    expect(r.status).toBe(200); // marks Bob's own copy
    // Alice's copy is still unread.
    const ar = await callNotify(st, "GET", "/api/notifications/unread-count", { token: aliceTok });
    expect(ar.json.count).toBe(1);
  });

  it("unauthenticated user calls are rejected", async () => {
    const r = await callNotify(st, "GET", "/api/notifications");
    expect(r.status).toBe(401);
  });
});

describe("admin history", () => {
  let st: AuthStore;
  beforeEach(() => { st = freshStore(); });

  it("lists with search and type filter", async () => {
    const { adminTok } = await makeUsers(st);
    await callAdmin(st, "POST", "/api/admin/notifications", {
      token: adminTok,
      body: { title: "Update v2", message: "New stuff", type: "system_update", audience: "all" },
    });
    await callAdmin(st, "POST", "/api/admin/notifications", {
      token: adminTok,
      body: { title: "Hello", message: "Hi", type: "information", audience: "all" },
    });

    let r = await callAdmin(st, "GET", "/api/admin/notifications?type=system_update", { token: adminTok });
    expect(r.json.total).toBe(1);
    expect(r.json.items[0].title).toBe("Update v2");

    r = await callAdmin(st, "GET", "/api/admin/notifications?search=hello", { token: adminTok });
    expect(r.json.total).toBe(1);

    // Details endpoint.
    const id = r.json.items[0].id;
    r = await callAdmin(st, "GET", `/api/admin/notifications/${id}`, { token: adminTok });
    expect(r.json.notification.title).toBe("Hello");
    expect(r.json.notification.recipientCount).toBe(3);
  });
});
