import type { ApiConfig, ProviderResolved, ResolvedConfig } from "../config";
import type { ChatMessage, ChatRequest, ChatResponse, ProviderStats, TaskKind } from "../types";
import type { LLMProvider } from "../providers/provider";
import { ProviderRegistry } from "../providers/registry";
import { formatFailoverError, isRetryable } from "../providers/errors";
import { ConcurrencyLimit } from "./pool";
import type { Logger } from "../logger";

export interface ApiManagerOptions {
  config: ResolvedConfig;
  logger?: Logger;
  registry?: ProviderRegistry;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  provider: string;
  model: string;
}

export class ApiSystem {
  readonly config: ApiConfig;
  readonly routing: Record<string, string>;
  readonly registry: ProviderRegistry;
  private pool: ConcurrencyLimit;
  private cooldowns = new Map<string, number>();
  private usageMap = new Map<string, ProviderStats>();
  private discoveredModels = new Map<string, string[]>();
  private requestsCompleted = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalLatencyMs = 0;
  private totalFailures = 0;
  private totalFailovers = 0;
  private logger?: Logger;
  private stopFlag = false;

  constructor(opts: ApiManagerOptions) {
    const cfg = opts.config;
    this.config = cfg.api;
    this.routing = cfg.routing;
    this.pool = new ConcurrencyLimit(this.config.maxConcurrentRequests);
    this.registry = opts.registry ?? new ProviderRegistry();
    this.registry.configure(cfg.providers, { timeoutMs: this.config.timeoutMs });
    this.logger = opts.logger;
  }

  configure(providers: ProviderResolved[]): void {
    // Reuses the registry's remembered timeout (set from config.api.timeoutMs).
    this.registry.configure(providers);
  }

  private log(msg: string): void {
    this.logger?.info(msg);
  }

  clearCooldowns(): void {
    this.cooldowns.clear();
  }

  private isCooldown(id: string): boolean {
    const until = this.cooldowns.get(id);
    return until !== undefined && until > Date.now();
  }

  private setCooldown(id: string, ms: number): void {
    this.cooldowns.set(id, Date.now() + ms);
  }

  private availableProviderIds(): string[] {
    return this.registry.ids().filter((id) => !this.isCooldown(id));
  }

  get stats(): {
    active: number;
    queued: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    failures: number;
    failovers: number;
    latencyMs: number;
    providers: Map<string, ProviderStats>;
  } {
    return {
      active: this.pool.running,
      queued: this.pool.queued,
      requests: this.requestsCompleted,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      failures: this.totalFailures,
      failovers: this.totalFailovers,
      latencyMs: this.totalLatencyMs,
      providers: this.usageMap,
    };
  }

  async health(): Promise<Record<string, { ok: boolean; latencyMs: number }>> {
    const out: Record<string, { ok: boolean; latencyMs: number }> = {};
    for (const id of this.registry.ids()) {
      out[id] = await this.registry.healthCheck(id);
    }
    return out;
  }

  async chat(kind: TaskKind, messages: ChatMessage[], opts?: {
    model?: string;
    provider?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<ChatResponse> {
    if (this.stopFlag) {
      throw new Error("API system is stopped");
    }
    if (this.registry.ids().length === 0) {
      throw new Error(
        "No LLM provider configured. Run `neutron config` to set one, or set LLM_BASE_URL/LLM_API_KEY (or OPENAI_BASE_URL/OPENAI_API_KEY) environment variables.",
      );
    }
    const req: ChatRequest = {
      messages,
      model: opts?.model,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
    };

    return this.pool.run(() => this.runWithFailover(kind, req, opts?.provider));
  }

  async *stream(
    kind: TaskKind,
    messages: ChatMessage[],
    opts?: { model?: string; provider?: string; temperature?: number; maxTokens?: number },
  ): AsyncGenerator<StreamChunk> {
    if (this.stopFlag) throw new Error("API system is stopped");
    if (this.registry.ids().length === 0) {
      throw new Error("No LLM provider configured. Run `neutron config` to set one.");
    }

    const tried = new Set<string>();
    let current = this.pickNext(kind, opts?.model, tried, opts?.provider);
    const failures: Array<{ id: string; error: unknown }> = [];

    while (current) {
      tried.add(current.id);
      let emitted = false;
      try {
        let model = current.model;
        if (!model) {
          model = await this.discoverModel(current.id, current.provider);
          if (!model) {
            throw new Error(`Provider ${current.id} has no models configured and discovery failed.`);
          }
        }
        for await (const chunk of current.provider.stream({
          messages,
          model,
          temperature: opts?.temperature,
          maxTokens: opts?.maxTokens,
        })) {
          emitted = true;
          yield { delta: chunk.delta, done: chunk.done, provider: current.id, model };
        }
        this.requestsCompleted++;
        return;
      } catch (err) {
        this.totalFailures++;
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ id: current.id, error: err });
        this.log(`provider ${current.id} stream failed: ${message}`);
        if (emitted) throw err;
        this.totalFailovers++;
      }
      current = this.pickNext(kind, opts?.model, tried, undefined);
    }

    throw formatFailoverError(failures);
  }

