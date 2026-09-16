import type { ChatRequest, ChatResponse, Model } from "../types";
import { normalizeBaseUrl, type BaseProviderOptions, type LLMProvider } from "./provider";

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private cachedModels: Model[] | undefined;
  private lastModelsFetch = 0;

  constructor(opts: BaseProviderOptions) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async models(): Promise<Model[]> {
    if (this.cachedModels && Date.now() - this.lastModelsFetch < 5 * 60_000) {
      return this.cachedModels;
    }
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Provider ${this.name} returned ${res.status} from /models`);
      (err as Error & { status?: number }).status = res.status;
      (err as Error & { retryable?: boolean }).retryable =
        res.status === 408 || res.status === 429 || res.status >= 500;
      (err as Error & { cooldown?: boolean }).cooldown = res.status === 429;
      (err as Error & { detail?: string }).detail = body.slice(0, 1000);
      throw err;
    }
    const data = (await res.json()) as { data?: { id: string }[] };
    this.cachedModels = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      contextWindow: 32_768,
      free: false,
    }));
    this.lastModelsFetch = Date.now();
    return this.cachedModels;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stop: request.stop,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const status = res.status;
      let detail = "";
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        detail = parsed.error?.message ?? "";
      } catch {
        detail = body.slice(0, 200);
      }
      const err = new Error(
        `Provider ${this.name} returned ${status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
      (err as Error & { status?: number }).status = status;
      (err as Error & { retryable?: boolean }).retryable =
        status === 408 || status === 429 || status >= 500;
      (err as Error & { cooldown?: boolean }).cooldown = status === 429;
      (err as Error & { detail?: string }).detail = body.slice(0, 1000);
      throw err;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - started,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<import("./provider").ChatStreamChunk> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stop: request.stop,
        stream: true,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Provider ${this.name} stream failed with ${res.status}`);
    }
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
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) yield { delta, done: false };
          } catch {
            /* partial JSON in a sanity check */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }
}