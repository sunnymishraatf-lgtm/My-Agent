import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatRequest, ChatResponse, Model } from "../src/types";
import type { LLMProvider, ChatStreamChunk } from "../src/providers/provider";
import { ProviderRegistry } from "../src/providers/registry";
import { ApiSystem } from "../src/api/api-manager";
import { ChatAgent, type ChatEvent } from "../src/chat/agent";
import { type ChatSession } from "../src/chat/session";
import { shareSession } from "../src/chat/share";
import { startServer } from "../src/server/server";
import { NeutronClient } from "../src/sdk/client";
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

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-features-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("compaction", () => {
  it("summarizes older messages and keeps the recent ones", async () => {
    const provider = new FakeProvider(["SUMMARY"]);
    const api = makeApi(provider);
    const events: ChatEvent[] = [];
    const agent = new ChatAgent({ root, api, onEvent: (e) => events.push(e) });
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: "c1",
      title: "t",
      createdAt: now,
      updatedAt: now,
      messages: Array.from({ length: 9 }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `message ${i}`,
      })),
    };

    const changed = await agent.compact(session, true);
    expect(changed).toBe(true);
    expect(session.messages).toHaveLength(4);
    expect(session.messages[0]!.content).toContain("SUMMARY");
    expect(session.messages[0]!.content).toContain("6 earlier");
    expect(events.some((e) => e.type === "compaction")).toBe(true);
  });

  it("is a no-op for short sessions", async () => {
    const api = makeApi(new FakeProvider([]));
    const agent = new ChatAgent({ root, api });
    const now = new Date().toISOString();
    const session: ChatSession = { id: "c2", title: "t", createdAt: now, updatedAt: now, messages: [{ role: "user", content: "hi" }] };
    expect(await agent.compact(session, false)).toBe(false);
  });
});

describe("sharing", () => {
  it("writes the session to .agent/shares", () => {
    const now = new Date().toISOString();
    const session: ChatSession = { id: "share-1", title: "t", createdAt: now, updatedAt: now, messages: [{ role: "user", content: "hi" }] };
    const { file } = shareSession(root, session);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).id).toBe("share-1");
  });
});

describe("http server", () => {
  it("serves health, agents and 404s", async () => {
    const running = await startServer({ root, port: 0, host: "127.0.0.1" });
    try {
      const health = await fetch(`http://127.0.0.1:${running.port}/health`);
      expect(health.status).toBe(200);
      const body = (await health.json()) as { ok: boolean; agents: string[] };
      expect(body.ok).toBe(true);
      expect(body.agents).toContain("build");

      const agents = await fetch(`http://127.0.0.1:${running.port}/v1/agents`);
      expect(agents.status).toBe(200);

      const missing = await fetch(`http://127.0.0.1:${running.port}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await running.close();
    }
  });

  it("serves the web UI and exposes a reusable SDK client", async () => {
    const running = await startServer({ root, port: 0, host: "127.0.0.1", web: true });
    try {
      const page = await fetch(`http://127.0.0.1:${running.port}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(await page.text()).toContain("<title>NEUTRON — Autonomous Software Maintenance Intelligence</title>");

      const client = new NeutronClient({ baseUrl: `http://127.0.0.1:${running.port}` });
      const health = await client.health();
      expect(health.ok).toBe(true);
      expect(health.agents).toContain("build");
      const agents = await client.agents();
      expect(agents.map((a) => a.name)).toContain("plan");
    } finally {
      await running.close();
    }
  });

  it("enforces basic auth when a password is set", async () => {
    const running = await startServer({ root, port: 0, host: "127.0.0.1", password: "secret" });
    try {
      const denied = await fetch(`http://127.0.0.1:${running.port}/health`);
      expect(denied.status).toBe(401);
      const auth = Buffer.from("neutron:secret").toString("base64");
      const allowed = await fetch(`http://127.0.0.1:${running.port}/health`, {
        headers: { authorization: `Basic ${auth}` },
      });
      expect(allowed.status).toBe(200);
    } finally {
      await running.close();
    }
  });
});
