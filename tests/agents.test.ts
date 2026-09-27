import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatRequest, ChatResponse, Model } from "../src/types";
import type { LLMProvider, ChatStreamChunk } from "../src/providers/provider";
import { ProviderRegistry } from "../src/providers/registry";
import { ApiSystem } from "../src/api/api-manager";
import { ChatAgent, type ChatEvent } from "../src/chat/agent";
import { SessionStore, type ChatSession } from "../src/chat/session";
import {
  findAgent,
  loadAgents,
  parseAgentMarkdown,
  permissionFor,
  isToolAllowed,
} from "../src/chat/agent-config";
import { loadSkills } from "../src/chat/skills";
import { deleteAgentFile, findAgentFile } from "../src/chat/agent-config";
import { generateAgentsMd } from "../src/chat/project-init";
import { SnapshotStore } from "../src/chat/snapshots";
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
    return { text: this.replies.shift() ?? "Done.", provider: this.name, model: request.model ?? "fake-model" };
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
  registry.configure = () => {};
  return new ApiSystem({
    config: baseConfig,
    registry,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}

function newSession(id = "s"): ChatSession {
  const now = new Date().toISOString();
  return { id, title: "t", createdAt: now, updatedAt: now, messages: [] };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-agents-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("agent config", () => {
  it("parses frontmatter with nested permissions", () => {
    const md = [
      "---",
      "description: Reviews code",
      "mode: subagent",
      "model: fake/model",
      "temperature: 0.2",
      "permission:",
      "  edit: deny",
      "  bash:",
      '    "*": ask',
      '    "git *": allow',
      "---",
      "You are a reviewer.",
    ].join("\n");
    const agent = parseAgentMarkdown("review", md);
    expect(agent.name).toBe("review");
    expect(agent.mode).toBe("subagent");
    expect(agent.model).toBe("fake/model");
    expect(agent.temperature).toBe(0.2);
    expect(agent.prompt).toBe("You are a reviewer.");
    expect(permissionFor(agent, "edit")).toBe("deny");
    expect(permissionFor(agent, "bash", "git status")).toBe("allow");
    expect(permissionFor(agent, "bash", "rm -rf /")).toBe("ask");
  });

  it("loads built-in and custom agents", () => {
    const dir = join(root, ".neutron", "agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "docs.md"), "---\ndescription: Docs writer\nmode: subagent\n---\nWrite docs.", "utf8");

    const agents = loadAgents(root);
    expect(findAgent(agents, "build")).toBeDefined();
    expect(findAgent(agents, "plan")).toBeDefined();
    expect(findAgent(agents, "docs")?.description).toBe("Docs writer");
    expect(isToolAllowed(findAgent(agents, "plan")!, "write")).toBe(false);
    expect(isToolAllowed(findAgent(agents, "plan")!, "read")).toBe(true);
  });

  it("locates and deletes custom agent files", () => {
    const dir = join(root, ".neutron", "agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "docs.md"), "---\ndescription: Docs writer\nmode: subagent\n---\nWrite docs.", "utf8");
    expect(findAgentFile(root, "docs")).toBe(join(dir, "docs.md"));
    expect(findAgentFile(root, "build")).toBeUndefined();
    expect(deleteAgentFile(root, "docs")).toBe(true);
    expect(findAgentFile(root, "docs")).toBeUndefined();
  });
});

describe("session store", () => {
  it("renames and searches sessions", () => {
    const store = new SessionStore(root);
    const a = store.create("Alpha setup");
    a.messages.push({ role: "user", content: "how do I configure the database" });
    store.save(a);
    const b = store.create("Beta work");
    store.save(b);

    expect(store.rename(a.id, "Renamed Alpha")).toBe(true);
    expect(store.load(a.id)?.title).toBe("Renamed Alpha");
    expect(store.rename("missing", "x")).toBe(false);

    expect(store.search("renamed").map((s) => s.id)).toEqual([a.id]);
    expect(store.search("database").map((s) => s.id)).toEqual([a.id]);
    expect(store.search("nope")).toHaveLength(0);
  });

  it("forks a session, optionally truncating messages", () => {
    const store = new SessionStore(root);
    const source = store.create("Original");
    source.messages.push({ role: "user", content: "one" }, { role: "assistant", content: "two" });
    store.save(source);

    const full = store.fork(source.id);
    expect(full?.title).toBe("Original (fork)");
    expect(full?.messages).toHaveLength(2);
    expect(full?.id).not.toBe(source.id);

    const partial = store.fork(source.id, { atMessage: 1, title: "Half" });
    expect(partial?.messages).toHaveLength(1);
    expect(partial?.title).toBe("Half");

    expect(store.fork("missing")).toBeUndefined();
  });
});

describe("skills", () => {
  it("loads SKILL.md files", () => {
    const dir = join(root, ".neutron", "skills", "react");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: react\ndescription: React tips\n---\nUse hooks.", "utf8");
    const skills = loadSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("react");
    expect(skills[0]!.body).toBe("Use hooks.");
  });
});

describe("subagents and todo tools", () => {
  it("delegates to a subagent via the task tool", async () => {
    const provider = new FakeProvider([
      '```tool\n{"tool":"task","args":{"description":"explore","prompt":"find the config","subagent_type":"explore"}}\n```',
      "The config lives in src/config.ts.",
      "Found it, done.",
    ]);
    const api = makeApi(provider);
    const events: ChatEvent[] = [];
    const agent = new ChatAgent({ root, api, maxSteps: 5, onEvent: (e) => events.push(e) });
    const final = await agent.send(newSession(), "where is config?");

    expect(final).toBe("Found it, done.");
    const taskResult = events.find((e) => e.type === "tool-result" && e.name === "task");
    expect(taskResult && taskResult.type === "tool-result" ? taskResult.output : "").toContain("src/config.ts");
    expect(provider.requests).toHaveLength(3);
  });

  it("tracks todos through todowrite/todoread", async () => {
    const provider = new FakeProvider([
      '```tool\n{"tool":"todowrite","args":{"todos":"[{\\"content\\":\\"ship it\\",\\"status\\":\\"pending\\",\\"priority\\":\\"high\\"}]"}}\n```',
      '```tool\n{"tool":"todoread","args":{}}\n```',
      "Done.",
    ]);
    const api = makeApi(provider);
    const events: ChatEvent[] = [];
    const agent = new ChatAgent({ root, api, maxSteps: 5, onEvent: (e) => events.push(e) });
    await agent.send(newSession(), "make a plan");
    const read = events.filter((e) => e.type === "tool-result" && e.name === "todoread");
    expect(read).toHaveLength(1);
    expect(read[0] && read[0].type === "tool-result" ? read[0].output : "").toContain("ship it");
  });

  it("loads a skill body through the skill tool", async () => {
    const dir = join(root, ".neutron", "skills", "style");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: style\ndescription: style guide\n---\nPrefer composition.", "utf8");
    const provider = new FakeProvider([
      '```tool\n{"tool":"skill","args":{"name":"style"}}\n```',
      "Noted.",
    ]);
    const api = makeApi(provider);
    const events: ChatEvent[] = [];
    const agent = new ChatAgent({ root, api, maxSteps: 5, onEvent: (e) => events.push(e) });
    await agent.send(newSession(), "follow our style");
    const result = events.find((e) => e.type === "tool-result" && e.name === "skill");
    expect(result && result.type === "tool-result" ? result.output : "").toContain("Prefer composition.");
  });
});

describe("permissions", () => {
  it("blocks writes for the plan agent", async () => {
    const provider = new FakeProvider([
      '```tool\n{"tool":"write","args":{"path":"nope.txt","content":"x"}}\n```',
      "I cannot write in plan mode.",
    ]);
    const api = makeApi(provider);
    const events: ChatEvent[] = [];
    const build = loadAgents(root);
    const agent = new ChatAgent({
      root,
      api,
      agent: findAgent(build, "plan"),
      agents: build,
      maxSteps: 5,
      onEvent: (e) => events.push(e),
    });
    await agent.send(newSession(), "create nope.txt");
    expect(existsSync(join(root, "nope.txt"))).toBe(false);
    const result = events.find((e) => e.type === "tool-result" && e.name === "write");
    expect(result && result.type === "tool-result" ? result.ok : true).toBe(false);
  });
});

describe("redo", () => {
  it("re-applies an undone turn", async () => {
    writeFileSync(join(root, "a.txt"), "original", "utf8");
    const provider = new FakeProvider([
      '```tool\n{"tool":"write","args":{"path":"a.txt","content":"changed"}}\n```',
      "done",
    ]);
    const api = makeApi(provider);
    const snapshots = new SnapshotStore(root);
    const agent = new ChatAgent({ root, api, snapshots, maxSteps: 5 });
    const session = newSession("r1");

    await agent.send(session, "edit");
    await agent.undo(session);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("original");
    await agent.redo(session);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("changed");
  });
});

describe("project init", () => {
  it("generates an AGENTS.md summary", () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest" }, dependencies: { zod: "^3.0.0" } }),
      "utf8",
    );
    const md = generateAgentsMd(root);
    expect(md).toContain("# ");
    expect(md).toContain("npm run test");
    expect(md).toContain("zod");
  });
});
