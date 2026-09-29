/**
 * Project intelligence tests (Phases 7/9/10/11):
 * - AI code review: prompt building (truncation caps) + finding parsing
 * - Secret-pattern detection (no false positives on normal code)
 * - Dependency helpers: version comparison, npm audit parsing, deps scan
 *   with a mocked registry lookup (no network)
 * - Health aggregation logic incl. honest unknown states
 */
import { describe, it, expect } from "vitest";
import ui from "../src/web/app/ui-utils.js";
import {
  scanContentForSecrets,
} from "../src/neutron/security-scanner";
import {
  compareVersions,
  parseNpmAudit,
  runDepsScan,
} from "../src/server/insights";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("buildReviewPrompt", () => {
  it("passes small diffs through untruncated", () => {
    const diff = "diff --git a/x.ts b/x.ts\n+const a = 1;";
    const p = ui.buildReviewPrompt(diff, {});
    expect(p.truncated).toBe(false);
    expect(p.user).toContain(diff);
    expect(p.system).toContain("senior code reviewer");
    expect(p.system).toContain("```json");
  });

  it("truncates huge diffs with an honest note", () => {
    const diff = "x".repeat(9000);
    const p = ui.buildReviewPrompt(diff, {});
    expect(p.truncated).toBe(true);
    expect(p.user).toContain("truncated to 7000 characters");
    expect(p.user.length).toBeLessThan(8000); // must survive /api/chat's 8000-char cap
  });

  it("honors a custom maxChars", () => {
    const p = ui.buildReviewPrompt("x".repeat(100), { maxChars: 10 });
    expect(p.truncated).toBe(true);
    expect(p.user).toContain("xxxxxxxxxx");
  });

  it("handles empty input", () => {
    const p = ui.buildReviewPrompt("", {});
    expect(p.truncated).toBe(false);
    expect(p.user).toContain("```diff");
  });
});

describe("parseReviewFindings", () => {
  const fenced = (body: string) => "Some intro\n```json\n" + body + "\n```\nSome outro";

  it("parses a valid fenced findings array and normalizes categories", () => {
    const r = ui.parseReviewFindings(
      fenced('[{"category":"bug","problem":"Null deref","evidence":"x.ts:12","why_it_matters":"crash","suggested_fix":"guard"}]'),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.category).toBe("BUG");
    expect(r.findings[0]!.problem).toBe("Null deref");
    expect(r.findings[0]!.evidence).toBe("x.ts:12");
  });

  it("maps unknown categories to MAINTAINABILITY instead of dropping", () => {
    const r = ui.parseReviewFindings(fenced('[{"category":"nonsense","problem":"p","evidence":"e"}]'));
    expect(r.findings[0]!.category).toBe("MAINTAINABILITY");
  });

  it("treats no_issues as a valid honest empty result", () => {
    const r = ui.parseReviewFindings(fenced('{"no_issues": true}'));
    expect(r.findings).toEqual([]);
    expect(r.raw).toBeUndefined();
  });

  it("tolerates bare JSON without a fence", () => {
    const r = ui.parseReviewFindings('[{"category":"STYLE","problem":"p","evidence":"e"}]');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.category).toBe("STYLE");
  });

  it("falls back to raw text on malformed JSON — never invents structure", () => {
    const r = ui.parseReviewFindings("```json\nnot json at all\n```");
    expect(r.findings).toEqual([]);
    expect(r.raw).toContain("not json at all");
  });

  it("falls back to raw text when there is no JSON at all", () => {
    const r = ui.parseReviewFindings("Looks fine to me, ship it.");
    expect(r.findings).toEqual([]);
    expect(r.raw).toBe("Looks fine to me, ship it.");
  });

  it("drops empty finding objects", () => {
    const r = ui.parseReviewFindings(fenced('[{},{"category":"BUG","problem":"p"}]'));
    expect(r.findings).toHaveLength(1);
  });
});

describe("scanContentForSecrets", () => {
  it("flags an inline api_key assignment with file:line evidence", () => {
    const hits = scanContentForSecrets('const x = 1;\napi_key = "sk-abcdef1234567890";\n', "a.ts");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.excerpt).not.toContain("sk-abcdef1234567890"); // redacted
  });

  it("flags a hard-coded password", () => {
    const hits = scanContentForSecrets('password = "hunter2hunter";', "db.ts");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("high");
  });

  it("does not flag env-var references or normal code", () => {
    expect(scanContentForSecrets('const apiKey = process.env.MY_API_KEY;\n', "a.ts")).toEqual([]);
    expect(scanContentForSecrets('function getSecret() { return vault.read("k"); }\n', "b.ts")).toEqual([]);
    expect(scanContentForSecrets('// TODO: rotate the api key regularly\n', "c.ts")).toEqual([]);
    expect(scanContentForSecrets('const password = getPassword();\n', "d.ts")).toEqual([]);
  });

  it("flags GitHub-style tokens", () => {
    const hits = scanContentForSecrets('token = "ghp_abcdefghij1234567890";', "ci.yml");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("critical");
  });
});

