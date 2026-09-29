/**
 * Terminal sessions: lifecycle, sandbox inheritance, ring-buffer caps,
 * idle expiry. Uses a temp workspace with a fake repo dir.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TerminalSessionManager,
  TERMINAL_LINE_CAP,
} from "../src/server/terminal/sessions";

let root: string;
let mgr: TerminalSessionManager;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait until the session's process exits (or timeout). */
async function waitIdle(m: TerminalSessionManager, id: string, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (m.isRunning(id)) {
    if (Date.now() - t0 > timeoutMs) throw new Error("timed out waiting for process exit");
    await sleep(50);
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-term-"));
  mkdirSync(join(root, "myrepo"));
  // Short timeouts keep the suite fast; sandbox semantics unchanged.
  mgr = new TerminalSessionManager(root, 4000, 60_000);
});

afterEach(() => {
  for (const s of mgr.list()) {
    try { mgr.remove(s.id); } catch { /* ignore */ }
  }
  rmSync(root, { recursive: true, force: true });
});

describe("session lifecycle", () => {
  it("creates a session in a known repo and lists it", () => {
    const s = mgr.create("myrepo", "tab1");
    expect(s.repo).toBe("myrepo");
    expect(s.id).toMatch(/^[a-f0-9]{24}$/);
    expect(mgr.list().map((x) => x.id)).toContain(s.id);
  });

  it("rejects unknown repositories (allow-list)", () => {
    expect(() => mgr.create("../escape")).toThrow();
    expect(() => mgr.create("nosuchrepo")).toThrow();
  });

  it("runs a command and streams stdout", async () => {
    const s = mgr.create("myrepo");
    mgr.input(s.id, "echo hello-terminal");
    await waitIdle(mgr, s.id);
    const out = mgr.output(s.id, 0);
    expect(out.lines.some((l) => l.text.includes("hello-terminal"))).toBe(true);
    expect(out.exitCode).toBe(0);
    expect(out.running).toBe(false);
  });

  it("supports since= polling (only new lines)", async () => {
    const s = mgr.create("myrepo");
    mgr.input(s.id, "echo one");
    await waitIdle(mgr, s.id);
    const first = mgr.output(s.id, 0);
    mgr.input(s.id, "echo two");
    await waitIdle(mgr, s.id);
    const second = mgr.output(s.id, first.nextSeq);
    expect(second.lines.some((l) => l.text.includes("two"))).toBe(true);
    expect(second.lines.some((l) => l.text.includes("one"))).toBe(false);
  });

  it("writes stdin to a running process", async () => {
    const s = mgr.create("myrepo");
    mgr.input(s.id, "cat");
    await sleep(300);
    expect(mgr.isRunning(s.id)).toBe(true);
    mgr.input(s.id, "stdin-line-here");
    await sleep(300);
    mgr.kill(s.id);
    await waitIdle(mgr, s.id);
    const text = mgr.fullText(s.id);
    expect(text).toContain("stdin-line-here");
  });

  it("kills a long-running process", async () => {
    const s = mgr.create("myrepo");
    mgr.input(s.id, "node -e \"setInterval(()=>{}, 1000)\"");
    await sleep(300);
    expect(mgr.isRunning(s.id)).toBe(true);
    const r = mgr.kill(s.id);
    expect(r.killed).toBe(true);
    await waitIdle(mgr, s.id);
    expect(mgr.isRunning(s.id)).toBe(false);
  });

  it("removes a session", () => {
    const s = mgr.create("myrepo");
    mgr.remove(s.id);
    expect(mgr.list()).toHaveLength(0);
    expect(() => mgr.output(s.id, 0)).toThrow();
  });

  it("caps the number of sessions", () => {
    for (let i = 0; i < 20; i++) mgr.create("myrepo");
    expect(() => mgr.create("myrepo")).toThrow(/Too many/);
  });
});

describe("sandbox inheritance", () => {
  it("rejects shell metacharacters (no shell)", async () => {
    const s = mgr.create("myrepo");
    mgr.input(s.id, "echo hi | cat");
    await sleep(200);
    expect(mgr.isRunning(s.id)).toBe(false);
    expect(mgr.fullText(s.id)).toMatch(/Not run|SHELL_BLOCKED|metacharacter/i);
  });

  it("rejects blocklisted commands", async () => {
    const s = mgr.create("myrepo");
    mgr.input(s.id, "mkfs /dev/null");
    await sleep(200);
    expect(mgr.isRunning(s.id)).toBe(false);
    expect(mgr.fullText(s.id)).toMatch(/Not run|blocked/i);
  });

  it("rejects path traversal in command args", async () => {
    const s = mgr.create("myrepo");
    mgr.input(s.id, "cat ../../etc/passwd");
    await sleep(200);
    expect(mgr.isRunning(s.id)).toBe(false);
  });

  it("cd builtin stays inside the repo", async () => {
    const s = mgr.create("myrepo");
    mkdirSync(join(root, "myrepo", "sub"));
    mgr.input(s.id, "cd sub");
    await sleep(100);
    mgr.input(s.id, "cd ..");
    await sleep(100);
    mgr.input(s.id, "cd ..");
    await sleep(100);
    const text = mgr.fullText(s.id);
    expect(text).toMatch(/no such directory|stays inside/i);
  });

  it("cd changes cwd for subsequent commands", async () => {
    const s = mgr.create("myrepo");
    mkdirSync(join(root, "myrepo", "sub"));
    mgr.input(s.id, "cd sub");
    await sleep(100);
    mgr.input(s.id, "node -e \"console.log(process.cwd())\"");
    await waitIdle(mgr, s.id);
    expect(mgr.fullText(s.id)).toContain(join(root, "myrepo", "sub"));
  });
});

describe("caps and expiry", () => {
  it("caps the ring buffer at TERMINAL_LINE_CAP lines", async () => {
    const s = mgr.create("myrepo");
    mgr.input(s.id, "node -e \"for(let i=0;i<2500;i++) console.log('line'+i)\"");
    await waitIdle(mgr, s.id, 15000);
    const out = mgr.output(s.id, 0);
    expect(out.lines.length).toBeLessThanOrEqual(TERMINAL_LINE_CAP);
    // Oldest lines were dropped; the newest command output survived.
    const texts = out.lines.map((l) => l.text);
    expect(texts.some((t) => t.includes("line2499"))).toBe(true);
    expect(texts.some((t) => t.includes("line0"))).toBe(false);
  });

  it("drops sessions idle past the idle budget", async () => {
    const short = new TerminalSessionManager(root, 4000, 80);
    const s = short.create("myrepo");
    await sleep(150);
    short.sweep();
    expect(short.list()).toHaveLength(0);
    // Active sessions are not swept.
    const s2 = short.create("myrepo");
    short.sweep();
    expect(short.list().map((x) => x.id)).toContain(s2.id);
    short.remove(s2.id);
    void s;
  });

  it("kills the process on the command timeout", async () => {
    const quick = new TerminalSessionManager(root, 300, 60_000);
    const s = quick.create("myrepo");
    quick.input(s.id, "node -e \"setInterval(()=>{}, 1000)\"");
    await waitIdle(quick, s.id, 5000);
    expect(quick.fullText(s.id)).toMatch(/timeout/i);
    expect(quick.lastExit(s.id)?.timedOut).toBe(true);
    quick.remove(s.id);
  });
});
