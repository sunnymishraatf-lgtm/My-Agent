import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ToolContext } from "../src/tools/types";
import type { ActionResult } from "../src/types";
import { connectMcpServers, readMcpConfig, McpClient, METHOD_NOT_FOUND, type SpawnFn } from "../src/mcp/client";
import { loadCustomTools } from "../src/tools/custom";

const FAKE_SERVER = `
process.stdin.setEncoding("utf8");
let buf = "";
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      respond(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } });
    } else if (msg.method === "tools/list") {
      respond(msg.id, { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string", description: "text" } }, required: ["text"] } }] });
    } else if (msg.method === "tools/call") {
      respond(msg.id, { content: [{ type: "text", text: "echo:" + msg.params.arguments.text }] });
    } else if (msg.id !== undefined) {
      respond(msg.id, {});
    }
  }
});
`;

let root: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-mcp-"));
  previousConfigDir = process.env.NEUTRON_CONFIG_DIR;
  process.env.NEUTRON_CONFIG_DIR = join(root, "cfg");
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.NEUTRON_CONFIG_DIR;
  else process.env.NEUTRON_CONFIG_DIR = previousConfigDir;
  rmSync(root, { recursive: true, force: true });
});

function ctx(run: (cmd: string) => Promise<ActionResult>): ToolContext {
  return { root, run };
}

const noRun = async (): Promise<ActionResult> => ({
  status: "ok",
  stdout: "",
  stderr: "",
  exitCode: 0,
  durationMs: 0,
  timedOut: false,
});

describe("mcp", () => {
  it("connects to a stdio server and calls its tools", async () => {
    const server = join(root, "server.mjs");
    writeFileSync(server, FAKE_SERVER, "utf8");
    mkdirSync(join(root, ".neutron"), { recursive: true });
    writeFileSync(
      join(root, ".neutron", "mcp.json"),
      JSON.stringify({ mcp: { fake: { command: process.execPath, args: [server] } } }),
      "utf8",
    );

    expect(Object.keys(readMcpConfig(root))).toEqual(["fake"]);
    const connection = await connectMcpServers(root);
    try {
      expect(connection.errors).toEqual([]);
      expect(connection.tools).toHaveLength(1);
      expect(connection.tools[0]!.name).toBe("fake_echo");
      const result = await connection.tools[0]!.execute({ text: "hi" }, ctx(noRun));
      expect(result.ok).toBe(true);
      expect(result.output).toBe("echo:hi");
    } finally {
      connection.clients.forEach((c) => c.stop());
    }
  });
});

describe("custom tools", () => {
  it("loads JSON tool definitions and substitutes arguments", async () => {
    const dir = join(root, ".neutron", "tool");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "deploy.json"),
      JSON.stringify({ description: "Deploy", command: "deploy {{target}}", parameters: { target: { type: "string", description: "env", required: true } } }),
      "utf8",
    );

    const tools = loadCustomTools(root);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("deploy");
    let ran = "";
    const result = await tools[0]!.execute({ target: "prod" }, ctx(async (cmd) => {
      ran = cmd;
      return { status: "ok", stdout: "deployed", stderr: "", exitCode: 0, durationMs: 1, timedOut: false };
    }));
    expect(ran).toBe("deploy prod");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("deployed");
  });
});

describe("McpClient with fake child process", () => {
  interface FakeChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (s: string) => boolean };
    written: string[];
    kill: () => void;
  }

  type Responder = (msg: any, write: (data: string | Buffer) => void) => void;

  function makeFakeMcpServer(responder: Responder) {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.written = [];
    const emitStdout = (data: string | Buffer) => child.stdout.emit("data", data);
    child.stdin = {
      write: (s: string) => {
        child.written.push(s);
        for (const line of s.split("\n")) {
          if (!line.trim()) continue;
          responder(JSON.parse(line), emitStdout);
        }
        return true;
      },
    };
    child.kill = () => {
      child.emit("exit", 0, null);
    };
    let spawnCount = 0;
    const spawnFn = (() => {
      spawnCount++;
      return child;
    }) as unknown as SpawnFn;
    const lastResponse = () => JSON.parse(child.written[child.written.length - 1]!);
    return { child, spawnFn, spawnCount: () => spawnCount, lastResponse };
  }

  /** Answers `initialize`; delegates everything else to `extra`. */
  function mcpResponder(extra?: Responder): Responder {
    return (msg, write) => {
      if (msg.method === "initialize") {
        write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "1" } },
          }) + "\n",
        );
        return;
      }
      extra?.(msg, write);
    };
  }

  it("start() is idempotent: concurrent and repeated calls spawn one child", async () => {
    const { spawnFn, spawnCount } = makeFakeMcpServer(mcpResponder());
    const client = new McpClient("fake", { command: "fake-cmd" }, spawnFn);
    await Promise.all([client.start(), client.start()]);
    await client.start();
    expect(spawnCount()).toBe(1);
    client.stop();
  });

  it("decodes multi-byte UTF-8 split across stdout chunks", async () => {
    const { spawnFn } = makeFakeMcpServer(
      mcpResponder((msg, write) => {
        if (msg.method === "tools/call") {
          const body =
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: "héllo wörld" }] },
            }) + "\n";
          const bytes = Buffer.from(body, "utf8");
          // Split right in the middle of the two-byte "é" (0xC3 0xA9).
          const splitAt = bytes.indexOf(Buffer.from("é", "utf8")) + 1;
          write(bytes.slice(0, splitAt));
          write(bytes.slice(splitAt));
        }
      }),
    );
    const client = new McpClient("fake", { command: "fake-cmd" }, spawnFn);
    await client.start();
    expect(await client.callTool("echo", {})).toBe("héllo wörld");
    client.stop();
  });

  it("answers server-initiated requests and drops notifications", async () => {
    const { child, spawnFn, lastResponse } = makeFakeMcpServer(mcpResponder());
    const client = new McpClient("fake", { command: "fake-cmd" }, spawnFn);
    await client.start();
    const writtenBefore = child.written.length;

    // Server-initiated request (has an id) -> JSON-RPC response.
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "server/ping", params: {} }) + "\n"),
    );
    expect(lastResponse()).toMatchObject({ id: 99, error: { code: METHOD_NOT_FOUND } });

    // Server-initiated notification (no id) -> dropped, nothing written back.
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} }) + "\n"),
    );
    expect(child.written.length).toBe(writtenBefore + 1);
    client.stop();
  });

  it("throws when a tool-call result has isError: true", async () => {
    const { spawnFn } = makeFakeMcpServer(
      mcpResponder((msg, write) => {
        if (msg.method === "tools/call") {
          write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: "kaboom" }], isError: true },
            }) + "\n",
          );
        }
      }),
    );
    const client = new McpClient("fake", { command: "fake-cmd" }, spawnFn);
    await client.start();
    await expect(client.callTool("bad", {})).rejects.toThrow("kaboom");
    client.stop();
  });

  it("rejects pending requests cleanly when the child emits an error", async () => {
    const { child, spawnFn } = makeFakeMcpServer(mcpResponder());
    const client = new McpClient("fake", { command: "fake-cmd" }, spawnFn);
    await client.start();
    const pending = client.listTools(); // never answered
    // Must not throw an unhandled "error" event; pending rejects instead.
    child.emit("error", new Error("spawn fake-cmd ENOENT"));
    await expect(pending).rejects.toThrow("MCP server fake failed");
    client.stop();
  });
});
