import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionStore } from "../src/chat/session";
import { estimateTokens, sessionToMarkdown } from "../src/chat/transcript";
import { completionScript } from "../src/cli/utility-commands";
import { getPath, setPath, parseConfigValue } from "../src/cli/config-command";
import { expandAlias, loadAliases, removeAlias, setAlias } from "../src/cli/aliases";
import { loadPlugins } from "../src/plugins/plugins";

const here = dirname(fileURLToPath(import.meta.url));
const pluginPath = join(here, "fixtures", "test-plugin.mjs");

let root: string;
let prevConfigDir: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-g-"));
  prevConfigDir = process.env.NEUTRON_CONFIG_DIR;
  process.env.NEUTRON_CONFIG_DIR = join(root, "config");
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.NEUTRON_CONFIG_DIR;
  else process.env.NEUTRON_CONFIG_DIR = prevConfigDir;
  rmSync(root, { recursive: true, force: true });
});

describe("transcript", () => {
  it("estimates tokens and renders markdown", () => {
    const store = new SessionStore(root);
    const session = store.create("Demo");
    session.messages.push({ role: "user", content: "abcd" }, { role: "assistant", content: "efgh" });
    const estimate = estimateTokens(session);
    expect(estimate.messages).toBe(2);
    expect(estimate.tokens).toBe(2);
    const md = sessionToMarkdown(session);
    expect(md).toContain("# Demo");
    expect(md).toContain("**You**");
    expect(md).toContain("**NEUTRON**");
  });
});

describe("session prune", () => {
  it("keeps only the most recent sessions", () => {
    const store = new SessionStore(root);
    for (let i = 0; i < 5; i++) {
      const s = store.create(`s${i}`);
      s.updatedAt = new Date(Date.now() + i * 1000).toISOString();
      store.save(s);
    }
    expect(store.list()).toHaveLength(5);
    const removed = store.prune(2);
    expect(removed).toBe(3);
    expect(store.list()).toHaveLength(2);
  });
});

describe("shell completion", () => {
  it("includes commands for supported shells", () => {
    expect(completionScript("bash")).toContain("neutron");
    expect(completionScript("powershell")).toContain("Register-ArgumentCompleter");
    expect(completionScript("zsh")).toContain("compdef");
    expect(completionScript("fish")).toBe("");
  });
});

describe("config dotted keys", () => {
  it("parses values and reads/writes nested keys", () => {
    expect(parseConfigValue("true")).toBe(true);
    expect(parseConfigValue("42")).toBe(42);
    expect(parseConfigValue("ocean")).toBe("ocean");
    const obj: Record<string, unknown> = {};
    setPath(obj, "api.maxRetries", 5);
    setPath(obj, "theme", "ocean");
    expect(getPath(obj, "api.maxRetries")).toBe(5);
    expect(getPath(obj, "theme")).toBe("ocean");
    expect(getPath(obj, "missing.key")).toBeUndefined();
  });
});

describe("aliases", () => {
  it("expands leading command aliases", () => {
    expect(expandAlias(["chat", "--continue"], { s: "chat", t: "test --watch" })).toEqual(["chat", "--continue"]);
    expect(expandAlias(["t", "src"], { t: "test --watch" })).toEqual(["test", "--watch", "src"]);
    expect(expandAlias([], {})).toEqual([]);
  });

  it("persists aliases to config", () => {
    expect(setAlias("s", "chat")).toBe(true);
    expect(loadAliases().s).toBe("chat");
    expect(removeAlias("s")).toBe(true);
    expect(loadAliases().s).toBeUndefined();
  });
});

describe("plugins from global config", () => {
  it("loads plugins listed in the config", async () => {
    mkdirSync(process.env.NEUTRON_CONFIG_DIR!, { recursive: true });
    writeFileSync(
      join(process.env.NEUTRON_CONFIG_DIR!, "config.json"),
      JSON.stringify({ version: 1, plugin: [pluginPath] }),
      "utf8",
    );
    const runner = await loadPlugins(root);
    expect(runner.plugins.map((p) => p.name)).toContain("test-plugin");
  });
});
