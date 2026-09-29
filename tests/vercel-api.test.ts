/**
 * Tests for the Vercel serverless API (api/*).
 *
 * The handlers are exercised in-process with mocked req/res objects against a
 * temp workspace. The prepare -> analyze flow runs the REAL NEUTRON pipeline
 * (scaffold -> analyzeRepository -> analyzeImpact -> buildPlan); the approval
 * token round-trip is verified with the real HMAC implementation; execute
 * must return the honest executionUnsupported state (never a fake run).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANARY = "sk-canary-must-never-leak-9f8e7d";
process.env.NEUTRON_DEMO_WORKSPACE = mkdtempSync(join(tmpdir(), "vercel-api-"));
process.env.SERVER_SECRET = "test-server-secret-for-vercel-api-tests";
process.env.AGENTROUTER_API_KEY = CANARY;

import health from "../api-src/health";
import status from "../api-src/demo/status";
import prepare from "../api-src/demo/prepare";
import analyze from "../api-src/demo/analyze";
import approve from "../api-src/demo/approve";
import rejectRoute from "../api-src/demo/reject";
import execute from "../api-src/demo/execute";
import clone from "../api-src/demo/clone";
import jobRoute from "../api-src/demo/jobs/[id]";
import resultRoute from "../api-src/demo/jobs/[id]/result";
import chat from "../api-src/chat";
import { verifyApprovalToken } from "../api-src/_lib";
import type { VercelRequest, VercelResponse } from "../api-src/_lib";

interface MockRes extends VercelResponse {
  statusCode: number;
  payload: any;
}

function mockRes(): MockRes {
  const r: any = { statusCode: 0, payload: undefined };
  r.status = (c: number) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b: unknown) => {
    r.payload = b;
    return r;
  };
  return r as MockRes;
}

function req(method: string, body?: unknown, query?: Record<string, string>): VercelRequest {
  return { method, body, query };
}

function noCanary(payload: unknown): void {
  expect(JSON.stringify(payload)).not.toContain(CANARY);
}

describe("vercel api: health & status", () => {
  it("GET /api/health returns version and serverless flag", async () => {
    const res = mockRes();
    await health(req("GET"), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(typeof res.payload.version).toBe("string");
    expect(res.payload.serverless).toBe(true);
    noCanary(res.payload);
  });

  it("rejects non-GET on health", async () => {
    const res = mockRes();
    await health(req("POST", {}), res);
    expect(res.statusCode).toBe(405);
  });

  it("GET /api/demo/status reports capabilities honestly", async () => {
    const res = mockRes();
    await status(req("GET"), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.serverless).toBe(true);
    expect(res.payload.executionSupported).toBe(false);
    expect(typeof res.payload.defaultRequest).toBe("string");
    noCanary(res.payload);
  });
});

describe("vercel api: prepare -> analyze (real pipeline)", () => {
  it("POST /api/demo/prepare scaffolds the real TaskFlow repo", async () => {
    const res = mockRes();
    await prepare(req("POST", {}), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.repository).toBe("demo");
    expect(res.payload.files).toBeGreaterThanOrEqual(20);
    noCanary(res.payload);
  });

  it("POST /api/demo/analyze runs the real pipeline and returns plan", async () => {
    const res = mockRes();
    await analyze(
      req("POST", {
        repo: "demo",
        request: "Add Google OAuth while preserving email/password login",
        riskTolerance: "balanced",
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(typeof res.payload.analysisId).toBe("string");
    expect(res.payload.analysis.filesAnalyzed).toBeGreaterThan(0);
    expect(res.payload.plan.tasks.length).toBeGreaterThan(0);
    expect(res.payload.impact.summary.files).toBeGreaterThan(0);
    noCanary(res.payload);
  });

  it("analyze auto-scaffolds the demo repo in a fresh workspace (serverless /tmp)", async () => {
    // Regression: on serverless, /tmp is per-instance, so a prepare on one
    // instance is invisible to analyze on another. Analyze must never return
    // empty data for the demo repo — it scaffolds on demand.
    const prev = process.env.NEUTRON_DEMO_WORKSPACE;
    process.env.NEUTRON_DEMO_WORKSPACE = mkdtempSync(join(tmpdir(), "vercel-api-fresh-"));
    try {
      const res = mockRes();
      await analyze(
        req("POST", {
          repo: "demo",
          request: "Add rate limiting to the login endpoint",
          riskTolerance: "balanced",
        }),
        res,
      );
      expect(res.statusCode).toBe(200);
      expect(res.payload.ok).toBe(true);
      expect(res.payload.analysis.filesAnalyzed).toBeGreaterThan(0);
      expect(res.payload.plan.tasks.length).toBeGreaterThan(0);
      noCanary(res.payload);
    } finally {
      process.env.NEUTRON_DEMO_WORKSPACE = prev;
    }
  });

  it("analyze rejects empty request", async () => {
    const res = mockRes();
    await analyze(req("POST", { repo: "demo", request: "   " }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.ok).toBe(false);
  });

  it("analyze rejects invalid riskTolerance", async () => {
    const res = mockRes();
    await analyze(req("POST", { repo: "demo", request: "x", riskTolerance: "reckless" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("analyze rejects path traversal", async () => {
    const res = mockRes();
    await analyze(req("POST", { repo: "../../etc", request: "x" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.ok).toBe(false);
  });

  it("analyze rejects non-POST", async () => {
    const res = mockRes();
    await analyze(req("GET"), res);
    expect(res.statusCode).toBe(405);
  });
});

describe("vercel api: stateless approval gate", () => {
  const analysisId = "analysis-test123";

  it("approve issues a signed token bound to the analysis id", async () => {
    const res = mockRes();
    await approve(req("POST", { analysisId }), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.approved).toBe(true);
    expect(typeof res.payload.approvalToken).toBe("string");
    expect(verifyApprovalToken(res.payload.approvalToken, analysisId)).toBe(true);
    // Bound to the id: wrong id fails.
    expect(verifyApprovalToken(res.payload.approvalToken, "analysis-other")).toBe(false);
    // Tampered token fails.
    expect(verifyApprovalToken(res.payload.approvalToken + "x", analysisId)).toBe(false);
    noCanary(res.payload);
  });

  it("approve rejects malformed analysis id", async () => {
    const res = mockRes();
    await approve(req("POST", { analysisId: "../../evil" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("approve fails closed without SERVER_SECRET", async () => {
    const saved = process.env.SERVER_SECRET;
    delete process.env.SERVER_SECRET;
    try {
      const res = mockRes();
      await approve(req("POST", { analysisId }), res);
      expect(res.statusCode).toBe(500);
      expect(res.payload.ok).toBe(false);
    } finally {
      process.env.SERVER_SECRET = saved;
    }
  });

  it("reject is recorded honestly", async () => {
    const res = mockRes();
    await rejectRoute(req("POST", { analysisId }), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.rejected).toBe(true);
  });
});

describe("vercel api: execute is honestly unsupported", () => {
  const analysisId = "analysis-exec123";

  async function approvedToken(): Promise<string> {
    const res = mockRes();
    await approve(req("POST", { analysisId }), res);
    return res.payload.approvalToken as string;
  }

  it("execute without a valid approval token is refused (gate enforced)", async () => {
    const res = mockRes();
    await execute(req("POST", { analysisId, approvalToken: "bogus" }), res);
    expect(res.statusCode).toBe(403);
    expect(res.payload.ok).toBe(false);
    expect(res.payload.requiresApproval).toBe(true);
  });

  it("execute without any token is refused", async () => {
    const res = mockRes();
    await execute(req("POST", { analysisId }), res);
    expect(res.statusCode).toBe(403);
  });

  it("execute with a valid token returns honest executionUnsupported (never faked)", async () => {
    const token = await approvedToken();
    const res = mockRes();
    await execute(req("POST", { analysisId, approvalToken: token }), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.executionUnsupported).toBe(true);
    expect(typeof res.payload.message).toBe("string");
    // Must not pretend to be a job.
    expect(res.payload.job).toBeUndefined();
    noCanary(res.payload);
  });
});

describe("vercel api: jobs & clone", () => {
  it("GET /api/demo/jobs/:id honestly reports no jobs on serverless", async () => {
    const res = mockRes();
    await jobRoute(req("GET", undefined, { id: "job-abc123" }), res);
    expect(res.statusCode).toBe(404);
    expect(res.payload.ok).toBe(false);
  });

  it("job route rejects malformed id", async () => {
    const res = mockRes();
    await jobRoute(req("GET", undefined, { id: "../evil" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/demo/jobs/:id/result honestly reports no results", async () => {
    const res = mockRes();
    await resultRoute(req("GET", undefined, { id: "job-abc123" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("clone is disabled without NEUTRON_DEMO_ALLOW_CLONE", async () => {
    const res = mockRes();
    await clone(req("POST", { url: "https://github.com/octocat/Hello-World" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.ok).toBe(false);
  });
});

describe("vercel api: chat (BYOK)", () => {
  const ENV_KEY = "AGENTROUTER_API_KEY";
  let saved: string | undefined;

  function clearProviderEnv() {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  }
  function restoreProviderEnv() {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  }

  it("POST /api/chat returns an honest error with no provider and no key", async () => {
    clearProviderEnv();
    try {
      const res = mockRes();
      await chat({ method: "POST", body: { messages: [{ role: "user", content: "hi" }] } }, res);
      expect(res.statusCode).toBe(502);
      expect(res.payload.ok).toBe(false);
      expect(String(res.payload.error)).toMatch(/No LLM provider configured/i);
      noCanary(res.payload);
    } finally {
      restoreProviderEnv();
    }
  });

  it("POST /api/chat rejects a missing user message with 400", async () => {
    const res = mockRes();
    await chat({ method: "POST", body: { messages: [] } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.ok).toBe(false);
  });

  it("POST /api/chat accepts the x-api-key header and never echoes a bad key", async () => {
    const badKey = "byok-vercel-bad-1234567890";
    const res = mockRes();
    await chat(
      {
        method: "POST",
        headers: { "x-api-key": badKey },
        body: { messages: [{ role: "user", content: "hi" }] },
      },
      res,
    );
    // Upstream auth failure (or offline network error): honest 502, not a
    // 500, and the key must not appear anywhere in the response.
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.payload)).not.toContain(badKey);
    noCanary(res.payload);
  }, 60000);

  it("POST /api/demo/status reflects a request key honestly", async () => {
    const res = mockRes();
    await status(
      { method: "GET", headers: { "x-api-key": "byok-status-key-1234567890" } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.payload.providerConfigured).toBe(true);
    expect(String(res.payload.llmNote)).toMatch(/provided with this request/i);
    expect(JSON.stringify(res.payload)).not.toContain("byok-status-key-1234567890");
  });
});
