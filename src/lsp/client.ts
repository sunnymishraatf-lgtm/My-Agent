import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { globalConfigPath } from "../config";
import { readProjectFile } from "../files/project-files";

export interface LspServerConfig {
  command: string;
  args?: string[];
  extensions: string[];
  languageId?: string;
  initializationOptions?: Record<string, unknown>;
  enabled?: boolean;
}

export interface Diagnostic {
  file: string;
  line: number;
  character: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
}

interface LspMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".json": "json",
  ".md": "markdown",
  ".css": "css",
  ".html": "html",
};

const SEVERITY: Record<number, Diagnostic["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

function parseDiagnostics(file: string, params: unknown): Diagnostic[] {
  const raw = (params ?? {}) as { diagnostics?: Record<string, unknown>[] };
  return (raw.diagnostics ?? []).map((d) => {
    const range = (d.range ?? {}) as { start?: { line?: number; character?: number } };
    return {
      file,
      line: (range.start?.line ?? 0) + 1,
      character: (range.start?.character ?? 0) + 1,
      severity: SEVERITY[Number(d.severity)] ?? "info",
      message: String(d.message ?? ""),
      ...(typeof d.source === "string" ? { source: d.source } : {}),
    };
  });
}

export class LspClient {
  readonly name: string;
  private config: LspServerConfig;
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private diagnostics = new Map<string, Diagnostic[]>();
  private buffer = Buffer.alloc(0);
  private shutdownRequested = false;

  constructor(name: string, config: LspServerConfig) {
    this.name = name;
    this.config = config;
  }

  async start(root: string): Promise<void> {
    this.child = spawn(this.config.command, this.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    this.child.stdout.on("data", (d: Buffer) => this.onData(d));
    this.child.on("exit", () => {
      for (const { reject } of this.pending.values()) reject(new Error(`LSP server ${this.name} exited`));
      this.pending.clear();
    });
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      capabilities: {
        textDocument: { publishDiagnostics: { relatedInformation: false } },
      },
      initializationOptions: this.config.initializationOptions ?? {},
    });
    this.notify("initialized", {});
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.slice(start, start + length).toString("utf8");
      this.buffer = this.buffer.slice(start + length);
      let message: LspMessage;
      try {
        message = JSON.parse(body) as LspMessage;
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: LspMessage): void {
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: string; diagnostics?: unknown } | undefined;
      if (params?.uri) {
        const file = decodeURIComponent(params.uri.replace(/^file:\/\//, ""));
        this.diagnostics.set(file, parseDiagnostics(file, params));
      }
      return;
    }
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  }

  private send(message: LspMessage): void {
    if (!this.child) throw new Error("LSP server not started");
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request ${method} timed out`));
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

  async diagnose(root: string, relPath: string, waitMs = 1500): Promise<Diagnostic[]> {
    const text = readProjectFile(root, relPath);
    if (text === undefined) throw new Error(`Cannot read ${relPath}`);
    const uri = pathToFileURL(join(root, relPath)).href;
    const languageId = this.config.languageId ?? LANGUAGE_IDS[extname(relPath).toLowerCase()] ?? "plaintext";
    this.diagnostics.delete(decodeURIComponent(uri.replace(/^file:\/\//, "")));
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.notify("textDocument/didClose", { textDocument: { uri } });
    return this.diagnostics.get(decodeURIComponent(uri.replace(/^file:\/\//, ""))) ?? [];
  }

  async stop(): Promise<void> {
    if (this.shutdownRequested) return;
    this.shutdownRequested = true;
    try {
      await this.request("shutdown", null);
      this.notify("exit", null);
    } catch {
      /* ignore */
    }
    try {
      this.child?.kill();
    } catch {
      /* ignore */
    }
  }
}

export function readLspConfig(root: string): Record<string, LspServerConfig> {
  const servers: Record<string, LspServerConfig> = {};
  for (const path of [globalConfigPath(), join(root, ".sunny", "lsp.json")]) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { lsp?: Record<string, LspServerConfig> };
      for (const [name, cfg] of Object.entries(raw.lsp ?? {})) {
        if (cfg && typeof cfg.command === "string" && Array.isArray(cfg.extensions)) servers[name] = cfg;
      }
    } catch {
      /* ignore */
    }
  }
  return servers;
}

export function findServerFor(
  configs: Record<string, LspServerConfig>,
  file: string,
): { name: string; config: LspServerConfig } | undefined {
  const ext = extname(file).toLowerCase();
  for (const [name, config] of Object.entries(configs)) {
    if (config.extensions.map((e) => e.toLowerCase()).includes(ext)) return { name, config };
  }
  return undefined;
}

export async function diagnoseFile(root: string, relPath: string): Promise<{ diagnostics: Diagnostic[]; server: string }> {
  const configs = readLspConfig(root);
  const found = findServerFor(configs, relPath);
  if (!found) {
    throw new Error(
      `No LSP server configured for ${relPath}. Add one under "lsp" in the global config or .sunny/lsp.json.`,
    );
  }
  const client = new LspClient(found.name, found.config);
  await client.start(root);
  try {
    const diagnostics = await client.diagnose(root, relPath);
    return { diagnostics, server: found.name };
  } finally {
    await client.stop();
  }
}
