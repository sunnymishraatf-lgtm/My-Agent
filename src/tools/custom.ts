import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globalConfigPath } from "../config";
import { fail, ok, type Tool, type ToolParameter } from "./types";
import { preferExisting, projectDirs } from "../compat";

export interface CustomToolDef {
  description?: string;
  command: string;
  parameters?: Record<string, ToolParameter>;
}

function normalizeDef(raw: unknown): CustomToolDef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const def = raw as Record<string, unknown>;
  if (typeof def.command !== "string") return undefined;
  const parameters: Record<string, ToolParameter> = {};
  if (def.parameters && typeof def.parameters === "object") {
    for (const [key, value] of Object.entries(def.parameters as Record<string, unknown>)) {
      const param = (value ?? {}) as Record<string, unknown>;
      const type = param.type === "number" || param.type === "boolean" ? param.type : "string";
      parameters[key] = {
        type,
        description: typeof param.description === "string" ? param.description : key,
        ...(param.required === true ? { required: true } : {}),
      };
    }
  }
  return {
    description: typeof def.description === "string" ? def.description : undefined,
    command: def.command,
    parameters,
  };
}

/** Quote a value so it is safe to interpolate into a shell command. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function substitute(command: string, args: Record<string, unknown>): string {
  return command.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    const value = args[key];
    if (value === undefined || value === null) return match;
    return shellQuote(String(value));
  });
}

function toTool(name: string, def: CustomToolDef): Tool {
  return {
    name,
    description: def.description ?? `Custom tool ${name}`,
    parameters: def.parameters ?? {},
    async execute(args, ctx) {
      const missing = Object.entries(def.parameters ?? {})
        .filter(([, p]) => p.required === true)
        .map(([name]) => name)
        .filter((name) => args[name] === undefined || args[name] === null || args[name] === "");
      if (missing.length > 0) {
        return fail(`Missing required parameter(s): ${missing.join(", ")}`);
      }
      const command = substitute(def.command, args);
      const res = await ctx.run(command);
      const parts = [`exit code: ${res.exitCode}`, res.stdout.trimEnd()];
      if (res.stderr.trim()) parts.push(`[stderr]\n${res.stderr.trimEnd()}`);
      return res.status === "ok" ? ok(parts.filter(Boolean).join("\n")) : fail(parts.filter(Boolean).join("\n"));
    },
  };
}

export function loadCustomTools(root: string): Tool[] {
  const byName = new Map<string, CustomToolDef>();

  const file = globalConfigPath();
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { tool?: Record<string, unknown> };
      for (const [name, value] of Object.entries(raw.tool ?? {})) {
        const def = normalizeDef(value);
        if (def) byName.set(name, def);
      }
    } catch {
      /* ignore */
    }
  }

  const dir = preferExisting(projectDirs(root, "tool"));
  if (existsSync(dir)) {
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      files = [];
    }
    for (const entry of files) {
      if (!entry.endsWith(".json")) continue;
      try {
        const def = normalizeDef(JSON.parse(readFileSync(join(dir, entry), "utf8")));
        if (def) byName.set(entry.slice(0, -5), def);
      } catch {
        /* ignore */
      }
    }
  }

  return [...byName.entries()].map(([name, def]) => toTool(name, def));
}
