import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBobActivity } from "../src/neutron/bob";
import { scanSecurity } from "../src/neutron/security-scanner";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-bobsec-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bob activity source", () => {
  it("reports activity.ndjson when that is the file read", () => {
    const base = join(root, ".agent", "bob");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "activity.ndjson"), JSON.stringify({ taskCount: 3 }) + "\n", "utf8");
    const activity = collectBobActivity(root);
    expect(activity.hasActivity).toBe(true);
    expect(activity.source).toBe("activity.ndjson");
  });

  it("reports activity.json when that is the file read", () => {
    const base = join(root, ".agent", "bob");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "activity.json"), JSON.stringify({ taskCount: 3 }), "utf8");
    const activity = collectBobActivity(root);
    expect(activity.source).toBe("activity.json");
  });
});

describe("security scanner oauth dedupe", () => {
  const OAUTH_TITLE = "OAuth callback does not validate 'state' (CSRF protection for OAuth flows)";

  it("does not double-report the same auth file for missing OAuth state", () => {
    const src = join(root, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "auth.ts"),
      [
        "export async function oauthCallback(req: any) {",
        "  const code = req.query.code;",
        "  return tokenExchange(code);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const review = scanSecurity(root);
    const oauthFindings = review.findings.filter((f) => f.title === OAUTH_TITLE);
    expect(oauthFindings.length).toBe(1);
    expect(oauthFindings[0]!.file).toBe(join("src", "auth.ts"));
  });

  it("still reports the summary finding for an auth file the detailed check missed", () => {
    // The detailed check only flags files with oauth/callback markers. A plain
    // auth file without those markers should still get the summary finding.
    const src = join(root, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "auth.ts"),
      ["export function login(user: string) {", "  return sign(user);", "}", ""].join("\n"),
      "utf8",
    );
    const review = scanSecurity(root);
    const oauthFindings = review.findings.filter((f) => f.title === OAUTH_TITLE);
    expect(oauthFindings.length).toBe(1);
  });
});
