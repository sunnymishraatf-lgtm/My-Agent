var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/providers/provider.ts
function normalizeBaseUrl(baseUrl) {
  let url = baseUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  return url;
}

// src/providers/catalog.ts
var BUILTIN = [
  {
    id: "agentrouter",
    displayName: "AgentRouter",
    description: "AgentRouter gateway for many models",
    baseUrl: "https://agentrouter.org/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["AGENTROUTER", "AGENT_ROUTER"],
    docsUrl: "https://agentrouter.org",
    color: "cyan"
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
    color: "magenta"
  },
  {
    id: "nous",
    displayName: "NousResearch",
    description: "NousResearch direct inference (Nous Portal). Portal auth is OAuth with short-lived JWTs \u2014 a pasted API key will NOT authenticate here. For Hermes models with an API key, use OpenRouter instead.",
    baseUrl: "https://inference-api.nousresearch.com/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["NOUS", "NOUSRESEARCH"],
    docsUrl: "https://github.com/NousResearch/hermes-agent",
    color: "cyan"
  },
  {
    id: "nvidia",
    displayName: "NVIDIA",
    description: "NVIDIA NIM \u2014 open models via build.nvidia.com (free nvapi- key). OpenAI-compatible endpoint.",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["NVIDIA"],
    docsUrl: "https://build.nvidia.com",
    color: "green"
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
    color: "cyanBright"
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
    color: "green"
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
    color: "yellow"
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
    color: "blue"
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
    color: "red"
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
    color: "yellowBright"
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
    color: "blueBright"
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
    color: "white"
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
    color: "greenBright"
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
    color: "magentaBright"
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
    local: true
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
    local: true
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
    color: "gray"
  }
];
var registry = /* @__PURE__ */ new Map();
for (const entry of BUILTIN) registry.set(entry.id, entry);
function listCatalog() {
  return [...registry.values()];
}
function getCatalogEntry(id) {
  return registry.get(id);
}
function findCatalogEntry(query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return void 0;
  for (const entry of registry.values()) {
    if (entry.id.toLowerCase() === needle || entry.displayName.toLowerCase() === needle) return entry;
  }
  return void 0;
}
function envPrefixesFor(entry) {
  const idUpper = entry.id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return [.../* @__PURE__ */ new Set([...entry.env, idUpper])];
}
function resolveEnvProviderFields(entry) {
  const fields = { id: entry.id, matched: false };
  for (const prefix of envPrefixesFor(entry)) {
    const baseUrl = process.env[`${prefix}_BASE_URL`];
    const apiKey = process.env[`${prefix}_API_KEY`];
    const models = process.env[`${prefix}_MODELS`];
    if (!baseUrl && !apiKey && !models) continue;
    fields.matched = true;
    if (baseUrl) fields.baseUrl = baseUrl;
    if (apiKey) fields.apiKey = apiKey;
    if (models) fields.models = models.split(",").map((m) => m.trim()).filter(Boolean);
    break;
  }
  return fields;
}
function resolveEnvProvider(entry) {
  const fields = resolveEnvProviderFields(entry);
  if (!fields.matched || !fields.baseUrl && !fields.apiKey) return void 0;
  const baseUrl = fields.baseUrl ?? entry.baseUrl;
  if (!baseUrl) return void 0;
  return {
    id: entry.id,
    baseUrl,
    apiKey: fields.apiKey,
    models: fields.models ?? [],
    enabled: true
  };
}

// src/providers/errors.ts
function base(ctx, kind, reason, retryable, suggestion) {
  const err = new Error(`${ctx.provider}: ${reason}`);
  err.kind = kind;
  err.retryable = retryable;
  err.reason = reason;
  err.suggestion = suggestion;
  err.provider = ctx.provider;
  err.endpoint = ctx.endpoint;
  err.model = ctx.model;
  return err;
}
function keySuggestion(ctx, fallback) {
  return ctx.keyEnv ? `check ${ctx.keyEnv}` : fallback;
}
function keyEnvVar(providerId) {
  const entry = getCatalogEntry(providerId);
  if (!entry) return `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const prefixes = envPrefixesFor(entry);
  return prefixes.length > 0 ? `${prefixes[0]}_API_KEY` : void 0;
}
function rootCause(err) {
  let current = err;
  let depth = 0;
  let last = { code: void 0, message: "", name: "" };
  while (current && depth < 6) {
    last = {
      code: typeof current.code === "string" ? current.code : last.code,
      message: typeof current.message === "string" ? current.message : last.message,
      name: typeof current.name === "string" ? current.name : last.name
    };
    const next = current.cause;
    if (!next || typeof next !== "object") break;
    current = next;
    depth++;
  }
  return last;
}
var TLS_CODES = /* @__PURE__ */ new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_ALTNAME_FORMAT_INVALID"
]);
function classifyNetworkError(err, ctx) {
  const { code, message, name } = rootCause(err);
  const msg = `${name}: ${message}`.toLowerCase();
  const timeout = name === "TimeoutError" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || msg.includes("aborted due to timeout") || msg.includes("timeout");
  if (timeout) {
    return base(
      ctx,
      "timeout",
      "request timed out",
      true,
      "the provider may be slow or unreachable; try again, or run `neutron doctor`"
    );
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || msg.includes("getaddrinfo")) {
    const host = safeHost(ctx.endpoint);
    return base(
      ctx,
      "dns",
      `could not resolve host${host ? ` "${host}"` : ""} (DNS failure)`,
      true,
      "check the base URL and your network/DNS settings"
    );
  }
  if (code === "ECONNREFUSED") {
    return base(
      ctx,
      "connection-refused",
      "connection refused \u2014 nothing is listening at that address",
      false,
      "check the base URL (host/port); for local providers make sure the server is running"
    );
  }
  if (code === "ECONNRESET" || code === "EPIPE" || msg.includes("socket hang up") || msg.includes("other side closed")) {
    return base(
      ctx,
      "connection-reset",
      "connection reset by the server",
      true,
      "transient network issue; try again"
    );
  }
  if (code && TLS_CODES.has(code) || msg.includes("certificate") || msg.includes("ssl")) {
    return base(
      ctx,
      "tls",
      `TLS/SSL failure (${code ?? "certificate error"})`,
      false,
      "check for a proxy/MITM, VPN, or an expired certificate; do not disable TLS verification"
    );
  }
  if (!ctx.endpoint) {
    return base(ctx, "config", "provider has no base URL configured", false, "run `neutron config` or set <PROVIDER>_BASE_URL");
  }
  return base(
    ctx,
    "network",
    `network error${code ? ` (${code})` : ""}${message ? `: ${truncate(message, 120)}` : ""}`,
    true,
    "check your network connection, then run `neutron doctor`"
  );
}
function classifyHttpError(status, detail, ctx) {
  const err = classifyHttp(status, detail, ctx);
  err.status = status;
  return err;
}
function classifyHttp(status, detail, ctx) {
  const clean = truncate(detail, 200);
  const withDetail = clean ? `: ${clean}` : "";
  switch (status) {
    case 400:
      return base(
        ctx,
        "http",
        `invalid request (HTTP 400)${withDetail}`,
        false,
        "check the model id and request parameters"
      );
    case 401:
      return base(
        ctx,
        "http",
        `authentication failed (HTTP 401)${withDetail}`,
        false,
        keySuggestion(ctx, "check the provider API key")
      );
    case 403:
      return base(
        ctx,
        "http",
        `forbidden (HTTP 403)${withDetail}`,
        false,
        "the key may lack access to this model or endpoint"
      );
    case 404:
      return base(
        ctx,
        "http",
        `not found (HTTP 404)${withDetail}`,
        false,
        "check the base URL (a wrong /v1 prefix is a common cause) and the model id"
      );
    case 408:
      return base(ctx, "http", "request timeout (HTTP 408)", true, "try again");
    case 429:
      return base(
        ctx,
        "http",
        `rate limited (HTTP 429)${withDetail}`,
        true,
        "slow down or wait before retrying"
      );
    default:
      if (status >= 500) {
        return base(
          ctx,
          "http",
          `provider server error (HTTP ${status})${withDetail}`,
          true,
          "the provider is having issues; try again later"
        );
      }
      return base(
        ctx,
        "http",
        `request failed (HTTP ${status})${withDetail}`,
        false,
        "run `neutron doctor` for details"
      );
  }
}
function classifyInvalidJson(ctx, snippet) {
  return base(
    ctx,
    "invalid-json",
    `provider returned invalid JSON${snippet ? `: ${truncate(snippet, 120)}` : ""}`,
    false,
    "the endpoint may not be an LLM API; check the base URL"
  );
}
function isClassified(err) {
  return !!err && typeof err === "object" && typeof err.kind === "string" && typeof err.retryable === "boolean";
}
function isRetryable(err) {
  if (isClassified(err)) return err.retryable;
  const e = err;
  if (typeof e?.retryable === "boolean") return e.retryable;
  if (typeof e?.status === "number") return e.status === 408 || e.status === 429 || e.status >= 500;
  return true;
}
function summarizeError(err) {
  if (isClassified(err)) {
    return err.suggestion ? `${err.reason} \u2014 ${err.suggestion}` : err.reason;
  }
  const e = err;
  if (typeof e?.status === "number") return `HTTP ${e.status} \u2014 ${truncate(err instanceof Error ? err.message : String(err), 160)}`;
  return truncate(err instanceof Error ? err.message : String(err), 160);
}
function formatFailoverError(failures) {
  const lines = ["All LLM providers failed after retries and failover.", "", "Provider failures:"];
  for (const f of failures) {
    lines.push(`- ${f.id}: ${summarizeError(f.error)}`);
  }
  lines.push("", "Suggestion: run `neutron doctor` to diagnose each provider.");
  const err = new Error(lines.join("\n"));
  err.failures = failures;
  return err;
}
function safeHost(endpoint) {
  if (!endpoint) return "";
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}
function truncate(s, n) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}\u2026` : t;
}

