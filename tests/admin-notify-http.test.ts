/**
 * Admin notification system — real HTTP end-to-end tests.
 *
 * Boots the REAL server (startServer) on an ephemeral port with a REAL
 * AuthStore (temp dir) and drives it over real HTTP + WebSocket:
 * no mocked requests, no mocked notifications, no fake users.
 *
 * Covers:
 * - Full authenticated admin-send flow over HTTP (send -> user inbox ->
 *   unread count -> mark read)
 * - Realtime WebSocket delivery + auth (valid token, bad token, no auth)
 * - 422 when no eligible users, 413 oversized body, 429 rate limiting
 * - Date filters on admin history
 * - /admin route alias redirect
 * - Cross-user isolation over HTTP
 * - /api/admin/system + /api/admin/audit
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { AuthStore } from "../src/server/auth/store";
import { setAuthStore } from "../src/server/auth/api";
import { startServer, type RunningServer } from "../src/server/server";
import { NotifySocketServer, NOTIFY_WS_PATH } from "../src/server/auth/notify-socket";

let running: RunningServer;
let base: string;
let wsBase: string;
let st: AuthStore;
let admin: any, alice: any, bob: any;
let adminTok = "", aliceTok = "", bobTok = "";

async function api(method: string, path: string, opts: { token?: string; body?: unknown; rawBody?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    headers["content-type"] = "application/json";
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(base + path, { method, headers, body, redirect: "manual" });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON (redirects) */ }
  return { status: res.status, json, headers: res.headers };
}

function sendAs(token: string, payload: Record<string, unknown>) {
  return api("POST", "/api/admin/notifications", { token, body: payload });
}

