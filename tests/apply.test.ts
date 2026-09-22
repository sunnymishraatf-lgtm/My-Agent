import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFileOps, applyFileOps } from "../src/agents/apply";
import type { AgentContext } from "../src/agents/agent";

function makeCtx(over: Partial<AgentContext> = {}): AgentContext {
  const written: Record<string, string> = {};
  const runCommands: string[] = [];
  return {
    root: "/tmp/project",
    api: undefined as never,
    log: () => {},
    run: async (cmd: string) => {
      runCommands.push(cmd);
      return { status: "ok", stdout: "", stderr: "", exitCode: 0 };
    },
    readFile: () => undefined,
    writeFile: (p: string, c: string) => {
      written[p] = c;
      return true;
    },
    listDir: () => [],
    getApproval: async () => true,
    ...over,
  } as AgentContext & { written: Record<string, string>; runCommands: string[] };
}

describe("parseFileOps", () => {
  it("parses FILE/TYPE blocks and RUN commands", () => {
    const text = `Here is my plan.

FILE: src/app.ts
TYPE: write
console.log("hello");

FILE: README.md
TYPE: append
more docs

RUN: npm test
RUN: npm run build
`;
    const { ops, commands } = parseFileOps(text);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ path: "src/app.ts", op: "write" });
    expect(ops[0]!.content).toContain("console.log");
    expect(ops[1]).toMatchObject({ path: "README.md", op: "append" });
    expect(commands).toEqual(["npm test", "npm run build"]);
  });

  it("defaults TYPE to write when omitted", () => {
    const { ops } = parseFileOps("FILE: a.txt\nhello");
    expect(ops[0]?.op).toBe("write");
  });

  it("does not truncate file content at Markdown ## headings", () => {
    const text = `FILE: notes.md
TYPE: write
# Title

Some intro.

## Section One

body text here

## Section Two

more body
`;
    const { ops } = parseFileOps(text);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.content).toContain("## Section One");
    expect(ops[0]!.content).toContain("body text here");
    expect(ops[0]!.content).toContain("## Section Two");
    expect(ops[0]!.content).toContain("more body");
  });

  it("keeps ## headings when followed by another FILE block", () => {
    const text = `FILE: a.md
# Doc

## Heading

content

FILE: b.md
plain
`;
    const { ops } = parseFileOps(text);
    expect(ops).toHaveLength(2);
    expect(ops[0]!.content).toContain("## Heading");
    expect(ops[0]!.content).toContain("content");
    expect(ops[1]!.content).toBe("plain");
  });
});

describe("applyFileOps", () => {
  it("writes files and runs commands", async () => {
    const ctx = makeCtx();
    const result = await applyFileOps(
      ctx,
      "FILE: src/a.ts\nTYPE: write\nexport {};\n\nRUN: npm test\n",
    );
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.commandsRun).toEqual(["npm test"]);
  });

  it("skips unsafe paths", async () => {
    const ctx = makeCtx();
    const result = await applyFileOps(ctx, "FILE: ../../etc/passwd\nTYPE: write\nnope\n");
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.issues[0]?.title).toContain("unsafe path");
  });

  it("skips chained shell commands", async () => {
    const ctx = makeCtx();
    const result = await applyFileOps(ctx, "RUN: npm test && npm run build\n");
    expect(result.commandsRun).toHaveLength(0);
    expect(result.issues.some((i) => i.title.includes("chained"))).toBe(true);
  });

  it("reports noFiles when the model produced nothing applicable", async () => {
    const ctx = makeCtx();
    const result = await applyFileOps(ctx, "I would suggest improving the structure.");
    expect(result.noFiles).toBe(true);
  });

  it("honors denied deletes", async () => {
    const ctx = makeCtx({ getApproval: async () => false });
    const result = await applyFileOps(ctx, "FILE: old.ts\nTYPE: delete\n");
    expect(result.applied).toBe(0);
    expect(result.issues.some((i) => i.title.includes("not approved"))).toBe(true);
  });

  it("actually deletes an approved file inside the workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "neutron-apply-"));
    try {
      mkdirSync(join(root, "sub"), { recursive: true });
      const target = join(root, "sub", "old.txt");
      writeFileSync(target, "bye", "utf8");
      const ctx = makeCtx({ root });
      const result = await applyFileOps(ctx, "FILE: sub/old.txt\nTYPE: delete\n");
      expect(result.applied).toBe(1);
      expect(result.failed).toBe(0);
      expect(existsSync(target)).toBe(false);
      expect(result.files[0]).toMatchObject({ path: "sub/old.txt", op: "delete" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to delete absolute paths outside the workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "neutron-apply-"));
    const outside = join(tmpdir(), "neutron-apply-outside.txt");
    try {
      writeFileSync(outside, "keep me", "utf8");
      const ctx = makeCtx({ root });
      const result = await applyFileOps(ctx, `FILE: ${outside}\nTYPE: delete\n`);
      expect(result.applied).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.issues.some((i) => i.title.includes("outside workspace"))).toBe(true);
      expect(existsSync(outside)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  });

  it("refuses to delete paths that escape via ..", async () => {
    const ctx = makeCtx();
    const result = await applyFileOps(ctx, "FILE: ../escape.txt\nTYPE: delete\n");
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.issues.some((i) => i.title.includes("unsafe path"))).toBe(true);
  });
});