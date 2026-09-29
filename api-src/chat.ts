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
import { applyAttachmentsToMessages, AttachmentError } from "../src/server/chat-attachments";
import { extractArtifacts, ARTIFACT_SYSTEM_NUDGE } from "../src/server/chat-artifacts";
import type { ChatMessage } from "../src/types";
import { handleApiError, readJsonBody, requireMethod, sendJson, type VercelRequest, type VercelResponse, handlePreflight } from "./_lib";

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** True when the body carries attachments — an attachment-only request is
    valid even with no text message (the merger synthesizes a user turn). */
function hasAttachments(body: { attachments?: unknown }): boolean {
  return Array.isArray(body.attachments) && body.attachments.length > 0;
}

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
    if (!messages.some((m) => m.role === "user") && !hasAttachments(body)) {
      sendJson(res, 400, { ok: false, error: "No user message provided" });
      return;
    }
    // Teach the model the file-artifact convention (short, fixed nudge).
    // An optional client-supplied PROJECT MEMORY block is appended to the
    // same system message so the artifact convention always survives.
    if (!messages.some((m) => m.role === "system")) {
      let system = ARTIFACT_SYSTEM_NUDGE;
      if (typeof body.projectContext === "string" && body.projectContext.trim()) {
        system += "\n\n" + body.projectContext.slice(0, 6000);
      }
      messages.unshift({ role: "system", content: system });
    }
    // Attachments: validated + merged into the last user message here.
    // AttachmentError -> honest 400 (names/sizes only, never contents).
    let outgoing: ChatMessage[];
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
      const chatOpts: { model?: string; provider?: string } = {};
      if (typeof body.model === "string" && body.model) chatOpts.model = body.model;
      if (providerId) chatOpts.provider = providerId;
      const reply = await api.chat("general", outgoing, chatOpts);
      const parsed = extractArtifacts(reply.text);
      sendJson(res, 200, {
        ok: true,
        text: parsed.text,
        artifacts: parsed.artifacts,
        provider: reply.provider,
        model: reply.model,
      });
    } catch (err) {
      sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    handleApiError(res, err);
  }
}
