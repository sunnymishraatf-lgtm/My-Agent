import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatRequest, ChatResponse, Model } from "../src/types";
import type { LLMProvider, ChatStreamChunk } from "../src/providers/provider";
import { ProviderRegistry } from "../src/providers/registry";
import { ApiSystem } from "../src/api/api-manager";
import { ChatAgent } from "../src/chat/agent";
import type { ChatSession } from "../src/chat/session";
import { SnapshotStore } from "../src/chat/snapshots";
import type { ResolvedConfig } from "../src/config";

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  private replies: string[];
  constructor(replies: string[]) {
    this.replies = [...replies];
  }
  async models(): Promise<Model[]> {
    return [{ id: "fake-model", name: "fake-model", contextWindow: 8000, free: true }];
  }
  async chat(request: ChatRequest): Promise<ChatResponse> {
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
  api: { maxConcurrentRequests: 2, maxRetries: 0, timeoutMs: 5000, backoffBaseMs: 100, providerCooldownMs: 1000, requestCooldownMs: 0 },
  routing: {},
  completion: { maxIterations: 5 },
  providers: [{ id: "fake", baseUrl: "http://localhost:1/v1", apiKey: "test", models: ["fake-model"], enabled: true }],
};

function makeApi(provider: LLMProvider): ApiSystem {
  const registry = new ProviderRegistry();
  registry.add("fake", provider, ["fake-model"]);
  // Skip real provider configuration/discovery (network) in tests.
  registry.configure = () => {};
  return new ApiSystem({
    config: baseConfig,
    registry,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}

function newSession(): ChatSession {
  const now = new Date().toISOString();
  return { id: "snap-test", title: "test", createdAt: now, updatedAt: now, messages: [] };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-snap-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("SnapshotStore", () => {
  it("round-trips undo and redo stacks independently", () => {
    const store = new SnapshotStore(root);
    const turn = { ts: new Date().toISOString(), files: { "a.txt": "v1" } };
    store.push("s1", turn);
    expect(store.list("s1")).toHaveLength(1);
    expect(store.pop("s1")).toEqual(turn);
    expect(store.list("s1")).toHaveLength(0);

    store.pushRedo("s1", turn);
    expect(store.listRedo("s1")).toHaveLength(1);
    expect(store.popRedo("s1")).toEqual(turn);
    expect(store.listRedo("s1")).toHaveLength(0);
  });

  it("clearRedo drops all redo history", () => {
    const store = new SnapshotStore(root);
    const turn = { ts: new Date().toISOString(), files: { "a.txt": "v1" } };
    store.pushRedo("s1", turn);
    store.pushRedo("s1", turn);
    store.clearRedo("s1");
    expect(store.listRedo("s1")).toHaveLength(0);
    // Undo history is untouched.
    store.push("s1", turn);
    store.clearRedo("s1");
    expect(store.list("s1")).toHaveLength(1);
  });
});

describe("ChatAgent undo/redo", () => {
  it("undo restores files and redo re-applies them", async () => {
    const provider = new FakeProvider([
      '```tool\n{"tool":"write","args":{"path":"hello.txt","content":"hi there"}}\n```',
      "Created hello.txt.",
    ]);
    const store = new SnapshotStore(root);
    const agent = new ChatAgent({ root, api: makeApi(provider), maxSteps: 5, snapshots: store });
    const session = newSession();

    await agent.send(session, "create hello.txt");
    expect(readFileSync(join(root, "hello.txt"), "utf8")).toBe("hi there");

    const undone = await agent.undo(session);
    expect(undone).toContain("hello.txt");
    expect(existsSync(join(root, "hello.txt"))).toBe(false);
    expect(store.listRedo(session.id)).toHaveLength(1);

    const redone = await agent.redo(session);
    expect(redone).toContain("hello.txt");
    expect(readFileSync(join(root, "hello.txt"), "utf8")).toBe("hi there");
  });

  it("a new turn invalidates redo history even when it changes no files", async () => {
    const provider = new FakeProvider([
      '```tool\n{"tool":"write","args":{"path":"hello.txt","content":"hi"}}\n```',
      "Created.",
      "Nothing to change.",
    ]);
    const store = new SnapshotStore(root);
    const agent = new ChatAgent({ root, api: makeApi(provider), maxSteps: 5, snapshots: store });
    const session = newSession();

    await agent.send(session, "create hello.txt");
    await agent.undo(session);
    expect(store.listRedo(session.id)).toHaveLength(1);

    // New turn with no file changes must still clear stale redo.
    await agent.send(session, "status?");
    expect(store.listRedo(session.id)).toHaveLength(0);
  });

  it("undo on a session without snapshots returns nothing", async () => {
    const store = new SnapshotStore(root);
    const agent = new ChatAgent({ root, api: makeApi(new FakeProvider([])), maxSteps: 5, snapshots: store });
    expect(await agent.undo(newSession())).toEqual([]);
    expect(await agent.redo(newSession())).toEqual([]);
  });
});

describe("CLI undo semantics", () => {
  it("captures current files into redo before restoring (mirror of agent.undo)", () => {
    // The `neutron undo` command must push the pre-restore state to redo so
    // `neutron redo` can re-apply it. Exercise the store primitives it relies on.
    const store = new SnapshotStore(root);
    writeFileSync(join(root, "a.txt"), "current", "utf8");
    const turn = { ts: new Date().toISOString(), files: { "a.txt": "before" } };
    store.push("s1", turn);

    const popped = store.pop("s1")!;
    // captureCurrent equivalent: record the on-disk state before restore.
    const before = { ts: new Date().toISOString(), files: { "a.txt": readFileSync(join(root, "a.txt"), "utf8") } };
    writeFileSync(join(root, "a.txt"), popped.files["a.txt"]!, "utf8");
    store.pushRedo("s1", before);

    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("before");
    expect(store.listRedo("s1")[0]!.files["a.txt"]).toBe("current");
  });
});
