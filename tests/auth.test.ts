/**
 * Auth store + password hashing tests.
 * Uses a temp dir (file backend); Redis paths are not exercised here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore, validUsername, safeUser } from "../src/server/auth/store";
import { hashPassword, verifyPassword } from "../src/server/auth/crypto";

function freshStore(): AuthStore {
  return new AuthStore(mkdtempSync(join(tmpdir(), "neutron-auth-")));
}

describe("validUsername", () => {
  it("accepts 3-24 char alnum/_/.", () => {
    expect(validUsername("sunny")).toBe(true);
    expect(validUsername("a1_")).toBe(true);
    expect(validUsername("x".repeat(24))).toBe(true);
    expect(validUsername("ab")).toBe(false);
    expect(validUsername("x".repeat(25))).toBe(false);
    expect(validUsername("has space")).toBe(false);
    expect(validUsername("semi;colon")).toBe(false);
  });
});

describe("password hashing", () => {
  it("hashes and verifies, rejects wrong passwords", async () => {
    const h = await hashPassword("correct horse 123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 123", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});

describe("AuthStore users", () => {
  let st: AuthStore;
  beforeEach(() => { st = freshStore(); });

  it("creates users with unique usernames (case-insensitive)", async () => {
    const u = await st.createUser({ username: "Sunny", displayName: "Sunny", provider: "guest" });
    expect(u.id.startsWith("u_")).toBe(true);
    await expect(st.createUser({ username: "sunny", displayName: "X", provider: "guest" }))
      .rejects.toThrow("username taken");
    expect(await st.findByUsername("SUNNY")).not.toBeNull();
  });

  it("safeUser strips the password hash", async () => {
    const u = await st.createUser({
      username: "bob", displayName: "Bob", provider: "email",
      email: "bob@x.com", passwordHash: await hashPassword("password123"),
    });
    const safe = safeUser(u);
    expect("passwordHash" in safe).toBe(false);
    expect((safe as any).username).toBe("bob");
  });

  it("sessions round-trip and expire", async () => {
    const u = await st.createUser({ username: "amy", displayName: "Amy", provider: "guest" });
    const s = await st.createSession(u.id, 50); // 50ms TTL
    const got = await st.getSession(s.token);
    expect(got?.user.id).toBe(u.id);
    await new Promise((r) => setTimeout(r, 70));
    expect(await st.getSession(s.token)).toBeNull();
  });

  it("email lookup is case-insensitive", async () => {
    await st.createUser({
      username: "cara", displayName: "Cara", provider: "email",
      email: "Cara@Example.com", passwordHash: "x",
    });
    expect(await st.findByEmail("cara@example.com")).not.toBeNull();
  });
});

describe("AuthStore connections", () => {
  let st: AuthStore;
  beforeEach(() => { st = freshStore(); });

  async function twoUsers() {
    const a = await st.createUser({ username: "alice", displayName: "Alice", provider: "guest" });
    const b = await st.createUser({ username: "bob", displayName: "Bob", provider: "guest" });
    return { a, b };
  }

  it("request -> list requests -> accept -> list connections", async () => {
    const { a, b } = await twoUsers();
    const c = await st.requestConnection(a.id, "bob");
    expect(c.status).toBe("pending");
    const reqs = await st.listRequests(b.id);
    expect(reqs.length).toBe(1);
    expect(reqs[0]!.peer.username).toBe("alice");
    await st.respondToRequest(b.id, c.id, true);
    const conns = await st.listConnections(a.id);
    expect(conns.length).toBe(1);
    expect(conns[0]!.peer.username).toBe("bob");
    // duplicate request now rejected
    await expect(st.requestConnection(a.id, "bob")).rejects.toThrow("already connected");
  });

  it("rejects self-requests and unknown users", async () => {
    const { a } = await twoUsers();
    await expect(st.requestConnection(a.id, "alice")).rejects.toThrow("yourself");
    await expect(st.requestConnection(a.id, "nobody")).rejects.toThrow("not found");
  });

  it("decline removes the request", async () => {
    const { a, b } = await twoUsers();
    const c = await st.requestConnection(a.id, "bob");
    await st.respondToRequest(b.id, c.id, false);
    expect(await st.listRequests(b.id)).toEqual([]);
  });

  it("removeConnection works for either party", async () => {
    const { a, b } = await twoUsers();
    const c = await st.requestConnection(a.id, "bob");
    await st.respondToRequest(b.id, c.id, true);
    await st.removeConnection(b.id, c.id);
    expect(await st.listConnections(a.id)).toEqual([]);
  });

  it("publicProfile hides secrets", async () => {
    const { a } = await twoUsers();
    const p = await st.publicProfile("alice");
    expect(p?.username).toBe("alice");
    expect(p && "passwordHash" in p).toBe(false);
    expect(await st.publicProfile("ghost")).toBeNull();
  });
});

describe("AuthStore persistence flag", () => {
  it("reports file backend when Redis is not configured", () => {
    const st = freshStore();
    expect(st.persistent).toBe(false);
  });
});

describe("AuthStore search", () => {
  it("finds users by partial username, excludes self", async () => {
    const st = freshStore();
    const me = await st.createUser({ username: "sunny", displayName: "Sunny", provider: "guest" });
    await st.createUser({ username: "sunnyfan", displayName: "Fan", provider: "guest" });
    await st.createUser({ username: "bob", displayName: "Bobby", provider: "guest" });
    const r1 = await st.searchUsers("sun", me.id);
    expect(r1.map((u) => u.username)).toEqual(["sunnyfan"]);
    const r2 = await st.searchUsers("bob", me.id);
    expect(r2.map((u) => u.username)).toEqual(["bob"]);
    expect(await st.searchUsers("x", me.id)).toEqual([]);
    expect(await st.searchUsers("s", me.id)).toEqual([]); // too short
  });
});
