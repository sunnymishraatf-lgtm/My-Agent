/**
 * Tests for the NEUTRON web demo (/demo + /api/demo/*).
 *
 * These tests exercise the real workflow: analyzeRepository, analyzeImpact and
 * buildPlan run against a scaffolded TaskFlow repo, and the background job
 * runner drives the real createNeutronWorkflow stages. When no LLM provider is
 * configured (the hermetic case), the suite additionally asserts the honest
 * no-LLM path: implementation is skipped without fabricating anything, while
 * analysis, tests, security, review and the release gate still produce results.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { startServer, type RunningServer } from "../src/server/server";
import { hasProviderConfigured } from "../src/neutron/agents";

// Canary: responses must never echo server-side secrets/environment.
const CANARY = `neutron-canary-${Math.random().toString(36).slice(2)}`;
process.env.NEUTRON_DEMO_TEST_CANARY = CANARY;

const providerOn = hasProviderConfigured();

let root: string;
let workspace: string;
let running: RunningServer;
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "neutron-demo-web-"));
  workspace = join(root, "demo-workspace");
  running = await startServer({ root, port: 0, demoWorkspace: workspace });
  base = `http://127.0.0.1:${running.port}`;
}, 30000);

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

async function get(path: string): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}

async function postRaw(path: string, raw: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
  return { status: res.status, text: await res.text() };
}

function assertNoCanary(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(CANARY);
}

/**
 * Raw-socket GET: sends the request target byte-for-byte without any
 * client-side normalization. fetch/undici decodes %2e%2e before sending, so a
 * traversal probe via fetch would never exercise the server's encoded-path
 * check. Returns the numeric HTTP status code.
 */
function rawGetStatus(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const port = Number(new URL(base).port);
    const sock = connect(port, "127.0.0.1", () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    sock.on("data", (c) => { data += c.toString(); });
    sock.on("end", () => {
      const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(data);
      resolve(m ? Number(m[1]) : -1);
    });
    sock.on("error", reject);
  });
}

const REQUEST = "Add a health-check endpoint while preserving the existing API behavior.";

async function analyzeOnce(repo = "demo"): Promise<any> {
  const { status, json } = await post("/api/demo/analyze", { repo, request: REQUEST, riskTolerance: "balanced" });
  expect(status).toBe(200);
  return json;
}

describe("demo UI serving", () => {
  it("serves the demo UI at /demo", async () => {
    const { status, text } = await get("/demo");
    expect(status).toBe(200);
    expect(text).toContain("NEUTRON");
    expect(text).toContain("AI Software Maintenance Agent");
    expect(text).toContain("/src/web/demo/app.js");
  });

  it("serves demo assets (js/css)", async () => {
    const js = await get("/src/web/demo/app.js");
    expect(js.status).toBe(200);
    expect(js.text).toContain("/api/demo/");
    const css = await get("/src/web/demo/styles.css");
    expect(css.status).toBe(200);
    expect(css.text).toContain(":root");
  });

  it("keeps the existing dashboard at / untouched", async () => {
    const { status, text } = await get("/");
    expect(status).toBe(200);
    expect(text).toContain("NEUTRON");
  });
});

describe("demo status + prepare", () => {
  it("GET /api/demo/status reports capabilities without secrets", async () => {
    const { status, json } = await get("/api/demo/status");
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.providerConfigured).toBe(providerOn);
    expect(typeof json.llmNote).toBe("string");
    expect(json.llmNote.length).toBeGreaterThan(0);
    assertNoCanary(json);
  });

  it("POST /api/demo/prepare scaffolds the TaskFlow demo repo (idempotent)", async () => {
    const first = await post("/api/demo/prepare", {});
    expect(first.status).toBe(200);
    expect(first.json.repository).toBe("demo");
    expect(first.json.files).toBeGreaterThan(0);
    expect(first.json.defaultRequest).toBeTruthy();
    assertNoCanary(first.json);
    expect(existsSync(join(workspace, "taskflow", "package.json"))).toBe(true);

    const second = await post("/api/demo/prepare", {});
    expect(second.status).toBe(200);
    expect(second.json.reused).toBe(true);
  });
});

