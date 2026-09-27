import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatRequest, ChatResponse, Model } from "../src/types";
import type { LLMProvider, ChatStreamChunk } from "../src/providers/provider";
import { ProviderRegistry } from "../src/providers/registry";
import { ApiSystem } from "../src/api/api-manager";
import { ChatAgent, type ChatEvent } from "../src/chat/agent";
import { SnapshotStore, restoreTurn } from "../src/chat/snapshots";
import { loadCommands, expandCommand } from "../src/chat/commands";
import { parseInput } from "../src/chat/input";
import type { ChatSession } from "../src/chat/session";
import type { ResolvedConfig } from "../src/config";

class StreamProvider implements LLMProvider {
  readonly name = "fake";
  streamCalls = 0;
  chatCalls = 0;
  private replies: string[];

  constructor(replies: string[]) {
    this.replies = [...replies];
  }

  async models(): Promise<Model[]> {
    return [{ id: "fake-model", name: "fake-model", contextWindow: 8000, free: true }];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.chatCalls++;
    return { text: this.replies.shift() ?? "Done.", provider: this.name, model: request.model ?? "fake-model" };
  }

  async *stream(): AsyncIterable<ChatStreamChunk> {
    this.streamCalls++;
    const text = this.replies.shift() ?? "Done.";
    for (const part of text.split(" ")) yield { delta: `${part} `, done: false };
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
  registry.configure = () => {};
  return new ApiSystem({
    config: baseConfig,
    registry,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}

function newSession(id = "test"): ChatSession {
  const now = new Date().toISOString();
  return { id, title: "test", createdAt: now, updatedAt: now, messages: [] };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-extras-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("streaming", () => {
  it("emits delta events and assembles the final answer", async () => {
    const provider = new StreamProvider(["Hello there friend"]);
    const api = makeApi(provider);
    const events: ChatEvent[] = [];
    const agent = new ChatAgent({ root, api, stream: true, onEvent: (e) => events.push(e) });
    const session = newSession();

    const final = await agent.send(session, "hi");

    expect(provider.streamCalls).toBe(1);
    expect(provider.chatCalls).toBe(0);
    expect(final).toBe("Hello there friend");
    const deltas = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text);
    expect(deltas.join("")).toBe("Hello there friend ");
  });

  it("falls back to non-streaming when streaming throws before any delta", async () => {
    const provider = new StreamProvider(["fallback answer"]);
    provider.stream = async function* (): AsyncIterable<ChatStreamChunk> {
      throw new Error("stream unsupported");
    };
    const api = makeApi(provider);
    const agent = new ChatAgent({ root, api, stream: true });
    const final = await agent.send(newSession(), "hi");
    expect(final).toBe("fallback answer");
    expect(provider.chatCalls).toBe(1);
  });
});

describe("Snapshots and undo", () => {
  it("restores a modified file to its previous content", async () => {
    writeFileSync(join(root, "a.txt"), "original", "utf8");
    const provider = new StreamProvider([
      '```tool\n{"tool":"write","args":{"path":"a.txt","content":"changed"}}\n```',
      "done",
    ]);
    const api = makeApi(provider);
    const snapshots = new SnapshotStore(root);
    const agent = new ChatAgent({ root, api, snapshots, maxSteps: 5 });
    const session = newSession("s1");

    await agent.send(session, "edit a.txt");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("changed");

    const restored = await agent.undo(session);
    expect(restored).toEqual(["a.txt"]);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("original");
  });

  it("removes a file that did not exist before the turn", async () => {
    const provider = new StreamProvider([
      '```tool\n{"tool":"write","args":{"path":"fresh.txt","content":"new"}}\n```',
      "done",
    ]);
    const api = makeApi(provider);
    const snapshots = new SnapshotStore(root);
    const agent = new ChatAgent({ root, api, snapshots, maxSteps: 5 });
    const session = newSession("s2");

    await agent.send(session, "create fresh.txt");
    expect(existsSync(join(root, "fresh.txt"))).toBe(true);

    await agent.undo(session);
    expect(existsSync(join(root, "fresh.txt"))).toBe(false);
  });

  it("SnapshotStore persists turns and restoreTurn handles it", () => {
    const store = new SnapshotStore(root);
    store.push("abc", { ts: "now", files: { "x.txt": null } });
    const turn = store.pop("abc");
    expect(turn?.files["x.txt"]).toBeNull();
    expect(store.pop("abc")).toBeUndefined();
    if (turn) expect(restoreTurn(root, turn)).toEqual([]);
  });
});

describe("custom commands", () => {
  it("loads markdown commands and expands arguments", () => {
    const dir = join(root, ".neutron", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "review.md"), "# Review code\nPlease review $ARGUMENTS focusing on $1.", "utf8");

    const commands = loadCommands(root);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("review");
    expect(commands[0]!.description).toBe("Review code");

    const expanded = expandCommand(commands[0]!, "src and tests");
    expect(expanded).toContain("focusing on src");
    expect(expanded).toContain("Please review src and tests");
  });

  it("returns an empty list when no command directory exists", () => {
    expect(loadCommands(root)).toEqual([]);
  });
});

describe("expandCommand", () => {
  const cmd = (body: string) => ({ name: "t", description: "", body, file: "t.md" });

  it("preserves literal dollar sequences in args substituted via $ARGUMENTS", () => {
    // `$&`, `$1`, `$$` are special in a String.replace replacement string;
    // they must survive as literal text.
    const expanded = expandCommand(cmd("Run $ARGUMENTS now"), "a $& b $$ c $1");
    expect(expanded).toBe("Run a $& b $$ c $1 now");
  });

  it("preserves literal dollar sequences in positional args", () => {
    expect(expandCommand(cmd("[$1]"), "p$&q")).toBe("[p$&q]");
    expect(expandCommand(cmd("[$1]"), "$$")).toBe("[$$]");
  });

  it("preserves literal $$ in the template", () => {
    expect(expandCommand(cmd("price: $$"), "x")).toBe("price: $$");
  });

  it("substitutes multi-digit positional args ($10, $11, ...)", () => {
    const args = "a b c d e f g h i j k l";
    expect(expandCommand(cmd("$10 $1 $2 $12"), args)).toBe("j a b l");
  });

  it("leaves out-of-range multi-digit placeholders empty", () => {
    expect(expandCommand(cmd("[$10]"), "a b")).toBe("[]");
  });
});

describe("input parsing", () => {
  it("attaches @file references", () => {
    writeFileSync(join(root, "note.txt"), "hello world", "utf8");
    const parsed = parseInput(root, "explain @note.txt please");
    expect(parsed.kind).toBe("send");
    expect(parsed.attached).toEqual(["note.txt"]);
    expect(parsed.text).toContain("[attached: note.txt]");
    expect(parsed.text).toContain("hello world");
  });

  it("passes through unknown @refs and detects !shell", () => {
    const parsed = parseInput(root, "see @missing.txt");
    expect(parsed.attached).toEqual([]);
    expect(parsed.text).toBe("see @missing.txt");

    const shell = parseInput(root, "!echo hi");
    expect(shell.kind).toBe("shell");
    expect(shell.text).toBe("echo hi");
  });
});