// src/providers/openai.ts
async function requestJson(ctx, url, init, endpointLabel) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err, ctx) };
  }
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = "";
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message ?? (typeof parsed.message === "string" ? parsed.message : "");
    } catch {
      detail = body.slice(0, 200);
    }
    const classified = classifyHttpError(res.status, detail, ctx);
    classified.status = res.status;
    classified.cooldown = res.status === 429;
    classified.detail = body.slice(0, 1e3);
    void endpointLabel;
    return { ok: false, error: classified };
  }
  if (!body) return { ok: false, error: classifyInvalidJson(ctx, "") };
  try {
    return { ok: true, data: JSON.parse(body) };
  } catch {
    return { ok: false, error: classifyInvalidJson(ctx, body.slice(0, 200)) };
  }
}
var OpenAICompatibleProvider = class {
  name;
  baseUrl;
  apiKey;
  timeoutMs;
  cachedModels;
  lastModelsFetch = 0;
  constructor(opts) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 12e4;
  }
  ctx(model) {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...model ? { model } : {},
      keyEnv: keyEnvVar(this.name)
    };
  }
  async models() {
    if (this.cachedModels && Date.now() - this.lastModelsFetch < 5 * 6e4) {
      return this.cachedModels;
    }
    const result = await requestJson(
      this.ctx(),
      `${this.baseUrl}/models`,
      {
        headers: this.headers(),
        signal: AbortSignal.timeout(1e4)
      },
      "/models"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    this.cachedModels = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      contextWindow: 32768,
      free: false
    }));
    this.lastModelsFetch = Date.now();
    return this.cachedModels;
  }
  async chat(request) {
    const started = Date.now();
    const result = await requestJson(
      this.ctx(request.model),
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers()
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/chat/completions"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - started
    };
  }
  async *stream(request) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers()
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop,
          stream: true
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      throw classifyNetworkError(err, this.ctx(request.model));
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(body);
        detail = parsed.error?.message ?? "";
      } catch {
        detail = body.slice(0, 200);
      }
      const classified = classifyHttpError(res.status, detail, this.ctx(request.model));
      classified.status = res.status;
      classified.cooldown = res.status === 429;
      throw classified;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunkRaw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = chunkRaw.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            yield { delta: "", done: true };
            return;
          }
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) yield { delta, done: false };
          } catch {
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  async healthCheck() {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(1e4)
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }
};

