import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { envVar } from "./compat";
import { listCatalog, resolveEnvProvider, resolveEnvProviderFields } from "./providers/catalog";

export interface ConfigProvider {
  id: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  enabled: boolean;
  weight?: number;
  /**
   * Explicit API flavor for this provider, e.g. 'anthropic', 'google',
   * 'openai' (or 'openai-compatible'). Optional: when omitted the registry
   * infers the adapter from the provider id/catalog entry or base URL.
   */
  apiType?: "anthropic" | "google" | "openai" | string;
}

export interface Config {
  api: {
    maxConcurrentRequests: number;
    maxRetries: number;
    timeoutMs: number;
    backoffBaseMs: number;
    providerCooldownMs: number;
    requestCooldownMs: number;
  };
  routing: Record<string, string>;
  completion: { maxIterations: number };
  providers: ConfigProvider[];
}

const configSchema = z.object({
  api: z.object({
    maxConcurrentRequests: z.number().min(1).max(64).default(8),
    maxRetries: z.number().min(0).max(10).default(3),
    timeoutMs: z.number().min(1_000).max(600_000).default(120_000),
    backoffBaseMs: z.number().min(100).max(60_000).default(1_000),
    providerCooldownMs: z.number().min(0).max(600_000).default(30_000),
    requestCooldownMs: z.number().min(0).max(60_000).default(0),
  }).default({}),
  routing: z.record(z.string(), z.string()).default({}),
  completion: z.object({
    maxIterations: z.number().min(0).max(20).default(5),
  }).default({}),
});

export type ApiConfig = z.infer<typeof configSchema>["api"];

export interface ResolvedConfig {
  api: ApiConfig;
  routing: Record<string, string>;
  completion: { maxIterations: number };
  providers: ProviderResolved[];
}

export type ProviderResolved = ConfigProvider;

export function userHome(): string {
  return homedir();
}

function configDirFor(name: string): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (process.platform === "win32") {
    return process.env.APPDATA ? join(process.env.APPDATA, name) : join(homedir(), `.${name}`);
  }
  if (xdg) return join(xdg, name);
  return join(homedir(), ".config", name);
}

/**
 * Global config directory. Resolution order:
 *   1. NEUTRON_CONFIG_DIR, then legacy SUNNY_CONFIG_DIR
 *   2. the NEUTRON directory if it exists (or if no legacy one exists)
 *   3. the legacy "sunny" directory, so existing users keep their providers/keys
 */
export function configDir(): string {
  const explicit = envVar("CONFIG_DIR");
  if (explicit) return explicit;
  const next = configDirFor("neutron");
  const legacy = configDirFor("sunny");
  return !existsSync(next) && existsSync(legacy) ? legacy : next;
}

export function globalConfigPath(): string {
  return join(configDir(), "config.json");
}

export function providerEnv(prefix: string, id: string): ProviderResolved | undefined {
  const baseUrl = process.env[`${prefix}_BASE_URL`] || process.env[`${id.toUpperCase()}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`] || process.env[`${id.toUpperCase()}_API_KEY`];
  const models = process.env[`${prefix}_MODELS`] || process.env[`${id.toUpperCase()}_MODELS`];
  if (!baseUrl && !apiKey) return undefined;
  // A key without an explicit base URL falls back to the known default, so
  // `OPENAI_API_KEY=...` alone is enough to configure the provider.
  const resolvedBase = baseUrl || knownBaseUrls[id];
  if (!resolvedBase) return undefined;
  return {
    id,
    baseUrl: resolvedBase,
    apiKey,
    models: models ? models.split(",").map((m) => m.trim()).filter(Boolean) : [],
    enabled: true,
  };
}

export const freeProviders: { id: string; env: string; desc: string }[] = [
  { id: "free-llm", env: "LLM", desc: "FreeLLMAPI (OpenAI-compatible gateway)" },
  { id: "groq", env: "GROQ", desc: "Groq (OpenAI-compatible)" },
  { id: "openrouter", env: "OPENROUTER", desc: "OpenRouter (OpenAI-compatible)" },
  { id: "openai", env: "OPENAI", desc: "OpenAI" },
  { id: "ollama", env: "OLLAMA", desc: "Local Ollama" },
  { id: "any", env: "ANY", desc: "Any OpenAI-compatible endpoint" },
];