  private async runWithFailover(kind: TaskKind, req: ChatRequest, forcedProvider?: string): Promise<ChatResponse> {
    const tried = new Set<string>();
    let current = this.pickNext(kind, req.model, tried, forcedProvider);
    const failures: Array<{ id: string; error: unknown }> = [];

    while (current) {
      if (this.stopFlag) throw new Error("API system is stopped");
      tried.add(current.id);
      try {
        let model = current.model;
        if (!model) {
          model = await this.discoverModel(current.id, current.provider);
          if (!model) {
            throw new Error(
              `Provider ${current.id} has no models configured and model discovery failed. Add a model to your provider config or set routing.`,
            );
          }
        }
        const res = await this.executeWithRetry(current.provider, current.id, { ...req, model });
        this.recordUsage(res, current.id);
        return res;
      } catch (err) {
        const e = err as { status?: number; cooldown?: boolean; retryable?: boolean };
        if (e.cooldown) this.setCooldown(current.id, this.config.providerCooldownMs);
        this.totalFailures++;
        this.totalFailovers++;
        failures.push({ id: current.id, error: err });
        const message = err instanceof Error ? err.message : String(err);
        this.log(`provider ${current.id} failed: ${message}; failing over`);
      }
      current = this.pickNext(kind, req.model, tried, undefined);
    }
    throw formatFailoverError(failures);
  }

  private preferFree(ids: string[]): string[] {
    const free = ids.filter((id) => id.toLowerCase().includes("free"));
    return [...free, ...ids.filter((id) => !free.includes(id))];
  }

  private async discoverModel(id: string, provider: LLMProvider): Promise<string | undefined> {
    const configured = this.registry.modelsFor(id);
    if (configured.length > 0) return this.preferFree(configured)[0];
    const cached = this.discoveredModels.get(id);
    if (cached) return cached[0];
    const models = await provider.models();
    const ids = models.map((m) => m.id).filter(Boolean);
    if (ids.length > 0) {
      const ordered = this.preferFree(ids);
      this.discoveredModels.set(id, ordered);
      this.log(`provider ${id}: discovered ${ordered.length} models, using ${ordered[0]}`);
      return ordered[0];
    }
    return undefined;
  }

  private pickNext(
    kind: TaskKind,
    modelHint: string | undefined,
    tried: Set<string>,
    forced?: string,
  ): { id: string; provider: LLMProvider; model: string | undefined } | undefined {
    if (forced && !tried.has(forced) && this.registry.has(forced) && !this.isCooldown(forced)) {
      return { id: forced, provider: this.registry.get(forced)!, model: this.resolveModel(forced, modelHint ?? this.routing[kind]) };
    }
    const pool = this.availableProviderIds().filter((id) => !tried.has(id));
    if (pool.length === 0) return undefined;
    const preferredModel = modelHint ?? this.routing[kind];
    if (preferredModel) {
      for (const id of pool) {
        if (this.registry.modelsFor(id).includes(preferredModel)) {
          return { id, provider: this.registry.get(id)!, model: preferredModel };
        }
      }
    }
    for (const id of pool) {
      if (id === "free-llm" || id === "openai") {
        return { id, provider: this.registry.get(id)!, model: this.resolveModel(id, preferredModel) };
      }
    }
    const id = pool[0]!;
    return { id, provider: this.registry.get(id)!, model: this.resolveModel(id, preferredModel) };
  }

  private resolveModel(providerId: string, hint: string | undefined): string | undefined {
    if (hint) return hint;
    const models = this.registry.modelsFor(providerId);
    if (models.length > 0) return this.preferFree(models)[0]!;
    return undefined;
  }

  private async executeWithRetry(provider: LLMProvider, id: string, req: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (this.stopFlag) throw new Error("API system is stopped");
      try {
        const res = await provider.chat(req);
        res.latencyMs = Date.now() - started;
        return res;
      } catch (err) {
        lastErr = err;
        const e = err as { status?: number; retryable?: boolean; cooldown?: boolean };
        if (e.cooldown) this.setCooldown(id, this.config.providerCooldownMs);
        // Config/auth errors (401, 403, 404, …) are never retried; only
        // transient failures (network, timeout, 408/429/5xx) are.
        if (!isRetryable(err)) break;
        if (attempt < this.config.maxRetries) {
          const wait = Math.min(this.config.backoffBaseMs * 2 ** attempt, 30_000) + (this.config.requestCooldownMs ?? 0);
          this.log(`retrying ${id} attempt ${attempt + 2} in ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`Provider ${id} failed`);
  }

  private recordUsage(res: ChatResponse, providerId: string): void {
    this.requestsCompleted++;
    this.totalInputTokens += res.inputTokens ?? 0;
    this.totalOutputTokens += res.outputTokens ?? 0;
    this.totalLatencyMs += res.latencyMs ?? 0;

    let stat = this.usageMap.get(providerId);
    if (!stat) {
      stat = { totalRequests: 0, failures: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, failoverCount: 0, cooldownUntil: undefined };
      this.usageMap.set(providerId, stat);
    }
    stat.totalRequests++;
    stat.inputTokens += res.inputTokens ?? 0;
    stat.outputTokens += res.outputTokens ?? 0;
    stat.latencyMs += res.latencyMs ?? 0;
  }

  stop(): void {
    this.stopFlag = true;
  }
}

export { type LLMProvider, type ChatMessage, type ChatRequest };