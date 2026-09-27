import type { ProviderResolved } from "../config";
import type { LLMProvider } from "./provider";
import { AnthropicProvider, GoogleProvider } from "./adapters";
import { OpenAICompatibleProvider } from "./openai";
import { findCatalogEntry } from "./catalog";

/**
 * Resolve the API flavor for a configured provider. An explicit `apiType`
 * always wins; otherwise we consult the provider catalog by id and fall back
 * to well-known base-URL patterns, defaulting to OpenAI-compatible.
 */
export function resolveApiType(p: ProviderResolved): string {
  if (p.apiType) return p.apiType;
  const entry = findCatalogEntry(p.id);
  if (entry) return entry.apiType;
  const url = p.baseUrl.toLowerCase();
  if (url.includes("api.anthropic.com")) return "anthropic";
  if (url.includes("generativelanguage.googleapis.com")) return "google";
  return "openai-compatible";
}

/** Instantiate the provider implementation matching the resolved API flavor. */
export function createRegistryProvider(p: ProviderResolved, opts?: { timeoutMs?: number }): LLMProvider {
  const apiOpts = {
    id: p.id,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    // Honors config.api.timeoutMs; the default matches the old hardcoded value.
    timeoutMs: opts?.timeoutMs ?? 120_000,
  };
  switch (resolveApiType(p).toLowerCase()) {
    case "anthropic":
      return new AnthropicProvider(apiOpts);
    case "google":
      return new GoogleProvider(apiOpts);
    default:
      return new OpenAICompatibleProvider(apiOpts);
  }
}

export class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();
  private configuredModels: Map<string, string[]> = new Map();
  private health: Map<string, { ok: boolean; latencyMs: number; checkedAt: number }> = new Map();
  private rrIndex = 0;
  private defaultTimeoutMs = 120_000;

  configure(list: ProviderResolved[], opts?: { timeoutMs?: number }): void {
    if (opts?.timeoutMs !== undefined) this.defaultTimeoutMs = opts.timeoutMs;
    this.providers.clear();
    this.configuredModels.clear();
    for (const p of list) {
      if (!p.enabled) continue;
      this.providers.set(p.id, createRegistryProvider(p, { timeoutMs: this.defaultTimeoutMs }));
      this.configuredModels.set(p.id, [...p.models]);
    }
  }

  add(id: string, provider: LLMProvider, models: string[] = []): void {
    this.providers.set(id, provider);
    this.configuredModels.set(id, [...models]);
  }

  modelsFor(id: string): string[] {
    return this.configuredModels.get(id) ?? [];
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  all(): LLMProvider[] {
    return [...this.providers.values()];
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  async healthCheck(id: string): Promise<{ ok: boolean; latencyMs: number }> {
    const provider = this.providers.get(id);
    if (!provider) return { ok: false, latencyMs: 0 };
    const result = await provider.healthCheck();
    this.health.set(id, { ...result, checkedAt: Date.now() });
    return result;
  }

  isHealthy(id: string): boolean {
    const h = this.health.get(id);
    if (!h) return true;
    if (Date.now() - h.checkedAt > 60_000) return true;
    return h.ok;
  }

  nextHealthy(): LLMProvider | undefined {
    const ids = this.ids();
    if (ids.length === 0) return undefined;
    for (let i = 0; i < ids.length; i++) {
      const idx = (this.rrIndex + i) % ids.length;
      const id = ids[idx]!;
      if (this.isHealthy(id)) {
        this.rrIndex = (idx + 1) % ids.length;
        return this.providers.get(id);
      }
    }
    return this.providers.get(ids[0]!);
  }
}

export type ProviderRegistryType = ProviderRegistry;