export const knownBaseUrls: Record<string, string> = {
  "free-llm": "http://localhost:3001/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

export function defaultConfig(): ResolvedConfig {
  return {
    api: {
      maxConcurrentRequests: 8,
      maxRetries: 3,
      timeoutMs: 120_000,
      backoffBaseMs: 1_000,
      providerCooldownMs: 30_000,
      requestCooldownMs: 0,
    },
    routing: {} as Record<string, string>,
    completion: { maxIterations: 5 },
    providers: [],
  };
}

function normalizeProvider(prov: unknown): ProviderResolved | undefined {
  if (!prov || typeof prov !== "object") return undefined;
  const raw = prov as Record<string, unknown>;
  const p: ProviderResolved = {
    id: String(raw.id || ""),
    baseUrl: String(raw.baseUrl || ""),
    apiKey: raw.apiKey !== undefined ? String(raw.apiKey) : undefined,
    models: Array.isArray(raw.models) ? raw.models.map(String) : [],
    enabled: raw.enabled !== false,
    weight: typeof raw.weight === "number" ? raw.weight : undefined,
  };
  if (!p.id || !p.baseUrl) return undefined;
  return p;
}

export function readFileProviders(): ProviderResolved[] {
  const raw = readRawConfig();
  const list = Array.isArray(raw.providers) ? raw.providers : [];
  return list.map(normalizeProvider).filter((p): p is ProviderResolved => !!p);
}

export function findFileProvider(id: string): ProviderResolved | undefined {
  return readFileProviders().find((p) => p.id === id);
}

export function readGlobalProviders(): ProviderResolved[] {
  const fromFile = readFileProviders();
  const fileById = new Map(fromFile.map((p) => [p.id, p]));

  // Environment variables override config-file entries field by field: only
  // fields actually set in the environment replace the file values, so e.g.
  // setting AGENTROUTER_API_KEY alone keeps the file's base URL and models.
  const fromEnv: ProviderResolved[] = [];
  const envIds = new Set<string>();

  // 1. Every catalog provider (including agentrouter) can be configured from
  //    the environment: <PREFIX>_API_KEY / <PREFIX>_BASE_URL / <PREFIX>_MODELS.
  //    A key without a base URL falls back to the catalog default base URL.
  for (const entry of listCatalog()) {
    // "custom" has no default base URL; it is covered by the legacy "any"
    // alias below, which requires an explicit base URL.
    if (entry.id === "custom" || envIds.has(entry.id)) continue;
    const fields = resolveEnvProviderFields(entry);
    if (!fields.matched) continue;
    envIds.add(entry.id);
    const fileEntry = fileById.get(entry.id);
    if (fileEntry && (fields.baseUrl || fields.apiKey || fields.models)) {
      fromEnv.push({
        ...fileEntry,
        baseUrl: fields.baseUrl ?? fileEntry.baseUrl ?? entry.baseUrl,
        ...(fields.apiKey !== undefined ? { apiKey: fields.apiKey } : {}),
        ...(fields.models !== undefined ? { models: fields.models } : {}),
        enabled: true,
      });
    } else {
      const resolved = resolveEnvProvider(entry);
      if (resolved) fromEnv.push(resolved);
      else if (fileEntry) fromEnv.push(fileEntry);
    }
  }

  // 2. Legacy aliases whose ids predate the catalog (e.g. ANY_* -> "any").
  for (const p of freeProviders) {
    if (envIds.has(p.id)) continue;
    const env = providerEnv(p.env, p.id);
    if (!env) continue;
    envIds.add(p.id);
    const fileEntry = fileById.get(p.id);
    if (fileEntry) {
      // Merge field by field: providerEnv() already applied the
      // known-base-URL fallback for key-only configuration, and an explicit
      // env base URL always beats the file one; unset env fields keep the
      // file values (notably models).
      const explicitBase = process.env[`${p.env}_BASE_URL`] || process.env[`${p.id.toUpperCase()}_BASE_URL`];
      const explicitModels = process.env[`${p.env}_MODELS`] || process.env[`${p.id.toUpperCase()}_MODELS`];
      fromEnv.push({
        ...fileEntry,
        // An explicit env base URL wins; otherwise the file's base URL is
        // kept, and the known-base-URL fallback applies only when the file
        // has none either.
        baseUrl: explicitBase || fileEntry.baseUrl || env.baseUrl,
        ...(env.apiKey !== undefined ? { apiKey: env.apiKey } : {}),
        ...(explicitModels !== undefined
          ? { models: explicitModels.split(",").map((m) => m.trim()).filter(Boolean) }
          : {}),
        enabled: true,
      });
    } else {
      fromEnv.push(env);
    }
  }

  // File entries not overridden from the environment are kept as-is.
  const fileKept = fromFile.filter((p) => !envIds.has(p.id));
  return [...fileKept, ...fromEnv];
}

/**
 * Ids whose effective configuration came (at least partly) from the
 * environment. Used for "source" reporting in diagnostics.
 */
export function envConfiguredIds(): Set<string> {
  const ids = new Set<string>();
  for (const entry of listCatalog()) {
    if (entry.id === "custom") continue;
    if (resolveEnvProviderFields(entry).matched) ids.add(entry.id);
  }
  for (const p of freeProviders) {
    if (providerEnv(p.env, p.id)) ids.add(p.id);
  }
  return ids;
}

export function loadConfig(params?: { providers?: ProviderResolved[]; raw?: unknown }): ResolvedConfig {
  const parsed = configSchema.parse(params?.raw ?? {});
  const providers = params?.providers ?? readGlobalProviders();
  return {
    api: parsed.api,
    routing: parsed.routing,
    completion: parsed.completion,
    providers,
  };
}

export function writeGlobalConfig(cfg: unknown): boolean {
  try {
    const dir = configDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(globalConfigPath(), JSON.stringify(cfg, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function readRawConfig(): Record<string, unknown> {
  const file = globalConfigPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function upsertProvider(provider: ConfigProvider): boolean {
  const raw = readRawConfig();
  const list = Array.isArray(raw.providers) ? ([...raw.providers] as ConfigProvider[]) : [];
  const idx = list.findIndex((p) => p && p.id === provider.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...provider };
  else list.push(provider);
  return writeGlobalConfig({ version: 1, ...raw, providers: list });
}

export function removeProvider(id: string): boolean {
  const raw = readRawConfig();
  const list = Array.isArray(raw.providers) ? (raw.providers as ConfigProvider[]) : [];
  const next = list.filter((p) => p && p.id !== id);
  return writeGlobalConfig({ version: 1, ...raw, providers: next });
}

export function setProviderEnabled(id: string, enabled: boolean): boolean {
  const raw = readRawConfig();
  const list = Array.isArray(raw.providers) ? ([...raw.providers] as ConfigProvider[]) : [];
  const target = list.find((p) => p && p.id === id);
  if (!target) return false;
  target.enabled = enabled;
  return writeGlobalConfig({ version: 1, ...raw, providers: list });
}

export function secretPatterns(): RegExp[] {
  return [
    /sk-[A-Za-z0-9_-]{12,}/g,
    /[A-Za-z0-9]{32,}/g,
    /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
  ];
}

let redactionEnabled = true;
export function setRedactionEnabled(enabled: boolean): void {
  redactionEnabled = enabled;
}

const keySet = new Set<string>();
export function registerSecrets(newKeys: string[]): void {
  for (const k of newKeys) {
    if (k && k.length >= 8) keySet.add(k);
  }
}

export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const k of keySet) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.split(k).join("sk-****************");
  }
  for (const re of secretPatterns()) {
    out = out.replace(re, (m) => {
      if (m.length < 8) return m;
      return `${m.slice(0, 3)}-****************`;
    });
  }
  return out;
}

export function printWithRedaction(s: string): void {
  process.stdout.write(redact(s) + "\n");
}

export function ensureGlobalConfig(): { path: string; providers: ProviderResolved[] } {
  const p = globalConfigPath();
  if (existsSync(p)) {
    return { path: p, providers: readGlobalProviders() };
  }
  writeGlobalConfig({
    version: 1,
    api: defaultConfig().api,
    routing: defaultConfig().routing,
    completion: defaultConfig().completion,
    providers: freeProviders.map((f) => ({
      id: f.id,
      baseUrl: `https://${f.id}.example.com/v1`,
      apiKey: "",
      enabled: false,
      models: [],
    })),
  });
  return { path: p, providers: readGlobalProviders() };
}

export function docsUrl(): string {
  return "https://github.com/sunny-ai/sunny-agent";
}

export function defaultDesignDir(): string {
  return join(process.cwd(), ".agent");
}

export function defaultWorkspaceDir(): string {
  return join(tmpdir(), "neutron-workspaces");
}