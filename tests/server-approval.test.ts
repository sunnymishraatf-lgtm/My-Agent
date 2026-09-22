import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, WEB_HTML, type RunningServer } from "../src/server/server";
import { NeutronStore } from "../src/neutron/store";

const here = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(here, "..", "src", "server", "server.ts"), "utf8");

const REQUEST = "add a health-check endpoint without changing existing behavior";

let root: string;
let running: RunningServer;
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "neutron-srv-"));
  running = await startServer({ root, port: 0 });
  base = `http://127.0.0.1:${running.port}`;
}, 30000);

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function postRaw(path: string, raw: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
  return { status: res.status, text: await res.text() };
}

describe("server plan → approve → execute", () => {
  it("plan persists request/graph/plan and resets approval", async () => {
    const { status, json } = await post("/api/neutron/plan", { request: REQUEST, riskTolerance: "balanced" });
    expect(status).toBe(200);
    expect(json.plan).toBeTruthy();
    expect(json.graph).toBeTruthy();

    const saved = new NeutronStore(root).load();
    expect(saved.request).toBe(REQUEST);
    expect(saved.plan).toBeTruthy();
    expect(saved.graph).toBeTruthy();
  });

  it("execute before approval returns 409 and ignores client approval flags", async () => {
    // A forged client-side approval flag must never authorize execution.
    const { status, json } = await post("/api/neutron/execute", {
      request: REQUEST,
      execution: "implement-and-test",
      planApproved: true,
    });
    expect(status).toBe(409);
    expect(json.requiresApproval).toBe(true);
  });

  it("approve → execute succeeds with runId === result.runId; approval is single-use", async () => {
    const ap = await post("/api/neutron/approve", { request: REQUEST });
    expect(ap.status).toBe(200);
    expect(ap.json.approved).toBe(true);

    const ex = await post("/api/neutron/execute", { request: REQUEST, execution: "implement-and-test" });
    expect(ex.status).toBe(200);
    expect(typeof ex.json.runId).toBe("string");
    expect(ex.json.runId.length).toBeGreaterThan(0);
    expect(ex.json.runId).toBe(ex.json.result.runId);

    // The approval was consumed by the run above: a second execute is rejected.
    const again = await post("/api/neutron/execute", { request: REQUEST, execution: "implement-and-test" });
    expect(again.status).toBe(409);
  }, 120000);

  it("a fresh plan invalidates a stale approval", async () => {
    await post("/api/neutron/plan", { request: REQUEST, riskTolerance: "balanced" });
    const ap = await post("/api/neutron/approve", { request: REQUEST });
    expect(ap.status).toBe(200);
    // New plan for the same request resets approval.
    await post("/api/neutron/plan", { request: REQUEST, riskTolerance: "balanced" });
    const ex = await post("/api/neutron/execute", { request: REQUEST, execution: "implement-and-test" });
    expect(ex.status).toBe(409);
  });

  it("malformed JSON returns 400", async () => {
    for (const path of ["/api/neutron/plan", "/api/neutron/approve", "/api/neutron/execute", "/api/neutron/analyze"]) {
      const { status } = await postRaw(path, "{not valid json");
      expect(status).toBe(400);
    }
  });

  it("invalid riskTolerance/execution enums return 400", async () => {
    const r1 = await post("/api/neutron/analyze", { request: REQUEST, riskTolerance: "reckless" });
    expect(r1.status).toBe(400);

    const r2 = await post("/api/neutron/plan", { request: REQUEST, riskTolerance: "yolo" });
    expect(r2.status).toBe(400);

    const r3 = await post("/api/neutron/execute", { request: REQUEST, execution: "deploy-to-prod" });
    expect(r3.status).toBe(400);
  });

  it("session id path traversal is rejected with 400", async () => {
    const res = await fetch(`${base}/v1/sessions/%2e%2e%2fpackage.json`);
    expect(res.status).toBe(400);

    const missing = await fetch(`${base}/v1/sessions/does-not-exist-123`);
    expect(missing.status).toBe(404);
  });
});

describe("embedded browser NDJSON parser", () => {
  it("TypeScript source escapes the newline so the generated JS stays valid", () => {
    // In the TS template literal the parser must read buf.indexOf("\\n") (two chars);
    // a raw newline there would inject a literal line break into the generated JS string.
    expect(serverSource).toContain('buf.indexOf("\\\\n")');
  });

  it("rendered page script is syntactically valid JavaScript", () => {
    const m = WEB_HTML.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const script = m![1] as string;
    expect(script).toContain('buf.indexOf("\\n")');
    const tmp = join(mkdtempSync(join(tmpdir(), "neutron-js-")), "parser.js");
    try {
      writeFileSync(tmp, script, "utf8");
      execFileSync(process.execPath, ["--check", tmp]);
    } finally {
      rmSync(tmp, { force: true });
    }
  });
});
