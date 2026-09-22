import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfigForSave, configCommand } from "../src/cli/config-command";
import { defaultConfig, readFileProviders, writeGlobalConfig } from "../src/config";

let dir: string;
const originalDir = process.env.NEUTRON_CONFIG_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "neutron-cfgcmd-"));
  process.env.NEUTRON_CONFIG_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalDir === undefined) delete process.env.NEUTRON_CONFIG_DIR;
  else process.env.NEUTRON_CONFIG_DIR = originalDir;
});

describe("config --add preserves omitted fields", () => {
  it("keeps the existing apiKey and models when they are not passed", async () => {
    writeGlobalConfig({
      version: 1,
      providers: [
        {
          id: "groq",
          baseUrl: "https://old.example/v1",
          apiKey: "sk-old",
          models: ["m1", "m2"],
          enabled: false,
        },
      ],
    });
    await configCommand({ add: "groq", baseUrl: "https://new.example/v1" });
    const providers = readFileProviders();
    expect(providers).toHaveLength(1);
    const p = providers[0]!;
    expect(p.baseUrl).toBe("https://new.example/v1");
    expect(p.apiKey).toBe("sk-old");
    expect(p.models).toEqual(["m1", "m2"]);
    expect(p.enabled).toBe(false);
  });

  it("overwrites fields that are explicitly provided", async () => {
    writeGlobalConfig({
      version: 1,
      providers: [
        { id: "groq", baseUrl: "https://old.example/v1", apiKey: "sk-old", models: ["m1"], enabled: true },
      ],
    });
    await configCommand({ add: "groq", baseUrl: "https://new.example/v1", apiKey: "sk-new", models: "m2, m3" });
    const p = readFileProviders()[0]!;
    expect(p.baseUrl).toBe("https://new.example/v1");
    expect(p.apiKey).toBe("sk-new");
    expect(p.models).toEqual(["m2", "m3"]);
  });

  it("adds a brand-new provider with empty key/models", async () => {
    writeGlobalConfig({ version: 1, providers: [] });
    await configCommand({ add: "newbie", baseUrl: "https://new.example/v1" });
    const p = readFileProviders()[0]!;
    expect(p.id).toBe("newbie");
    expect(p.apiKey).toBeUndefined();
    expect(p.models).toEqual([]);
  });
});

describe("buildConfigForSave merge order", () => {
  it("writes defaults first so persisted values overlay them", () => {
    const persistedApi = { ...defaultConfig().api, maxConcurrentRequests: 4 };
    writeGlobalConfig({ version: 1, api: persistedApi, providers: [] });
    const saved = buildConfigForSave([
      { id: "x", baseUrl: "https://x.example/v1", models: [], enabled: true },
    ]);
    const api = saved.api as typeof persistedApi;
    // The user's saved value survives (the old order clobbered it with the default 8).
    expect(api.maxConcurrentRequests).toBe(4);
    // Defaults still fill in the remaining keys.
    expect(api.maxRetries).toBe(defaultConfig().api.maxRetries);
    expect(saved.providers).toHaveLength(1);
  });
});
