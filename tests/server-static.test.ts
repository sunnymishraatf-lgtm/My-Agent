import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "../src/server/server";

let running: RunningServer;
let base: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "neutron-static-"));
  running = await startServer({ root, port: 0 });
  base = `http://127.0.0.1:${running.port}`;
  (globalThis as { __root?: string }).__root = root;
}, 30000);

afterAll(async () => {
  await running.close();
  const root = (globalThis as { __root?: string }).__root;
  if (root) rmSync(root, { recursive: true, force: true });
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, type: res.headers.get("content-type"), text: await res.text() };
}

describe("static /app/ assets", () => {
  it("serves the PWA manifest with the manifest MIME type", async () => {
    const r = await get("/app/manifest.webmanifest");
    expect(r.status).toBe(200);
    expect(r.type).toContain("application/manifest+json");
    expect(JSON.parse(r.text).name).toBe("NEUTRON");
  });

  it("serves app icons", async () => {
    const r = await get("/app/icons/icon-192.png");
    expect(r.status).toBe(200);
    expect(r.type).toContain("image/png");
  });

  it("rejects path traversal outside the web dir", async () => {
    const r = await get("/app/..%2f..%2fpackage.json");
    expect(r.status).not.toBe(200);
  });

  it("404s on missing assets", async () => {
    const r = await get("/app/no-such-file.png");
    expect(r.status).toBe(404);
  });

  it("still serves /src/web/ files", async () => {
    const r = await get("/src/web/app/index.html");
    expect(r.status).toBe(200);
  });
});