// src/providers/adapters.ts
function joinUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}
async function requestJson2(ctx, url, init, endpointLabel) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err, ctx) };
  }
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = "";
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message ?? (typeof parsed.message === "string" ? parsed.message : "");
    } catch {
      detail = body.slice(0, 200);
    }
    const classified = classifyHttpError(res.status, detail, ctx);
    classified.status = res.status;
    classified.cooldown = res.status === 429;
    classified.detail = body.slice(0, 1e3);
    void endpointLabel;
    return { ok: false, error: classified };
  }
  if (!body) return { ok: false, error: classifyInvalidJson(ctx, "") };
  try {
    return { ok: true, data: JSON.parse(body) };
  } catch {
    return { ok: false, error: classifyInvalidJson(ctx, body.slice(0, 200)) };
  }
}
async function* sseEvents(res) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of raw.split("\n")) {
          if (line.startsWith("data:")) yield line.slice(5).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
async function openStream(ctx, url, init, endpointLabel) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err, ctx) };
  }
  if (res.ok && res.body) return { ok: true, res };
  const body = await res.text().catch(() => "");
  let detail = "";
  try {
    const parsed = JSON.parse(body);
    detail = parsed.error?.message ?? "";
  } catch {
    detail = body.slice(0, 200);
  }
  const classified = classifyHttpError(res.status, detail, ctx);
  classified.status = res.status;
  classified.cooldown = res.status === 429;
  void endpointLabel;
  return { ok: false, error: classified };
}
var AnthropicProvider = class _AnthropicProvider {
  name;
  baseUrl;
  apiKey;
  timeoutMs;
  constructor(opts) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 12e4;
  }
  headers() {
    const h = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01"
    };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }
  ctx(model) {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...model ? { model } : {},
      keyEnv: keyEnvVar(this.name)
    };
  }
  static splitMessages(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    return { ...system ? { system } : {}, messages: rest };
  }
  async models() {
    const result = await requestJson2(
      this.ctx(),
      joinUrl(this.baseUrl, "v1/models"),
      { headers: this.headers(), signal: AbortSignal.timeout(15e3) },
      "/v1/models"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    return (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id, contextWindow: 0, free: false }));
  }
  async chat(request) {
    const started = Date.now();
    const { system, messages } = _AnthropicProvider.splitMessages(request.messages);
    const result = await requestJson2(
      this.ctx(request.model),
      joinUrl(this.baseUrl, "v1/messages"),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          ...system ? { system } : {},
          messages
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/v1/messages"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      latencyMs: Date.now() - started
    };
  }
  async *stream(request) {
    const { system, messages } = _AnthropicProvider.splitMessages(request.messages);
    const opened = await openStream(
      this.ctx(request.model),
      joinUrl(this.baseUrl, "v1/messages"),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          stream: true,
          ...system ? { system } : {},
          messages
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/v1/messages"
    );
    if (!opened.ok) throw opened.error;
    for await (const payload of sseEvents(opened.res)) {
      if (payload === "[DONE]") {
        yield { delta: "", done: true };
        return;
      }
      try {
        const json = JSON.parse(payload);
        if (json.type === "content_block_delta" && json.delta?.text) {
          yield { delta: json.delta.text, done: false };
        } else if (json.type === "message_stop") {
          yield { delta: "", done: true };
          return;
        }
      } catch {
      }
    }
    yield { delta: "", done: true };
  }
  async healthCheck() {
    const started = Date.now();
    try {
      const res = await fetch(joinUrl(this.baseUrl, "v1/models"), {
        headers: this.headers(),
        signal: AbortSignal.timeout(1e4)
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
};
var GoogleProvider = class _GoogleProvider {
  name;
  baseUrl;
  apiKey;
  timeoutMs;
  constructor(opts) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 12e4;
  }
  keyParam(sep2) {
    return this.apiKey ? `${sep2}key=${encodeURIComponent(this.apiKey)}` : "";
  }
  ctx(model) {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...model ? { model } : {},
      keyEnv: keyEnvVar(this.name)
    };
  }
  static splitMessages(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    return { ...system ? { system } : {}, contents };
  }
  async models() {
    const result = await requestJson2(
      this.ctx(),
      `${this.baseUrl}/models?pageSize=1000${this.keyParam("&")}`,
      { headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15e3) },
      "/models"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    return (data.models ?? []).map((m) => ({
      id: m.name.replace(/^models\//, ""),
      name: m.displayName ?? m.name.replace(/^models\//, ""),
      contextWindow: 0,
      free: false
    }));
  }
  async chat(request) {
    const started = Date.now();
    const { system, contents } = _GoogleProvider.splitMessages(request.messages);
    const result = await requestJson2(
      this.ctx(request.model),
      `${this.baseUrl}/models/${request.model}:generateContent${this.keyParam("?")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...system ? { systemInstruction: { parts: [{ text: system }] } } : {},
          generationConfig: {
            ...request.temperature !== void 0 ? { temperature: request.temperature } : {},
            ...request.maxTokens !== void 0 ? { maxOutputTokens: request.maxTokens } : {}
          }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/generateContent"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - started
    };
  }
  async *stream(request) {
    const { system, contents } = _GoogleProvider.splitMessages(request.messages);
    const opened = await openStream(
      this.ctx(request.model),
      `${this.baseUrl}/models/${request.model}:streamGenerateContent?alt=sse${this.keyParam("&")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...system ? { systemInstruction: { parts: [{ text: system }] } } : {},
          generationConfig: {
            ...request.temperature !== void 0 ? { temperature: request.temperature } : {},
            ...request.maxTokens !== void 0 ? { maxOutputTokens: request.maxTokens } : {}
          }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/streamGenerateContent"
    );
    if (!opened.ok) throw opened.error;
    for await (const payload of sseEvents(opened.res)) {
      try {
        const json = JSON.parse(payload);
        const delta = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (delta) yield { delta, done: false };
      } catch {
      }
    }
    yield { delta: "", done: true };
  }
  async healthCheck() {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models?pageSize=1${this.keyParam("&")}`, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(1e4)
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
};

// src/providers/registry.ts
function resolveApiType(p) {
  if (p.apiType) return p.apiType;
  const entry = findCatalogEntry(p.id);
  if (entry) return entry.apiType;
  const url = p.baseUrl.toLowerCase();
  if (url.includes("api.anthropic.com")) return "anthropic";
  if (url.includes("generativelanguage.googleapis.com")) return "google";
  return "openai-compatible";
}
function createRegistryProvider(p, opts) {
  const apiOpts = {
    id: p.id,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    // Honors config.api.timeoutMs; the default matches the old hardcoded value.
    timeoutMs: opts?.timeoutMs ?? 12e4
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
var ProviderRegistry = class {
  providers = /* @__PURE__ */ new Map();
  configuredModels = /* @__PURE__ */ new Map();
  health = /* @__PURE__ */ new Map();
  rrIndex = 0;
  defaultTimeoutMs = 12e4;
  configure(list, opts) {
    if (opts?.timeoutMs !== void 0) this.defaultTimeoutMs = opts.timeoutMs;
    this.providers.clear();
    this.configuredModels.clear();
    for (const p of list) {
      if (!p.enabled) continue;
      this.providers.set(p.id, createRegistryProvider(p, { timeoutMs: this.defaultTimeoutMs }));
      this.configuredModels.set(p.id, [...p.models]);
    }
  }
  add(id, provider, models = []) {
    this.providers.set(id, provider);
    this.configuredModels.set(id, [...models]);
  }
  modelsFor(id) {
    return this.configuredModels.get(id) ?? [];
  }
  get(id) {
    return this.providers.get(id);
  }
  all() {
    return [...this.providers.values()];
  }
  ids() {
    return [...this.providers.keys()];
  }
  has(id) {
    return this.providers.has(id);
  }
  async healthCheck(id) {
    const provider = this.providers.get(id);
    if (!provider) return { ok: false, latencyMs: 0 };
    const result = await provider.healthCheck();
    this.health.set(id, { ...result, checkedAt: Date.now() });
    return result;
  }
  isHealthy(id) {
    const h = this.health.get(id);
    if (!h) return true;
    if (Date.now() - h.checkedAt > 6e4) return true;
    return h.ok;
  }
  nextHealthy() {
    const ids = this.ids();
    if (ids.length === 0) return void 0;
    for (let i = 0; i < ids.length; i++) {
      const idx = (this.rrIndex + i) % ids.length;
      const id = ids[idx];
      if (this.isHealthy(id)) {
        this.rrIndex = (idx + 1) % ids.length;
        return this.providers.get(id);
      }
    }
    return this.providers.get(ids[0]);
  }
};

// src/api/pool.ts
var ConcurrencyLimit = class {
  max;
  active = 0;
  queue = [];
  constructor(max) {
    this.max = Math.max(1, max);
  }
  get running() {
    return this.active;
  }
  get queued() {
    return this.queue.length;
  }
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  acquire() {
    return new Promise((resolve) => {
      if (this.active < this.max) {
        this.active++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
  width(newMax) {
    const clamped = Math.max(1, newMax);
    const delta = clamped - this.max;
    this.max = clamped;
    if (delta > 0) {
      const wake = Math.min(delta, this.queue.length);
      for (let i = 0; i < wake; i++) {
        this.active++;
        this.queue.shift()();
      }
    }
  }
};

// src/api/api-manager.ts
var ApiSystem = class {
  config;
  routing;
  registry;
  pool;
  cooldowns = /* @__PURE__ */ new Map();
  usageMap = /* @__PURE__ */ new Map();
  discoveredModels = /* @__PURE__ */ new Map();
  requestsCompleted = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  totalLatencyMs = 0;
  totalFailures = 0;
  totalFailovers = 0;
  logger;
  stopFlag = false;
  constructor(opts) {
    const cfg = opts.config;
    this.config = cfg.api;
    this.routing = cfg.routing;
    this.pool = new ConcurrencyLimit(this.config.maxConcurrentRequests);
    this.registry = opts.registry ?? new ProviderRegistry();
    this.registry.configure(cfg.providers, { timeoutMs: this.config.timeoutMs });
    this.logger = opts.logger;
  }
  configure(providers) {
    this.registry.configure(providers);
  }
  log(msg) {
    this.logger?.info(msg);
  }
  clearCooldowns() {
    this.cooldowns.clear();
  }
  isCooldown(id) {
    const until = this.cooldowns.get(id);
    return until !== void 0 && until > Date.now();
  }
  setCooldown(id, ms) {
    this.cooldowns.set(id, Date.now() + ms);
  }
  availableProviderIds() {
    return this.registry.ids().filter((id) => !this.isCooldown(id));
  }
  get stats() {
    return {
      active: this.pool.running,
      queued: this.pool.queued,
      requests: this.requestsCompleted,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      failures: this.totalFailures,
      failovers: this.totalFailovers,
      latencyMs: this.totalLatencyMs,
      providers: this.usageMap
    };
  }
  async health() {
    const out = {};
    for (const id of this.registry.ids()) {
      out[id] = await this.registry.healthCheck(id);
    }
    return out;
  }
  async chat(kind, messages, opts) {
    if (this.stopFlag) {
      throw new Error("API system is stopped");
    }
    if (this.registry.ids().length === 0) {
      throw new Error(
        "No LLM provider configured. Run `neutron config` to set one, or set LLM_BASE_URL/LLM_API_KEY (or OPENAI_BASE_URL/OPENAI_API_KEY) environment variables."
      );
    }
    const req = {
      messages,
      model: opts?.model,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens
    };
    return this.pool.run(() => this.runWithFailover(kind, req, opts?.provider));
  }
  async *stream(kind, messages, opts) {
    if (this.stopFlag) throw new Error("API system is stopped");
    if (this.registry.ids().length === 0) {
      throw new Error("No LLM provider configured. Run `neutron config` to set one.");
    }
    const tried = /* @__PURE__ */ new Set();
    let current = this.pickNext(kind, opts?.model, tried, opts?.provider);
    const failures = [];
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
          maxTokens: opts?.maxTokens
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
      current = this.pickNext(kind, opts?.model, tried, void 0);
    }
    throw formatFailoverError(failures);
  }
  async runWithFailover(kind, req, forcedProvider) {
    const tried = /* @__PURE__ */ new Set();
    let current = this.pickNext(kind, req.model, tried, forcedProvider);
    const failures = [];
    while (current) {
      if (this.stopFlag) throw new Error("API system is stopped");
      tried.add(current.id);
      try {
        let model = current.model;
        if (!model) {
          model = await this.discoverModel(current.id, current.provider);
          if (!model) {
            throw new Error(
              `Provider ${current.id} has no models configured and model discovery failed. Add a model to your provider config or set routing.`
            );
          }
        }
        const res = await this.executeWithRetry(current.provider, current.id, { ...req, model });
        this.recordUsage(res, current.id);
        return res;
      } catch (err) {
        const e = err;
        if (e.cooldown) this.setCooldown(current.id, this.config.providerCooldownMs);
        this.totalFailures++;
        this.totalFailovers++;
        failures.push({ id: current.id, error: err });
        const message = err instanceof Error ? err.message : String(err);
        this.log(`provider ${current.id} failed: ${message}; failing over`);
      }
      current = this.pickNext(kind, req.model, tried, void 0);
    }
    throw formatFailoverError(failures);
  }
  preferFree(ids) {
    const free = ids.filter((id) => id.toLowerCase().includes("free"));
    return [...free, ...ids.filter((id) => !free.includes(id))];
  }
  async discoverModel(id, provider) {
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
    return void 0;
  }
  pickNext(kind, modelHint, tried, forced) {
    if (forced && !tried.has(forced) && this.registry.has(forced) && !this.isCooldown(forced)) {
      return { id: forced, provider: this.registry.get(forced), model: this.resolveModel(forced, modelHint ?? this.routing[kind]) };
    }
    const pool = this.availableProviderIds().filter((id2) => !tried.has(id2));
    if (pool.length === 0) return void 0;
    const preferredModel = modelHint ?? this.routing[kind];
    if (preferredModel) {
      for (const id2 of pool) {
        if (this.registry.modelsFor(id2).includes(preferredModel)) {
          return { id: id2, provider: this.registry.get(id2), model: preferredModel };
        }
      }
    }
    for (const id2 of pool) {
      if (id2 === "free-llm" || id2 === "openai") {
        return { id: id2, provider: this.registry.get(id2), model: this.resolveModel(id2, preferredModel) };
      }
    }
    const id = pool[0];
    return { id, provider: this.registry.get(id), model: this.resolveModel(id, preferredModel) };
  }
  resolveModel(providerId, hint) {
    if (hint) return hint;
    const models = this.registry.modelsFor(providerId);
    if (models.length > 0) return this.preferFree(models)[0];
    return void 0;
  }
  async executeWithRetry(provider, id, req) {
    const started = Date.now();
    let lastErr;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (this.stopFlag) throw new Error("API system is stopped");
      try {
        const res = await provider.chat(req);
        res.latencyMs = Date.now() - started;
        return res;
      } catch (err) {
        lastErr = err;
        const e = err;
        if (e.cooldown) this.setCooldown(id, this.config.providerCooldownMs);
        if (!isRetryable(err)) break;
        if (attempt < this.config.maxRetries) {
          const wait = Math.min(this.config.backoffBaseMs * 2 ** attempt, 3e4) + (this.config.requestCooldownMs ?? 0);
          this.log(`retrying ${id} attempt ${attempt + 2} in ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`Provider ${id} failed`);
  }
  recordUsage(res, providerId) {
    this.requestsCompleted++;
    this.totalInputTokens += res.inputTokens ?? 0;
    this.totalOutputTokens += res.outputTokens ?? 0;
    this.totalLatencyMs += res.latencyMs ?? 0;
    let stat = this.usageMap.get(providerId);
    if (!stat) {
      stat = { totalRequests: 0, failures: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, failoverCount: 0, cooldownUntil: void 0 };
      this.usageMap.set(providerId, stat);
    }
    stat.totalRequests++;
    stat.inputTokens += res.inputTokens ?? 0;
    stat.outputTokens += res.outputTokens ?? 0;
    stat.latencyMs += res.latencyMs ?? 0;
  }
  stop() {
    this.stopFlag = true;
  }
};

// src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base2 = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base2))
          return INVALID;
        const result = effect.transform(base2.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base2) => {
          if (!isValid(base2))
            return INVALID;
          return Promise.resolve(effect.transform(base2.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/compat.ts
function envVar(name) {
  const next = process.env[`NEUTRON_${name}`];
  if (next !== void 0 && next !== "") return next;
  const legacy = process.env[`SUNNY_${name}`];
  return legacy !== void 0 && legacy !== "" ? legacy : void 0;
}

// src/config.ts
var configSchema = external_exports.object({
  api: external_exports.object({
    maxConcurrentRequests: external_exports.number().min(1).max(64).default(8),
    maxRetries: external_exports.number().min(0).max(10).default(3),
    timeoutMs: external_exports.number().min(1e3).max(6e5).default(12e4),
    backoffBaseMs: external_exports.number().min(100).max(6e4).default(1e3),
    providerCooldownMs: external_exports.number().min(0).max(6e5).default(3e4),
    requestCooldownMs: external_exports.number().min(0).max(6e4).default(0)
  }).default({}),
  routing: external_exports.record(external_exports.string(), external_exports.string()).default({}),
  completion: external_exports.object({
    maxIterations: external_exports.number().min(0).max(20).default(5)
  }).default({})
});
function configDirFor(name) {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (process.platform === "win32") {
    return process.env.APPDATA ? join(process.env.APPDATA, name) : join(homedir(), `.${name}`);
  }
  if (xdg) return join(xdg, name);
  return join(homedir(), ".config", name);
}
function configDir() {
  const explicit = envVar("CONFIG_DIR");
  if (explicit) return explicit;
  const next = configDirFor("neutron");
  const legacy = configDirFor("sunny");
  return !existsSync(next) && existsSync(legacy) ? legacy : next;
}
function globalConfigPath() {
  return join(configDir(), "config.json");
}
function providerEnv(prefix, id) {
  const baseUrl = process.env[`${prefix}_BASE_URL`] || process.env[`${id.toUpperCase()}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`] || process.env[`${id.toUpperCase()}_API_KEY`];
  const models = process.env[`${prefix}_MODELS`] || process.env[`${id.toUpperCase()}_MODELS`];
  if (!baseUrl && !apiKey) return void 0;
  const resolvedBase = baseUrl || knownBaseUrls[id];
  if (!resolvedBase) return void 0;
  return {
    id,
    baseUrl: resolvedBase,
    apiKey,
    models: models ? models.split(",").map((m) => m.trim()).filter(Boolean) : [],
    enabled: true
  };
}
var freeProviders = [
  { id: "free-llm", env: "LLM", desc: "FreeLLMAPI (OpenAI-compatible gateway)" },
  { id: "groq", env: "GROQ", desc: "Groq (OpenAI-compatible)" },
  { id: "openrouter", env: "OPENROUTER", desc: "OpenRouter (OpenAI-compatible)" },
  { id: "openai", env: "OPENAI", desc: "OpenAI" },
  { id: "ollama", env: "OLLAMA", desc: "Local Ollama" },
  { id: "any", env: "ANY", desc: "Any OpenAI-compatible endpoint" }
];
var knownBaseUrls = {
  "free-llm": "http://localhost:3001/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434/v1"
};
function normalizeProvider(prov) {
  if (!prov || typeof prov !== "object") return void 0;
  const raw = prov;
  const p = {
    id: String(raw.id || ""),
    baseUrl: String(raw.baseUrl || ""),
    apiKey: raw.apiKey !== void 0 ? String(raw.apiKey) : void 0,
    models: Array.isArray(raw.models) ? raw.models.map(String) : [],
    enabled: raw.enabled !== false,
    weight: typeof raw.weight === "number" ? raw.weight : void 0
  };
  if (!p.id || !p.baseUrl) return void 0;
  return p;
}
function readFileProviders() {
  const raw = readRawConfig();
  const list = Array.isArray(raw.providers) ? raw.providers : [];
  return list.map(normalizeProvider).filter((p) => !!p);
}
function readGlobalProviders() {
  const fromFile = readFileProviders();
  const fileById = new Map(fromFile.map((p) => [p.id, p]));
  const fromEnv = [];
  const envIds = /* @__PURE__ */ new Set();
  for (const entry of listCatalog()) {
    if (entry.id === "custom" || envIds.has(entry.id)) continue;
    const fields = resolveEnvProviderFields(entry);
    if (!fields.matched) continue;
    envIds.add(entry.id);
    const fileEntry = fileById.get(entry.id);
    if (fileEntry && (fields.baseUrl || fields.apiKey || fields.models)) {
      fromEnv.push({
        ...fileEntry,
        baseUrl: fields.baseUrl ?? fileEntry.baseUrl ?? entry.baseUrl,
        ...fields.apiKey !== void 0 ? { apiKey: fields.apiKey } : {},
        ...fields.models !== void 0 ? { models: fields.models } : {},
        enabled: true
      });
    } else {
      const resolved = resolveEnvProvider(entry);
      if (resolved) fromEnv.push(resolved);
      else if (fileEntry) fromEnv.push(fileEntry);
    }
  }
  for (const p of freeProviders) {
    if (envIds.has(p.id)) continue;
    const env = providerEnv(p.env, p.id);
    if (!env) continue;
    envIds.add(p.id);
    const fileEntry = fileById.get(p.id);
    if (fileEntry) {
      const explicitBase = process.env[`${p.env}_BASE_URL`] || process.env[`${p.id.toUpperCase()}_BASE_URL`];
      const explicitModels = process.env[`${p.env}_MODELS`] || process.env[`${p.id.toUpperCase()}_MODELS`];
      fromEnv.push({
        ...fileEntry,
        // An explicit env base URL wins; otherwise the file's base URL is
        // kept, and the known-base-URL fallback applies only when the file
        // has none either.
        baseUrl: explicitBase || fileEntry.baseUrl || env.baseUrl,
        ...env.apiKey !== void 0 ? { apiKey: env.apiKey } : {},
        ...explicitModels !== void 0 ? { models: explicitModels.split(",").map((m) => m.trim()).filter(Boolean) } : {},
        enabled: true
      });
    } else {
      fromEnv.push(env);
    }
  }
  const fileKept = fromFile.filter((p) => !envIds.has(p.id));
  return [...fileKept, ...fromEnv];
}
function loadConfig(params) {
  const parsed = configSchema.parse(params?.raw ?? {});
  const providers = params?.providers ?? readGlobalProviders();
  return {
    api: parsed.api,
    routing: parsed.routing,
    completion: parsed.completion,
    providers
  };
}
function readRawConfig() {
  const file = globalConfigPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
var keySet = /* @__PURE__ */ new Set();
function registerSecrets(newKeys) {
  for (const k of newKeys) {
    if (k && k.length >= 8) keySet.add(k);
  }
}

// src/server/byok.ts
var API_KEY_HEADER = "x-api-key";
var PROVIDER_HEADER = "x-provider";
function providerFromRequestKey(key, providerId) {
  const k = (key ?? "").trim();
  if (k.length < 8 || /\s/.test(k)) return void 0;
  const wanted = (providerId ?? "").trim().toLowerCase();
  if (!wanted) return void 0;
  const entry = getCatalogEntry(wanted);
  if (!entry?.baseUrl) return void 0;
  return {
    id: entry.id,
    baseUrl: entry.baseUrl,
    apiKey: k,
    models: [],
    enabled: true
  };
}
function extractRequestKeyFromHeaders(headers) {
  if (!headers) return void 0;
  const h = headers[API_KEY_HEADER] ?? headers["X-Api-Key"] ?? headers["X-API-KEY"];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function extractRequestProviderFromHeaders(headers) {
  if (!headers) return void 0;
  const h = headers[PROVIDER_HEADER] ?? headers["X-Provider"] ?? headers["X-PROVIDER"];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : void 0;
}
function configForRequest(apiKey, providerId) {
  const provider = apiKey ? providerFromRequestKey(apiKey, providerId) : void 0;
  if (provider?.apiKey) {
    registerSecrets([provider.apiKey]);
    return loadConfig({ providers: [provider] });
  }
  return loadConfig();
}

// src/server/chat-attachments.ts
import { inflateRawSync } from "node:zlib";
import {
  mkdirSync as mkdirSync2,
  mkdtempSync,
  readFileSync as readFileSync2,
  rmSync,
  statSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join2, sep } from "node:path";
var MAX_ATTACHMENTS = 5;
var MAX_FILE_BYTES = 100 * 1024;
var MAX_TOTAL_BYTES = 512 * 1024;
var MAX_ZIP_TEXT_FILE_BYTES = 50 * 1024;
var MAX_ZIP_TEXT_FILES = 20;
var MAX_ZIP_ENTRIES = 200;
var AttachmentError = class extends Error {
  status = 400;
  constructor(message) {
    super(message);
    this.name = "AttachmentError";
  }
};
function fail(msg) {
  throw new AttachmentError(msg);
}
function classify(name, mime) {
  const m = (mime || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/zip" || m === "application/x-zip-compressed" || n.endsWith(".zip")) return "zip";
  return "text";
}
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([
  "txt",
  "md",
  "markdown",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "go",
  "rs",
  "php",
  "html",
  "htm",
  "css",
  "scss",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "csv",
  "tsv",
  "sh",
  "bash",
  "zsh",
  "sql",
  "log",
  "diff",
  "patch",
  "vue",
  "svelte"
]);
function isUtf8Text(buf) {
  const win = buf.subarray(0, 8192);
  for (let i = 0; i < win.length; i++) {
    if (win[i] === 0) return false;
  }
  const s = buf.toString("utf8");
  return !s.includes("\uFFFD");
}
function looksLikeText(name, buf) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  if (ext && TEXT_EXTENSIONS.has(ext)) return isUtf8Text(buf);
  return isUtf8Text(buf);
}
function readZipEntries(buf) {
  const entries = [];
  let off = 0;
  while (off + 30 <= buf.length && entries.length < MAX_ZIP_ENTRIES) {
    if (buf.readUInt32LE(off) !== 67324752) break;
    const flags = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    const compressedSize = buf.readUInt32LE(off + 18);
    const uncompressedSize = buf.readUInt32LE(off + 22);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const nameStart = off + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buf.length) break;
    const name = buf.subarray(nameStart, nameEnd).toString("utf8");
    const dataOffset = nameEnd + extraLen;
    if (dataOffset > buf.length) break;
    if (flags & 8) {
      fail(`Zip entry "${name.slice(0, 80)}" uses a data descriptor, which is not supported.`);
    }
    if (dataOffset + compressedSize > buf.length) break;
    entries.push({ name, flags, method, compressedSize, uncompressedSize, dataOffset });
    off = dataOffset + compressedSize;
  }
  return entries;
}
function safeEntryName(raw) {
  if (!raw || raw.endsWith("/")) return null;
  const norm = raw.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[A-Za-z]:\//.test(norm)) {
    fail(`Zip entry "${raw.slice(0, 80)}" has an absolute path and was rejected.`);
  }
  const parts = norm.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === "..")) {
    fail(`Zip entry "${raw.slice(0, 80)}" tries to escape the archive and was rejected.`);
  }
  if (parts.length === 0) return null;
  return parts.join("/");
}
function extractZipToTmp(zipBuf) {
  const entries = readZipEntries(zipBuf);
  const dir = mkdtempSync(join2(tmpdir2(), "neutron-chat-"));
  const files = [];
  try {
    for (const e of entries) {
      const safe = safeEntryName(e.name);
      if (safe === null) continue;
      const short = safe.slice(0, 80);
      if (e.flags & 1) fail(`Zip entry "${short}" is encrypted, which is not supported.`);
      if (e.uncompressedSize === 4294967295 || e.compressedSize === 4294967295) {
        fail(`Zip entry "${short}" uses zip64, which is not supported.`);
      }
      if (e.uncompressedSize > MAX_FILE_BYTES) {
        fail(`Zip entry "${short}" is larger than ${MAX_FILE_BYTES / 1024} KB after extraction.`);
      }
      let data = zipBuf.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
      if (e.method === 8) {
        data = inflateRawSync(data);
      } else if (e.method !== 0) {
        fail(`Zip entry "${short}" uses an unsupported compression method.`);
      }
      const dest = join2(dir, ...safe.split("/"));
      if (!dest.startsWith(dir + sep)) {
        fail(`Zip entry "${short}" escapes the extraction directory.`);
      }
      mkdirSync2(join2(dir, ...safe.split("/").slice(0, -1)), { recursive: true });
      writeFileSync2(dest, data);
      files.push(safe);
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { dir, files };
}
function processAttachments(raw) {
  const notes = [];
  const empty = { visionParts: [], contextBlocks: [], notes };
  if (raw === void 0 || raw === null) return empty;
  if (!Array.isArray(raw)) fail("attachments must be an array.");
  if (raw.length === 0) return empty;
  if (raw.length > MAX_ATTACHMENTS) {
    fail(`Too many attachments (${raw.length}); the maximum is ${MAX_ATTACHMENTS}.`);
  }
  const items = raw.map((a, i) => {
    if (!a || typeof a !== "object") fail(`attachments[${i}] must be an object.`);
    const o = a;
    return {
      name: typeof o.name === "string" && o.name ? o.name.slice(0, 120) : `file-${i + 1}`,
      mime: typeof o.mime === "string" ? o.mime.slice(0, 120) : "application/octet-stream",
      kind: typeof o.kind === "string" ? o.kind : "",
      data: typeof o.data === "string" ? o.data : ""
    };
  });
  let totalBytes = 0;
  const visionParts = [];
  const contextBlocks = [];
  for (const item of items) {
    if (!item.data) fail(`Attachment "${item.name}" has no data.`);
    let buf;
    try {
      buf = Buffer.from(item.data, "base64");
    } catch {
      fail(`Attachment "${item.name}" is not valid base64.`);
    }
    if (buf.length === 0) fail(`Attachment "${item.name}" is empty.`);
    if (buf.length > MAX_FILE_BYTES) {
      fail(
        `Attachment "${item.name}" is ${Math.round(buf.length / 1024)} KB; the per-file limit is ${MAX_FILE_BYTES / 1024} KB.`
      );
    }
    totalBytes += buf.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      fail(`Attachments total ${Math.round(totalBytes / 1024)} KB; the limit is ${MAX_TOTAL_BYTES / 1024} KB.`);
    }
    const kind = classify(item.name, item.mime);
    if (kind === "image") {
      const mime = item.mime.toLowerCase().startsWith("image/") ? item.mime : "image/png";
      visionParts.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${buf.toString("base64")}` }
      });
      notes.push(`image ${item.name} (${Math.round(buf.length / 1024)} KB)`);
    } else if (kind === "zip") {
      const { dir, files } = extractZipToTmp(buf);
      try {
        notes.push(`zip ${item.name}: ${files.length} file(s)`);
        let inlined = 0;
        for (const f of files) {
          const full = join2(dir, ...f.split("/"));
          if (!statSync(full).isFile()) continue;
          const content = readFileSync2(full);
          if (content.length > MAX_ZIP_TEXT_FILE_BYTES || !looksLikeText(f, content)) {
            notes.push(`  listed, not inlined: ${f} (${Math.round(content.length / 1024)} KB)`);
            continue;
          }
          if (inlined >= MAX_ZIP_TEXT_FILES) {
            notes.push(`  listed, over per-zip inline cap: ${f}`);
            continue;
          }
          contextBlocks.push(`[file: ${item.name}/${f}]
${content.toString("utf8")}`);
          inlined++;
        }
        if (inlined === 0 && files.length > 0) {
          notes.push(`  (no text files could be inlined from ${item.name})`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } else {
      if (!looksLikeText(item.name, buf)) {
        fail(`Attachment "${item.name}" is not a text file, image, or zip \u2014 binary files are not accepted.`);
      }
      contextBlocks.push(`[file: ${item.name}]
${buf.toString("utf8")}`);
      notes.push(`text ${item.name} (${Math.round(buf.length / 1024)} KB)`);
    }
  }
  return { visionParts, contextBlocks, notes };
}
function applyAttachmentsToMessages(messages, raw) {
  const { visionParts, contextBlocks, notes } = processAttachments(raw);
  const out = messages.map((m) => ({ ...m }));
  if (!visionParts.length && !contextBlocks.length) return { messages: out, notes };
  let idx = out.length - 1;
  while (idx >= 0 && out[idx].role !== "user") idx--;
  if (idx < 0) {
    out.push({ role: "user", content: "" });
    idx = out.length - 1;
  }
  const target = out[idx];
  const baseText = target.content;
  const prefix = contextBlocks.length ? "[attached files \u2014 use the following as context]\n" + contextBlocks.join("\n\n") + "\n\n" : "";
  if (visionParts.length) {
    const parts = [];
    const text = prefix + baseText;
    if (text) parts.push({ type: "text", text });
    for (const v of visionParts) parts.push(v);
    target.content = parts;
  } else {
    target.content = prefix + baseText;
  }
  return { messages: out, notes };
}

// src/server/chat-artifacts.ts
var MAX_ARTIFACTS = 20;
var MAX_ARTIFACT_BYTES = 200 * 1024;
var BLOCK_RE = /```neutron-file[ \t]+path="([^"\r\n]{1,200})"[^\r\n]*\r?\n([\s\S]*?)```/g;
function sanitizeArtifactPath(raw) {
  const p = raw.trim().replace(/\\/g, "/");
  if (!p || p.length > 200) return null;
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return null;
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.length === 0 || parts.some((s) => s === "..")) return null;
  return parts.join("/");
}
function extractArtifacts(replyText) {
  const artifacts = [];
  const notes = [];
  if (!replyText || !replyText.includes("```neutron-file")) {
    return { text: replyText, artifacts, notes };
  }
  const text = replyText.replace(BLOCK_RE, (_m, rawPath, content) => {
    const path = sanitizeArtifactPath(String(rawPath ?? ""));
    if (!path) {
      notes.push(`skipped artifact with unsafe path "${String(rawPath ?? "").slice(0, 60)}"`);
      return _m;
    }
    const body = content.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const size = Buffer.byteLength(body, "utf8");
    if (artifacts.length >= MAX_ARTIFACTS) {
      notes.push(`skipped "${path}": over the ${MAX_ARTIFACTS}-file cap`);
      return _m;
    }
    if (size > MAX_ARTIFACT_BYTES) {
      notes.push(`skipped "${path}": ${Math.round(size / 1024)} KB over the ${MAX_ARTIFACT_BYTES / 1024} KB cap`);
      return _m;
    }
    artifacts.push({ path, content: body, size });
    return "";
  });
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, artifacts, notes };
}
var ARTIFACT_SYSTEM_NUDGE = 'You can deliver file artifacts with fenced blocks like:\n```neutron-file path="relative/path.ext"\n<file content here>\n```\nUse this when the user asks for code, configs, or documents. Artifacts are offered as downloads; you cannot write to the user\'s device or execute code on the server.';

// src/neutron/analyzer.ts
var FRONTEND_MARKERS = ["pages", "components", "components/", "src/pages", "src/components", "app/"].map((m) => m.toLowerCase());
var BACKEND_MARKERS = ["controllers", "routes", "services", "api", "middleware", "src/api", "src/services", "src/routes"].map((m) => m.toLowerCase());
var DB_MARKERS = ["models", "migrations", "schema", "prisma"].map((m) => m.toLowerCase());

// src/neutron/demo.ts
var TASKFLOW = {
  "package.json": JSON.stringify(
    {
      name: "taskflow",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { dev: "node server.js", start: "node server.js", test: "vitest run", build: "node server.js --check" },
      dependencies: {
        express: "^4.19.2",
        "express-session": "^1.18.0",
        bcryptjs: "^2.4.3",
        jsonwebtoken: "^9.0.2",
        "dotenv": "^16.4.1",
        "passport": "^0.7.0",
        "passport-google-oauth20": "^2.0.0"
      },
      devDependencies: { vitest: "^2.1.0" }
    },
    null,
    2
  ),
  "README.md": [
    "# TaskFlow",
    "",
    "A task management app with email/password login, user profiles and a REST API.",
    "",
    "Stack: React, Node.js, Express, PostgreSQL."
  ].join("\n"),
  ".env.example": [
    "SESSION_SECRET=change-me",
    "DATABASE_URL=postgres://user:pass@localhost:5432/taskflow",
    "JWT_SECRET=change-me",
    "GOOGLE_CLIENT_ID=",
    "GOOGLE_CLIENT_SECRET="
  ].join("\n"),
  "server.js": `const express = require("express");
const session = require("express-session");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

const authRoutes = require("./src/routes/auth");
app.use("/api/auth", authRoutes);

const userRoutes = require("./src/routes/users");
app.use("/api/users", userRoutes);

const taskRoutes = require("./src/routes/tasks");
app.use("/api/tasks", taskRoutes);

module.exports = app;
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`TaskFlow listening on :\${PORT}\`));
`,
  "src/config/index.js": `const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

module.exports = {
  sessionSecret: process.env.SESSION_SECRET || "dev-secret",
  jwtSecret: process.env.JWT_SECRET || "dev-jwt",
  databaseUrl: process.env.DATABASE_URL || "postgres://localhost:5432/taskflow",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/api/auth/google/callback",
  },
};
`,
  "src/middleware/auth.js": `const { verifyToken } = require("../services/token");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid session" });
  }
}

module.exports = { requireAuth };
`,
  "src/services/token.js": `const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config");

function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: "7d" });
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

module.exports = { issueToken, verifyToken };
`,
  "src/services/password.js": `const bcrypt = require("bcryptjs");

async function hash(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

async function verify(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}

module.exports = { hash, verify };
`,
  "src/services/users.js": `const users = require("../db/users");

async function createUser({ email, password }) {
  const existing = await users.findByEmail(email);
  if (existing) throw new Error("EMAIL_TAKEN");
  return users.insert({ email, password });
}

async function findById(id) {
  return users.findById(id);
}

module.exports = { createUser, findById };
`,
  "src/routes/auth.js": `const express = require("express");
const router = express.Router();
const passport = require("passport");
const { issueToken } = require("../services/token");
const { verify } = require("../services/password");
const users = require("../db/users");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await users.findByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await verify(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    res.json({ token: issueToken(user), user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const hashService = require("../services/password");
    const passwordHash = await hashService.hash(password);
    const user = await users.insert({ email, passwordHash });
    res.status(201).json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    const token = issueToken(req.user);
    res.json({ token, user: { id: req.user.id, email: req.user.email } });
  }
);

module.exports = router;
`,
  "src/routes/users.js": `const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { findById } = require("../services/users");

router.get("/me", requireAuth, async (req, res) => {
  const user = await findById(req.user.id);
  res.json({ user });
});

router.put("/me", requireAuth, async (req, res) => {
  const user = await findById(req.user.id);
  res.json({ user: { ...user, ...req.body } });
});

module.exports = router;
`,
  "src/routes/tasks.js": `const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const tasks = require("../db/tasks");

router.get("/", requireAuth, async (req, res) => {
  const items = await tasks.listByUser(req.user.id);
  res.json({ tasks: items });
});

router.post("/", requireAuth, async (req, res) => {
  const task = await tasks.insert({ ownerId: req.user.id, title: req.body.title });
  res.status(201).json({ task });
});

module.exports = router;
`,
  "src/db/index.js": `const { databaseUrl } = require("../config");

// In-memory + environment-driven store for the demo. Production would use PostgreSQL.
const MAP = new Map();

function init() {
  void databaseUrl;
}

module.exports = { MAP, init };
`,
  "src/db/users.js": `const { MAP } = require("./index");

const users = [];

async function findByEmail(email) {
  return users.find((u) => u.email === email) || null;
}

async function findById(id) {
  return users.find((u) => u.id === id) || null;
}

async function insert({ email, passwordHash }) {
  const user = { id: users.length + 1, email, passwordHash, createdAt: new Date().toISOString() };
  users.push(user);
  return user;
}

module.exports = { findByEmail, findById, insert };
`,
  "src/db/tasks.js": `const tasks = [];

async function listByUser(ownerId) {
  return tasks.filter((t) => t.ownerId === ownerId);
}

async function insert({ ownerId, title }) {
  const task = { id: tasks.length + 1, ownerId, title, done: false, createdAt: new Date().toISOString() };
  tasks.push(task);
  return task;
}

module.exports = { listByUser, insert };
`,
  "src/frontend/pages/Login.jsx": `import React, { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      window.location.href = "/dashboard";
    }
  }

  return (
    <div>
      <h1>Login</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      <button onClick={submit}>Sign in</button>
      <a href="/api/auth/google">Continue with Google</a>
    </div>
  );
}
`,
  "src/frontend/pages/Dashboard.jsx": `import React, { useEffect, useState } from "react";

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks));
  }, []);
  return (
    <div>
      <h1>Dashboard</h1>
      <ul>{tasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
    </div>
  );
}
`,
  "src/frontend/pages/Profile.jsx": `import React, { useEffect, useState } from "react";

export default function Profile() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user));
  }, []);
  return <div><h1>Profile</h1>{user && <p>{user.email}</p>}</div>;
}
`,
  "src/frontend/services/api.js": `export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}
`,
  "tests/auth.test.js": `const { describe, it, expect } = require("vitest");
const request = require("supertest");
const app = require("../server");
const users = require("../src/db/users");

describe("auth", () => {
  it("registers a user", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "a@b.c", password: "secret123" });
    expect(res.statusCode).toBe(201);
  });
  it("logs in with valid credentials", async () => {
    await request(app).post("/api/auth/register").send({ email: "a@b.c", password: "secret123" });
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.c", password: "secret123" });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
  it("rejects invalid credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.c", password: "wrong" });
    expect(res.statusCode).toBe(401);
  });
});
`,
  "tests/tasks.test.js": `const { describe, it, expect } = require("vitest");
const request = require("supertest");
const app = require("../server");
const { issueToken } = require("../src/services/token");

describe("tasks", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.statusCode).toBe(401);
  });
  it("lists and creates tasks with a token", async () => {
    const token = issueToken({ id: 1, email: "a@b.c" });
    const create = await request(app).post("/api/tasks").set("authorization", \`Bearer \${token}\`).send({ title: "Do it" });
    expect(create.statusCode).toBe(201);
    const list = await request(app).get("/api/tasks").set("authorization", \`Bearer \${token}\`);
    expect(list.statusCode).toBe(200);
  });
});
`,
  "tests/security.test.js": `const { describe, it, expect } = require("vitest");

describe("security posture", () => {
  it("uses safe password hashing", async () => {
    const pw = require("../src/services/password");
    const hash = await pw.hash("secret123");
    expect(hash).not.toContain("secret123");
    expect(await pw.verify("secret123", hash)).toBe(true);
  });
});
`
};

// src/server/demo.ts
var DemoError = class extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var REPO_PKG_CAP = 50 * 1024;

// api-src/_lib.ts
function sendJson(res, status, body) {
  setCorsHeaders(res);
  res.status(status).json(body);
}
var CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key, x-provider"
};
function setCorsHeaders(res) {
  const r = res;
  if (typeof r.setHeader === "function") {
    for (const [k, v] of Object.entries(CORS_HEADERS)) r.setHeader(k, v);
  }
}
function handlePreflight(req, res) {
  setCorsHeaders(res);
  if ((req.method ?? "").toUpperCase() === "OPTIONS") {
    sendJson(res, 204, {});
    return true;
  }
  return false;
}
function requireMethod(req, res, method) {
  if (req.method !== method) {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return false;
  }
  return true;
}
function readJsonBody(req) {
  const raw = req.body;
  if (raw === void 0 || raw === null) return {};
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
    }
    throw new DemoError("Invalid JSON body", 400);
  }
  if (typeof raw === "object") return raw;
  throw new DemoError("Invalid JSON body", 400);
}
var TOKEN_TTL_MS = 30 * 60 * 1e3;
function handleApiError(res, err) {
  if (err instanceof DemoError) {
    sendJson(res, err.status, { ok: false, error: err.message });
    return;
  }
  sendJson(res, 500, { ok: false, error: "Internal server error" });
}

// api-src/chat.ts
var silentLogger = { debug: () => {
}, info: () => {
}, warn: () => {
}, error: () => {
} };
function hasAttachments(body) {
  return Array.isArray(body.attachments) && body.attachments.length > 0;
}
async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "POST")) return;
  try {
    const body = readJsonBody(req);
    const fromBody = typeof body.apiKey === "string" ? body.apiKey : void 0;
    const apiKey = extractRequestKeyFromHeaders(req.headers) ?? fromBody;
    const providerId = extractRequestProviderFromHeaders(req.headers) ?? (typeof body.provider === "string" ? body.provider.trim().toLowerCase() || void 0 : void 0);
    const raw = Array.isArray(body.messages) ? body.messages : [];
    const messages = raw.filter(
      (m) => !!m && typeof m === "object" && typeof m.content === "string" && m.content.trim().length > 0
    ).slice(-20).map((m) => ({
      role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
      content: m.content.slice(0, 8e3)
    }));
    if (!messages.some((m) => m.role === "user") && !hasAttachments(body)) {
      sendJson(res, 400, { ok: false, error: "No user message provided" });
      return;
    }
    if (!messages.some((m) => m.role === "system")) {
      let system = ARTIFACT_SYSTEM_NUDGE;
      if (typeof body.projectContext === "string" && body.projectContext.trim()) {
        system += "\n\n" + body.projectContext.slice(0, 6e3);
      }
      messages.unshift({ role: "system", content: system });
    }
    let outgoing;
    try {
      outgoing = applyAttachmentsToMessages(messages, body.attachments).messages;
    } catch (err) {
      if (err instanceof AttachmentError) {
        sendJson(res, err.status, { ok: false, error: err.message });
        return;
      }
      throw err;
    }
    const config = configForRequest(apiKey, providerId);
    const api = new ApiSystem({ config, logger: silentLogger });
    try {
      const chatOpts = {};
      if (typeof body.model === "string" && body.model) chatOpts.model = body.model;
      if (providerId) chatOpts.provider = providerId;
      const reply = await api.chat("general", outgoing, chatOpts);
      const parsed = extractArtifacts(reply.text);
      sendJson(res, 200, {
        ok: true,
        text: parsed.text,
        artifacts: parsed.artifacts,
        provider: reply.provider,
        model: reply.model
      });
    } catch (err) {
      sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    handleApiError(res, err);
  }
}
export {
  handler as default
};