describe("compareVersions", () => {
  it("compares semver numerically, not lexically", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("strips ranges and prefixes", () => {
    expect(compareVersions("^1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("~2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions(">=1.0.0", "1.0.0")).toBe(0);
  });
});

describe("parseNpmAudit", () => {
  it("parses npm v7+ vulnerabilities format", () => {
    const json = JSON.stringify({
      vulnerabilities: {
        lodash: { severity: "high", title: "Prototype pollution", via: ["lodash"] },
      },
    });
    const m = parseNpmAudit(json);
    expect(m.get("lodash")).toHaveLength(1);
    expect(m.get("lodash")![0]!.severity).toBe("high");
  });

  it("parses npm v6 advisories format", () => {
    const json = JSON.stringify({
      advisories: { "1": { severity: "critical", title: "RCE", module_name: "minimist" } },
    });
    const m = parseNpmAudit(json);
    expect(m.get("minimist")![0]!.severity).toBe("critical");
  });

  it("returns empty on invalid JSON — never invents vulns", () => {
    expect(parseNpmAudit("not json").size).toBe(0);
    expect(parseNpmAudit("{}").size).toBe(0);
  });
});

describe("runDepsScan (mocked registry)", () => {
  function tmpRepo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "neutron-deps-"));
    for (const [name, content] of Object.entries(files)) {
      const full = join(dir, name);
      mkdirSync(join(dir), { recursive: true });
      writeFileSync(full, content);
    }
    return dir;
  }

  it("detects manifests and flags updates via the mocked registry", async () => {
    const dir = tmpRepo({
      "package.json": JSON.stringify({ dependencies: { leftpad: "^1.0.0", pinned: "2.0.0" } }),
      "requirements.txt": "requests==2.0\n",
    });
    try {
      const payload = await runDepsScan(dir, async (name) => {
        if (name === "leftpad") return { latest: "1.3.0", deprecated: false };
        if (name === "pinned") return { latest: "2.0.0", deprecated: true };
        return { latest: null, deprecated: false };
      });
      expect(payload.manifests).toContain("package.json");
      expect(payload.manifests).toContain("requirements.txt");
      expect(payload.unsupported).toContain("requirements.txt"); // honest: not version-checked
      const leftpad = payload.packages.find((p) => p.name === "leftpad")!;
      expect(leftpad.updateAvailable).toBe(true);
      expect(leftpad.latest).toBe("1.3.0");
      const pinned = payload.packages.find((p) => p.name === "pinned")!;
      expect(pinned.deprecated).toBe(true);
      expect(pinned.updateAvailable).toBe(false);
      expect(payload.counts.updates).toBe(1);
      expect(payload.auditAvailable).toBe(false); // no stdout → honest note
      expect(payload.auditNote).toContain("unavailable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports no manifests honestly", async () => {
    const dir = tmpRepo({ "README.md": "# hi" });
    try {
      const payload = await runDepsScan(dir, async () => ({ latest: null, deprecated: false }));
      expect(payload.manifests).toEqual([]);
      expect(payload.packages).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("compactDiffsToUnified", () => {
  it("converts compact prefixes to unified markers with file headers", () => {
    const out = ui.compactDiffsToUnified([
      { path: "a.ts", diff: "- const x = 1;\n+ const x = 2;\n  const y = 3;" },
    ]);
    expect(out).toContain("--- a/a.ts");
    expect(out).toContain("+++ b/a.ts");
    expect(out).toContain("-const x = 1;");
    expect(out).toContain("+const x = 2;");
  });

  it("handles empty and missing input", () => {
    expect(ui.compactDiffsToUnified([])).toBe("");
    expect(ui.compactDiffsToUnified(null)).toBe("");
  });
});

describe("computeHealth", () => {
  it("is unknown when nothing has produced data", () => {
    const h = ui.computeHealth({});
    expect(h.overall).toBe("unknown");
    expect(h.items.every((i: any) => i.state === "unknown")).toBe(true);
  });

  it("is healthy when every known signal is good", () => {
    const h = ui.computeHealth({
      git: { clean: true },
      security: { counts: { critical: 0, high: 0, medium: 1, low: 2, info: 0 } },
      deps: { counts: { vulnerable: 0, updates: 3 } },
      build: "passed",
      tests: "passed",
    });
    expect(h.overall).toBe("healthy");
  });

  it("flags attention on dirty git", () => {
    const h = ui.computeHealth({ git: { clean: false } });
    expect(h.overall).toBe("attention");
    expect(h.items.find((i: any) => i.key === "git")!.state).toBe("attention");
  });

  it("flags attention on critical/high security findings but not on medium", () => {
    expect(
      ui.computeHealth({ security: { counts: { critical: 1, high: 0, medium: 0, low: 0, info: 0 } } }).overall,
    ).toBe("attention");
    expect(
      ui.computeHealth({ security: { counts: { critical: 0, high: 2, medium: 0, low: 0, info: 0 } } }).overall,
    ).toBe("attention");
    expect(
      ui.computeHealth({
        git: { clean: true },
        security: { counts: { critical: 0, high: 0, medium: 5, low: 0, info: 0 } },
      }).overall,
    ).toBe("healthy");
  });

  it("flags attention on vulnerable deps and failed builds", () => {
    expect(ui.computeHealth({ deps: { counts: { vulnerable: 1, updates: 0 } } }).overall).toBe("attention");
    expect(ui.computeHealth({ git: { clean: true }, build: "failed" }).overall).toBe("attention");
  });
});
