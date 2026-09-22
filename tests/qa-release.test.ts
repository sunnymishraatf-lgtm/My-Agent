import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBuild } from "../src/neutron/test-runner";
import { formatTestResult } from "../src/neutron/test-runner";
import { buildTestReport } from "../src/agents/qa";
import type { TestResult } from "../src/neutron/model";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-build-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("validateBuild", () => {
  it("runs the configured build script when package.json defines one", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", scripts: { build: "tsc -p ." } }));
    mkdirSync(join(root, "node_modules"));
    const seen: string[] = [];
    const v = await validateBuild(root, async (cmd) => {
      seen.push(cmd);
      return { ok: true, stdout: "built" };
    });
    expect(v.ok).toBe(true);
    expect(v.command).toBe("npm run build");
    expect(seen).toEqual(["npm run build"]);
  });

  it("reports missing node_modules as its own reason without running the build", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", scripts: { build: "tsc -p ." } }));
    const seen: string[] = [];
    const v = await validateBuild(root, async (cmd) => {
      seen.push(cmd);
      return { ok: true, stdout: "" };
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("missing-node-modules");
    expect(seen).toEqual([]);
  });

  it("reports a failing configured build as build-failed", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", scripts: { build: "tsc -p ." } }));
    mkdirSync(join(root, "node_modules"));
    const v = await validateBuild(root, async () => ({ ok: false, stdout: "error TS123" }));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("build-failed");
    expect(v.command).toBe("npm run build");
  });

  it("falls back to tsc --noEmit when no build script is configured", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({}));
    const seen: string[] = [];
    const v = await validateBuild(root, async (cmd) => {
      seen.push(cmd);
      return { ok: true, stdout: "" };
    });
    expect(v.ok).toBe(true);
    expect(v.command).toBe("npx tsc --noEmit");
    expect(seen).toEqual(["npx tsc --noEmit"]);
  });

  it("reports a failing tsc fallback as build-failed", async () => {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({}));
    const v = await validateBuild(root, async () => ({ ok: false, stdout: "error TS2345" }));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("build-failed");
  });

  it("treats a project with no build setup at all as valid", async () => {
    const seen: string[] = [];
    const v = await validateBuild(root, async (cmd) => {
      seen.push(cmd);
      return { ok: true, stdout: "" };
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toBeUndefined();
    expect(v.command).toBeUndefined();
    expect(seen).toEqual([]);
  });
});

describe("QA reporting", () => {
  it("distinguishes missing node_modules from a failed build", () => {
    const missing = buildTestReport({
      pass: 0,
      fail: 0,
      buildOk: false,
      buildReason: "missing-node-modules",
      buildCommand: "npm run build",
      stdout: "",
    });
    expect(missing).toContain("node_modules");
    expect(missing).not.toMatch(/Build: FAILED/);

    const failed = buildTestReport({
      pass: 0,
      fail: 0,
      buildOk: false,
      buildReason: "build-failed",
      buildCommand: "npm run build",
      stdout: "boom",
    });
    expect(failed).toMatch(/Build: FAILED/);
    expect(failed).not.toContain("node_modules");
  });

  it("reports blocked test runs instead of silently omitting them", () => {
    const r = buildTestReport({
      pass: 0,
      fail: 0,
      buildOk: true,
      blocked: "no package.json found — no test command is configured",
      stdout: "",
    });
    expect(r).toContain("BLOCKED");
    expect(r).toContain("no package.json");
  });

  it("formatTestResult marks runs that could not start as blocked", () => {
    const result: TestResult = {
      selection: [],
      command: "",
      executedAt: new Date().toISOString(),
      truncatedStdout: "node_modules are not installed. Run `npm install` first.",
      regression: false,
      failedTests: [],
    };
    const text = formatTestResult(result);
    expect(text).toContain("BLOCKED");
    expect(text).toContain("npm install");
  });
});
