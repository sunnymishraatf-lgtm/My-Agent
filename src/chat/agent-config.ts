import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../config";

export type AgentMode = "primary" | "subagent" | "all";
export type PermissionAction = "allow" | "ask" | "deny";

export interface AgentPermission {
  action: PermissionAction;
  patterns?: Record<string, PermissionAction>;
}

export interface AgentConfig {
  name: string;
  description: string;
  mode: AgentMode;
  prompt?: string;
  model?: string;
  temperature?: number;
  topP?: number;
  maxSteps?: number;
  hidden?: boolean;
  builtin?: boolean;
  permissions: Record<string, AgentPermission | PermissionAction>;
}

const SUBAGENT_DIRS = [".sunny/agent", ".neutron/agent", ".opencode/agent", ".agent/agent"];

export const BUILTIN_AGENTS: AgentConfig[] = [
  {
    name: "build",
    description: "Default agent with all tools enabled for development work.",
    mode: "primary",
    builtin: true,
    permissions: { "*": "allow" },
  },
  {
    name: "plan",
    description: "Read-only analysis and planning agent. Cannot edit files.",
    mode: "primary",
    builtin: true,
    permissions: { edit: "deny", write: "deny", bash: "ask", "*": "allow" },
  },
  {
    name: "general",
    description: "General-purpose subagent for multi-step research and tasks.",
    mode: "subagent",
    builtin: true,
    permissions: { "*": "allow" },
  },
  {
    name: "explore",
    description: "Fast read-only subagent for exploring codebases.",
    mode: "subagent",
    builtin: true,
    permissions: { read: "allow", list: "allow", glob: "allow", grep: "allow", "*": "deny" },
  },
];

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseScalar(value: string): unknown {
  const v = stripQuotes(value);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "") return "";
  if (!Number.isNaN(Number(v)) && v.trim() !== "") return Number(v);
  return v;
}

/**
 * Minimal YAML-ish frontmatter parser supporting nested maps one level deep:
 *   permission:
 *     edit: deny
 *     bash:
 *       "*": ask
 */
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const lines = match[1]!.split(/\r?\n/);
  const data: Record<string, unknown> = {};
  let currentKey: string | undefined;
  let currentNested: Record<string, unknown> | undefined;
  let nestedKey: string | undefined;

  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const key = stripQuotes(trimmed.slice(0, colon).trim());
    const rawValue = trimmed.slice(colon + 1);

    if (indent === 0) {
      currentKey = key;
      currentNested = undefined;
      nestedKey = undefined;
      if (rawValue.trim() === "") {
        currentNested = {};
        data[key] = currentNested;
      } else {
        data[key] = parseScalar(rawValue);
      }
    } else if (indent >= 2 && currentNested) {
      const parent = data[currentKey!];
      if (indent >= 4 && nestedKey && parent && typeof parent === "object") {
        const deep = (parent as Record<string, unknown>)[nestedKey];
        if (deep && typeof deep === "object") {
          (deep as Record<string, unknown>)[key] = parseScalar(rawValue);
          continue;
        }
      }
      if (rawValue.trim() === "") {
        nestedKey = key;
        (currentNested as Record<string, unknown>)[key] = {};
      } else {
        nestedKey = undefined;
        (currentNested as Record<string, unknown>)[key] = parseScalar(rawValue);
      }
    }
  }
  return { data, body: text.slice(match[0].length) };
}

function toPermissions(raw: unknown): Record<string, AgentPermission | PermissionAction> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, AgentPermission | PermissionAction> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === "allow" || value === "ask" || value === "deny") {
      out[key] = value;
    } else if (value && typeof value === "object") {
      const patterns: Record<string, PermissionAction> = {};
      for (const [p, action] of Object.entries(value as Record<string, unknown>)) {
        if (action === "allow" || action === "ask" || action === "deny") patterns[p] = action;
      }
      out[key] = { action: "ask", patterns };
    }
  }
  return out;
}

