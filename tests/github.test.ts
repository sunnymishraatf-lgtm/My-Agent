import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatRequest, ChatResponse, Model } from "../src/types";
import type { LLMProvider, ChatStreamChunk } from "../src/providers/provider";
import { ProviderRegistry } from "../src/providers/registry";
import { ApiSystem } from "../src/api/api-manager";
import { installGitHubWorkflow, parseGitHubEvent, runGitHubAction } from "../src/github/actions";
import type { ResolvedConfig } from "../src/config";

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  async models(): Promise<Model[]> {
    return [{ id: "fake-model", name: "fake-model", contextWindow: 8000, free: true }];
  }
  async chat(request: ChatRequest): Promise<ChatResponse> {
    return { text: "Fixed the issue.", provider: this.name, model: request.model ?? "fake-model" };
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

function makeApi(): ApiSystem {
  const registry = new ProviderRegistry();
  registry.add("fake", new FakeProvider(), ["fake-model"]);
  registry.configure = () => {};
  return new ApiSystem({
    config: baseConfig,
    registry,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-gh-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("github actions", () => {
  it("installs a workflow file", () => {
    const result = installGitHubWorkflow(root);
    expect(result.created).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, "utf8")).toContain("neutron github run");
  });

  it("parses an issues event into a prompt", () => {
    const context = parseGitHubEvent("issues", {
      repository: { full_name: "acme/repo" },
      sender: { login: "octocat" },
      issue: { number: 7, title: "Bug", body: "It crashes" },
    });
    expect(context.repo).toBe("acme/repo");
    expect(context.issueNumber).toBe(7);
    expect(context.prompt).toContain("Bug");
    expect(context.prompt).toContain("It crashes");
  });

  it("runs the agent for an event without a token", async () => {
    const result = await runGitHubAction(root, {
      eventName: "issues",
      event: { repository: { full_name: "acme/repo" }, issue: { number: 1, title: "Fix", body: "please" } },
      api: makeApi(),
    });
    expect(result.text).toBe("Fixed the issue.");
    expect(result.commented).toBe(false);
  });
});
