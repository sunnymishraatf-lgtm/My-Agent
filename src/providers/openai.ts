import type { ChatRequest, ChatResponse, Model } from "../types";
import { normalizeBaseUrl, type BaseProviderOptions, type LLMProvider } from "./provider";
import {
  classifyHttpError,
  classifyInvalidJson,
  classifyNetworkError,
  keyEnvVar,
} from "./errors";

interface Ctx {
  provider: string;
  endpoint: string;
  model?: string;
  keyEnv?: string;
}

/** Shared fetch/JSON/error handling for every OpenAI-compatible request. */
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
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
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

  private ctx(model?: string): Ctx {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...(model ? { model } : {}),
      keyEnv: keyEnvVar(this.name),
    };
  }

  async models(): Promise<Model[]> {
    if (this.cachedModels && Date.now() - this.lastModelsFetch < 5 * 60_000) {
      return this.cachedModels;
    }
    const result = await requestJson(
      this.ctx(),
      `${this.baseUrl}/models`,
      {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      },
      "/models",
    );
    if (!result.ok) throw result.error;
    const data = result.data as { data?: { id: string }[] };
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
    const result = await requestJson(
      this.ctx(request.model),
      `${this.baseUrl}/chat/completions`,
      {
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
      },
      "/chat/completions",
    );
    if (!result.ok) throw result.error;

    const data = result.data as {
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
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
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
    } catch (err) {
      throw classifyNetworkError(err, this.ctx(request.model));
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        detail = parsed.error?.message ?? "";
      } catch {
        detail = body.slice(0, 200);
      }
      const classified = classifyHttpError(res.status, detail, this.ctx(request.model));
      (classified as Error & { status?: number }).status = res.status;
      (classified as Error & { cooldown?: boolean }).cooldown = res.status === 429;
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