describe("demo analyze validation", () => {
  it("rejects a missing request", async () => {
    const { status, json } = await post("/api/demo/analyze", { repo: "demo" });
    expect(status).toBe(400);
    expect(json.error).toMatch(/request/i);
  });

  it("rejects path traversal", async () => {
    const { status } = await post("/api/demo/analyze", { repo: "../../etc", request: REQUEST });
    expect(status).toBe(400);
  });

  it("rejects absolute paths", async () => {
    const { status } = await post("/api/demo/analyze", { repo: "/tmp", request: REQUEST });
    expect(status).toBe(400);
  });

  it("rejects repository URLs on a deployment without cloning enabled", async () => {
    const { status, json } = await post("/api/demo/analyze", {
      repo: "https://github.com/octocat/hello-world",
      request: REQUEST,
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/cloning is disabled/i);
  });

  it("returns 404 for a workspace path that does not exist", async () => {
    const { status } = await post("/api/demo/analyze", { repo: "no-such-repo", request: REQUEST });
    expect(status).toBe(404);
  });

  it("rejects an invalid riskTolerance", async () => {
    const { status } = await post("/api/demo/analyze", { repo: "demo", request: REQUEST, riskTolerance: "yolo" });
    expect(status).toBe(400);
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    const bad = await postRaw("/api/demo/analyze", "{not json");
    expect(bad.status).toBe(400);
    const big = await postRaw("/api/demo/analyze", "x".repeat(6_000_000));
    expect([400, 413]).toContain(big.status);
  });
});

describe("demo analyze (real pipeline)", () => {
  it("returns real analysis, impact graph and plan", async () => {
    const json = await analyzeOnce();
    expect(json.analysisId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    expect(json.repository).toBe("taskflow");
    expect(json.isDemo).toBe(true);
    expect(json.analysis.filesAnalyzed).toBeGreaterThan(0);
    expect(json.impact.nodes.length).toBeGreaterThan(0);
    expect(json.plan.tasks.length).toBeGreaterThan(0);
    // No absolute server paths leak to the client.
    expect(JSON.stringify(json)).not.toContain(workspace);
    assertNoCanary(json);
  });
});

describe("demo approval gate", () => {
  it("execute without approval returns 409 with requiresApproval", async () => {
    const a = await analyzeOnce();
    const { status, json } = await post("/api/demo/execute", { analysisId: a.analysisId });
    expect(status).toBe(409);
    expect(json.requiresApproval).toBe(true);
  });

  it("execute with an unknown analysis id returns 404", async () => {
    const { status } = await post("/api/demo/execute", { analysisId: "analysis-doesnotexist" });
    expect(status).toBe(404);
  });

  it("approve rejects malformed and unknown ids", async () => {
    const bad = await post("/api/demo/approve", { analysisId: "not a valid id!" });
    expect(bad.status).toBe(400);
    const unknown = await post("/api/demo/approve", { analysisId: "analysis-doesnotexist" });
    expect(unknown.status).toBe(404);
  });

  it("reject clears the gate: execute afterwards is 409 again", async () => {
    const a = await analyzeOnce();
    const ap = await post("/api/demo/approve", { analysisId: a.analysisId });
    expect(ap.status).toBe(200);
    const rej = await post("/api/demo/reject", { analysisId: a.analysisId });
    expect(rej.status).toBe(200);
    const ex = await post("/api/demo/execute", { analysisId: a.analysisId });
    expect(ex.status).toBe(409);
  });

  it("job ids are validated", async () => {
    // Encoded traversal must be rejected with 400, not treated as a route.
    // Sent over a raw socket: fetch would normalize %2e%2e client-side.
    expect(await rawGetStatus("/api/demo/jobs/%2e%2e")).toBe(400);
    expect(await rawGetStatus("/api/demo/jobs/%2Fetc%2Fpasswd")).toBe(400);
    const missing = await get("/api/demo/jobs/job-doesnotexist");
    expect(missing.status).toBe(404);
  });
});

describe("demo execute (background job, real stages)", () => {
  it("approve -> execute starts a job; approval is single-use", async () => {
    const a = await analyzeOnce();
    expect((await post("/api/demo/approve", { analysisId: a.analysisId })).status).toBe(200);
    const ex = await post("/api/demo/execute", { analysisId: a.analysisId });
    expect(ex.status).toBe(202);
    expect(ex.json.jobId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    const again = await post("/api/demo/execute", { analysisId: a.analysisId });
    expect(again.status).toBe(409);

    // Let the background job finish before the suite tears the server down.
    const jobId = ex.json.jobId as string;
    const deadline = Date.now() + 120_000;
    for (;;) {
      const { json } = await get(`/api/demo/jobs/${jobId}`);
      if (["completed", "failed", "denied"].includes(json.job.status)) break;
      if (Date.now() > deadline) throw new Error("demo job did not finish in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  it("job status exposes the 9 workflow stages and a live event log", async () => {
    const a = await analyzeOnce();
    await post("/api/demo/approve", { analysisId: a.analysisId });
    const ex = await post("/api/demo/execute", { analysisId: a.analysisId });
    const jobId = ex.json.jobId as string;
    const deadline = Date.now() + 120_000;
    let last: any;
    for (;;) {
      const { json } = await get(`/api/demo/jobs/${jobId}`);
      last = json.job;
      assertNoCanary(json);
      if (["completed", "failed", "denied"].includes(last.status)) break;
      if (Date.now() > deadline) throw new Error("demo job did not finish in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
    const keys = last.stages.map((s: any) => s.key);
    for (const k of [
      "repository-analysis", "impact-analysis", "implementation-plan", "human-approval",
      "agent-execution", "testing", "security", "code-review", "release-readiness",
    ]) {
      expect(keys).toContain(k);
    }
    expect(last.events.length).toBeGreaterThan(0);
  });

  it("result endpoint returns the real sanitized result", async () => {
    const a = await analyzeOnce();
    await post("/api/demo/approve", { analysisId: a.analysisId });
    const ex = await post("/api/demo/execute", { analysisId: a.analysisId });
    const jobId = ex.json.jobId as string;
    const deadline = Date.now() + 120_000;
    for (;;) {
      const { json } = await get(`/api/demo/jobs/${jobId}`);
      if (["completed", "failed", "denied"].includes(json.job.status)) break;
      if (Date.now() > deadline) throw new Error("demo job did not finish in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
    const { status, json } = await get(`/api/demo/jobs/${jobId}/result`);
    expect(status).toBe(200);
    expect(json.result).toBeTruthy();
    expect(json.result.analysis.filesAnalyzed).toBeGreaterThan(0);
    expect(json.result.plan.tasks.length).toBeGreaterThan(0);
    expect(json.result.impact.nodes.length).toBeGreaterThan(0);
    assertNoCanary(json);
    if (!providerOn) {
      // Hermetic case: the honest no-LLM path — nothing fabricated.
      expect(json.result.noLlm).toBe(true);
      expect(json.result.llmNote).toMatch(/No LLM provider/i);
      expect(json.result.execution.noLlm).toBe(true);
      expect(json.result.execution.changes).toEqual([]);
    }
  });
});
