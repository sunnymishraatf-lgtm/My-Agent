import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globalConfigPath } from "../config";
import { fail, ok, type Tool, type ToolResult } from "../tools/types";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const CLIENT_INFO = { name: "sunny-agent", version: "0.1.0" };
const PROTOCOL_VERSION = "2024-11-05";

export class McpClient {
  readonly name: string;
  private config: McpServerConfig;
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private stderr = "";

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  async start(): Promise<void> {
    this.child = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    this.child.stdout.on("data", (d: Buffer) => this.onData(d.toString()));
    this.child.stderr.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    this.child.on("exit", () => {
      for (const { reject } of this.pending.values()) reject(new Error(`MCP server ${this.name} exited`));
      this.pending.clear();
    });

    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    this.notify("notifications/initialized", {});
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }
      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
      }
    }
  }

  private send(message: JsonRpcMessage): void {
    if (!this.child) throw new Error("MCP server not started");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.request("tools/list", {})) as { tools?: McpToolInfo[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("tools/call", { name, arguments: args })) as
      | { content?: { type: string; text?: string }[]; isError?: boolean }
      | undefined;
    const parts = (result?.content ?? [])
      .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
      .filter(Boolean);
    return parts.join("\n") || "(no output)";
  }

  stop(): void {
    try {
      this.child?.kill();
    } catch {
      /* ignore */
    }
  }
}

export function readMcpConfig(root: string): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};
  const paths = [globalConfigPath(), join(root, ".sunny", "mcp.json")];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { mcp?: Record<string, McpServerConfig> };
      const entries = raw.mcp && typeof raw.mcp === "object" ? raw.mcp : {};
      // Project config (later path) overrides global.
      for (const [name, cfg] of Object.entries(entries)) {
        if (cfg && typeof cfg.command === "string") servers[name] = cfg;
      }
    } catch {
      /* ignore */
    }
  }
  return servers;
}

function toTool(client: McpClient, serverName: string, info: McpToolInfo): Tool {
  const properties: Tool["parameters"] = {};
  const required = new Set(info.inputSchema?.required ?? []);
  for (const [key, schema] of Object.entries(info.inputSchema?.properties ?? {})) {
    const type = schema.type === "number" || schema.type === "boolean" ? schema.type : "string";
    properties[key] = {
      type,
      description: schema.description ?? key,
      ...(required.has(key) ? { required: true } : {}),
    };
  }
  const toolName = `${serverName}_${info.name}`.replace(/[^A-Za-z0-9_]/g, "_");
  return {
    name: toolName,
    description: `[MCP:${serverName}] ${info.description ?? info.name}`,
    parameters: properties,
    async execute(args): Promise<ToolResult> {
      try {
        const output = await client.callTool(info.name, args);
        return ok(output);
      } catch (err) {
        return fail(`MCP tool ${info.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

export interface McpConnection {
  clients: McpClient[];
  tools: Tool[];
  errors: string[];
}

export async function connectMcpServers(root: string): Promise<McpConnection> {
  const configs = readMcpConfig(root);
  const clients: McpClient[] = [];
  const tools: Tool[] = [];
  const errors: string[] = [];
  for (const [name, cfg] of Object.entries(configs)) {
    if (cfg.enabled === false) continue;
    const client = new McpClient(name, cfg);
    try {
      await client.start();
      const infos = await client.listTools();
      for (const info of infos) tools.push(toTool(client, name, info));
      clients.push(client);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      client.stop();
    }
  }
  return { clients, tools, errors };
}
