import type { ChatMessage, ChatRequest, ChatResponse, Model } from "../types";
import { normalizeBaseUrl, type BaseProviderOptions, type ChatStreamChunk, type LLMProvider } from "./provider";
import type { ProviderApiType, ProviderAuthType, ProviderCatalogEntry } from "./catalog";
import { OpenAICompatibleProvider } from "./openai";
import {
  classifyHttpError,
  classifyInvalidJson,
  classifyNetworkError,
  keyEnvVar,
} from "./errors";

export interface AdapterOptions extends BaseProviderOptions {
  auth?: ProviderAuthType;
}

interface Ctx {
  provider: string;
  endpoint: string;
  model?: string;
  keyEnv?: string;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

/** Shared fetch/JSON/error handling for Anthropic and Google requests. */
async function requestJson(
  ctx: Ctx,
  url: string,
  init: RequestInit,
  endpointLabel: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: Error }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err, ctx) };
  }
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = "";
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string };
        message?: string;
      };
      detail = parsed.error?.message ?? (typeof parsed.message === "string" ? parsed.message : "");
    } catch {
      detail = body.slice(0, 200);
    }
    const classified = classifyHttpError(res.status, detail, ctx);
    // Backwards-compatible flags consumed by the retry/failover layer.
    (classified as Error & { status?: number }).status = res.status;
    (classified as Error & { cooldown?: boolean }).cooldown = res.status === 429;
    (classified as Error & { detail?: string }).detail = body.slice(0, 1000);
    void endpointLabel;
    return { ok: false, error: classified };
  }
  if (!body) return { ok: false, error: classifyInvalidJson(ctx, "") };
  try {
    return { ok: true, data: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, error: classifyInvalidJson(ctx, body.slice(0, 200)) };
  }
}

/** Parse a `text/event-stream` body, yielding each `data:` payload. */
async function* sseEvents(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
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

/**
 * Open a streaming (SSE) request with classified error handling. On failure
 * the returned object carries `error`; otherwise `res`.
 */
async function openStream(
  ctx: Ctx,
  url: string,
  init: RequestInit,
  endpointLabel: string,
): Promise<{ ok: true; res: Response } | { ok: false; error: Error }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err, ctx) };
  }
  if (res.ok && res.body) return { ok: true, res };
  const body = await res.text().catch(() => "");
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    detail = parsed.error?.message ?? "";
  } catch {
    detail = body.slice(0, 200);
  }
  const classified = classifyHttpError(res.status, detail, ctx);
  (classified as Error & { status?: number }).status = res.status;
  (classified as Error & { cooldown?: boolean }).cooldown = res.status === 429;
  void endpointLabel;
  return { ok: false, error: classified };
}

/** Anthropic Messages API adapter (`/v1/messages`). */
export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(opts: AdapterOptions) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }

  private ctx(model?: string): Ctx {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...(model ? { model } : {}),
      keyEnv: keyEnvVar(this.name),
    };
  }

  private static splitMessages(messages: ChatMessage[]): {
    system?: string;
    messages: { role: "user" | "assistant"; content: string }[];
  } {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    return { ...(system ? { system } : {}), messages: rest };
  }

  async models(): Promise<Model[]> {
    const result = await requestJson(
      this.ctx(),
      joinUrl(this.baseUrl, "v1/models"),
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
      "/v1/models",
    );
    if (!result.ok) throw result.error;
    const data = result.data as { data?: { id: string; display_name?: string }[] };
    return (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id, contextWindow: 0, free: false }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const { system, messages } = AnthropicProvider.splitMessages(request.messages);
    const result = await requestJson(
      this.ctx(request.model),
      joinUrl(this.baseUrl, "v1/messages"),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          ...(system ? { system } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
      "/v1/messages",
    );
    if (!result.ok) throw result.error;
    const data = result.data as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      latencyMs: Date.now() - started,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const { system, messages } = AnthropicProvider.splitMessages(request.messages);
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
          ...(system ? { system } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
      "/v1/messages",
    );
    if (!opened.ok) throw opened.error;
    for await (const payload of sseEvents(opened.res)) {
      if (payload === "[DONE]") {
        yield { delta: "", done: true };
        return;
      }
      try {
        const json = JSON.parse(payload) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (json.type === "content_block_delta" && json.delta?.text) {
          yield { delta: json.delta.text, done: false };
        } else if (json.type === "message_stop") {
          yield { delta: "", done: true };
          return;
        }
      } catch {
        /* ignore partial frames */
      }
    }
    yield { delta: "", done: true };
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const started = Date.now();
    try {
      const res = await fetch(joinUrl(this.baseUrl, "v1/models"), {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
}

/** Google Generative Language (Gemini) adapter. */
export class GoogleProvider implements LLMProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(opts: AdapterOptions) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  private keyParam(sep: string): string {
    return this.apiKey ? `${sep}key=${encodeURIComponent(this.apiKey)}` : "";
  }

  private ctx(model?: string): Ctx {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...(model ? { model } : {}),
      keyEnv: keyEnvVar(this.name),
    };
  }

  private static splitMessages(messages: ChatMessage[]): {
    system?: string;
    contents: { role: "user" | "model"; parts: { text: string }[] }[];
  } {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? ("model" as const) : ("user" as const), parts: [{ text: m.content }] }));
    return { ...(system ? { system } : {}), contents };
  }

  async models(): Promise<Model[]> {
    const result = await requestJson(
      this.ctx(),
      `${this.baseUrl}/models?pageSize=1000${this.keyParam("&")}`,
      { headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000) },
      "/models",
    );
    if (!result.ok) throw result.error;
    const data = result.data as { models?: { name: string; displayName?: string }[] };
    return (data.models ?? []).map((m) => ({
      id: m.name.replace(/^models\//, ""),
      name: m.displayName ?? m.name.replace(/^models\//, ""),
      contextWindow: 0,
      free: false,
    }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const { system, contents } = GoogleProvider.splitMessages(request.messages);
    const result = await requestJson(
      this.ctx(request.model),
      `${this.baseUrl}/models/${request.model}:generateContent${this.keyParam("?")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
      "/generateContent",
    );
    if (!result.ok) throw result.error;
    const data = result.data as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - started,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const { system, contents } = GoogleProvider.splitMessages(request.messages);
    const opened = await openStream(
      this.ctx(request.model),
      `${this.baseUrl}/models/${request.model}:streamGenerateContent?alt=sse${this.keyParam("&")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
      "/streamGenerateContent",
    );
    if (!opened.ok) throw opened.error;
    for await (const payload of sseEvents(opened.res)) {
      try {
        const json = JSON.parse(payload) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const delta = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (delta) yield { delta, done: false };
      } catch {
        /* ignore partial frames */
      }
    }
    yield { delta: "", done: true };
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models?pageSize=1${this.keyParam("&")}`, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
}

/** Instantiate the adapter that matches a catalog entry's api type. */
export function createAdapter(entry: ProviderCatalogEntry, opts: Omit<AdapterOptions, "id">): LLMProvider {
  const common: AdapterOptions = { id: entry.id, auth: entry.auth, ...opts };
  switch (entry.apiType) {
    case "anthropic":
      return new AnthropicProvider(common);
    case "google":
      return new GoogleProvider(common);
    default:
      return new OpenAICompatibleProvider(common);
  }
}

export function adapterForApiType(apiType: ProviderApiType): ProviderApiType {
  return apiType;
}
