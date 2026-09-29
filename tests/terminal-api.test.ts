/**
 * Terminal API surface: rate limiting and manager wiring.
 * (HTTP handler bodies are thin wrappers over TerminalSessionManager,
 * which is covered in terminal-sessions.test.ts.)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  terminalCreateRateLimited,
  resetTerminalRateLimit,
  getTerminalManager,
  setTerminalManager,
} from "../src/server/terminal/api";
import { TerminalSessionManager } from "../src/server/terminal/sessions";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("terminal creation rate limit", () => {
  beforeEach(() => resetTerminalRateLimit());

  it("allows a burst then throttles", () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 30; i++) expect(terminalCreateRateLimited(ip)).toBe(false);
    expect(terminalCreateRateLimited(ip)).toBe(true);
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 30; i++) terminalCreateRateLimited("10.0.0.2");
    expect(terminalCreateRateLimited("10.0.0.2")).toBe(true);
    expect(terminalCreateRateLimited("10.0.0.3")).toBe(false);
  });
});

describe("terminal manager singleton", () => {
  it("rebinds when the workspace changes", () => {
    const a = mkdtempSync(join(tmpdir(), "neutron-term-a-"));
    const b = mkdtempSync(join(tmpdir(), "neutron-term-b-"));
    mkdirSync(join(a, "repo"));
    try {
      const m1 = getTerminalManager(a);
      expect(m1).toBeInstanceOf(TerminalSessionManager);
      expect(getTerminalManager(a)).toBe(m1);
      const m2 = getTerminalManager(b);
      expect(m2).not.toBe(m1);
      expect(getTerminalManager(b)).toBe(m2);
    } finally {
      setTerminalManager(null);
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});
