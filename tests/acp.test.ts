import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChatRequest, ChatResponse, Model } from "../src/types";
import type { LLMProvider, ChatStreamChunk } from "../src/providers/provider";
import { ProviderRegistry } from "../src/providers/registry";
import { ApiSystem } from "../src/api/api-manager";
import { AcpServer } from "../src/acp/server";
import type { ResolvedConfig } from "../src/config";

class StreamingProvider implements LLMProvider {
  readonly name = "fake";
  async models(): Promise<Model[]> {
    return [{ id: "fake-model", name: "fake-model", contextWindow: 8000, free: true }];
  }
  async chat(request: ChatRequest): Promise<ChatResponse> {
    return { text: "Hello from ACP", provider: this.name, model: request.model ?? "fake-model" };
  }
  async *stream(): AsyncIterable<ChatStreamChunk> {
    yield { delta: "Hello ", done: false };
    yield { delta: "from ACP", done: true };
  }
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    return { ok: true, latencyMs: 1 };
  }
}

const baseConfig: ResolvedConfig = {
  api: {
    maxConcurrentRequests: 2,
    maxRetries: 0,
    timeoutMs: 5000,
    backoffBaseMs: 100,
    providerCooldownMs: 1000,
    requestCooldownMs: 0,
  },
  routing: {},
  completion: { maxIterations: 5 },
  providers: [{ id: "fake", baseUrl: "http://localhost:1/v1", apiKey: "test", models: ["fake-model"], enabled: true }],
};

function makeApi(): ApiSystem {
  const registry = new ProviderRegistry();
  registry.add("fake", new StreamingProvider(), ["fake-model"]);
  registry.configure = () => {};
  return new ApiSystem({
    config: baseConfig,
    registry,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-acp-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("acp server", () => {
  it("handles initialize, session/new and session/prompt", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const server = new AcpServer({ root, input, output, api: makeApi() });
    server.start();

    const messages: Record<string, unknown>[] = [];
    let buffer = "";
    output.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) messages.push(JSON.parse(line) as Record<string, unknown>);
      }
    });

    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: {} }) + "\n");

    await new Promise((r) => setTimeout(r, 50));
    const init = messages.find((m) => m.id === 1) as { result: { protocolVersion: number } };
    expect(init.result.protocolVersion).toBe(1);
    const newSession = messages.find((m) => m.id === 2) as { result: { sessionId: string } };
    const sessionId = newSession.result.sessionId;
    expect(typeof sessionId).toBe("string");

    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "say hi" }] },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 200));

    const promptResult = messages.find((m) => m.id === 3) as { result?: { stopReason: string } };
    expect(promptResult.result?.stopReason).toBe("end_turn");
    const updates = messages.filter((m) => m.method === "session/update");
    expect(updates.length).toBeGreaterThan(0);
  });
});
