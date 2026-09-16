import { normalizeBaseUrl } from "./provider";
import type { ProviderCatalogEntry } from "./catalog";
import { OpenAICompatibleProvider } from "./openai";
import { AnthropicProvider, GoogleProvider } from "./adapters";
import type { CachedModel } from "./model-cache";

interface RawRecord {
  [key: string]: unknown;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

function modalities(value: unknown): string[] | undefined {
  const list = asArray(value).map(asString).filter((v): v is string => !!v);
  return list.length > 0 ? list : undefined;
}

/**
 * Normalise the many `/models` response shapes into {@link CachedModel}s.
 * Only fields the provider actually sent are populated; unknown stays unknown.
 */
export function parseModelsPayload(payload: unknown): CachedModel[] {
  const root = (payload ?? {}) as RawRecord;
  const list = asArray(root.data).length > 0 ? asArray(root.data) : asArray(root.models);
  const models: CachedModel[] = [];

  for (const item of list) {
    if (typeof item === "string") {
      models.push({ id: item, name: item });
      continue;
    }
    const raw = item as RawRecord;
    const rawId = asString(raw.id) ?? asString(raw.name) ?? asString(raw.model);
    if (!rawId) continue;
    const id = rawId.replace(/^models\//, "");
    const name = asString(raw.display_name) ?? asString(raw.displayName) ?? asString(raw.name) ?? id;

    const arch = (raw.architecture ?? {}) as RawRecord;
    const pricing = (raw.pricing ?? {}) as RawRecord;
    const supported = new Set(asArray(raw.supported_parameters).map(asString).filter((v): v is string => !!v));

    const promptPrice = asNumber(pricing.prompt);
    const completionPrice = asNumber(pricing.completion);
    const hasPricing = promptPrice !== undefined || completionPrice !== undefined;
    const clearlyFree =
      id.toLowerCase().endsWith(":free") ||
      raw.free === true ||
      (hasPricing && (promptPrice ?? 0) === 0 && (completionPrice ?? 0) === 0);

    const input = modalities(arch.input_modalities ?? arch.inputModalities);
    const output = modalities(arch.output_modalities ?? arch.outputModalities);
    const toolHint =
      supported.size > 0
        ? supported.has("tools") || supported.has("tool_choice") || supported.has("function_call")
        : undefined;
    const reasonHint =
      supported.size > 0 ? supported.has("reasoning") || supported.has("include_reasoning") : undefined;
    const streamHint = supported.size > 0 ? supported.has("stream") : undefined;

    const model: CachedModel = {
      id,
      name,
      contextWindow:
        asNumber(raw.context_length) ??
        asNumber(raw.contextLength) ??
        asNumber(raw.context_window) ??
        asNumber(raw.max_context_length),
      free: clearlyFree || undefined,
    };
    if (input) model.input = input;
    if (output) model.output = output;
    if (input || output) {
      const all = [...(input ?? []), ...(output ?? [])];
      model.vision = all.some((m) => /image|vision/i.test(m));
    }
    if (toolHint !== undefined) model.tools = toolHint;
    if (reasonHint !== undefined) model.reasoning = reasonHint;
    if (streamHint !== undefined) model.streaming = streamHint;
    if (hasPricing) {
      model.pricing = { prompt: promptPrice, completion: completionPrice };
    }
    models.push(model);
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export interface DiscoverOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

async function fetchModelsRaw(entry: ProviderCatalogEntry, opts: DiscoverOptions): Promise<unknown> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl || entry.baseUrl);
  const timeout = opts.timeoutMs ?? 15_000;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url: string;

  if (entry.apiType === "anthropic") {
    if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    url = `${baseUrl}${entry.modelsPath ?? "/v1/models"}`;
  } else if (entry.apiType === "google") {
    const key = opts.apiKey ? `${entry.modelsPath?.includes("?") ? "&" : "?"}key=${encodeURIComponent(opts.apiKey)}` : "";
    url = `${baseUrl}${entry.modelsPath ?? "/models?pageSize=1000"}${key}`;
  } else {
    if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
    url = `${baseUrl}${entry.modelsPath ?? "/models"}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

/**
 * Query a provider's own model API and return normalised metadata. Never
 * invents models or counts: a failure returns an empty list plus the error.
 */
export async function discoverModels(
  entry: ProviderCatalogEntry,
  opts: DiscoverOptions = {},
): Promise<{ models: CachedModel[]; error?: string }> {
  try {
    const payload = await fetchModelsRaw(entry, opts);
    return { models: parseModelsPayload(payload) };
  } catch (err) {
    return { models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build a live adapter for a catalog entry (used for chat/streaming). */
export function adapterForEntry(entry: ProviderCatalogEntry, opts: { baseUrl?: string; apiKey?: string; timeoutMs?: number } = {}) {
  const common = {
    baseUrl: opts.baseUrl || entry.baseUrl,
    ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
  switch (entry.apiType) {
    case "anthropic":
      return new AnthropicProvider({ id: entry.id, ...common });
    case "google":
      return new GoogleProvider({ id: entry.id, ...common });
    default:
      return new OpenAICompatibleProvider({ id: entry.id, ...common });
  }
}
