import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  upsertProvider,
  removeProvider,
  setProviderEnabled,
  readGlobalProviders,
  findFileProvider,
  globalConfigPath,
} from "../src/config";
import { authLogin, authLogout } from "../src/cli/auth-command";

let dir: string;
let previous: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "neutron-config-"));
  previous = process.env.NEUTRON_CONFIG_DIR;
  process.env.NEUTRON_CONFIG_DIR = dir;
});

afterEach(() => {
  if (previous === undefined) delete process.env.NEUTRON_CONFIG_DIR;
  else process.env.NEUTRON_CONFIG_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

describe("provider config helpers", () => {
  it("adds, updates, toggles and removes a provider", () => {
    expect(upsertProvider({ id: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", models: ["m"], enabled: true })).toBe(true);

    let groq = readGlobalProviders().find((p) => p.id === "groq");
    expect(groq).toBeTruthy();
    expect(groq?.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(globalConfigPath()).toContain("config.json");

    upsertProvider({ id: "groq", baseUrl: "https://example.com/v1", apiKey: "k2", models: [], enabled: true });
    const updated = readGlobalProviders().filter((p) => p.id === "groq");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.baseUrl).toBe("https://example.com/v1");

    expect(setProviderEnabled("groq", false)).toBe(true);
    expect(readGlobalProviders().find((p) => p.id === "groq")?.enabled).toBe(false);

    expect(removeProvider("groq")).toBe(true);
    expect(readGlobalProviders().some((p) => p.id === "groq")).toBe(false);
  });

  it("authLogin uses known base URLs and authLogout removes them", async () => {
    await authLogin("groq", { key: "secret", models: "llama-3.3-70b-versatile" });
    const groq = findFileProvider("groq");
    expect(groq?.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(groq?.models).toEqual(["llama-3.3-70b-versatile"]);
    expect(groq?.apiKey).toBe("secret");

    authLogout("groq");
    expect(findFileProvider("groq")).toBeUndefined();
  });
});
