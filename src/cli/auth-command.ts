import { createInterface } from "node:readline";
import {
  readGlobalProviders,
  findFileProvider,
  upsertProvider,
  removeProvider,
  freeProviders,
  knownBaseUrls,
} from "../config";
import type { ConfigProvider } from "../config";
import { configCommand, listProviders } from "./config-command";

export interface AuthLoginOptions {
  key?: string;
  baseUrl?: string;
  models?: string;
}

function ask(rl: import("node:readline").Interface, q: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(q, (ans) => resolve(ans.trim()));
  });
}

export function authList(): void {
  listProviders();
}

export function authLogout(id: string): void {
  if (!findFileProvider(id)) {
    console.log(`No stored credentials for "${id}".`);
    process.exitCode = 1;
    return;
  }
  removeProvider(id);
  console.log(`Removed credentials for ${id}.`);
}

export async function authLogin(provider: string | undefined, opts: AuthLoginOptions = {}): Promise<void> {
  if (!provider) {
    if (!process.stdin.isTTY) {
      console.log("Usage: neutron auth login <provider> --key <key> [--base-url <url>] [--models a,b]");
      console.log(`Known providers: ${freeProviders.map((p) => p.id).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    await configCommand();
    return;
  }

  const existing = findFileProvider(provider);
  const baseUrl = opts.baseUrl ?? knownBaseUrls[provider] ?? existing?.baseUrl;
  if (!baseUrl) {
    console.log(
      `Unknown provider "${provider}". Pass --base-url <url>, or use a known id: ${freeProviders.map((p) => p.id).join(", ")}.`,
    );
    process.exitCode = 1;
    return;
  }

  let key = opts.key;
  if (key === undefined && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    key = (await ask(rl, `API key for ${provider} (leave blank if none): `)).trim();
    rl.close();
  }

  const models = opts.models
    ? opts.models.split(",").map((m) => m.trim()).filter(Boolean)
    : existing?.models ?? [];
  const providerConfig: ConfigProvider = {
    id: provider,
    baseUrl,
    apiKey: key ?? existing?.apiKey,
    models,
    enabled: true,
  };

  if (!upsertProvider(providerConfig)) {
    console.log("Failed to write config.");
    process.exitCode = 1;
    return;
  }
  console.log(`Logged in ${provider} -> ${baseUrl} [${providerConfig.apiKey ? "key set" : "no key"}]`);
  console.log("Verify with `neutron doctor --chat`.");
}

export async function ensureProviderInteractive(): Promise<boolean> {
  if (readGlobalProviders().some((p) => p.enabled && p.baseUrl)) return true;
  if (!process.stdin.isTTY) return false;

  console.log("\nNo LLM provider configured yet.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await ask(rl, "Configure one now? [Y/n] ")).trim().toLowerCase();
  rl.close();
  if (answer === "n" || answer === "no") return false;

  await configCommand();
  return readGlobalProviders().some((p) => p.enabled && p.baseUrl);
}
