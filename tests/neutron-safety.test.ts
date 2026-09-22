import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/server";
import { collectBobActivity } from "../src/neutron/bob";
import { envVar, stateDir } from "../src/compat";
import { configDir } from "../src/config";
import { NeutronStore } from "../src/neutron/store";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-safety-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const a = 1;\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("web server", () => {
  it("serves the NEUTRON dashboard and assets, and refuses path traversal", async () => {
    const running = await startServer({ root, port: 0, host: "127.0.0.1", web: true });
    try {
      const base = `http://127.0.0.1:${running.port}`;
      const page = await (await fetch(`${base}/`)).text();
      expect(page).toContain("<title>NEUTRON — Autonomous Software Maintenance Intelligence</title>");
      expect(page).not.toMatch(/\bSUN\b/);
      const css = await fetch(`${base}/src/web/styles/neutron.css`);
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toContain("text/css");
      for (const bad of ["/src/web/..%2f..%2fpackage.json", "/src/web/%2e%2e/%2e%2e/package.json", "/src/web/..%5c..%5cpackage.json"]) {
        const r = await fetch(`${base}${bad}`);
        expect(r.status).toBe(404);
      }
    } finally {
      await running.close();
    }
  });

  it("never runs code-changing work without an explicit plan approval", async () => {
    const running = await startServer({ root, port: 0, host: "127.0.0.1", web: true });
    try {
      const url = `http://127.0.0.1:${running.port}/api/neutron/execute`;
      const post = (body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

      // A client-supplied blanket autoApprove is ignored.
      const r1 = await post({ request: "add oauth", execution: "implement-and-test", autoApprove: true });
      expect(r1.status).toBe(409);
      expect(((await r1.json()) as { requiresApproval: boolean }).requiresApproval).toBe(true);

      // Claiming approval without a saved plan for this request is also refused.
      const r2 = await post({ request: "add oauth", execution: "implement-and-test", planApproved: true });
      expect(r2.status).toBe(409);
    } finally {
      await running.close();
    }
  });
});

describe("IBM Bob evidence", () => {
  it("reports no activity (and what is missing) when nothing has been exported", () => {
    const a = collectBobActivity(root);
    expect(a.hasActivity).toBe(false);
    expect(a.sessionCount).toBe(0);
    expect(a.missing.join(" ")).toContain("Bob session files");
  });

  it("reads only real exported sessions", () => {
    mkdirSync(join(root, ".agent", "bob", "sessions"), { recursive: true });
    writeFileSync(
      join(root, ".agent", "bob", "sessions", "s1.json"),
      JSON.stringify({ id: "s1", title: "Repo analysis", createdAt: "2026-09-01T00:00:00Z", messages: [{ role: "user" }], files: ["src/a.ts"] }),
    );
    writeFileSync(join(root, ".agent", "bob", "summary.md"), "Bob analysed the auth module.");
    const a = collectBobActivity(root);
    expect(a.hasActivity).toBe(true);
    expect(a.sessionCount).toBe(1);
    expect(a.sessions[0]?.filesTouched).toEqual(["src/a.ts"]);
    expect(a.missing.join(" ")).not.toContain("session files");
    expect(a.samples[0]).toContain("auth module");
  });
});

describe("legacy SUNNY compatibility", () => {
  it("prefers NEUTRON_* env vars but falls back to SUNNY_*", () => {
    delete process.env.NEUTRON_THEME;
    process.env.SUNNY_THEME = "legacy";
    expect(envVar("THEME")).toBe("legacy");
    process.env.NEUTRON_THEME = "new";
    expect(envVar("THEME")).toBe("new");
    delete process.env.NEUTRON_THEME;
    delete process.env.SUNNY_THEME;
  });

  it("honours SUNNY_CONFIG_DIR only when NEUTRON_CONFIG_DIR is unset", () => {
    process.env.SUNNY_CONFIG_DIR = "/tmp/legacy-cfg";
    delete process.env.NEUTRON_CONFIG_DIR;
    expect(configDir()).toBe("/tmp/legacy-cfg");
    process.env.NEUTRON_CONFIG_DIR = "/tmp/new-cfg";
    expect(configDir()).toBe("/tmp/new-cfg");
    delete process.env.SUNNY_CONFIG_DIR;
    delete process.env.NEUTRON_CONFIG_DIR;
  });

  it("keeps using an existing legacy .agent/sun state dir instead of orphaning it", () => {
    const r = mkdtempSync(join(tmpdir(), "neutron-legacy-"));
    mkdirSync(join(r, ".agent", "sun"), { recursive: true });
    writeFileSync(join(r, ".agent", "sun", "state.json"), JSON.stringify({ request: "old request" }));
    expect(stateDir(r)).toBe(join(r, ".agent", "sun"));
    expect(new NeutronStore(r).load().request).toBe("old request");
    const fresh = mkdtempSync(join(tmpdir(), "neutron-fresh-"));
    expect(stateDir(fresh)).toBe(join(fresh, ".agent", "neutron"));
    rmSync(r, { recursive: true, force: true });
    rmSync(fresh, { recursive: true, force: true });
  });
});
