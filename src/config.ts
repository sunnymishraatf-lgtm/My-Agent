import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export interface ConfigProvider {
  id: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  enabled: boolean;
  weight?: number;
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

export function configDir(): string {
  if (process.env.SUNNY_CONFIG_DIR) return process.env.SUNNY_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (process.platform === "win32") {
    return process.env.APPDATA
      ? join(process.env.APPDATA, "sunny")
      : join(homedir(), ".sunny");
  }
  if (xdg) return join(xdg, "sunny");
  return join(homedir(), ".config", "sunny");
}

export function globalConfigPath(): string {
  return join(configDir(), "config.json");
}

export function providerEnv(prefix: string, id: string): ProviderResolved | undefined {
  const baseUrl = process.env[`${prefix}_BASE_URL`] || process.env[`${id.toUpperCase()}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`] || process.env[`${id.toUpperCase()}_API_KEY`];
  const models = process.env[`${prefix}_MODELS`] || process.env[`${id.toUpperCase()}_MODELS`];
  if (!baseUrl) return undefined;
  return {
    id,
    baseUrl,
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

  // Environment variables are appended last so they override same-id file entries.
  const fromEnv: ProviderResolved[] = [];
  for (const p of freeProviders) {
    const env = providerEnv(p.env, p.id);
    if (env) fromEnv.push(env);
  }
  return [...fromFile, ...fromEnv];
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
  return join(tmpdir(), "sunny-workspaces");
}