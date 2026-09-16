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