export function parseAgentMarkdown(name: string, text: string): AgentConfig {
  const { data, body } = parseFrontmatter(text);
  const mode = data.mode === "primary" || data.mode === "subagent" || data.mode === "all" ? data.mode : "all";
  const agent: AgentConfig = {
    name,
    description: typeof data.description === "string" && data.description ? data.description : name,
    mode,
    prompt: body.trim() || undefined,
    permissions: toPermissions(data.permission),
  };
  if (typeof data.model === "string") agent.model = data.model;
  if (typeof data.temperature === "number") agent.temperature = data.temperature;
  if (typeof data.top_p === "number") agent.topP = data.top_p;
  if (typeof data.steps === "number") agent.maxSteps = data.steps;
  if (typeof data.maxSteps === "number") agent.maxSteps = data.maxSteps;
  if (data.hidden === true) agent.hidden = true;
  if (data.tools && typeof data.tools === "object") {
    const perms: Record<string, PermissionAction> = { ...(agent.permissions as Record<string, PermissionAction>) };
    for (const [tool, enabled] of Object.entries(data.tools as Record<string, unknown>)) {
      perms[tool] = enabled === false ? "deny" : "allow";
    }
    agent.permissions = perms;
  }
  return agent;
}

export function loadAgents(root: string): AgentConfig[] {
  const byName = new Map<string, AgentConfig>();
  for (const builtin of BUILTIN_AGENTS) byName.set(builtin.name, builtin);

  const dirs = SUBAGENT_DIRS.map((d) => join(root, d));
  const globalDir = join(configDir(), "agent");
  if (existsSync(globalDir)) dirs.push(globalDir);

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      let text: string;
      try {
        text = readFileSync(join(dir, file), "utf8");
      } catch {
        continue;
      }
      const agent = parseAgentMarkdown(file.slice(0, -3), text);
      byName.set(agent.name, agent);
    }
  }
  return [...byName.values()];
}

export function findAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
  return agents.find((a) => a.name === name);
}

export function agentDirs(root: string): string[] {
  return [...SUBAGENT_DIRS.map((d) => join(root, d)), join(configDir(), "agent")];
}

export function findAgentFile(root: string, name: string): string | undefined {
  for (const dir of agentDirs(root)) {
    const path = join(dir, `${name}.md`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function deleteAgentFile(root: string, name: string): boolean {
  const path = findAgentFile(root, name);
  if (!path) return false;
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

export function primaryAgents(agents: AgentConfig[]): AgentConfig[] {
  return agents.filter((a) => a.mode === "primary" || a.mode === "all");
}

export function subagents(agents: AgentConfig[]): AgentConfig[] {
  return agents.filter((a) => a.mode === "subagent" || a.mode === "all");
}

export function isToolAllowed(agent: AgentConfig, tool: string): boolean {
  return permissionFor(agent, tool) !== "deny";
}

/** Resolve the permission action for a tool, checking exact, wildcard and pattern rules. */
export function permissionFor(agent: AgentConfig, tool: string, argText = ""): PermissionAction {
  const perms = agent.permissions;
  const exact = perms[tool];
  const wildcard = perms["*"];
  const resolve = (value: AgentPermission | PermissionAction | undefined): PermissionAction | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === "string") return value;
    if (value.patterns && Object.keys(value.patterns).length > 0) {
      let result: PermissionAction | undefined = value.action;
      for (const [pattern, action] of Object.entries(value.patterns)) {
        if (pattern === "*" || globMatch(pattern, argText)) result = action;
      }
      return result;
    }
    return value.action;
  };
  const specific = resolve(exact);
  if (specific !== undefined) return specific;
  const general = resolve(wildcard);
  return general ?? "allow";
}

function globMatch(pattern: string, text: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    // Full-string match only: a bare prefix match would fail open and grant
    // permissions the pattern never intended (e.g. "read" matching "read-secret").
    return new RegExp(`^${escaped}$`).test(text);
  } catch {
    return false;
  }
}
