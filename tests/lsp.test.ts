import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseFile, findServerFor, readLspConfig } from "../src/lsp/client";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "fixtures", "fake-lsp.mjs");

let root: string;
let prevConfigDir: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sunny-lsp-"));
  prevConfigDir = process.env.SUNNY_CONFIG_DIR;
  process.env.SUNNY_CONFIG_DIR = join(root, "config");
  mkdirSync(join(root, ".sunny"), { recursive: true });
  writeFileSync(
    join(root, ".sunny", "lsp.json"),
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
  if (prevConfigDir === undefined) delete process.env.SUNNY_CONFIG_DIR;
  else process.env.SUNNY_CONFIG_DIR = prevConfigDir;
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
