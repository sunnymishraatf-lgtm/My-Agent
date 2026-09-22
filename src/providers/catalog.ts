import type { ProviderResolved } from "../config";

/**
 * How a provider's HTTP API is shaped. Only "openai-compatible" endpoints can
 * reuse {@link OpenAICompatibleProvider}; the others have a dedicated adapter.
 */
export type ProviderApiType = "openai-compatible" | "anthropic" | "google";

/** How the API key is transmitted. */
export type ProviderAuthType = "bearer" | "x-api-key" | "query" | "none";

/**
 * A static description of a provider NEUTRON knows how to talk to. Model lists
 * are deliberately NOT stored here: they are discovered from the provider's
 * own `/models` endpoint (see discovery.ts) and cached locally.
 */
export interface ProviderCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  baseUrl: string;
  apiType: ProviderApiType;
  auth: ProviderAuthType;
  /** Environment variable prefixes accepted for configuration. */
  env: string[];
  docsUrl: string;
  /** Ink colour name used to render the provider. */
  color: string;
  /** Single-character glyph used next to the name. */
  icon?: string;
  /** True for servers that normally run locally and need no API key. */
  local?: boolean;
  /** Overrides the default models path (appended to baseUrl). */
  modelsPath?: string;
  /** Overrides the default chat path. */
  chatPath?: string;
}

const BUILTIN: ProviderCatalogEntry[] = [
  {
    id: "agentrouter",
    displayName: "AgentRouter",
    description: "AgentRouter gateway for many models",
    baseUrl: "https://agentrouter.org/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["AGENTROUTER", "AGENT_ROUTER"],
    docsUrl: "https://agentrouter.org",
    color: "cyan",
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    description: "Aggregated access to hundreds of models",
    baseUrl: "https://openrouter.ai/api/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["OPENROUTER"],
    docsUrl: "https://openrouter.ai/docs",
    color: "magenta",
  },
  {
    id: "tokenharbor",
    displayName: "Token Harbor",
    description: "OpenAI-compatible model gateway",
    baseUrl: "https://tokenharbor.ai/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["TOKENHARBOR", "TOKEN_HARBOR"],
    docsUrl: "https://tokenharbor.ai",
    color: "cyanBright",
  },
  {
    id: "openai",
    displayName: "OpenAI",
    description: "OpenAI GPT models",
    baseUrl: "https://api.openai.com/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["OPENAI"],
    docsUrl: "https://platform.openai.com/docs",
    color: "green",
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    description: "Claude models via the Messages API",
    baseUrl: "https://api.anthropic.com",
    apiType: "anthropic",
    auth: "x-api-key",
    env: ["ANTHROPIC"],
    docsUrl: "https://docs.anthropic.com",
    color: "yellow",
  },
  {
    id: "google",
    displayName: "Google Gemini",
    description: "Gemini models via the Generative Language API",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiType: "google",
    auth: "query",
    env: ["GOOGLE", "GEMINI", "GOOGLE_GEMINI"],
    docsUrl: "https://ai.google.dev/docs",
    color: "blue",
  },
  {
    id: "groq",
    displayName: "Groq",
    description: "Ultra-fast inference on open models",
    baseUrl: "https://api.groq.com/openai/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["GROQ"],
    docsUrl: "https://console.groq.com/docs",
    color: "red",
  },
  {
    id: "mistral",
    displayName: "Mistral",
    description: "Mistral AI models",
    baseUrl: "https://api.mistral.ai/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["MISTRAL"],
    docsUrl: "https://docs.mistral.ai",
    color: "yellowBright",
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    description: "DeepSeek chat and reasoning models",
    baseUrl: "https://api.deepseek.com/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["DEEPSEEK"],
    docsUrl: "https://api-docs.deepseek.com",
    color: "blueBright",
  },
  {
    id: "xai",
    displayName: "xAI",
    description: "Grok models from xAI",
    baseUrl: "https://api.x.ai/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["XAI", "X_AI"],
    docsUrl: "https://docs.x.ai",
    color: "white",
  },
  {
    id: "cohere",
    displayName: "Cohere",
    description: "Cohere Command models (compatibility API)",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["COHERE"],
    docsUrl: "https://docs.cohere.com",
    color: "greenBright",
  },
  {
    id: "qwen",
    displayName: "Alibaba Qwen",
    description: "Qwen models via DashScope compatibility mode",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["QWEN", "DASHSCOPE", "ALIBABA"],
    docsUrl: "https://help.aliyun.com/zh/model-studio",
    color: "magentaBright",
  },
  {
    id: "ollama",
    displayName: "Ollama",
    description: "Local models served by Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiType: "openai-compatible",
    auth: "none",
    env: ["OLLAMA"],
    docsUrl: "https://ollama.com",
    color: "white",
    local: true,
  },
  {
    id: "free-llm",
    displayName: "Free LLM",
    description: "Local OpenAI-compatible gateway",
    baseUrl: "http://localhost:3001/v1",
    apiType: "openai-compatible",
    auth: "none",
    env: ["LLM", "FREE_LLM"],
    docsUrl: "https://github.com/FreeLLMAPI",
    color: "green",
    local: true,
  },
  {
    id: "custom",
    displayName: "Any Custom",
    description: "Any OpenAI-compatible endpoint you host",
    baseUrl: "",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["ANY", "CUSTOM"],
    docsUrl: "",
    color: "gray",
  },
];