beforeAll(async () => {
  st = new AuthStore(mkdtempSync(join(tmpdir(), "neutron-admin-http-")));
  setAuthStore(st);
  admin = await st.createUser({ username: "boss", displayName: "Boss", provider: "email", email: "boss@test.com", role: "admin" });
  alice = await st.createUser({ username: "alice", displayName: "Alice", provider: "email", email: "alice@test.com" });
  bob = await st.createUser({ username: "bob", displayName: "Bob", provider: "email", email: "bob@test.com" });
  adminTok = (await st.createSession(admin.id)).token;
  aliceTok = (await st.createSession(alice.id)).token;
  bobTok = (await st.createSession(bob.id)).token;
  const root = mkdtempSync(join(tmpdir(), "neutron-admin-http-root-"));
  running = await startServer({ root, port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${running.port}`;
  wsBase = `ws://127.0.0.1:${running.port}`;
}, 60000);

afterAll(async () => {
  await running.close();
  setAuthStore(null);
});

describe("full HTTP admin-send flow", () => {
  it("send -> inbox -> unread count -> mark read, all over real HTTP", async () => {
    const r = await sendAs(adminTok, {
      title: "HTTP E2E", message: "real http flow", type: "information", audience: "all",
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.recipients).toBe(3); // admin + alice + bob

    const inbox = await api("GET", "/api/notifications", { token: aliceTok });
    expect(inbox.status).toBe(200);
    expect(inbox.json.items.length).toBeGreaterThanOrEqual(1);
    expect(inbox.json.items[0].title).toBe("HTTP E2E");
    expect(inbox.json.items[0].read).toBe(false);

    const c1 = await api("GET", "/api/notifications/unread-count", { token: aliceTok });
    expect(c1.json.count).toBeGreaterThanOrEqual(1);

    const mark = await api("POST", "/api/notifications/read-all", { token: aliceTok });
    expect(mark.status).toBe(200);

    const c2 = await api("GET", "/api/notifications/unread-count", { token: aliceTok });
    expect(c2.json.count).toBe(0);
  });

  it("rejects unauthenticated (401) and non-admin (403) sends over HTTP", async () => {
    const noAuth = await sendAs("", { title: "x", message: "y", type: "information", audience: "all" });
    expect(noAuth.status).toBe(401);
    const user = await sendAs(aliceTok, { title: "x", message: "y", type: "information", audience: "all" });
    expect(user.status).toBe(403);
  });

  it("specific audience reaches only the targeted user", async () => {
    const r = await sendAs(adminTok, {
      title: "For Alice", message: "only alice", type: "success", audience: "specific", userIds: [alice.id],
    });
    expect(r.status).toBe(200);
    expect(r.json.recipients).toBe(1);
    const bobInbox = await api("GET", "/api/notifications?unreadOnly=1", { token: bobTok });
    const titles = (bobInbox.json.items || []).map((n: any) => n.title);
    expect(titles).not.toContain("For Alice");
    const aliceInbox = await api("GET", "/api/notifications?unreadOnly=1", { token: aliceTok });
    expect((aliceInbox.json.items || []).map((n: any) => n.title)).toContain("For Alice");
  });
});

describe("realtime WebSocket delivery", () => {
  function connect(): Promise<WebSocket> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(wsBase + NOTIFY_WS_PATH);
      ws.once("open", () => res(ws));
      ws.once("error", rej);
    });
  }
  function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<any> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timed out waiting for WS message")), timeoutMs);
      ws.once("message", (d) => { clearTimeout(t); res(JSON.parse(String(d))); });
    });
  }

  it("delivers the notification to the online recipient instantly", async () => {
    const ws = await connect();
    try {
      ws.send(JSON.stringify({ type: "auth", token: bobTok }));
      const ready = await nextMessage(ws);
      expect(ready.type).toBe("ready");
      expect(typeof ready.unreadCount).toBe("number");

      const msgP = nextMessage(ws);
      const r = await sendAs(adminTok, {
        title: "Realtime ping", message: "instant", type: "warning", audience: "specific", userIds: [bob.id],
      });
      expect(r.status).toBe(200);
      const msg = await msgP;
      expect(msg.type).toBe("notification");
      expect(msg.notification.title).toBe("Realtime ping");
      expect(msg.notification.message).toBe("instant");
      expect(typeof msg.unreadCount).toBe("number");
      expect(msg.unreadCount).toBeGreaterThanOrEqual(1);
    } finally {
      ws.close();
    }
  });

  it("does not deliver other users' notifications to this socket", async () => {
    const ws = await connect();
    try {
      ws.send(JSON.stringify({ type: "auth", token: bobTok }));
      await nextMessage(ws); // ready
      const r = await sendAs(adminTok, {
        title: "Alice only WS", message: "nope", type: "information", audience: "specific", userIds: [alice.id],
      });
      expect(r.status).toBe(200);
      // Bob must NOT receive anything within 1.5s.
      const got = await new Promise<boolean>((res) => {
        const t = setTimeout(() => res(false), 1500);
        ws.once("message", () => { clearTimeout(t); res(true); });
      });
      expect(got).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("closes the connection on a bad token (4401)", async () => {
    const ws = await connect();
    const closed = new Promise<number>((res) => ws.once("close", (code) => res(code)));
    ws.send(JSON.stringify({ type: "auth", token: "bogus-token" }));
    expect(await closed).toBe(4401);
  });

  it("closes unauthenticated connections after the auth deadline", async () => {
    // Short deadline via a dedicated server so the test stays fast.
    const raw: Server = createServer();
    const nss = new NotifySocketServer({ getStore: () => st, authTimeoutMs: 300 });
    nss.attach(raw);
    await new Promise<void>((res) => raw.listen(0, "127.0.0.1", () => res()));
    const port = (raw.address() as any).port;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${NOTIFY_WS_PATH}`);
      await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
      const closed = new Promise<number>((res) => ws.once("close", (code) => res(code)));
      expect(await closed).toBe(4400);
    } finally {
      nss.close();
      await new Promise<void>((res) => raw.close(() => res()));
    }
  });

  it("leaves collab WebSocket upgrades working (no cross-talk)", async () => {
    const ws = await new Promise<WebSocket>((res, rej) => {
      const c = new WebSocket(wsBase + "/collab");
      c.once("open", () => res(c));
      c.once("error", rej);
    });
    ws.close();
    // If we got here without error, the collab path still upgrades fine.
    expect(ws.readyState).toBeLessThanOrEqual(WebSocket.CLOSING);
  });
});

describe("validation + limits over HTTP", () => {
  it("returns 422 (not 200) when there are no eligible users", async () => {
    const r = await sendAs(adminTok, {
      title: "Nobody", message: "ghost", type: "information",
      audience: "specific", userIds: ["u_doesnotexist0001"],
    });
    expect(r.status).toBe(422);
    expect(r.json.ok).toBe(false);
  });

  it("returns 413 for an oversized request body", async () => {
    const big = "x".repeat(110_000);
    const r = await api("POST", "/api/admin/notifications", {
      token: adminTok,
      rawBody: JSON.stringify({ title: big, message: "y", type: "information", audience: "all" }),
    });
    expect(r.status).toBe(413);
  });

  it("rate-limits to 10 sends per admin per minute (429)", async () => {
    // Fresh admin so earlier tests in this file don't consume the quota.
    const admin2 = await st.createUser({
      username: "boss2", displayName: "Boss2", provider: "email", email: "boss2@test.com", role: "admin",
    });
    const tok2 = (await st.createSession(admin2.id)).token;
    const payload = { title: "rl", message: "m", type: "information", audience: "specific", userIds: [alice.id] };
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const r = await sendAs(tok2, payload);
      last = r.status;
      if (i < 10) expect(r.status).toBe(200);
    }
    expect(last).toBe(429);
  });

  it("rejects malformed input with 400s", async () => {
    const base_payload = { message: "m", type: "information", audience: "all" };
    const noTitle = await sendAs(adminTok, { ...base_payload });
    expect(noTitle.status).toBe(400);
    const badType = await sendAs(adminTok, { title: "t", message: "m", type: "nope", audience: "all" });
    expect(badType.status).toBe(400);
    const badId = await sendAs(adminTok, {
      title: "t", message: "m", type: "information", audience: "specific", userIds: ["not-a-user-id!!"],
    });
    expect(badId.status).toBe(400);
  });
});

describe("admin history date filters over HTTP", () => {
  it("filters by from/to dates", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r1 = await api("GET", `/api/admin/notifications?from=${today}`, { token: adminTok });
    expect(r1.status).toBe(200);
    expect(r1.json.total).toBeGreaterThanOrEqual(1);

    const r2 = await api("GET", "/api/admin/notifications?from=2999-01-01", { token: adminTok });
    expect(r2.status).toBe(200);
    expect(r2.json.total).toBe(0);

    const r3 = await api("GET", "/api/admin/notifications?to=2000-01-01", { token: adminTok });
    expect(r3.status).toBe(200);
    expect(r3.json.total).toBe(0);
  });

  it("rejects invalid date filters", async () => {
    const bad = await api("GET", "/api/admin/notifications?from=not-a-date", { token: adminTok });
    expect(bad.status).toBe(400);
    const flipped = await api("GET", "/api/admin/notifications?from=2999-01-01&to=2000-01-01", { token: adminTok });
    expect(flipped.status).toBe(400);
  });
});

describe("route aliases + system + audit", () => {
  it("redirects /admin/* to the /app#/admin* hash route", async () => {
    const r = await api("GET", "/admin/notifications", {});
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/app#/admin/notifications");
    const r2 = await api("GET", "/admin", {});
    expect(r2.status).toBe(302);
    expect(r2.headers.get("location")).toBe("/app#/admin");
  });

  it("serves system status to admins only, with no secret values", async () => {
    const r = await api("GET", "/api/admin/system", { token: adminTok });
    expect(r.status).toBe(200);
    const s = r.json.system;
    expect(typeof s.uptimeSec).toBe("number");
    expect(typeof s.node).toBe("string");
    expect(["redis", "memory"]).toContain(s.store);
    expect(s.realtime.supported).toBe(true);
    expect(s.realtime.path).toBe(NOTIFY_WS_PATH);
    expect(typeof s.config.adminEmailsConfigured).toBe("boolean");
    const flat = JSON.stringify(r.json).toLowerCase();
    expect(flat).not.toContain("smtp_pass");
    const denied = await api("GET", "/api/admin/system", { token: aliceTok });
    expect(denied.status).toBe(403);
  });

  it("serves the audit log with the send entries", async () => {
    const r = await api("GET", "/api/admin/audit?limit=20", { token: adminTok });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.items)).toBe(true);
    expect(r.json.items.length).toBeGreaterThanOrEqual(1);
    expect(r.json.items[0].action).toMatch(/SEND_NOTIFICATION|DELETE_NOTIFICATION|DELETE_USER/);
    expect(r.json.items[0].timestamp).toBeGreaterThan(0);
  });
});

describe("cross-user isolation over HTTP", () => {
  it("a user cannot read or mark another user's notification", async () => {
    const aliceInbox = await api("GET", "/api/notifications?unreadOnly=1", { token: aliceTok });
    const mine = (aliceInbox.json.items || [])[0];
    expect(mine).toBeTruthy();
    // Bob tries to mark Alice's notification as read: must 404.
    const r = await api("POST", `/api/notifications/${mine.notificationId}/read`, { token: bobTok });
    expect(r.status).toBe(404);
    // Bob tries to delete Alice's copy: must 404.
    const d = await api("DELETE", `/api/notifications/${mine.notificationId}`, { token: bobTok });
    expect(d.status).toBe(404);
  });
});
