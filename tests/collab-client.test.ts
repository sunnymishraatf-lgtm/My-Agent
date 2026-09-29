/**
 * Phase 1 collaboration tests: pure client helpers in src/web/app/ui-utils.js.
 * No DOM — only the testable logic: code normalization, reconnect backoff,
 * name/text sanitizing, relative timestamps.
 */
import { describe, it, expect } from "vitest";
import ui from "../src/web/app/ui-utils.js";

describe("normalizeRoomCode / isValidRoomCode", () => {
  it("normalizes case and whitespace", () => {
    expect(ui.normalizeRoomCode("  neutron-ab23cd ")).toBe("NEUTRON-AB23CD");
    expect(ui.normalizeRoomCode("NEUTRON-AB23CD")).toBe("NEUTRON-AB23CD");
    expect(ui.normalizeRoomCode(null)).toBe("");
    expect(ui.normalizeRoomCode(undefined)).toBe("");
  });
  it("validates the code shape", () => {
    expect(ui.isValidRoomCode("NEUTRON-AB23CD")).toBe(true);
    expect(ui.isValidRoomCode("neutron-ab23cd")).toBe(true); // normalized first
    expect(ui.isValidRoomCode("NEUTRON-AB12CD")).toBe(false); // 1 excluded
    expect(ui.isValidRoomCode("NEUTRON-AB23C")).toBe(false); // too short
    expect(ui.isValidRoomCode("NEUTRON-AB23CDX")).toBe(false); // too long
    expect(ui.isValidRoomCode("ROOM-AB23CD")).toBe(false);
    expect(ui.isValidRoomCode("")).toBe(false);
  });
  it("matches the server's alphabet", () => {
    // Server: ABCDEFGHJKMNPQRSTUVWXYZ23456789 (no 0/O, 1/I/L)
    expect(ui.isValidRoomCode("NEUTRON-AO23CD")).toBe(false);
    expect(ui.isValidRoomCode("NEUTRON-AI23CD")).toBe(false);
    expect(ui.isValidRoomCode("NEUTRON-AB03CD")).toBe(false);
    expect(ui.isValidRoomCode("NEUTRON-ZZ99ZZ")).toBe(true);
  });
});

describe("collabBackoffMs", () => {
  it("backs off exponentially and caps at 30s", () => {
    expect(ui.collabBackoffMs(0)).toBe(1000);
    expect(ui.collabBackoffMs(1)).toBe(2000);
    expect(ui.collabBackoffMs(2)).toBe(4000);
    expect(ui.collabBackoffMs(5)).toBe(30000);
    expect(ui.collabBackoffMs(99)).toBe(30000);
    expect(ui.collabBackoffMs(-3)).toBe(1000);
  });
});

describe("sanitizeCollabName", () => {
  it("cleans display names", () => {
    expect(ui.sanitizeCollabName("  Sunny  ")).toBe("Sunny");
    expect(ui.sanitizeCollabName("Jo   hn")).toBe("Jo hn");
    expect(ui.sanitizeCollabName("a\u0000b\u001fc")).toBe("abc");
    expect(ui.sanitizeCollabName("x".repeat(100)).length).toBe(32);
    expect(ui.sanitizeCollabName("   ")).toBe("");
    expect(ui.sanitizeCollabName(null)).toBe("");
  });
});

describe("sanitizeCollabText", () => {
  it("trims and caps chat text", () => {
    expect(ui.sanitizeCollabText("  hi  ")).toBe("hi");
    expect(ui.sanitizeCollabText("x".repeat(5000))).toHaveLength(2000);
    expect(ui.sanitizeCollabText("")).toBe("");
  });
});

describe("timeAgo", () => {
  const NOW = 1_700_000_000_000;
  it("formats relative times", () => {
    expect(ui.timeAgo(NOW - 30_000, NOW)).toBe("just now");
    expect(ui.timeAgo(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(ui.timeAgo(NOW - 3 * 3600_000, NOW)).toBe("3h ago");
    expect(ui.timeAgo(NOW - 2 * 86400_000, NOW)).toBe("2d ago");
    expect(ui.timeAgo(NOW + 60_000, NOW)).toBe("just now"); // future clamps
    expect(ui.timeAgo(NOW - 30 * 86400_000, NOW)).not.toBe("");
    expect(ui.timeAgo(NaN, NOW)).toBe("");
  });
});
