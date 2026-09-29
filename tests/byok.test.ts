/**
 * Tests for bring-your-own-key (BYOK) request plumbing.
 *
 * The request key (x-api-key header or apiKey body field) must:
 * - build a request-scoped AgentRouter provider (never touch env/config),
 * - never be stored on any long-lived object (DemoManager, jobs, sessions),
 * - never appear in responses, logs, or error text,
 * - produce honest provider errors (never 500s, never fabricated replies).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import {
  API_KEY_HEADER,
  PROVIDER_HEADER,
  configForRequest,
  extractRequestKey,
  extractRequestProvider,
  providerFromRequestKey,
} from "../src/server/byok";
import * as byokModule from "../src/server/byok";
import { defaultModelsFor, getCatalogEntry } from "../src/providers/catalog";
import { handlePreflight } from "../api-src/_lib";
import { loadConfig } from "../src/config";
import { DemoManager } from "../src/server/demo";
import { startServer, type RunningServer } from "../src/server/server";

const KEY = "byok-test-key-abcdef1234567890";

function fakeReq(headers: Record<string, string | string[]> = {}): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("providerFromRequestKey", () => {
  it("builds an explicit NVIDIA provider when requested", () => {
    const p = providerFromRequestKey(KEY, "nvidia");
    expect(p).toBeDefined();
    expect(p!.id).toBe("nvidia");
    expect(p!.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(p!.apiKey).toBe(KEY);
    expect(p!.enabled).toBe(true);
  });

  it("builds an explicit AgentRouter provider when requested", () => {
    const p = providerFromRequestKey(KEY, "agentrouter");
    expect(p).toBeDefined();
    expect(p!.id).toBe("agentrouter");
    expect(p!.baseUrl).toBe("https://agentrouter.org/v1");
    expect(p!.apiKey).toBe(KEY);
  });

  it("returns undefined when no provider id is given — no silent default", () => {
    expect(providerFromRequestKey(KEY)).toBeUndefined();
    expect(providerFromRequestKey(KEY, "")).toBeUndefined();
    expect(providerFromRequestKey(KEY, "   ")).toBeUndefined();
  });

  it("rejects empty, short, and whitespace-containing input", () => {
    expect(providerFromRequestKey("")).toBeUndefined();
    expect(providerFromRequestKey("   ")).toBeUndefined();
    expect(providerFromRequestKey("short")).toBeUndefined();
    expect(providerFromRequestKey("has space in key 12345678")).toBeUndefined();
  });

  it("builds the requested provider entry when a provider id is given", () => {
    const p = providerFromRequestKey(KEY, "openrouter");
    expect(p).toBeDefined();
    expect(p!.id).toBe("openrouter");
    expect(p!.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(p!.apiKey).toBe(KEY);
  });

  it("builds the NousResearch entry for provider id 'nous'", () => {
    const p = providerFromRequestKey(KEY, "nous");
    expect(p).toBeDefined();
    expect(p!.id).toBe("nous");
    expect(p!.baseUrl).toBe("https://inference-api.nousresearch.com/v1");
    expect(p!.apiKey).toBe(KEY);
  });

  it("returns undefined for unknown provider ids — no silent fallback", () => {
    expect(providerFromRequestKey(KEY, "definitely-not-a-provider")).toBeUndefined();
  });

  it("returns undefined for providers without a base URL", () => {
    expect(providerFromRequestKey(KEY, "custom")).toBeUndefined();
  });
});

describe("extractRequestProvider", () => {
  it("prefers the x-provider header over the body field", () => {
    expect(
      extractRequestProvider(fakeReq({ [PROVIDER_HEADER]: "OpenRouter" }), { provider: "nous" }),
    ).toBe("openrouter");
  });

  it("falls back to the provider body field", () => {
    expect(extractRequestProvider(fakeReq({}), { provider: "Nous" })).toBe("nous");
  });

  it("returns undefined when no provider is supplied", () => {
    expect(extractRequestProvider(fakeReq({}), {})).toBeUndefined();
    expect(extractRequestProvider(fakeReq({}))).toBeUndefined();
  });
});

describe("extractRequestKey", () => {
  it("prefers the x-api-key header over the body field", () => {
    expect(
      extractRequestKey(fakeReq({ [API_KEY_HEADER]: "header-key-12345678" }), { apiKey: "body-key-12345678" }),
    ).toBe("header-key-12345678");
  });

  it("falls back to the apiKey body field", () => {
    expect(extractRequestKey(fakeReq({}), { apiKey: "body-key-12345678" })).toBe("body-key-12345678");
  });

  it("returns undefined when no key is supplied", () => {
    expect(extractRequestKey(fakeReq({}), {})).toBeUndefined();
    expect(extractRequestKey(fakeReq({}))).toBeUndefined();
  });
});

describe("configForRequest", () => {
  it("falls back to the server config when a key is given without a provider choice", () => {
    // No silent provider assignment: the key alone picks nothing.
    expect(configForRequest(KEY)).toEqual(loadConfig());
  });

  it("falls back to the server config when no key is given", () => {
    expect(configForRequest(undefined)).toEqual(loadConfig());
    expect(configForRequest("")).toEqual(loadConfig());
  });

  it("does not silently pick a provider for an unknown provider id", () => {
    expect(configForRequest(KEY, "definitely-not-a-provider")).toEqual(loadConfig());
  });

  it("builds a single-provider config for the requested provider", () => {
    const cfg = configForRequest(KEY, "openrouter");
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]!.id).toBe("openrouter");
    expect(cfg.providers[0]!.apiKey).toBe(KEY);
  });

  it("honors an explicit agentrouter choice", () => {
    const cfg = configForRequest(KEY, "agentrouter");
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]!.id).toBe("agentrouter");
  });

  it("honors an explicit nvidia choice", () => {
    const cfg = configForRequest(KEY, "nvidia");
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]!.id).toBe("nvidia");
    expect(cfg.providers[0]!.apiKey).toBe(KEY);
  });
});

describe("NVIDIA catalog wiring", () => {
  it("has a verified nvidia entry pointing at the real NIM endpoint", () => {
    const e = getCatalogEntry("nvidia");
    expect(e).toBeDefined();
    expect(e!.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(e!.apiType).toBe("openai-compatible");
    expect(e!.auth).toBe("bearer");
  });

  it("suggests verified NVIDIA-hosted model ids (BYOK-compatible)", () => {
    const models = defaultModelsFor("nvidia");
    expect(models).toContain("nvidia/nemotron-3-ultra-550b-a55b");
    expect(models).toContain("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(models).toContain("nvidia/nemotron-3-super-120b-a12b");
  });

  it("exposes no default provider constant", () => {
    expect("DEFAULT_BYOK_PROVIDER" in byokModule).toBe(false);
  });

  it("resolves an explicit nvidia choice end to end", () => {
    const p = providerFromRequestKey(KEY, "nvidia");
    expect(p).toBeDefined();
    expect(p!.id).toBe("nvidia");
    expect(p!.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });
});

describe("CORS preflight helper (api-src/_lib)", () => {
  function mockRes() {
    const headers: Record<string, string> = {};
    let statusCode = 0;
    let body: unknown = null;
    const res = {
      status: (c: number) => {
        statusCode = c;
        return { json: (b: unknown) => { body = b; } };
      },
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    };
    return { res: res as never, headers, get statusCode() { return statusCode; }, get body() { return body; } };
  }

  it("answers OPTIONS with 204 and CORS headers", () => {
    const m = mockRes();
    const handled = handlePreflight({ method: "OPTIONS" } as never, m.res);
    expect(handled).toBe(true);
    expect(m.statusCode).toBe(204);
    expect(m.headers["access-control-allow-origin"]).toBe("*");
    expect(m.headers["access-control-allow-headers"]).toContain("x-api-key");
    expect(m.headers["access-control-allow-headers"]).toContain("x-provider");
  });

  it("passes non-OPTIONS requests through untouched", () => {
    const m = mockRes();
    const handled = handlePreflight({ method: "POST" } as never, m.res);
    expect(handled).toBe(false);
    expect(m.statusCode).toBe(0);
    // CORS headers are still stamped on the pass-through for real responses
    expect(m.headers["access-control-allow-origin"]).toBe("*");
  });

  it("works with header-less mock responses (tests)", () => {
    const res = { status: (c: number) => ({ json: (_b: unknown) => {} }) };
    expect(handlePreflight({ method: "OPTIONS" } as never, res as never)).toBe(true);
    expect(handlePreflight({ method: "GET" } as never, res as never)).toBe(false);
  });
});

describe("NousResearch / Hermes catalog wiring", () => {
  it("has a verified nous entry pointing at the real inference endpoint", () => {
    const e = getCatalogEntry("nous");
    expect(e).toBeDefined();
    expect(e!.baseUrl).toBe("https://inference-api.nousresearch.com/v1");
    expect(e!.apiType).toBe("openai-compatible");
  });

  it("suggests verified Hermes model ids for OpenRouter (BYOK-compatible)", () => {
    const models = defaultModelsFor("openrouter");
    expect(models).toContain("nousresearch/hermes-4-405b");
    expect(models).toContain("nousresearch/hermes-3-llama-3.1-405b");
    expect(models).toContain("nousresearch/hermes-3-llama-3.1-70b");
  });
});

describe("DemoManager never retains the request key", () => {
  it("execute() takes the key as a parameter only — nothing is stored", () => {
    const workspace = mkdtempSync(join(tmpdir(), "byok-"));
    try {
      const manager = new DemoManager(workspace);
      const rec = manager.analyze("demo", "Add a health check endpoint.", "balanced");
      manager.approve(rec.id);
      const job = manager.execute(rec.id, KEY);
      // The background runner may already have flipped queued -> running;
      // either way the job started with the key passed as a parameter.
      expect(["queued", "running"]).toContain(job.status);
      // Structural invariant: no field on the manager (or the job record)
      // may hold the key. The background job will fail honestly on the
      // dummy key; nothing here awaits it.
      expect((manager as unknown as Record<string, unknown>).apiKey).toBeUndefined();
      expect((manager as unknown as Record<string, unknown>).requestKey).toBeUndefined();
      expect(JSON.stringify(job)).not.toContain(KEY);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("/api/chat on the Node server", () => {
  let running: RunningServer;
  let base: string;
  let root: string;
  const ENV_KEYS = [
    "AGENTROUTER_API_KEY", "AGENT_ROUTER_API_KEY",
    "OPENAI_API_KEY", "OPENROUTER_API_KEY", "LLM_API_KEY",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    root = mkdtempSync(join(tmpdir(), "byok-chat-"));
    running = await startServer({ root, port: 0, demoWorkspace: join(root, "ws") });
    base = `http://127.0.0.1:${running.port}`;
  }, 30000);

  afterAll(async () => {
    await running.close();
    rmSync(root, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function postChat(body: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  }

  it("returns an honest error when no provider and no key are configured", async () => {
    const { status, json, text } = await postChat({ messages: [{ role: "user", content: "hello" }] });
    expect(status).toBe(502);
    expect(json.ok).toBe(false);
    expect(String(json.error)).toMatch(/No LLM provider configured/i);
  });

  it("rejects a missing user message with 400", async () => {
    const { status } = await postChat({ messages: [] });
    expect(status).toBe(400);
  });

  it("accepts the x-api-key header and never echoes a bad key", async () => {
    const badKey = "byok-bad-key-zzzz1234567890";
    const { status, text } = await postChat(
      { messages: [{ role: "user", content: "hello" }] },
      { "x-api-key": badKey },
    );
    // Upstream auth failure (or offline network error) — honest, not a 500,
    // and the key must not appear anywhere in the response.
    expect(status).toBe(502);
    expect(text).not.toContain(badKey);
  }, 60000);

  it("honors x-provider with a bad key: honest upstream error, no leak", async () => {
    const badKey = "byok-bad-key-pppp1234567890";
    const { status, json, text } = await postChat(
      { messages: [{ role: "user", content: "hello" }], model: "nousresearch/hermes-4-405b" },
      { "x-api-key": badKey, "x-provider": "openrouter" },
    );
    // Provider-aware: the request went to OpenRouter (or failed reaching it),
    // never a 500, never fabricated, key never echoed.
    expect(status).toBe(502);
    expect(json.ok).toBe(false);
    expect(text).not.toContain(badKey);
    expect(text).not.toContain("pppp1234567890");
  }, 60000);

  it("key without provider: honest no-provider error, never a silent pick", async () => {
    const badKey = "byok-bad-key-kkkk1234567890";
    const { status, json, text } = await postChat(
      { messages: [{ role: "user", content: "hello" }] },
      { "x-api-key": badKey },
    );
    // No provider chosen and none configured on the server: the request
    // must fail honestly (not 500, not fabricated), and the key must not
    // be assigned to any provider or echoed back.
    expect(status).toBe(502);
    expect(json.ok).toBe(false);
    expect(String(json.error)).toMatch(/No LLM provider configured/i);
    expect(text).not.toContain(badKey);
    expect(text).not.toContain("kkkk1234567890");
  });

  it("GET /api/providers lists the real catalog including nvidia, with no default", async () => {
    const res = await fetch(`${base}/api/providers`);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    const ids = (json.providers as any[]).map((p) => p.id);
    expect(ids).toContain("agentrouter");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("nous");
    expect(ids).toContain("nvidia");
    // No default provider is advertised anywhere in the response.
    expect("defaultProvider" in json).toBe(false);
    for (const p of json.providers as any[]) expect("isDefault" in p).toBe(false);
    const nvidia = (json.providers as any[]).find((p) => p.id === "nvidia");
    expect(nvidia.defaultModels).toContain("nvidia/nemotron-3-ultra-550b-a55b");
    const openrouter = (json.providers as any[]).find((p) => p.id === "openrouter");
    expect(openrouter.defaultModels).toContain("nousresearch/hermes-4-405b");
    // No secrets in the catalog response.
    expect(JSON.stringify(json)).not.toMatch(/api[_-]?key/i);
  });
});

describe("/app frontend: explicit provider selection, no default", () => {
  const src = readFileSync(new URL("../src/web/app/app.js", import.meta.url), "utf8");

  it("provider dropdown starts with an unselected placeholder", () => {
    expect(src).toContain("Select a provider");
  });

  it("never hardcodes a default provider", () => {
    expect(src).not.toContain("DEFAULT_PROVIDER");
  });

  it("sends x-provider only when the user chose one", () => {
    expect(src).toContain('if (prov) opts.headers["x-provider"] = prov;');
    expect(src).not.toContain('opts.headers["x-provider"] = storedProvider() ||');
  });

  it("chat refuses to send without a chosen provider", () => {
    expect(src).toContain("Please select a provider in Settings first");
  });
});
