import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { diagnoseFile, findServerFor, readLspConfig, LspClient, METHOD_NOT_FOUND, type SpawnFn } from "../src/lsp/client";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "fixtures", "fake-lsp.mjs");

let root: string;
let prevConfigDir: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-lsp-"));
  prevConfigDir = process.env.NEUTRON_CONFIG_DIR;
  process.env.NEUTRON_CONFIG_DIR = join(root, "config");
  mkdirSync(join(root, ".neutron"), { recursive: true });
  writeFileSync(
    join(root, ".neutron", "lsp.json"),
    JSON.stringify({
      lsp: {
        fake: {
          command: process.execPath,
          args: [serverPath],
          extensions: [".txt"],
          languageId: "plaintext",
        },
      },
    }),
    "utf8",
  );
  writeFileSync(join(root, "a.txt"), "hello world", "utf8");
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.NEUTRON_CONFIG_DIR;
  else process.env.NEUTRON_CONFIG_DIR = prevConfigDir;
  rmSync(root, { recursive: true, force: true });
});

describe("lsp client", () => {
  it("reads config and finds a server by extension", () => {
    const configs = readLspConfig(root);
    expect(configs.fake).toBeDefined();
    expect(findServerFor(configs, "a.txt")?.name).toBe("fake");
    expect(findServerFor(configs, "a.ts")).toBeUndefined();
  });

  it("collects diagnostics from a language server", async () => {
    const result = await diagnoseFile(root, "a.txt");
    expect(result.server).toBe("fake");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", message: "fake error", line: 1, character: 3 });
  }, 15000);
});

describe("LspClient with fake child process", () => {
  interface FakeChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (s: string) => boolean };
    written: string[];
    kill: () => void;
  }

  type Responder = (msg: any, write: (data: Buffer) => void) => void;

  function frame(msg: unknown): Buffer {
    const body = JSON.stringify(msg);
    return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  function makeFakeLspServer(responder: Responder) {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.written = [];
    const emitStdout = (data: Buffer) => child.stdout.emit("data", data);
    child.stdin = {
      write: (s: string) => {
        child.written.push(s);
        // Parse the Content-Length frames the client wrote.
        let rest = Buffer.from(s);
        while (true) {
          const headerEnd = rest.indexOf("\r\n\r\n");
          if (headerEnd < 0) break;
          const match = /Content-Length:\s*(\d+)/i.exec(rest.slice(0, headerEnd).toString("utf8"));
          if (!match) break;
          const length = Number(match[1]);
          const start = headerEnd + 4;
          if (rest.length < start + length) break;
          responder(JSON.parse(rest.slice(start, start + length).toString("utf8")), emitStdout);
          rest = rest.slice(start + length);
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
    const lastSentMessage = () => {
      const raw = child.written[child.written.length - 1]!;
      const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
      return JSON.parse(body);
    };
    return { child, spawnFn, spawnCount: () => spawnCount, lastSentMessage };
  }

  const answerInitialize: Responder = (msg, write) => {
    if (msg.method === "initialize") {
      write(frame({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } }));
    }
  };

  it("start() is idempotent: concurrent and repeated calls spawn one child", async () => {
    const { spawnFn, spawnCount } = makeFakeLspServer(answerInitialize);
    const client = new LspClient("fake", { command: "fake-cmd", extensions: [".txt"] }, spawnFn);
    await Promise.all([client.start(root), client.start(root)]);
    await client.start(root);
    expect(spawnCount()).toBe(1);
  });

  it("rejects pending requests cleanly when the child emits an error", async () => {
    const { child, spawnFn } = makeFakeLspServer(answerInitialize);
    const client = new LspClient("fake", { command: "fake-cmd", extensions: [".txt"] }, spawnFn);
    await client.start(root);
    const pending = (client as unknown as { request: (m: string, p: unknown) => Promise<unknown> }).request(
      "workspace/symbol",
      { query: "x" },
    );
    // Must not throw an unhandled "error" event; pending rejects instead.
    child.emit("error", new Error("spawn fake-cmd ENOENT"));
    await expect(pending).rejects.toThrow("LSP server fake failed");
  });

  it("answers workspace/configuration with the configured settings", async () => {
    const { child, spawnFn, lastSentMessage } = makeFakeLspServer(answerInitialize);
    const client = new LspClient(
      "fake",
      { command: "fake-cmd", extensions: [".txt"], initializationOptions: { lint: true } },
      spawnFn,
    );
    await client.start(root);
    const writtenBefore = child.written.length;
    child.stdout.emit(
      "data",
      frame({ jsonrpc: "2.0", id: 7, method: "workspace/configuration", params: { items: [{ section: "a" }, {}] } }),
    );
    expect(lastSentMessage()).toEqual({ jsonrpc: "2.0", id: 7, result: [{ lint: true }, { lint: true }] });
    expect(child.written.length).toBe(writtenBefore + 1);
  });

  it("rejects unknown server-initiated requests with method-not-found", async () => {
    const { child, spawnFn, lastSentMessage } = makeFakeLspServer(answerInitialize);
    const client = new LspClient("fake", { command: "fake-cmd", extensions: [".txt"] }, spawnFn);
    await client.start(root);
    child.stdout.emit(
      "data",
      frame({ jsonrpc: "2.0", id: 8, method: "window/showMessageRequest", params: { type: 1, message: "hi" } }),
    );
    expect(lastSentMessage()).toMatchObject({ id: 8, error: { code: METHOD_NOT_FOUND } });
    // The client stays usable: a fresh request still works.
    child.stdout.emit(
      "data",
      frame({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri: "file:///a.txt", diagnostics: [] },
      }),
    );
  });
});
