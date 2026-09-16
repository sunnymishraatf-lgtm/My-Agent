import { randomUUID } from "node:crypto";
import { loadConfig } from "../config";
import { ApiSystem } from "../api/api-manager";
import { ChatAgent } from "../chat/agent";
import type { ChatSession } from "../chat/session";

export interface AcpServerOptions {
  root: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  api?: ApiSystem;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = 1;
const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Minimal Agent Client Protocol server: newline-delimited JSON-RPC over stdio.
 * Supports initialize, session/new, session/prompt and session/cancel.
 */
export class AcpServer {
  private root: string;
  private input: NodeJS.ReadableStream;
  private output: NodeJS.WritableStream;
  private api: ApiSystem;
  private sessions = new Map<string, ChatSession>();
  private cancelled = new Set<string>();
  private buffer = "";

  constructor(opts: AcpServerOptions) {
    this.root = opts.root;
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stdout;
    this.api = opts.api ?? new ApiSystem({ config: loadConfig(), logger: silentLogger });
  }

  start(): void {
    this.input.setEncoding?.("utf8");
    this.input.on("data", (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: JsonRpcRequest;
      try {
        message = JSON.parse(line) as JsonRpcRequest;
      } catch {
        continue;
      }
      void this.dispatch(message);
    }
  }

  private respond(id: number | string | undefined, result: unknown): void {
    if (id === undefined) return;
    this.write({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: number | string | undefined, code: number, message: string): void {
    if (id === undefined) return;
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: unknown): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private async dispatch(message: JsonRpcRequest): Promise<void> {
    switch (message.method) {
      case "initialize":
        this.respond(message.id, {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { promptCapabilities: { image: false, audio: false } },
          authMethods: [],
        });
        return;
      case "authenticate":
        this.respond(message.id, {});
        return;
      case "session/new": {
        const sessionId = randomUUID();
        const now = new Date().toISOString();
        this.sessions.set(sessionId, {
          id: sessionId,
          title: "ACP session",
          createdAt: now,
          updatedAt: now,
          messages: [],
        });
        this.respond(message.id, { sessionId });
        return;
      }
      case "session/cancel": {
        const sessionId = String(message.params?.sessionId ?? "");
        this.cancelled.add(sessionId);
        return;
      }
      case "session/prompt": {
        await this.prompt(message);
        return;
      }
      default:
        this.respondError(message.id, -32601, `Method not found: ${message.method}`);
    }
  }

  private async prompt(message: JsonRpcRequest): Promise<void> {
    const sessionId = String(message.params?.sessionId ?? "");
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.respondError(message.id, -32602, `Unknown session: ${sessionId}`);
      return;
    }
    const prompt = message.params?.prompt;
    const text = Array.isArray(prompt)
      ? prompt
          .map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: string }).text ?? "") : ""))
          .join("")
      : String(prompt ?? "");
    if (!text) {
      this.respondError(message.id, -32602, "Empty prompt");
      return;
    }

    const agent = new ChatAgent({
      root: this.root,
      api: this.api,
      stream: true,
      formatOnWrite: false,
      onEvent: (event) => {
        if (event.type === "delta" && event.text) {
          this.notify("session/update", {
            sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.text } },
          });
        } else if (event.type === "tool-call") {
          this.notify("session/update", {
            sessionId,
            update: { sessionUpdate: "tool_call", toolCallId: `${Date.now()}-${event.name}`, title: event.name, status: "in_progress" },
          });
        }
      },
    });

    try {
      await agent.send(session, text);
      this.respond(message.id, { stopReason: this.cancelled.has(sessionId) ? "cancelled" : "end_turn" });
    } catch (err) {
      this.respondError(message.id, -32603, err instanceof Error ? err.message : String(err));
    } finally {
      this.cancelled.delete(sessionId);
    }
  }
}
