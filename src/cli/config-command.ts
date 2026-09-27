import { createInterface } from "node:readline";
import {
  globalConfigPath,
  loadConfig,
  readGlobalProviders,
  readFileProviders,
  writeGlobalConfig,
  readRawConfig,
  registerSecrets,
  redact,
  upsertProvider,
  removeProvider,
  setProviderEnabled,
  freeProviders,
  knownBaseUrls,
  defaultConfig,
} from "../config";
import type { ConfigProvider } from "../config";

export interface ConfigCommandOptions {
  list?: boolean;
  show?: boolean;
  get?: string;
  set?: string;
  add?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string;
  remove?: string;
  enable?: string;
  disable?: string;
}

export function parseConfigValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  return value;
}

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

function ask(rl: import("node:readline").Interface, q: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(q, (ans) => resolve(ans.trim()));
  });
}

export function listProviders(): void {
  const file = globalConfigPath();
  const providers = readGlobalProviders();
  console.log(`Config: ${file}`);
  if (providers.length === 0) {
    console.log("No providers configured.");
    console.log('Add one: neutron config --add groq --base-url https://api.groq.com/openai/v1 --api-key YOUR_KEY --models llama-3.3-70b-versatile');
    return;
  }
  for (const p of providers) {
    console.log(`  ${p.id}: ${p.baseUrl} (${p.enabled ? "enabled" : "disabled"}) [${p.apiKey ? "key set" : "no key"}]`);
  }
}

/**
 * Build the config document written after interactive configuration.
 * Merge order: defaults FIRST, then persisted/raw values overlay them, then
 * the freshly edited provider list. Reversing this clobbers saved user
 * values with defaults.
 */
export function buildConfigForSave(out: ConfigProvider[]): Record<string, unknown> {
  return { version: 1, ...defaultConfig(), ...readRawConfig(), providers: out };
}

