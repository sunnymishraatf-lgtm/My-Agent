/**
 * Phase 1 collaboration tests: RoomManager — room lifecycle, membership,
 * owner-token privilege, chat caps, presence sweeps, snapshot persistence.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RoomManager,
  normalizeRoomCode,
  isValidRoomCode,
  sanitizeDisplayName,
  sanitizeChatText,
  MAX_CHAT_PER_ROOM,
  MAX_MEMBERS_PER_ROOM,
  PRESENCE_TIMEOUT_MS,
} from "../src/server/collab/room-manager";

function freshManager() {
  const dir = mkdtempSync(join(tmpdir(), "neutron-collab-"));
  let t = 1_000_000;
  const mgr = new RoomManager(dir, () => t);
  return { mgr, dir, advance: (ms: number) => (t += ms) };
}

describe("room codes", () => {
  it("generates codes shaped like NEUTRON-XXXXXX", () => {
    const { mgr } = freshManager();
    const { room } = mgr.createRoom("Test");
    expect(isValidRoomCode(room.id)).toBe(true);
    expect(room.id.startsWith("NEUTRON-")).toBe(true);
  });
  it("generates unique codes", () => {
    const { mgr } = freshManager();
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) seen.add(mgr.createRoom("r").room.id);
    expect(seen.size).toBe(25);
  });
  it("normalizes user-typed codes", () => {
    expect(normalizeRoomCode("  neutron-ab23cd ")).toBe("NEUTRON-AB23CD");
    expect(normalizeRoomCode("neutron ab23cd")).toBe("NEUTRONAB23CD");
    expect(isValidRoomCode("neutron-ab23cd")).toBe(true);
    expect(isValidRoomCode("NEUTRON-AB12C0")).toBe(false); // 0 not in alphabet
    expect(isValidRoomCode("NEUTRON-ABC")).toBe(false);
    expect(isValidRoomCode("")).toBe(false);
    expect(isValidRoomCode(null)).toBe(false);
  });
  it("getRoom finds rooms case-insensitively, misses unknown codes", () => {
    const { mgr } = freshManager();
    const { room } = mgr.createRoom("Alpha");
    expect(mgr.getRoom(room.id.toLowerCase())?.name).toBe("Alpha");
    expect(mgr.getRoom("NEUTRON-ZZZZZZ")).toBeUndefined();
    expect(mgr.getRoom("garbage")).toBeUndefined();
  });
});

describe("ownership", () => {
  it("creator holds the owner token; others don't", () => {
    const { mgr } = freshManager();
    const { room, ownerToken } = mgr.createRoom("Owned");
    expect(ownerToken.length).toBeGreaterThan(20);
    expect(mgr.isOwner(room.id, ownerToken)).toBe(true);
    expect(mgr.isOwner(room.id, "nope")).toBe(false);
    expect(mgr.isOwner(room.id, "")).toBe(false);
    expect(mgr.isOwner(room.id, undefined)).toBe(false);
    expect(mgr.isOwner("NEUTRON-ZZZZZZ", ownerToken)).toBe(false);
  });
  it("joining with the owner token grants the owner role", () => {
    const { mgr } = freshManager();
    const { room, ownerToken } = mgr.createRoom("Owned");
    const res: any = mgr.joinRoom(room.id, "Sunny", ownerToken);
    expect(res.member.role).toBe("owner");
    const res2: any = mgr.joinRoom(room.id, "Rahul");
    expect(res2.member.role).toBe("member");
  });
  it("only the owner can rename or delete", () => {
    const { mgr } = freshManager();
    const { room, ownerToken } = mgr.createRoom("Owned");
    expect(mgr.renameRoom(room.id, "wrong", "Hacked")).toBe(false);
    expect(mgr.deleteRoom(room.id, "wrong")).toBe(false);
    expect(mgr.getRoom(room.id)?.name).toBe("Owned");
    expect(mgr.renameRoom(room.id, ownerToken, "Renamed")).toBe(true);
    expect(mgr.getRoom(room.id)?.name).toBe("Renamed");
    expect(mgr.renameRoom(room.id, ownerToken, "   ")).toBe(false);
    expect(mgr.deleteRoom(room.id, ownerToken)).toBe(true);
    expect(mgr.getRoom(room.id)).toBeUndefined();
  });
});

describe("membership", () => {
  it("join validates the room and the name", () => {
    const { mgr } = freshManager();
    const { room } = mgr.createRoom("M");
    expect((mgr.joinRoom("NEUTRON-ZZZZZZ", "Sunny") as any).error).toBe("ROOM_NOT_FOUND");
    expect((mgr.joinRoom(room.id, "   ") as any).error).toBe("BAD_NAME");
    expect((mgr.joinRoom("bogus", "Sunny") as any).error).toBe("ROOM_NOT_FOUND");
  });
  it("leave removes the member", () => {
    const { mgr } = freshManager();
    const { room } = mgr.createRoom("M");
    const res: any = mgr.joinRoom(room.id, "Sunny");
    expect(mgr.listMembers(room.id).length).toBe(1);
    expect(mgr.leaveRoom(room.id, res.member.id)).toBe(true);
    expect(mgr.listMembers(room.id).length).toBe(0);
    expect(mgr.leaveRoom(room.id, res.member.id)).toBe(false);
  });
  it("enforces the member cap", () => {
    const { mgr } = freshManager();
    const { room } = mgr.createRoom("Full");
    for (let i = 0; i < MAX_MEMBERS_PER_ROOM; i++) {
      expect((mgr.joinRoom(room.id, "u" + i) as any).member).toBeTruthy();
    }
    expect((mgr.joinRoom(room.id, "extra") as any).error).toBe("ROOM_FULL");
  });
});

describe("chat", () => {
  it("posts messages only for members, caps history", () => {
    const { mgr } = freshManager();
    const { room } = mgr.createRoom("C");
    expect(mgr.postChat(room.id, "ghost", "hi")).toBeUndefined();
    const res: any = mgr.joinRoom(room.id, "Sunny");
    expect(mgr.postChat(room.id, res.member.id, "   ")).toBeUndefined();
    const m1 = mgr.postChat(room.id, res.member.id, "hello");
    expect(m1?.text).toBe("hello");
    expect(m1?.displayName).toBe("Sunny");
    for (let i = 0; i < MAX_CHAT_PER_ROOM + 5; i++) mgr.postChat(room.id, res.member.id, "m" + i);
    const chat = mgr.getChat(room.id);
    expect(chat.length).toBe(MAX_CHAT_PER_ROOM);
    expect(chat[chat.length - 1]?.text).toBe("m" + (MAX_CHAT_PER_ROOM + 4));
  });
  it("sanitizes chat text", () => {
    expect(sanitizeChatText("  hi  ")).toBe("hi");
    expect(sanitizeChatText("x".repeat(5000)).length).toBe(2000);
    expect(sanitizeDisplayName("  Jo\nhn  ")).toBe("Jo hn");
    expect(sanitizeDisplayName("x".repeat(100)).length).toBe(32);
  });
});

describe("presence", () => {
  it("sweeps members silent past the timeout", () => {
    const { mgr, advance } = freshManager();
    const { room } = mgr.createRoom("P");
    const a: any = mgr.joinRoom(room.id, "A");
    const b: any = mgr.joinRoom(room.id, "B");
    advance(PRESENCE_TIMEOUT_MS - 1000);
    mgr.heartbeat(room.id, a.member.id); // A stays alive
    advance(2000);
    const swept = mgr.sweepPresence();
    expect(swept.length).toBe(1);
    expect(swept[0]?.removed).toEqual([b.member.id]);
    expect(mgr.listMembers(room.id).map((m) => m.displayName)).toEqual(["A"]);
  });
  it("setPresence validates status and updates activity", () => {
    const { mgr } = freshManager();
    const { room } = mgr.createRoom("P");
    const a: any = mgr.joinRoom(room.id, "A");
    expect(mgr.setPresence(room.id, a.member.id, "away", "Lunch")).toBe(true);
    const listed = mgr.listMembers(room.id)[0];
    expect(listed?.status).toBe("away");
    expect(listed?.activity).toBe("Lunch");
    expect(mgr.setPresence(room.id, a.member.id, "ghost" as any, "")).toBe(false);
    expect(mgr.setPresence(room.id, "nope", "online", "")).toBe(false);
  });
});

describe("snapshot persistence", () => {
  it("round-trips rooms, chat, and owner hash", () => {
    const { mgr, dir } = freshManager();
    const { room, ownerToken } = mgr.createRoom("Persist me");
    const a: any = mgr.joinRoom(room.id, "Sunny", ownerToken);
    mgr.postChat(room.id, a.member.id, "remember this");
    mgr.saveNow();
    const raw = readFileSync(join(dir, ".agent", "collab", "rooms.json"), "utf8");
    expect(raw).not.toContain(ownerToken); // raw token never hits disk

    const mgr2 = new RoomManager(dir);
    mgr2.load();
    expect(mgr2.getRoom(room.id)?.name).toBe("Persist me");
    expect(mgr2.getChat(room.id).map((m) => m.text)).toEqual(["remember this"]);
    expect(mgr2.listMembers(room.id)).toEqual([]); // members are session state
    expect(mgr2.isOwner(room.id, ownerToken)).toBe(true); // owner survives restart
    expect(mgr2.isOwner(room.id, "wrong")).toBe(false);
  });
  it("survives a corrupt snapshot", () => {
    const { mgr, dir } = freshManager();
    mgr.createRoom("Keep");
    const path = join(dir, ".agent", "collab", "rooms.json");
    mgr.saveNow();
    writeFileSync(path, "{not json", "utf8");
    const mgr2 = new RoomManager(dir);
    expect(() => mgr2.load()).not.toThrow();
    expect(mgr2.roomCount()).toBe(0);
  });
  it("starts empty when no snapshot exists", () => {
    const { mgr } = freshManager();
    expect(() => mgr.load()).not.toThrow();
    expect(mgr.roomCount()).toBe(0);
  });
});
