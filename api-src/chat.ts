/**
 * POST /api/chat — stateless chat completion for the /app Chat view.
 *
 * Body: { messages: [{ role: "user"|"assistant"|"system", content: string }], model?, provider?, apiKey? }
 * The BYOK key may also arrive via the `x-api-key` header (preferred: it
 * never lands in a logged body), and the provider choice via `x-provider`
 * (or the `provider` body field). The key wins over server env; both are
 * used for this invocation only and never persisted.
 *
 * Without any provider the error is honest ("No LLM provider configured"),
 * never a fabricated reply.
 */
import { ApiSystem } from "../src/api/api-manager";
import {
  configForRequest,
  extractRequestKeyFromHeaders,
  extractRequestProviderFromHeaders,
} from "../src/server/byok";
import type { ChatMessage } from "../src/types";
import { handleApiError, readJsonBody, requireMethod, sendJson, type VercelRequest, type VercelResponse, handlePreflight } from "./_lib";

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "POST")) return;
  try {
    const body = readJsonBody(req);
    const fromBody = typeof body.apiKey === "string" ? body.apiKey : undefined;
    const apiKey = extractRequestKeyFromHeaders(req.headers) ?? fromBody;
    const providerId =
      extractRequestProviderFromHeaders(req.headers) ??
      (typeof body.provider === "string" ? body.provider.trim().toLowerCase() || undefined : undefined);
    const raw = Array.isArray(body.messages) ? body.messages : [];
    const messages: ChatMessage[] = raw
      .filter(
        (m): m is { role?: string; content: string } =>
          !!m && typeof m === "object" && typeof (m as { content?: unknown }).content === "string" &&
          ((m as { content: string }).content.trim().length > 0),
      )
      .slice(-20)
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : m.role === "system" ? ("system" as const) : ("user" as const),
        content: m.content.slice(0, 8000),
      }));
    if (!messages.some((m) => m.role === "user")) {
      sendJson(res, 400, { ok: false, error: "No user message provided" });
      return;
    }
    const config = configForRequest(apiKey, providerId);
    const api = new ApiSystem({ config, logger: silentLogger });
    try {
      const chatOpts: { model?: string; provider?: string } = {};
      if (typeof body.model === "string" && body.model) chatOpts.model = body.model;
      if (providerId) chatOpts.provider = providerId;
      const reply = await api.chat("general", messages, chatOpts);
      sendJson(res, 200, { ok: true, text: reply.text, provider: reply.provider, model: reply.model });
    } catch (err) {
      sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    handleApiError(res, err);
  }
}
