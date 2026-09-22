import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginRunner, loadPluginFile } from "../src/plugins/plugins";

const here = dirname(fileURLToPath(import.meta.url));
const pluginPath = join(here, "fixtures", "test-plugin.mjs");

describe("plugins", () => {
  it("loads hooks from a plugin file", async () => {
    const plugin = await loadPluginFile(pluginPath);
    expect(plugin?.name).toBe("test-plugin");
    expect(Object.keys(plugin?.hooks ?? {})).toEqual(["chat.message", "tool.before", "tool.after"]);
  });

  it("transforms chat messages", async () => {
    const runner = new PluginRunner([(await loadPluginFile(pluginPath))!]);
    expect(await runner.chatMessage("[enhance] question")).toBe("enhanced question");
  });

  it("rewrites tool arguments and outputs", async () => {
    const runner = new PluginRunner([(await loadPluginFile(pluginPath))!]);
    const before = await runner.toolBefore("bash", { command: "rm -rf /" });
    expect(before.args.command).toBe("echo patched");

    const after = await runner.toolAfter("read", {}, true, "file body");
    expect(after.output).toBe("file body\n[plugin]");
    expect(after.ok).toBe(true);
  });

  it("supports cancelling a tool call", async () => {
    const runner = new PluginRunner([
      { name: "veto", hooks: { "tool.before": () => ({ cancel: "blocked by plugin" }) } },
    ]);
    const result = await runner.toolBefore("write", { path: "a.txt", content: "x" });
    expect(result.cancel).toBe("blocked by plugin");
  });
});

describe("plugin module shapes", () => {
  it("loads hooks from `export default { hooks }`", async () => {
    const dir = join(here, "fixtures");
    const p = join(dir, "test-plugin-default-hooks.mjs");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      p,
      `export default { hooks: { "chat.message": (text) => text + "!" } };\n`,
      "utf8",
    );
    try {
      const plugin = await loadPluginFile(p);
      expect(Object.keys(plugin?.hooks ?? {})).toEqual(["chat.message"]);
      const runner = new PluginRunner([plugin!]);
      expect(await runner.chatMessage("hi")).toBe("hi!");
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(p, { force: true });
    }
  });

  it("loads hooks when the default export IS the hooks object", async () => {
    const { writeFileSync, rmSync } = await import("node:fs");
    const p = join(here, "fixtures", "test-plugin-default-direct.mjs");
    writeFileSync(p, `export default { "tool.after": () => ({ output: "patched" }) };\n`, "utf8");
    try {
      const plugin = await loadPluginFile(p);
      expect(Object.keys(plugin?.hooks ?? {})).toEqual(["tool.after"]);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("loads named hook function exports", async () => {
    const { writeFileSync, rmSync } = await import("node:fs");
    const p = join(here, "fixtures", "test-plugin-named.mjs");
    writeFileSync(p, `export function toolBefore() { return { cancel: "nope" }; }\n`, "utf8");
    try {
      const plugin = await loadPluginFile(p);
      expect(Object.keys(plugin?.hooks ?? {})).toEqual(["tool.before"]);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("dedupes the same plugin file listed twice", async () => {
    const { loadPlugins } = await import("../src/plugins/plugins");
    const runner = await loadPlugins(here, [pluginPath, pluginPath]);
    const names = runner.plugins.map((p) => p.name);
    expect(names.filter((n) => n === "test-plugin")).toHaveLength(1);
  });
});
