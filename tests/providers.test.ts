import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  builtinCatalog,
  getCatalogEntry,
  findCatalogEntry,
  registerProvider,
  resolveEnvProvider,
  listCatalog,
} from "../src/providers/catalog";
import { parseModelsPayload, discoverModels } from "../src/providers/discovery";
import { readModelCache, writeModelCache, setCachedModels } from "../src/providers/model-cache";
import {
  buildProviderStatuses,
  mergeModels,
  priceLabel,
  capabilitySummary,
  formatContext,
} from "../src/providers/service";
import { createAdapter, AnthropicProvider, GoogleProvider } from "../src/providers/adapters";
import { OpenAICompatibleProvider } from "../src/providers/openai";

let dir: string;
const originalDir = process.env.NEUTRON_CONFIG_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "neutron-prov-"));
  process.env.NEUTRON_CONFIG_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalDir === undefined) delete process.env.NEUTRON_CONFIG_DIR;
  else process.env.NEUTRON_CONFIG_DIR = originalDir;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("provider catalog", () => {
  it("ships every built-in provider from the spec", () => {
    const ids = listCatalog().map((p) => p.id);
    for (const id of [
      "agentrouter",
      "openrouter",
      "tokenharbor",
      "openai",
      "anthropic",
      "google",
      "groq",
      "mistral",
      "deepseek",
      "xai",
      "cohere",
      "qwen",
      "ollama",
      "free-llm",
      "custom",
    ]) {
      expect(ids).toContain(id);
    }
    expect(builtinCatalog().length).toBeGreaterThanOrEqual(15);
  });

  it("uses the correct api type per provider", () => {
    expect(getCatalogEntry("anthropic")?.apiType).toBe("anthropic");
    expect(getCatalogEntry("google")?.apiType).toBe("google");
    expect(getCatalogEntry("groq")?.apiType).toBe("openai-compatible");
  });

  it("registers new providers without clobbering by default", () => {
    registerProvider({
      id: "my-gateway",
      displayName: "My Gateway",
      description: "custom",
      baseUrl: "https://example.com/v1",
      apiType: "openai-compatible",
      auth: "bearer",
      env: ["MY_GATEWAY"],
      docsUrl: "",
      color: "gray",
    });
    registerProvider({ ...getCatalogEntry("my-gateway")!, displayName: "Nope", baseUrl: "https://other" });
    expect(getCatalogEntry("my-gateway")?.displayName).toBe("My Gateway");
    expect(findCatalogEntry("my gateway")?.id).toBe("my-gateway");
  });

  it("resolves providers from environment variables", () => {
    process.env.AGENTROUTER_BASE_URL = "https://env.example/v1";
    process.env.AGENTROUTER_API_KEY = "secret";
    process.env.AGENTROUTER_MODELS = "a,b";
    const resolved = resolveEnvProvider(getCatalogEntry("agentrouter")!);
    expect(resolved?.baseUrl).toBe("https://env.example/v1");
    expect(resolved?.apiKey).toBe("secret");
    expect(resolved?.models).toEqual(["a", "b"]);
    delete process.env.AGENTROUTER_BASE_URL;
    delete process.env.AGENTROUTER_API_KEY;
    delete process.env.AGENTROUTER_MODELS;
  });
});

describe("model discovery parsing", () => {
  it("parses an OpenAI-style model list", () => {
    const models = parseModelsPayload({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
    expect(models.map((m) => m.id)).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(models[0]!.contextWindow).toBeUndefined();
    expect(models[0]!.free).toBeUndefined();
  });

  it("parses rich OpenRouter metadata without inventing anything", () => {
    const models = parseModelsPayload({
      data: [
        {
          id: "deepseek/v4:free",
          name: "DeepSeek V4",
          context_length: 131_072,
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: ["tools", "reasoning"],
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        },
        {
          id: "paid/model",
          pricing: { prompt: "0.5", completion: "1.5" },
        },
      ],
    });
    const free = models.find((m) => m.id === "deepseek/v4:free")!;
    expect(free.free).toBe(true);
    expect(free.contextWindow).toBe(131_072);
    expect(free.tools).toBe(true);
    expect(free.reasoning).toBe(true);
    expect(free.vision).toBe(true);
    const paid = models.find((m) => m.id === "paid/model")!;
    expect(paid.free).toBeUndefined();
    expect(priceLabel(paid)).toBe("PAID");
  });

  it("handles plain string lists and Google models", () => {
    expect(parseModelsPayload({ data: ["a", "b"] }).map((m) => m.id)).toEqual(["a", "b"]);
    const google = parseModelsPayload({ models: [{ name: "models/gemini-2.0-flash" }] });
    expect(google[0]!.id).toBe("gemini-2.0-flash");
  });

  it("queries the provider endpoint and reports errors without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "m1" }] }),
        text: async () => "",
      })),
    );
    const result = await discoverModels(getCatalogEntry("groq")!, { apiKey: "k" });
    expect(result.models.map((m) => m.id)).toEqual(["m1"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "unauthorized", json: async () => ({}) })),
    );
    const failed = await discoverModels(getCatalogEntry("groq")!, { apiKey: "bad" });
    expect(failed.models).toEqual([]);
    expect(failed.error).toContain("401");
  });
});

