import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../config";

/** A discovered model plus whatever metadata the provider chose to expose. */
export interface CachedModel {
  id: string;
  name: string;
  contextWindow?: number;
  input?: string[];
  output?: string[];
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  streaming?: boolean;
  pricing?: { prompt?: number; completion?: number };
  /** true = clearly free, undefined = unknown. Never guessed as paid. */
  free?: boolean;
}

export interface CachedProviderModels {
  models: CachedModel[];
  fetchedAt: number;
  error?: string;
}

export type ModelCache = Record<string, CachedProviderModels>;

export function modelCachePath(): string {
  return join(configDir(), "models-cache.json");
}

export function readModelCache(): ModelCache {
  const file = modelCachePath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ModelCache;
  } catch {
    return {};
  }
}

export function writeModelCache(cache: ModelCache): boolean {
  try {
    const dir = configDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(modelCachePath(), JSON.stringify(cache, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function getCachedModels(id: string): CachedProviderModels | undefined {
  return readModelCache()[id];
}

/** Persist a single provider's discovered models (read-modify-write). */
export function setCachedModels(id: string, models: CachedModel[], error?: string): boolean {
  const cache = readModelCache();
  cache[id] = { models, fetchedAt: Date.now(), ...(error ? { error } : {}) };
  return writeModelCache(cache);
}

export function clearModelCache(id?: string): boolean {
  if (!id) return writeModelCache({});
  const cache = readModelCache();
  delete cache[id];
  return writeModelCache(cache);
}
