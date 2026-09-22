import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
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

const CLIENT_INFO = { name: "neutron-agent", version: "0.1.0" };
const PROTOCOL_VERSION = "2024-11-05";

/** JSON-RPC method-not-found error code. */
export const METHOD_NOT_FOUND = -32601;

/**
 * Factory used to spawn the server child process. Defaults to `spawn` from
 * `node:child_process`; injectable so tests can supply a fake child process
 * instead of a real subprocess.
 */
export type SpawnFn = typeof spawn;

export class McpClient {
  readonly name: string;
  private config: McpServerConfig;
  private spawnFn: SpawnFn;
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private stderr = "";
  private decoder = new StringDecoder("utf8");
  private startPromise?: Promise<void>;

  constructor(name: string, config: McpServerConfig, spawnFn: SpawnFn = spawn) {
    this.name = name;
    this.config = config;
    this.spawnFn = spawnFn;
  }

  /** Idempotent: concurrent or repeated calls share a single child process. */
  async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.doStart().catch((err) => {
        // Allow a retry after a failed start.
        this.startPromise = undefined;
        throw err;
      });
    }
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    this.child = this.spawnFn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    // StringDecoder keeps multi-byte UTF-8 sequences that are split across
    // chunk boundaries intact.
    this.child.stdout.on("data", (d: Buffer) => this.onData(this.decoder.write(d)));
    this.child.stdout.on("end", () => {
      const tail = this.decoder.end();
      if (tail) this.onData(tail);
    });
    this.child.stderr.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    this.child.on("exit", () => {
      this.failPending(new Error(`MCP server ${this.name} exited`));
    });
    // A spawn failure surfaces as an "error" event on the child. Handle it so
    // it rejects pending requests instead of crashing the Node process with
    // an unhandled "error" event.
    this.child.on("error", (err: Error) => {
      this.failPending(new Error(`MCP server ${this.name} failed: ${err.message}`));
    });

    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    this.notify("notifications/initialized", {});
  }

  private failPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
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
        continue;
      }
      // Server-initiated request or notification. Notifications (no id) are
      // dropped; requests get a JSON-RPC response so the server never hangs.
      if (message.method !== undefined) {
        if (typeof message.id === "number") {
          this.send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: METHOD_NOT_FOUND, message: `Method not found: ${message.method}` },
          });
        }
        continue;
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
    const output = parts.join("\n") || "(no output)";
    if (result?.isError) throw new Error(`MCP tool ${name} failed: ${output}`);
    return output;
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
  // Later paths override earlier ones: global < legacy .sunny < .neutron.
  const paths = [globalConfigPath(), join(root, ".sunny", "mcp.json"), join(root, ".neutron", "mcp.json")];
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
