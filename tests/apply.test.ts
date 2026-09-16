import { describe, it, expect } from "vitest";
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
});