import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatRequest, ChatResponse, Model } from "../src/types";
import type { LLMProvider, ChatStreamChunk } from "../src/providers/provider";
import { ProviderRegistry } from "../src/providers/registry";
import { ApiSystem } from "../src/api/api-manager";
import { ChatAgent, type ChatEvent } from "../src/chat/agent";
import { SessionStore, type ChatSession } from "../src/chat/session";
import { parseToolCalls } from "../src/chat/protocol";
import type { ResolvedConfig } from "../src/config";

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly requests: ChatRequest[] = [];
  private replies: string[];

  constructor(replies: string[]) {
    this.replies = [...replies];
  }

  async models(): Promise<Model[]> {
    return [{ id: "fake-model", name: "fake-model", contextWindow: 8000, free: true }];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const text = this.replies.shift() ?? "Done.";
    return { text, provider: this.name, model: request.model ?? "fake-model" };
  }

  async *stream(): AsyncIterable<ChatStreamChunk> {
    yield { delta: "", done: true };
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

function makeApi(provider: LLMProvider): ApiSystem {
  const registry = new ProviderRegistry();
  registry.add("fake", provider, ["fake-model"]);
  const originalConfigure = registry.configure.bind(registry);
  registry.configure = () => {
    void originalConfigure;
  };
  return new ApiSystem({
    config: baseConfig,
    registry,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}

function newSession(): ChatSession {
  const now = new Date().toISOString();
  return { id: "test", title: "test", createdAt: now, updatedAt: now, messages: [] };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-chat-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseToolCalls", () => {
  it("extracts a fenced tool block and strips it from the prose", () => {
    const text = "Sure.\n```tool\n{\"tool\":\"read\",\"args\":{\"path\":\"a.ts\"}}\n```";
    const parsed = parseToolCalls(text);
    expect(parsed.calls).toEqual([{ name: "read", args: { path: "a.ts" } }]);
    expect(parsed.text).toBe("Sure.");
  });

  it("supports flat args, arrays and single-key objects", () => {
    const flat = parseToolCalls('```tool\n{"tool":"list","path":"src"}\n```');
    expect(flat.calls[0]).toEqual({ name: "list", args: { path: "src" } });

    const array = parseToolCalls(
      '```tool\n[{"tool":"read","args":{"path":"a"}},{"name":"list","arguments":{"path":"b"}}]\n```',
    );
    expect(array.calls).toHaveLength(2);
    expect(array.calls[1]).toEqual({ name: "list", args: { path: "b" } });

    const single = parseToolCalls('```tool\n{"grep":{"pattern":"foo"}}\n```');
    expect(single.calls[0]).toEqual({ name: "grep", args: { pattern: "foo" } });
  });

  it("returns no calls for plain text", () => {
    expect(parseToolCalls("just talking").calls).toHaveLength(0);
  });
});

describe("ChatAgent tool loop", () => {
  it("executes a tool call and continues to the final answer", async () => {
    const provider = new FakeProvider([
      '```tool\n{"tool":"write","args":{"path":"hello.txt","content":"hi there"}}\n```',
      "Created hello.txt.",
    ]);
    const api = makeApi(provider);
    const events: ChatEvent[] = [];
    const agent = new ChatAgent({ root, api, maxSteps: 5, onEvent: (e) => events.push(e) });
    const session = newSession();

    const final = await agent.send(session, "create hello.txt");

    expect(final).toBe("Created hello.txt.");
    expect(existsSync(join(root, "hello.txt"))).toBe(true);
    expect(readFileSync(join(root, "hello.txt"), "utf8")).toBe("hi there");
    expect(events.some((e) => e.type === "tool-call" && e.name === "write")).toBe(true);
    expect(events.some((e) => e.type === "tool-result" && e.ok)).toBe(true);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]!.messages.some((m) => m.content.includes("Tool result"))).toBe(true);
  });

  it("does not loop when the model answers directly", async () => {
    const provider = new FakeProvider(["No changes needed."]);
    const api = makeApi(provider);
    const agent = new ChatAgent({ root, api, maxSteps: 5 });
    const session = newSession();
    const final = await agent.send(session, "status?");
    expect(final).toBe("No changes needed.");
    expect(provider.requests).toHaveLength(1);
  });
});

describe("SessionStore", () => {
  it("creates, lists, loads and removes sessions", () => {
    const store = new SessionStore(root);
    const session = store.create("my session");
    expect(store.list()).toHaveLength(0);
    session.messages.push({ role: "user", content: "hi" });
    store.save(session);

    expect(store.list()).toHaveLength(1);
    expect(store.latest()?.id).toBe(session.id);
    expect(store.load(session.id)?.messages).toHaveLength(1);

    expect(store.remove(session.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });
});
