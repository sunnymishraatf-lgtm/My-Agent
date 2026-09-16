import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { ApiSystem } from "../src/api/api-manager";
import { loadConfig, type ProviderResolved } from "../src/config";

function startServer(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, body: string) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => handler(req, res, body));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

const servers: Server[] = [];

afterAll(() => {
  for (const s of servers) s.close();
});

function chatResponse(model: string): string {
  return JSON.stringify({
    choices: [{ message: { content: "hello world" } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

function modelsResponse(): string {
  return JSON.stringify({ data: [{ id: "discovered-model" }] });
}

function serveChatAndModels(res: import("node:http").ServerResponse, url: string | undefined): void {
  if (url?.includes("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(modelsResponse());
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(chatResponse("discovered-model"));
  }
}

describe("ApiSystem failover", () => {
  it("fails over from a broken provider to a working one", async () => {
    const bad = await startServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "boom" }));
    });
    const good = await startServer((_req, res) => {
      serveChatAndModels(res, _req.url);
    });
    servers.push(bad.server, good.server);

    const providers: ProviderResolved[] = [
      { id: "bad", baseUrl: `http://127.0.0.1:${bad.port}/v1`, apiKey: "k", models: [], enabled: true },
      { id: "good", baseUrl: `http://127.0.0.1:${good.port}/v1`, apiKey: "k", models: [], enabled: true },
    ];
    const cfg = loadConfig({
      providers,
      raw: { api: { maxRetries: 0, backoffBaseMs: 100, timeoutMs: 5_000 } },
    });
    const api = new ApiSystem({ config: cfg });

    const res = await api.chat("general", [{ role: "user", content: "hi" }]);
    expect(res.text).toBe("hello world");
    expect(res.provider).toBe("good");
    expect(res.model).toBe("discovered-model");
    expect(api.stats.failovers).toBeGreaterThan(0);
  });

  it("puts a provider on cooldown after a 429 and skips it", async () => {
    let badHits = 0;
    const rateLimited = await startServer((_req, res) => {
      badHits++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate limited" }));
    });
    const good = await startServer((_req, res) => {
      serveChatAndModels(res, _req.url);
    });
    servers.push(rateLimited.server, good.server);

    const providers: ProviderResolved[] = [
      { id: "rate-limited", baseUrl: `http://127.0.0.1:${rateLimited.port}/v1`, apiKey: "k", models: [], enabled: true },
      { id: "good", baseUrl: `http://127.0.0.1:${good.port}/v1`, apiKey: "k", models: [], enabled: true },
    ];
    const cfg = loadConfig({
      providers,
      raw: { api: { maxRetries: 0, backoffBaseMs: 100, providerCooldownMs: 60_000, timeoutMs: 5_000 } },
    });
    const api = new ApiSystem({ config: cfg });

    const first = await api.chat("general", [{ role: "user", content: "hi" }]);
    expect(first.provider).toBe("good");
    const firstHits = badHits;

    const second = await api.chat("general", [{ role: "user", content: "hi again" }]);
    expect(second.provider).toBe("good");
    expect(badHits).toBe(firstHits);
  });

  it("uses the provider's first configured model when no hint is given", async () => {
    let seenModel = "";
    const srv = await startServer((_req, res, body) => {
      const parsed = JSON.parse(body) as { model?: string };
      seenModel = parsed.model ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(chatResponse("any"));
    });
    servers.push(srv.server);

    const providers: ProviderResolved[] = [
      { id: "p", baseUrl: `http://127.0.0.1:${srv.port}/v1`, apiKey: "k", models: ["llama-3.3-70b"], enabled: true },
    ];
    const cfg = loadConfig({ providers, raw: { api: { maxRetries: 0, backoffBaseMs: 100 } } });
    const api = new ApiSystem({ config: cfg });
    const res = await api.chat("frontend", [{ role: "user", content: "hi" }]);
    expect(res.model).toBe("llama-3.3-70b");
    expect(seenModel).toBe("llama-3.3-70b");
  });

  it("throws a helpful error when no providers are configured", async () => {
    const cfg = loadConfig({ providers: [], raw: {} });
    const api = new ApiSystem({ config: cfg });
    await expect(api.chat("general", [{ role: "user", content: "hi" }])).rejects.toThrow(/No LLM provider configured/u);
  });
});