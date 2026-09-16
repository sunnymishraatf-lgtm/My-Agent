import type { ProviderResolved } from "../config";
import { listCatalog, getCatalogEntry, resolveEnvProvider, type ProviderCatalogEntry } from "./catalog";
import { readModelCache, type CachedModel, type ModelCache } from "./model-cache";

export type ProviderConnectionStatus = "connected" | "unconfigured" | "checking" | "error" | "local";

export interface ProviderStatus {
  id: string;
  displayName: string;
  description: string;
  baseUrl: string;
  apiType: ProviderCatalogEntry["apiType"];
  auth: ProviderCatalogEntry["auth"];
  docsUrl: string;
  color: string;
  local: boolean;
  configured: boolean;
  enabled: boolean;
  hasKey: boolean;
  source: "config" | "env" | "catalog";
  models: CachedModel[];
  modelCount: number;
  lastRefresh?: number;
  error?: string;
  status: ProviderConnectionStatus;
}

function entryFromConfig(id: string, baseUrl: string): ProviderCatalogEntry {
  const known = getCatalogEntry(id);
  if (known) return known;
  return {
    id,
    displayName: id,
    description: "Custom OpenAI-compatible provider",
    baseUrl,
    apiType: "openai-compatible",
    auth: "bearer",
    env: [],
    docsUrl: "",
    color: "gray",
  };
}

/** Merge manually-entered model ids with richer discovered metadata. */
export function mergeModels(manual: string[], cached: CachedModel[]): CachedModel[] {
  const map = new Map<string, CachedModel>();
  for (const id of manual) map.set(id, { id, name: id });
  for (const model of cached) map.set(model.id, model);
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function resolveConfig(
  id: string,
  configured: ProviderResolved[],
  entry: ProviderCatalogEntry,
): { cfg?: ProviderResolved; source: ProviderStatus["source"] } {
  const fromConfig = configured.find((p) => p.id === id);
  if (fromConfig) return { cfg: fromConfig, source: "config" };
  const fromEnv = resolveEnvProvider(entry);
  if (fromEnv) return { cfg: fromEnv, source: "env" };
  return { source: "catalog" };
}

/**
 * Build the full provider list shown in the UI: every catalog provider plus
 * any user-defined providers. Configured providers are marked and enriched
 * with their cached/discovered models. Model counts always come from real
 * discovery or explicit user configuration — never hardcoded.
 */
export function buildProviderStatuses(
  configured: ProviderResolved[],
  cache: ModelCache = readModelCache(),
): ProviderStatus[] {
  const catalog = listCatalog();
  const seen = new Set<string>();
  const out: ProviderStatus[] = [];

  const push = (entry: ProviderCatalogEntry): void => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    const { cfg, source } = resolveConfig(entry.id, configured, entry);
    const cachedEntry = cache[entry.id];
    const models = mergeModels(cfg?.models ?? [], cachedEntry?.models ?? []);
    const hasKey = !!cfg?.apiKey;
    const configuredFlag = !!cfg;
    const local = entry.local === true;
    const error = cachedEntry?.error;

    let status: ProviderConnectionStatus;
    if (!configuredFlag) status = "unconfigured";
    else if (local) status = "local";
    else if (error) status = "error";
    else status = "connected";

    out.push({
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      baseUrl: cfg?.baseUrl || entry.baseUrl,
      apiType: entry.apiType,
      auth: entry.auth,
      docsUrl: entry.docsUrl,
      color: entry.color,
      local,
      configured: configuredFlag,
      enabled: cfg ? cfg.enabled !== false : false,
      hasKey,
      source,
      models,
      modelCount: models.length,
      ...(cachedEntry?.fetchedAt ? { lastRefresh: cachedEntry.fetchedAt } : {}),
      ...(error ? { error } : {}),
      status,
    });
  };

  for (const entry of catalog) push(entry);

  // Config-only providers (custom gateways) are surfaced as custom entries.
  for (const p of configured) {
    if (seen.has(p.id)) continue;
    push(entryFromConfig(p.id, p.baseUrl));
  }

  return out;
}

export function findProviderStatus(statuses: ProviderStatus[], id: string): ProviderStatus | undefined {
  return statuses.find((s) => s.id === id);
}

/** Human summary of the capabilities a model exposes, omitting unknowns. */
export function capabilitySummary(model: CachedModel): string {
  const parts: string[] = [];
  if (model.contextWindow) parts.push(`Context: ${formatContext(model.contextWindow)}`);
  if (model.tools !== undefined) parts.push(`Tools: ${model.tools ? "yes" : "no"}`);
  if (model.vision !== undefined) parts.push(`Vision: ${model.vision ? "yes" : "no"}`);
  if (model.reasoning !== undefined) parts.push(`Reasoning: ${model.reasoning ? "yes" : "no"}`);
  if (model.streaming !== undefined) parts.push(`Streaming: ${model.streaming ? "yes" : "no"}`);
  return parts.join(" · ") || "Capabilities unknown";
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}

/** "FREE" | "PAID" | "UNKNOWN" — never guessed. */
export function priceLabel(model: CachedModel): "FREE" | "PAID" | "UNKNOWN" {
  if (model.free === true) return "FREE";
  if (model.pricing && (model.pricing.prompt || model.pricing.completion)) return "PAID";
  if (model.free === false) return "PAID";
  return "UNKNOWN";
}