export async function configCommand(opts?: ConfigCommandOptions): Promise<void> {
  opts = opts ?? {};

  if (opts.show) {
    const config = loadConfig();
    registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));
    console.log(`Config: ${globalConfigPath()}`);
    console.log(redact(JSON.stringify(config, null, 2)));
    return;
  }

  if (opts.get) {
    const raw = readRawConfig();
    const value = getPath(raw, opts.get);
    if (value === undefined) {
      console.error(`No config value at "${opts.get}".`);
      process.exitCode = 1;
      return;
    }
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    return;
  }

  if (opts.set) {
    const eq = opts.set.indexOf("=");
    if (eq < 0) {
      console.error("Use --set <key>=<value> (e.g. --set theme=ocean).");
      process.exitCode = 1;
      return;
    }
    const key = opts.set.slice(0, eq).trim();
    const rawValue = opts.set.slice(eq + 1);
    const raw = readRawConfig();
    setPath(raw, key, parseConfigValue(rawValue));
    if (!writeGlobalConfig({ version: 1, ...raw })) {
      console.error("Failed to write config.");
      process.exitCode = 1;
      return;
    }
    console.log(`Set ${key} = ${rawValue}`);
    return;
  }

  if (opts.remove) {
    const ok = removeProvider(opts.remove);
    console.log(ok ? `Removed provider ${opts.remove}.` : `Could not remove ${opts.remove}.`);
    return;
  }
  if (opts.enable) {
    const ok = setProviderEnabled(opts.enable, true);
    console.log(ok ? `Enabled provider ${opts.enable}.` : `Provider not found: ${opts.enable}.`);
    if (!ok) process.exitCode = 1;
    return;
  }
  if (opts.disable) {
    const ok = setProviderEnabled(opts.disable, false);
    console.log(ok ? `Disabled provider ${opts.disable}.` : `Provider not found: ${opts.disable}.`);
    if (!ok) process.exitCode = 1;
    return;
  }

  if (opts.add) {
    if (!opts.baseUrl) {
      console.log("--base-url is required when using --add.");
      process.exitCode = 1;
      return;
    }
    // Preserve fields the user did not pass: only explicitly provided flags
    // overwrite an existing provider entry.
    const existing = readFileProviders().find((p) => p.id === opts.add);
    const provider: ConfigProvider = {
      id: opts.add,
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey ?? existing?.apiKey,
      models: opts.models ? opts.models.split(",").map((m) => m.trim()).filter(Boolean) : (existing?.models ?? []),
      enabled: existing?.enabled ?? true,
    };
    const ok = upsertProvider(provider);
    if (!ok) {
      console.log("Failed to write config.");
      process.exitCode = 1;
      return;
    }
    console.log(`Saved provider ${opts.add} -> ${opts.baseUrl} [${opts.apiKey ? "key set" : "no key"}]`);
    console.log(`Config: ${globalConfigPath()}`);
    console.log("Verify with `neutron doctor --chat`.");
    return;
  }

  if (opts.list) {
    listProviders();
    return;
  }

  if (!process.stdin.isTTY) {
    listProviders();
    console.log("");
    console.log("Non-interactive mode: use `neutron config --add <id> --base-url <url> --api-key <key> [--models a,b]`.");
    return;
  }

  const file = globalConfigPath();
  const providers = readGlobalProviders();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nNEUTRON provider configuration (${file})\n`);
  console.log("Available providers:");

  const candidates = freeProviders.map((f) => ({
    id: f.id,
    baseUrl: knownBaseUrls[f.id] ?? `https://${f.id}.example.com/v1`,
  }));
  candidates.forEach((c, i) => console.log(`  ${i + 1}) ${c.id} — ${c.baseUrl}`));
  console.log(`  ${candidates.length + 1}) Custom OpenAI-compatible endpoint`);
  console.log(`  ${candidates.length + 2}) Done\n`);

  const out: ConfigProvider[] = [...providers];
  while (true) {
    const ans = await ask(rl, "Select a provider to configure (or 'q' to quit): ");
    const idx = Number(ans);
    if (ans.toLowerCase() === "q") break;
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length + 2) {
      console.log("Invalid selection.\n");
      continue;
    }
    if (idx === candidates.length + 2) break;
    if (idx === candidates.length + 1) {
      const id = await ask(rl, "  Provider id (e.g. my-gateway): ");
      const baseUrl = await ask(rl, "  Base URL (e.g. http://localhost:3001/v1): ");
      const apiKey = await ask(rl, "  API key (leave blank if none): ");
      out.push({ id, baseUrl, apiKey: apiKey || undefined, enabled: true, models: [] });
      console.log(`  Added ${id}\n`);
      continue;
    }
    const chosen = candidates[idx - 1]!;
    console.log(`\nConfiguring ${chosen.id}:`);
    const baseUrl = (await ask(rl, `  Base URL [${chosen.baseUrl}]: `)) || chosen.baseUrl;
    const apiKey = await ask(rl, "  API key (leave blank if none): ");
    const models = await ask(rl, "  Model names (comma-separated; optional): ");
    const existing = out.find((p) => p.id === chosen.id);
    if (existing) {
      existing.baseUrl = baseUrl;
      if (apiKey) existing.apiKey = apiKey;
      existing.enabled = true;
      if (models) existing.models = models.split(",").map((m) => m.trim()).filter(Boolean);
    } else {
      out.push({
        id: chosen.id,
        baseUrl,
        apiKey: apiKey || undefined,
        enabled: true,
        models: models ? models.split(",").map((m) => m.trim()).filter(Boolean) : [],
      });
    }
    console.log("  Saved.\n");
  }

  const saved = writeGlobalConfig(buildConfigForSave(out));
  rl.close();

  if (saved) {
    console.log(`\nSaved config to ${file}`);
    console.log("API keys are stored locally. `neutron doctor --chat` can verify connectivity.\n");
  } else {
    console.log("Failed to write config.");
  }
}
