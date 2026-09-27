import { fail, ok, stringArg, type Tool, type ToolResult } from "./types";
import type { TodoStore } from "./todos";
import { findSkill, loadSkills } from "../chat/skills";
import { diagnoseFile } from "../lsp/client";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_FETCH_BYTES = 500_000;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20_000;

/**
 * True when an IP address targets a non-public host. Used as SSRF protection:
 * the fetcher refuses to connect to loopback, private, link-local and other
 * non-routable addresses.
 */
export function isBlockedAddress(ip: string): boolean {
  if (!isIP(ip)) return true;
  const v = ip.toLowerCase();
  const m4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const a = Number(m4[1]);
    const b = Number(m4[2]);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // fc00::/7 unique local
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true; // fe80::/10 link-local
  if (v.startsWith("::ffff:")) return isBlockedAddress(v.slice("::ffff:".length)); // IPv4-mapped
  return false;
}

/** Resolve the URL's host and refuse non-public destinations. Returns an error message or undefined. */
async function checkUrlTarget(url: URL): Promise<string | undefined> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http(s) URLs are supported";
  const host = url.hostname;
  try {
    if (isIP(host)) {
      if (isBlockedAddress(host)) return `Blocked: ${host} is not a public address`;
    } else {
      const addrs = await lookup(host, { all: true });
      if (addrs.length === 0) return `Could not resolve host: ${host}`;
      for (const a of addrs) {
        if (isBlockedAddress(a.address)) return `Blocked: ${host} resolves to non-public address ${a.address}`;
      }
    }
  } catch (err) {
    return `Could not resolve host ${host}: ${err instanceof Error ? err.message : String(err)}`;
  }
  return undefined;
}

/** Read a response body stream, aborting once maxBytes is exceeded. */
async function readBodyWithLimit(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface FetchResult {
  status: number;
  href: string;
  contentType: string;
  text: string;
}

/**
 * Fetch with manual redirect handling: each hop is re-validated against the
 * SSRF blocklist (a redirect to an internal address is refused), and the body
 * is streamed with a hard byte limit instead of being buffered unboundedly.
 */
async function fetchTextWithRedirects(start: URL, maxBytes: number): Promise<FetchResult> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = await checkUrlTarget(url);
    if (blocked) throw new Error(blocked);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": "neutron-agent/0.1" },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        url = new URL(location, url);
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const text = await readBodyWithLimit(res, maxBytes);
      return { status: res.status, href: url.href, contentType, text };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Blocked:")) throw err;
      throw new Error(
        err instanceof Error && err.name === "AbortError" ? `Request timed out after ${FETCH_TIMEOUT_MS}ms` : err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webfetchTool: Tool = {
  name: "webfetch",
  description: "Fetch a URL and return its text content (HTML is converted to plain text).",
  parameters: {
    url: { type: "string", description: "Absolute http(s) URL to fetch", required: true },
    maxBytes: { type: "number", description: "Maximum bytes to read (default 500000)" },
  },
  async execute(args): Promise<ToolResult> {
    const url = stringArg(args, "url");
    if (!url) return fail("Missing required argument: url");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fail("Only http(s) URLs are supported");
    }
    const maxBytes = Math.min(5_000_000, Math.max(1000, Math.floor(Number(args.maxBytes) || MAX_FETCH_BYTES)));
    try {
      const { status, href, contentType, text } = await fetchTextWithRedirects(parsed, maxBytes);
      const out = /html/i.test(contentType) ? stripHtml(text) : text;
      return ok(`HTTP ${status} ${href}\n\n${out.slice(0, 100_000)}`);
    } catch (err) {
      return fail(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export const skillTool: Tool = {
  name: "skill",
  description: "Load a named skill's instructions from .neutron/skills (or .claude/skills).",
  parameters: {
    name: { type: "string", description: "Skill name, or 'list' to see available skills", required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const name = stringArg(args, "name");
    if (!name) return fail("Missing required argument: name");
    if (name === "list") {
      const skills = loadSkills(ctx.root);
      if (skills.length === 0) return ok("No skills found. Add SKILL.md files under .neutron/skills/.");
      return ok(skills.map((s) => `- ${s.name}: ${s.description}`).join("\n"));
    }
    const skill = findSkill(ctx.root, name);
    if (!skill) return fail(`Unknown skill: ${name}. Use the skill tool with name="list".`);
    return ok(`# Skill: ${skill.name}\n\n${skill.body}`);
  },
};

export const lspTool: Tool = {
  name: "lsp",
  description: "Run the configured language server for a file and return its diagnostics (errors and warnings).",
  parameters: {
    path: { type: "string", description: "File path relative to the workspace root", required: true },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const path = stringArg(args, "path");
    if (!path) return fail("Missing required argument: path");
    try {
      const { diagnostics, server } = await diagnoseFile(ctx.root, path);
      if (diagnostics.length === 0) return ok(`No diagnostics for ${path} (server: ${server}).`);
      const lines = diagnostics.map(
        (d) => `${d.file}:${d.line}:${d.character} ${d.severity}: ${d.message}${d.source ? ` (${d.source})` : ""}`,
      );
      return ok(`${diagnostics.length} diagnostic(s) for ${path} (server: ${server}):\n${lines.join("\n")}`);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
};

export interface TaskRequest {
  description: string;
  prompt: string;
  subagent_type?: string;
}

export type TaskSpawner = (request: TaskRequest) => Promise<{ ok: boolean; output: string }>;

export function createTaskTool(spawn: TaskSpawner, agentNames: string[]): Tool {
  return {
    name: "task",
    description:
      "Delegate a self-contained task to a subagent and return its result. Use for broad codebase exploration or research.",
    parameters: {
      description: { type: "string", description: "Short 3-5 word description of the task", required: true },
      prompt: { type: "string", description: "Full instructions for the subagent", required: true },
      subagent_type: {
        type: "string",
        description: `Subagent to use: ${agentNames.join(", ") || "general"}`,
      },
    },
    async execute(args): Promise<ToolResult> {
      const prompt = stringArg(args, "prompt");
      if (!prompt) return fail("Missing required argument: prompt");
      const description = stringArg(args, "description") ?? prompt.slice(0, 40);
      const subagent_type = stringArg(args, "subagent_type");
      const result = await spawn({
        description,
        prompt,
        ...(subagent_type ? { subagent_type } : {}),
      });
      return result.ok ? ok(result.output) : fail(result.output);
    },
  };
}

export function createTodoTools(store: TodoStore): Tool[] {
  const todowrite: Tool = {
    name: "todowrite",
    description: "Create or update the task list for the current session.",
    parameters: {
      todos: { type: "string", description: "JSON array of {content, status, priority} objects", required: true },
    },
    async execute(args): Promise<ToolResult> {
      let parsed: unknown = args.todos;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          return fail("todos must be a JSON array");
        }
      }
      try {
        store.write(parsed);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      return ok(store.format());
    },
  };
  const todoread: Tool = {
    name: "todoread",
    description: "Read the current task list.",
    parameters: {},
    async execute(): Promise<ToolResult> {
      return ok(store.format());
    },
  };
  return [todowrite, todoread];
}