const registry = new Map<string, ProviderCatalogEntry>();

for (const entry of BUILTIN) registry.set(entry.id, entry);

/**
 * Add (or replace) a provider in the catalog. Intentionally tiny so new
 * providers only need a single definition:
 *
 * ```ts
 * registerProvider({ id: "my-gw", displayName: "My Gateway", baseUrl: "...", apiType: "openai-compatible", ... });
 * ```
 */
export function registerProvider(entry: ProviderCatalogEntry, opts: { overwrite?: boolean } = {}): void {
  if (!opts.overwrite && registry.has(entry.id)) return;
  registry.set(entry.id, entry);
}

/** All catalog entries, built-ins first, in registration order. */
export function listCatalog(): ProviderCatalogEntry[] {
  return [...registry.values()];
}

export function getCatalogEntry(id: string): ProviderCatalogEntry | undefined {
  return registry.get(id);
}

/** Case-insensitive lookup by id or display name. */
export function findCatalogEntry(query: string): ProviderCatalogEntry | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  for (const entry of registry.values()) {
    if (entry.id.toLowerCase() === needle || entry.displayName.toLowerCase() === needle) return entry;
  }
  return undefined;
}

/**
 * Every env prefix that can configure a provider, including its id uppercased
 * so a hand-written provider still works from the environment.
 */
export function envPrefixesFor(entry: ProviderCatalogEntry): string[] {
  const idUpper = entry.id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return [...new Set([...entry.env, idUpper])];
}

/** Fields explicitly set in the environment for a catalog provider. */
export interface EnvProviderFields {
  id: string;
  /** Set only when `<PREFIX>_BASE_URL` is present. */
  baseUrl?: string;
  /** Set only when `<PREFIX>_API_KEY` is present. */
  apiKey?: string;
  /** Set only when `<PREFIX>_MODELS` is present. */
  models?: string[];
  /** True when at least one of the above was set. */
  matched: boolean;
}

/**
 * Which provider fields were explicitly configured from the environment.
 * Unlike {@link resolveEnvProvider}, this does not apply catalog fallbacks,
 * so callers can merge env values over a config-file entry field by field.
 */
export function resolveEnvProviderFields(entry: ProviderCatalogEntry): EnvProviderFields {
  const fields: EnvProviderFields = { id: entry.id, matched: false };
  for (const prefix of envPrefixesFor(entry)) {
    const baseUrl = process.env[`${prefix}_BASE_URL`];
    const apiKey = process.env[`${prefix}_API_KEY`];
    const models = process.env[`${prefix}_MODELS`];
    if (!baseUrl && !apiKey && !models) continue;
    fields.matched = true;
    if (baseUrl) fields.baseUrl = baseUrl;
    if (apiKey) fields.apiKey = apiKey;
    if (models) fields.models = models.split(",").map((m) => m.trim()).filter(Boolean);
    break; // first matching prefix wins
  }
  return fields;
}

/** Resolve a provider's endpoint/key from the environment, if present. */
export function resolveEnvProvider(entry: ProviderCatalogEntry): ProviderResolved | undefined {
  const fields = resolveEnvProviderFields(entry);
  // A key or base URL is required to configure a provider; a bare MODELS
  // list alone does not (it can still override a config-file entry's models).
  if (!fields.matched || (!fields.baseUrl && !fields.apiKey)) return undefined;
  // A key without an explicit base URL falls back to the known default, so
  // `AGENTROUTER_API_KEY=...` alone is enough to configure the provider.
  const baseUrl = fields.baseUrl ?? entry.baseUrl;
  if (!baseUrl) return undefined;
  return {
    id: entry.id,
    baseUrl,
    apiKey: fields.apiKey,
    models: fields.models ?? [],
    enabled: true,
  };
}

/** Deep copy of the built-in catalog, useful in tests to reset state. */
export function builtinCatalog(): ProviderCatalogEntry[] {
  return BUILTIN.map((entry) => ({ ...entry }));
}
