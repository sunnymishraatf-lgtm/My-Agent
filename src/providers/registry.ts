import type { ProviderResolved } from "../config";
import type { LLMProvider } from "./provider";
import { OpenAICompatibleProvider } from "./openai";

export class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();
  private configuredModels: Map<string, string[]> = new Map();
  private health: Map<string, { ok: boolean; latencyMs: number; checkedAt: number }> = new Map();
  private rrIndex = 0;

  configure(list: ProviderResolved[]): void {
    this.providers.clear();
    this.configuredModels.clear();
    for (const p of list) {
      if (!p.enabled) continue;
      this.providers.set(
        p.id,
        new OpenAICompatibleProvider({
          id: p.id,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          timeoutMs: 120_000,
        }),
      );
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