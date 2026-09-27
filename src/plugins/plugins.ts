import { existsSync, readdirSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { configDir, readRawConfig } from "../config";

export interface ToolBeforeHookResult {
  args?: Record<string, unknown>;
  cancel?: string;
}

export interface ToolAfterHookResult {
  ok?: boolean;
  output?: string;
}

export interface PluginHooks {
  "chat.message"?: (text: string) => string | void | Promise<string | void>;
  "tool.before"?: (
    info: { name: string; args: Record<string, unknown> },
  ) => ToolBeforeHookResult | void | Promise<ToolBeforeHookResult | void>;
  "tool.after"?: (
    info: { name: string; args: Record<string, unknown>; ok: boolean; output: string },
  ) => ToolAfterHookResult | void | Promise<ToolAfterHookResult | void>;
}

export interface Plugin {
  name: string;
  hooks: PluginHooks;
}

const HOOK_KEYS = ["chat.message", "tool.before", "tool.after"] as const;

export class PluginRunner {
  readonly plugins: Plugin[];

  constructor(plugins: Plugin[] = []) {
    this.plugins = plugins;
  }

  async chatMessage(text: string): Promise<string> {
    let current = text;
    for (const plugin of this.plugins) {
      const handler = plugin.hooks["chat.message"];
      if (!handler) continue;
      const result = await handler(current);
      if (typeof result === "string") current = result;
    }
    return current;
  }

  async toolBefore(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ args: Record<string, unknown>; cancel?: string }> {
    let current = args;
    for (const plugin of this.plugins) {
      const handler = plugin.hooks["tool.before"];
      if (!handler) continue;
      const result = await handler({ name, args: current });
      if (result?.args) current = result.args;
      if (result?.cancel) return { args: current, cancel: result.cancel };
    }
    return { args: current };
  }

  async toolAfter(
    name: string,
    args: Record<string, unknown>,
    ok: boolean,
    output: string,
  ): Promise<{ ok: boolean; output: string }> {
    let current = { ok, output };
    for (const plugin of this.plugins) {
      const handler = plugin.hooks["tool.after"];
      if (!handler) continue;
      const result = await handler({ name, args, ok: current.ok, output: current.output });
      if (result) {
        if (typeof result.ok === "boolean") current.ok = result.ok;
        if (typeof result.output === "string") current.output = result.output;
      }
    }
    return current;
  }
}

function normalizeHooks(raw: unknown): PluginHooks {
  if (!raw || typeof raw !== "object") return {};
  const hooks: PluginHooks = {};
  const record = raw as Record<string, unknown>;
  const target = hooks as Record<string, unknown>;
  for (const key of HOOK_KEYS) {
    const value = record[key];
    if (typeof value === "function") target[key] = value;
  }
  // Named hook aliases (e.g. `export function toolBefore() {}`).
  const aliases: Record<string, (typeof HOOK_KEYS)[number]> = {
    chatMessage: "chat.message",
    toolBefore: "tool.before",
    toolAfter: "tool.after",
  };
  for (const [alias, key] of Object.entries(aliases)) {
    if (target[key] === undefined && typeof record[alias] === "function") target[key] = record[alias];
  }
  return hooks;
}

/**
 * Collect hooks from every supported plugin module shape:
 * - `export const hooks = {...}` (named hooks export)
 * - `export default { hooks: {...} }` (default object carrying hooks)
 * - `export default {...}` (default export IS the hooks object)
 * - hook keys / hook functions exported directly on the module namespace
 */
function extractHooks(module: Record<string, unknown>): PluginHooks {
  const merged: PluginHooks = {};
  const target = merged as Record<string, unknown>;
  const def = module.default;
  const candidates: unknown[] = [
    module.hooks,
    def && typeof def === "object" ? (def as Record<string, unknown>).hooks : undefined,
    def,
    module,
  ];
  for (const candidate of candidates) {
    const hooks = normalizeHooks(candidate);
    for (const key of HOOK_KEYS) {
      if (target[key] === undefined && (hooks as Record<string, unknown>)[key] !== undefined) {
        target[key] = (hooks as Record<string, unknown>)[key];
      }
    }
  }
  return merged;
}

export function pluginDirs(root: string): string[] {
  return [join(root, ".sunny", "plugin"), join(root, ".neutron", "plugin"), join(root, ".opencode", "plugin"), join(configDir(), "plugin")];
}

export async function loadPluginFile(path: string): Promise<Plugin | undefined> {
  try {
    const module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    const hooks = extractHooks(module);
    if (Object.keys(hooks).length === 0) return undefined;
    const name = basename(path, extname(path));
    return { name, hooks };
  } catch {
    return undefined;
  }
}

export async function loadPlugins(root: string, extraFiles: string[] = []): Promise<PluginRunner> {
  const files: string[] = [];
  for (const dir of pluginDirs(root)) {
    if (!existsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir)) {
        if (/\.(mjs|cjs|js)$/.test(file)) files.push(join(dir, file));
      }
    } catch {
      /* ignore */
    }
  }
  files.push(...extraFiles.filter((f) => existsSync(f)));

  const raw = readRawConfig();
  const configured = Array.isArray(raw.plugin) ? raw.plugin.filter((p): p is string => typeof p === "string") : [];
  for (const entry of configured) {
    const resolved = isAbsolute(entry) ? entry : join(root, entry);
    if (existsSync(resolved)) files.push(resolved);
  }

  const plugins: Plugin[] = [];
  // The same plugin file can be reachable from several dirs (plugin dirs,
  // --plugin flags, config entries). Dedupe by resolved path.
  const seen = new Set<string>();
  for (const file of files) {
    const resolved = resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const plugin = await loadPluginFile(file);
    if (plugin) plugins.push(plugin);
  }
  return new PluginRunner(plugins);
}
