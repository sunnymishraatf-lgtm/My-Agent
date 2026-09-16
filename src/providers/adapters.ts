import type { ChatMessage, ChatRequest, ChatResponse, Model } from "../types";
import { normalizeBaseUrl, type BaseProviderOptions, type ChatStreamChunk, type LLMProvider } from "./provider";
import type { ProviderApiType, ProviderAuthType, ProviderCatalogEntry } from "./catalog";
import { OpenAICompatibleProvider } from "./openai";

export interface AdapterOptions extends BaseProviderOptions {
  auth?: ProviderAuthType;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

async function readError(res: Response, name: string, endpoint: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    detail = parsed.error?.message ?? "";
  } catch {
    detail = body.slice(0, 200);
  }
  const err = new Error(`Provider ${name} returned ${res.status} from ${endpoint}${detail ? `: ${detail}` : ""}`);
  (err as Error & { status?: number; retryable?: boolean; cooldown?: boolean }).status = res.status;
  (err as Error & { retryable?: boolean }).retryable = res.status === 408 || res.status === 429 || res.status >= 500;
  (err as Error & { cooldown?: boolean }).cooldown = res.status === 429;
  return err;
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
    const res = await fetch(joinUrl(this.baseUrl, "v1/models"), {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw await readError(res, this.name, "/v1/models");
    const data = (await res.json()) as { data?: { id: string; display_name?: string }[] };
    return (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id, contextWindow: 0, free: false }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const { system, messages } = AnthropicProvider.splitMessages(request.messages);
    const res = await fetch(joinUrl(this.baseUrl, "v1/messages"), {
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
    });
    if (!res.ok) throw await readError(res, this.name, "/v1/messages");
    const data = (await res.json()) as {
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
    const res = await fetch(joinUrl(this.baseUrl, "v1/messages"), {
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
    });
    if (!res.ok) throw await readError(res, this.name, "/v1/messages");
    for await (const payload of sseEvents(res)) {
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
    const res = await fetch(`${this.baseUrl}/models?pageSize=1000${this.keyParam("&")}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw await readError(res, this.name, "/models");
    const data = (await res.json()) as { models?: { name: string; displayName?: string }[] };
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
    const res = await fetch(`${this.baseUrl}/models/${request.model}:generateContent${this.keyParam("?")}`, {
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
    });
    if (!res.ok) throw await readError(res, this.name, "/generateContent");
    const data = (await res.json()) as {
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
    const res = await fetch(
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
    );
    if (!res.ok) throw await readError(res, this.name, "/streamGenerateContent");
    for await (const payload of sseEvents(res)) {
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
