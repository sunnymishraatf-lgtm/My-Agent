import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../src/tools/types";
import type { ActionResult } from "../src/types";
import { connectMcpServers, readMcpConfig } from "../src/mcp/client";
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
  root = mkdtempSync(join(tmpdir(), "sunny-mcp-"));
  previousConfigDir = process.env.SUNNY_CONFIG_DIR;
  process.env.SUNNY_CONFIG_DIR = join(root, "cfg");
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.SUNNY_CONFIG_DIR;
  else process.env.SUNNY_CONFIG_DIR = previousConfigDir;
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
    mkdirSync(join(root, ".sunny"), { recursive: true });
    writeFileSync(
      join(root, ".sunny", "mcp.json"),
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
    const dir = join(root, ".sunny", "tool");
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
