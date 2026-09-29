/**
 * Reports summary tests: summarizeJobResult() in src/web/app/ui-utils.js.
 * Normalizes a maintain-job SanitizedResult into render-ready sections for
 * the Reports job-detail view (the raw JSON dump stays underneath).
 */
import { describe, it, expect } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";

const { summarizeJobResult } = uiUtils;

function fullResult() {
  return {
    runId: "r1",
    noLlm: false,
    execution: {
      completed: 3, failed: 1, blocked: 0, noLlm: false,
      changes: [
        { path: "src/a.ts", kind: "modify", linesAdded: 10, linesRemoved: 2, agent: "impl", risk: "low" },
        { path: "src/b.ts", kind: "create", linesAdded: 50, linesRemoved: 0, agent: "impl", risk: "medium" },
      ],
    },
    tests: {
      command: "npm test",
      after: { total: 100, passed: 97, failed: 3 },
      regression: true,
      failedTests: ["a.test.ts > case 1", "b.test.ts > case 2"],
      stdoutTail: "...",
    },
    security: {
      blocked: false,
      summary: "2 low findings",
      findings: [
        { severity: "low", title: "console.log left", file: "src/a.ts", category: "hygiene" },
      ],
      findingsTruncated: false,
    },
    codeReview: {
      score: 82, passed: true, summary: "Looks good",
      findings: [{ severity: "info", title: "nit", file: "src/b.ts" }],
      findingsTruncated: false,
    },
    release: {
      status: "blocked",
      checks: [{ name: "tests", ok: false, detail: "3 failed" }],
      blockedBy: ["tests"],
    },
    deviations: ["skipped docs"],
    errors: [],
  };
}

describe("summarizeJobResult", () => {
  it("returns null for invalid input", () => {
    expect(summarizeJobResult(null)).toBeNull();
    expect(summarizeJobResult("nope")).toBeNull();
    expect(summarizeJobResult(undefined)).toBeNull();
  });

  it("summarizes execution with change counts", () => {
    const s = summarizeJobResult(fullResult())!;
    expect(s.execution!.completed).toBe(3);
    expect(s.execution!.failed).toBe(1);
    expect(s.execution!.changeCount).toBe(2);
    expect(s.execution!.changes[0]!.path).toBe("src/a.ts");
    expect(s.execution!.changes[0]!.added).toBe(10);
  });

  it("summarizes tests including failed test names", () => {
    const s = summarizeJobResult(fullResult())!;
    expect(s.tests!.command).toBe("npm test");
    expect(s.tests!.passed).toBe(97);
    expect(s.tests!.failed).toBe(3);
    expect(s.tests!.regression).toBe(true);
    expect(s.tests!.failedTests).toHaveLength(2);
  });

  it("summarizes security, review, and release sections", () => {
    const s = summarizeJobResult(fullResult())!;
    expect(s.security!.blocked).toBe(false);
    expect(s.security!.findingCount).toBe(1);
    expect(s.security!.findings[0]!.category).toBe("hygiene");
    expect(s.review!.score).toBe(82);
    expect(s.review!.passed).toBe(true);
    expect(s.release!.status).toBe("blocked");
    expect(s.release!.checks[0]!.ok).toBe(false);
    expect(s.release!.blockedBy).toEqual(["tests"]);
  });

  it("passes deviations and errors through", () => {
    const s = summarizeJobResult(fullResult())!;
    expect(s.deviations).toEqual(["skipped docs"]);
    expect(s.errors).toEqual([]);
  });

  it("caps long lists but keeps totals", () => {
    const r = fullResult();
    r.execution!.changes = Array.from({ length: 50 }, (_, i) => ({
      path: "f" + i + ".ts", kind: "modify", linesAdded: 1, linesRemoved: 0, agent: "x", risk: "low",
    }));
    const s = summarizeJobResult(r)!;
    expect(s.execution!.changes).toHaveLength(20);
    expect(s.execution!.changeCount).toBe(50);
  });

  it("tolerates missing sections", () => {
    const s = summarizeJobResult({ runId: "r2", deviations: [], errors: ["boom"] })!;
    expect(s.execution).toBeNull();
    expect(s.tests).toBeNull();
    expect(s.security).toBeNull();
    expect(s.review).toBeNull();
    expect(s.release).toBeNull();
    expect(s.errors).toEqual(["boom"]);
  });

  it("tolerates malformed section shapes", () => {
    const s = summarizeJobResult({ execution: "junk", tests: { after: "junk" }, deviations: "x" })!;
    expect(s.execution).toBeNull();
    expect(s.tests!.hasAfter).toBe(false);
    expect(s.deviations).toEqual([]);
  });
});
