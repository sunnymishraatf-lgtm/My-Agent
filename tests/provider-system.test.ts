import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDotEnv, loadDotEnvFiles, resetDotEnvLoader, loadedEnvFiles } from "../src/env";
import {
  classifyNetworkError,
  classifyHttpError,
  isRetryable,
  isClassified,
  formatFailoverError,
  formatCliError,
  keyEnvVar,
} from "../src/providers/errors";
import { readGlobalProviders } from "../src/config";
import { writeFileSync } from "node:fs";

const C = { provider: "agentrouter", endpoint: "https://agentrouter.org/v1", keyEnv: "AGENTROUTER_API_KEY" };

describe("parseDotEnv", () => {
  it("parses simple assignments, quotes, comments and export prefix", () => {
    const parsed = parseDotEnv([
      "# comment",
      "AGENTROUTER_API_KEY=sk-secret-123",
      'QUOTED="value with # hash"',
      "SINGLE='single quoted'",
      "export EXPORTED=yes",
      "EMPTY=",
      "SPACED = spaced out ",
      "TRAILING=value # inline comment",
      "",
      "not-a-key??=ignored",
    ].join("\n"));
    expect(parsed.AGENTROUTER_API_KEY).toBe("sk-secret-123");
    expect(parsed.QUOTED).toBe("value with # hash");
    expect(parsed.SINGLE).toBe("single quoted");
    expect(parsed.EXPORTED).toBe("yes");
    expect(parsed.EMPTY).toBe("");
    expect(parsed.SPACED).toBe("spaced out");
    expect(parsed.TRAILING).toBe("value");
    expect(parsed["not-a-key??"]).toBeUndefined();
  });

  it("never overrides real environment variables", () => {
    const dir = mkdtempSync(join(tmpdir(), "neutron-env-"));
    try {
      writeFileSync(join(dir, ".env"), "NEUTRON_TEST_KEEP=from-file\nNEUTRON_TEST_NEW=from-file\n");
      process.env.NEUTRON_TEST_KEEP = "from-env";
      delete process.env.NEUTRON_TEST_NEW;
      resetDotEnvLoader();
      loadDotEnvFiles(dir);
      expect(process.env.NEUTRON_TEST_KEEP).toBe("from-env");
      expect(process.env.NEUTRON_TEST_NEW).toBe("from-file");
      expect(loadedEnvFiles).toContain(join(dir, ".env"));
    } finally {
      delete process.env.NEUTRON_TEST_KEEP;
      delete process.env.NEUTRON_TEST_NEW;
      resetDotEnvLoader();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("classifyNetworkError", () => {
  it("classifies DNS failures", () => {
    const err = new TypeError("fetch failed");
    (err as unknown as { cause: unknown }).cause = Object.assign(new Error("getaddrinfo ENOTFOUND bad.host"), { code: "ENOTFOUND" });
    const c = classifyNetworkError(err, C);
    expect(c.kind).toBe("dns");
    expect(c.retryable).toBe(true);
    expect(c.reason).toMatch(/could not resolve host/i);
    expect(c.reason).not.toMatch(/sk-/);
  });

  it("classifies connection refused as non-retryable with a useful suggestion", () => {
    const err = new TypeError("fetch failed");
    (err as unknown as { cause: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { code: "ECONNREFUSED" });
    const c = classifyNetworkError(err, { provider: "ollama", endpoint: "http://127.0.0.1:11434/v1" });
    expect(c.kind).toBe("connection-refused");
    expect(c.retryable).toBe(false);
    expect(c.suggestion).toMatch(/server is running/i);
  });

  it("classifies timeouts as retryable", () => {
    const err = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const c = classifyNetworkError(err, C);
    expect(c.kind).toBe("timeout");
    expect(c.retryable).toBe(true);
  });

  it("classifies TLS failures as non-retryable", () => {
    const err = new TypeError("fetch failed");
    (err as unknown as { cause: unknown }).cause = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
    const c = classifyNetworkError(err, C);
    expect(c.kind).toBe("tls");
    expect(c.retryable).toBe(false);
  });
});

describe("classifyHttpError", () => {
  it("marks 401 as non-retryable with a key suggestion", () => {
    const c = classifyHttpError(401, "unauthorized", C);
    expect(c.status).toBe(401);
    expect(c.retryable).toBe(false);
    expect(c.reason).toMatch(/authentication failed/i);
    expect(c.suggestion).toMatch(/AGENTROUTER_API_KEY/);
  });

  it("marks 404/400/403 as non-retryable", () => {
    for (const status of [400, 403, 404]) {
      expect(classifyHttpError(status, "", C).retryable).toBe(false);
    }
  });

  it("marks 429 and 5xx as retryable", () => {
    expect(classifyHttpError(429, "", C).retryable).toBe(true);
    expect(classifyHttpError(500, "", C).retryable).toBe(true);
    expect(classifyHttpError(503, "", C).retryable).toBe(true);
  });

  it("isRetryable honors classified errors and legacy flags", () => {
    expect(isRetryable(classifyHttpError(401, "", C))).toBe(false);
    expect(isRetryable(classifyHttpError(500, "", C))).toBe(true);
    expect(isRetryable({ retryable: false } as never)).toBe(false);
    expect(isRetryable({ status: 429 } as never)).toBe(true);
  });
});

describe("failover error formatting", () => {
  it("lists every provider failure instead of only the last error", () => {
    const err = formatFailoverError([
      { id: "agentrouter", error: classifyHttpError(401, "bad key", C) },
      { id: "openai", error: classifyNetworkError(Object.assign(new Error("x"), { code: "ENOTFOUND" }), { provider: "openai", endpoint: "https://api.openai.com/v1" }) },
    ]);
    const msg = err.message;
    expect(msg).toMatch(/agentrouter/);
    expect(msg).toMatch(/authentication failed/i);
    expect(msg).toMatch(/openai/);
    expect(msg).toMatch(/neutron doctor/);
  });

  it("formatCliError renders the requested block shape", () => {
    const text = formatCliError(classifyHttpError(401, "", { ...C, model: "claude-opus-5" }));
    expect(text).toMatch(/Agentrouter request failed/);
    expect(text).toMatch(/Reason: authentication failed \(HTTP 401\)/);
    expect(text).toMatch(/Provider: agentrouter/);
    expect(text).toMatch(/Model: claude-opus-5/);
    expect(text).toMatch(/Endpoint: https:\/\/agentrouter\.org\/v1/);
    expect(text).toMatch(/Suggestion: check AGENTROUTER_API_KEY; run `neutron doctor` for a full diagnosis/);
  });

  it("never leaks the API key in classified reasons, suggestions or CLI output", () => {
    const secret = "sk-test-secret-value-12345";
    const err = classifyHttpError(401, `invalid key`, C);
    expect(err.reason).not.toContain(secret);
    expect(err.suggestion).not.toContain(secret);
    const cli = formatCliError(classifyNetworkError(new Error("down"), { ...C, model: "m" }));
    expect(cli).not.toContain(secret);
    // keyEnvVar only ever yields the VARIABLE NAME, never a value.
    expect(keyEnvVar("agentrouter")).not.toContain(secret);
  });

  it("keyEnvVar resolves the right variable name", () => {
    expect(keyEnvVar("agentrouter")).toBe("AGENTROUTER_API_KEY");
    expect(keyEnvVar("openai")).toBe("OPENAI_API_KEY");
  });
});

describe("readGlobalProviders env resolution", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ["AGENTROUTER_API_KEY", "AGENTROUTER_BASE_URL", "AGENTROUTER_MODELS", "OPENAI_API_KEY", "NEUTRON_CONFIG_DIR"];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const dir = mkdtempSync(join(tmpdir(), "neutron-cfg-"));
    process.env.NEUTRON_CONFIG_DIR = dir;
    (saved as Record<string, string>).__dir = dir;
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    const dir = (saved as Record<string, string>).__dir;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("configures agentrouter from AGENTROUTER_API_KEY alone (catalog base URL fallback)", () => {
    process.env.AGENTROUTER_API_KEY = "test-key";
    const providers = readGlobalProviders();
    const ar = providers.find((p) => p.id === "agentrouter");
    expect(ar).toBeDefined();
    expect(ar!.baseUrl).toBe("https://agentrouter.org/v1");
    expect(ar!.apiKey).toBe("test-key");
    expect(ar!.enabled).toBe(true);
  });

  it("reads AGENTROUTER_MODELS as a configurable model list", () => {
    process.env.AGENTROUTER_API_KEY = "test-key";
    process.env.AGENTROUTER_MODELS = "claude-opus-5, deepseek-v4-flash";
    const ar = readGlobalProviders().find((p) => p.id === "agentrouter");
    expect(ar!.models).toEqual(["claude-opus-5", "deepseek-v4-flash"]);
  });

  it("honors an explicit AGENTROUTER_BASE_URL override", () => {
    process.env.AGENTROUTER_API_KEY = "k";
    process.env.AGENTROUTER_BASE_URL = "https://proxy.example.com/v1";
    const ar = readGlobalProviders().find((p) => p.id === "agentrouter");
    expect(ar!.baseUrl).toBe("https://proxy.example.com/v1");
  });

  it("configures openai from OPENAI_API_KEY alone", () => {
    process.env.OPENAI_API_KEY = "test-key";
    const oai = readGlobalProviders().find((p) => p.id === "openai");
    expect(oai).toBeDefined();
    expect(oai!.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("does not invent providers when no env vars are set", () => {
    const providers = readGlobalProviders();
    expect(providers.find((p) => p.id === "agentrouter")).toBeUndefined();
  });
});

describe("OpenAICompatibleProvider URL handling", () => {
  it("never duplicates /v1 when joining endpoint paths", async () => {
    const { OpenAICompatibleProvider } = await import("../src/providers/openai");
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      const p = new OpenAICompatibleProvider({ id: "agentrouter", baseUrl: "https://agentrouter.org/v1/", apiKey: "k" });
      await p.models();
      expect(seen[0]).toBe("https://agentrouter.org/v1/models");
      expect(seen[0]).not.toMatch(/\/v1\/v1/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("converts a bare fetch failure into a classified error", async () => {
    const { OpenAICompatibleProvider } = await import("../src/providers/openai");
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async () => {
      const err = new TypeError("fetch failed");
      (err as unknown as { cause: unknown }).cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      throw err;
    };
    try {
      const p = new OpenAICompatibleProvider({ id: "agentrouter", baseUrl: "https://agentrouter.org/v1", apiKey: "k" });
      await expect(p.models()).rejects.toMatchObject({ kind: "dns" });
      try {
        await p.models();
      } catch (err) {
        expect(isClassified(err)).toBe(true);
        expect(isRetryable(err)).toBe(true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces HTTP 401 as a non-retryable classified error with endpoint context", async () => {
    const { OpenAICompatibleProvider } = await import("../src/providers/openai");
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 });
    try {
      const p = new OpenAICompatibleProvider({ id: "agentrouter", baseUrl: "https://agentrouter.org/v1", apiKey: "k" });
      const promise = p.chat({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] });
      await expect(promise).rejects.toMatchObject({ kind: "http", status: 401, retryable: false });
      await promise.catch((err: unknown) => {
        expect((err as { endpoint?: string }).endpoint).toBe("https://agentrouter.org/v1");
        expect((err as { model?: string }).model).toBe("claude-opus-5");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe(".env precedence (home < cwd < real env)", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "neutron-home-"));
  const cwdDir = mkdtempSync(join(tmpdir(), "neutron-cwd-"));
  const saved: Record<string, string | undefined> = {};
  const keys = ["NEUTRON_TEST_PREC_HOME", "NEUTRON_TEST_PREC_BOTH", "NEUTRON_TEST_PREC_REAL"];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    writeFileSync(
      join(homeDir, ".env"),
      "NEUTRON_TEST_PREC_HOME=from-home\nNEUTRON_TEST_PREC_BOTH=from-home\nNEUTRON_TEST_PREC_REAL=from-home\n",
    );
    writeFileSync(join(cwdDir, ".env"), "NEUTRON_TEST_PREC_BOTH=from-cwd\n");
    resetDotEnvLoader();
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    resetDotEnvLoader();
  });

  it("project .env overrides home .env; real environment wins over both", () => {
    process.env.NEUTRON_TEST_PREC_REAL = "from-env";
    loadDotEnvFiles(cwdDir, homeDir);
    expect(process.env.NEUTRON_TEST_PREC_HOME).toBe("from-home");
    expect(process.env.NEUTRON_TEST_PREC_BOTH).toBe("from-cwd");
    expect(process.env.NEUTRON_TEST_PREC_REAL).toBe("from-env");
  });
});

describe("readGlobalProviders env-over-file precedence", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ["AGENTROUTER_API_KEY", "AGENTROUTER_BASE_URL", "AGENTROUTER_MODELS", "NEUTRON_CONFIG_DIR"];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const dir = mkdtempSync(join(tmpdir(), "neutron-cfg-"));
    process.env.NEUTRON_CONFIG_DIR = dir;
    (saved as Record<string, string>).__dir = dir;
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    const dir = (saved as Record<string, string>).__dir;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("environment variables merge over a same-id config-file provider field by field", () => {
    const dir = process.env.NEUTRON_CONFIG_DIR!;
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        providers: [{ id: "agentrouter", baseUrl: "https://old.example.com/v1", apiKey: "file-key", enabled: true, models: ["old-model"] }],
      }),
    );
    // Only the key comes from the environment: the file's base URL and
    // models survive, and there is exactly one merged entry.
    process.env.AGENTROUTER_API_KEY = "env-key";
    const providers = readGlobalProviders();
    const matches = providers.filter((p) => p.id === "agentrouter");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.apiKey).toBe("env-key");
    expect(matches[0]!.baseUrl).toBe("https://old.example.com/v1");
    expect(matches[0]!.models).toEqual(["old-model"]);
  });

  it("an explicit env base URL and models list override the file values", () => {
    const dir = process.env.NEUTRON_CONFIG_DIR!;
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        providers: [{ id: "agentrouter", baseUrl: "https://old.example.com/v1", apiKey: "file-key", enabled: true, models: ["old-model"] }],
      }),
    );
    process.env.AGENTROUTER_API_KEY = "env-key";
    process.env.AGENTROUTER_BASE_URL = "https://proxy.example.com/v1";
    process.env.AGENTROUTER_MODELS = "claude-opus-5";
    const ar = readGlobalProviders().find((p) => p.id === "agentrouter");
    expect(ar).toBeDefined();
    expect(ar!.apiKey).toBe("env-key");
    expect(ar!.baseUrl).toBe("https://proxy.example.com/v1");
    expect(ar!.models).toEqual(["claude-opus-5"]);
  });

  it("envConfiguredIds marks env-touched providers for source reporting", async () => {
    const { envConfiguredIds } = await import("../src/config");
    process.env.AGENTROUTER_API_KEY = "env-key";
    expect(envConfiguredIds().has("agentrouter")).toBe(true);
    expect(envConfiguredIds().has("openai")).toBe(false);
  });

  it("config-file provider is kept when no env vars override it", () => {
    const dir = process.env.NEUTRON_CONFIG_DIR!;
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        providers: [{ id: "agentrouter", baseUrl: "https://old.example.com/v1", apiKey: "file-key", enabled: true, models: ["old-model"] }],
      }),
    );
    const providers = readGlobalProviders();
    const ar = providers.find((p) => p.id === "agentrouter");
    expect(ar).toBeDefined();
    expect(ar!.apiKey).toBe("file-key");
    expect(ar!.baseUrl).toBe("https://old.example.com/v1");
  });
});

describe("Anthropic/Google adapters classify errors", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(fn: (url: unknown) => Promise<Response>) {
    (globalThis as unknown as { fetch: unknown }).fetch = fn;
  }

  it("Anthropic adapter classifies a bare fetch failure instead of 'fetch failed'", async () => {
    const { AnthropicProvider } = await import("../src/providers/adapters");
    stubFetch(async () => {
      const err = new TypeError("fetch failed");
      (err as unknown as { cause: unknown }).cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      throw err;
    });
    const p = new AnthropicProvider({ id: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "k" });
    await expect(p.models()).rejects.toMatchObject({ kind: "dns", retryable: true });
    try {
      await p.models();
    } catch (err) {
      expect(isClassified(err)).toBe(true);
      expect((err as Error).message).not.toMatch(/^fetch failed$/);
    }
  });

  it("Anthropic adapter classifies HTTP 401 on /v1/messages as non-retryable", async () => {
    const { AnthropicProvider } = await import("../src/providers/adapters");
    stubFetch(async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }));
    const p = new AnthropicProvider({ id: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "bad" });
    await expect(
      p.chat({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ kind: "http", status: 401, retryable: false });
  });

  it("Google adapter classifies a refused connection instead of 'fetch failed'", async () => {
    const { GoogleProvider } = await import("../src/providers/adapters");
    stubFetch(async () => {
      const err = new TypeError("fetch failed");
      (err as unknown as { cause: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      throw err;
    });
    const p = new GoogleProvider({ id: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "k" });
    await expect(p.models()).rejects.toMatchObject({ kind: "connection-refused", retryable: false });
  });

  it("Google adapter classifies HTTP 400 on generateContent as non-retryable", async () => {
    const { GoogleProvider } = await import("../src/providers/adapters");
    stubFetch(async () => new Response("not json at all{{{", { status: 400, headers: { "Content-Type": "text/plain" } }));
    const p = new GoogleProvider({ id: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "k" });
    const err = await p.chat({ model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }] }).catch((e) => e);
    expect(isClassified(err)).toBe(true);
    expect(err).toMatchObject({ kind: "http", status: 400, retryable: false });
  });
});

describe("registry timeout wiring", () => {
  it("createRegistryProvider honors the timeoutMs option", async () => {
    const { createRegistryProvider } = await import("../src/providers/registry");
    const prov = createRegistryProvider(
      { id: "agentrouter", baseUrl: "https://agentrouter.org/v1", apiKey: "k", models: [], enabled: true },
      { timeoutMs: 42_000 },
    );
    expect((prov as unknown as { timeoutMs?: number }).timeoutMs).toBe(42_000);
  });

  it("ApiSystem passes config.api.timeoutMs into the registry", async () => {
    const { ApiSystem } = await import("../src/api/api-manager");
    const api = new ApiSystem({
      config: {
        api: { maxConcurrentRequests: 8, maxRetries: 1, timeoutMs: 77_000, backoffBaseMs: 1000, providerCooldownMs: 30000, requestCooldownMs: 0 },
        routing: {},
        completion: { maxIterations: 5 },
        providers: [{ id: "agentrouter", baseUrl: "https://agentrouter.org/v1", apiKey: "k", models: ["m"], enabled: true }],
      },
    });
    const prov = api.registry.get("agentrouter");
    expect((prov as unknown as { timeoutMs?: number }).timeoutMs).toBe(77_000);
  });
});
