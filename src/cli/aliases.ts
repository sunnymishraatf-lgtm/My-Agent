import { readRawConfig, writeGlobalConfig } from "../config";

export type AliasMap = Record<string, string>;

export function loadAliases(): AliasMap {
  const raw = readRawConfig();
  const aliases = raw.alias;
  if (!aliases || typeof aliases !== "object") return {};
  const out: AliasMap = {};
  for (const [name, value] of Object.entries(aliases as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[name] = value.trim();
  }
  return out;
}

/** Expand a leading command alias in argv. Returns the (possibly rewritten) argv. */
export function expandAlias(argv: string[], aliases = loadAliases()): string[] {
  if (argv.length === 0) return argv;
  const first = argv[0]!;
  const expansion = aliases[first];
  if (!expansion) return argv;
  const extra = expansion.split(/\s+/).filter(Boolean);
  return [...extra, ...argv.slice(1)];
}

export function setAlias(name: string, command: string): boolean {
  const raw = readRawConfig();
  const aliases = (raw.alias && typeof raw.alias === "object" ? raw.alias : {}) as Record<string, string>;
  aliases[name] = command;
  return writeGlobalConfig({ version: 1, ...raw, alias: aliases });
}

export function removeAlias(name: string): boolean {
  const raw = readRawConfig();
  const aliases = (raw.alias && typeof raw.alias === "object" ? raw.alias : {}) as Record<string, string>;
  delete aliases[name];
  return writeGlobalConfig({ version: 1, ...raw, alias: aliases });
}