describe("model cache", () => {
  it("persists and reloads discovered models", () => {
    expect(readModelCache()).toEqual({});
    setCachedModels("groq", [{ id: "llama", name: "llama", free: true }]);
    const cache = readModelCache();
    expect(cache.groq?.models[0]?.id).toBe("llama");
    expect(writeModelCache({})).toBe(true);
    expect(readModelCache()).toEqual({});
  });
});

describe("provider service", () => {
  it("marks unconfigured catalog providers and counts models from cache", () => {
    registerProvider({
      id: "no-env-provider",
      displayName: "No Env",
      description: "test",
      baseUrl: "https://no-env.example/v1",
      apiType: "openai-compatible",
      auth: "bearer",
      env: [],
      docsUrl: "",
      color: "gray",
    });
    const statuses = buildProviderStatuses([], {
      "no-env-provider": { models: [{ id: "a", name: "a" }, { id: "b", name: "b" }], fetchedAt: Date.now() },
    });
    const provider = statuses.find((s) => s.id === "no-env-provider")!;
    expect(provider.modelCount).toBe(2);
    expect(provider.configured).toBe(false);
    expect(provider.status).toBe("unconfigured");
    const ollama = statuses.find((s) => s.id === "ollama")!;
    expect(ollama.local).toBe(true);
  });

  it("marks configured providers connected and includes custom providers", () => {
    const statuses = buildProviderStatuses([
      { id: "agentrouter", baseUrl: "https://agentrouter.org/v1", apiKey: "sk-secret-key-value", models: [], enabled: true },
      { id: "my-gateway", baseUrl: "https://gw.example/v1", apiKey: "x", models: ["m"], enabled: true },
    ]);
    const ar = statuses.find((s) => s.id === "agentrouter")!;
    expect(ar.configured).toBe(true);
    expect(ar.hasKey).toBe(true);
    expect(ar.status).toBe("connected");
    const custom = statuses.find((s) => s.id === "my-gateway")!;
    expect(custom.configured).toBe(true);
    expect(custom.modelCount).toBe(1);
    // The service never carries the raw key.
    expect(JSON.stringify(statuses)).not.toContain("sk-secret-key-value");
  });

  it("merges manual and discovered models and formats metadata", () => {
    const merged = mergeModels(["manual"], [{ id: "manual", name: "Manual", contextWindow: 8000 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.contextWindow).toBe(8000);
    expect(formatContext(131_072)).toBe("131K");
    expect(formatContext(1_000_000)).toBe("1M");
    expect(capabilitySummary({ id: "x", name: "x" })).toBe("Capabilities unknown");
    expect(priceLabel({ id: "x", name: "x", free: true })).toBe("FREE");
    expect(priceLabel({ id: "x", name: "x" })).toBe("UNKNOWN");
  });
});

describe("adapters", () => {
  it("routes api types to the right adapter", () => {
    expect(createAdapter(getCatalogEntry("openai")!, { baseUrl: "https://api.openai.com/v1" })).toBeInstanceOf(
      OpenAICompatibleProvider,
    );
    expect(createAdapter(getCatalogEntry("anthropic")!, { baseUrl: "https://api.anthropic.com" })).toBeInstanceOf(
      AnthropicProvider,
    );
    expect(
      createAdapter(getCatalogEntry("google")!, { baseUrl: "https://generativelanguage.googleapis.com/v1beta" }),
    ).toBeInstanceOf(GoogleProvider);
  });
});
