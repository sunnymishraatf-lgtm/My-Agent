import type { AgentContext } from "../agents/agent";
import type { Issue } from "../scheduler/task";

interface FileOp {
  path: string;
  op: "write" | "append" | "delete";
  content?: string;
}

export interface ApplyResult {
  applied: number;
  failed: number;
  noFiles: boolean;
  files: Array<{ path: string; op: string }>;
  commandsRun: string[];
  issues: Issue[];
}

export function parseFileOps(text: string): { ops: FileOp[]; commands: string[] } {
  const ops: FileOp[] = [];
  const commands: string[] = [];
  const blocks = text.match(/```(\w+)\n([\s\S]*?)```/g) ?? [];
  const src = blocks.length ? blocks.join("\n") : text;

  const writeRe = /FILE:\s*([^\n]+)\n(?:TYPE:\s*(\w+)\n)?([\s\S]*?)(?=\nFILE:|## |$)/g;
  let m: RegExpExecArray | null;
  while ((m = writeRe.exec(src)) !== null) {
    const path = m[1]!.trim();
    const opRaw = (m[2] ?? "write").toLowerCase();
    const op = opRaw === "append" || opRaw === "delete" ? opRaw : "write";
    ops.push({ path, op, content: m[3]!.trim() });
  }

  const cmdRe = /(?:RUN|COMMAND):\s*(.+)/g;
  let c: RegExpExecArray | null;
  while ((c = cmdRe.exec(src)) !== null) {
    commands.push(c[1]!.trim());
  }
  return { ops, commands };
}

export async function applyFileOps(ctx: AgentContext, text: string): Promise<ApplyResult> {
  const { ops, commands } = parseFileOps(text);
  const files: Array<{ path: string; op: string }> = [];
  const issues: Issue[] = [];
  let failed = 0;
  const commandsRun: string[] = [];

  for (const op of ops) {
    if (!op.path || op.path.includes("..")) {
      failed++;
      issues.push({ severity: "medium", category: "agent", title: `Skipped unsafe path: ${op.path}` });
      continue;
    }
    if (op.op === "delete") {
      if (!(await ctx.getApproval({ message: `An agent wants to delete ${op.path}`, reason: "destructive" }))) {
        failed++;
        issues.push({ severity: "medium", category: "agent", title: `Delete not approved: ${op.path}` });
        continue;
      }
      ctx.log(`deleting ${op.path}`);
      files.push({ path: op.path, op: "delete" });
      continue;
    }
    const ok = ctx.writeFile(op.path, op.content ?? "");
    if (ok) {
      files.push({ path: op.path, op: op.op });
    } else {
      failed++;
      issues.push({ severity: "medium", category: "agent", title: `Failed to write ${op.path}` });
    }
  }

  for (const cmd of commands) {
    if (cmd.includes("&&") || cmd.includes(";") || cmd.includes("|")) {
      issues.push({ severity: "low", category: "agent", title: "Skipped chained shell command" });
      continue;
    }
    const result = await ctx.run(cmd);
    commandsRun.push(cmd);
    if (result.status === "error") {
      failed++;
      issues.push({
        severity: "medium",
        category: "agent",
        title: `Command failed (${result.exitCode}): ${cmd}`,
        detail: result.stderr.slice(0, 600),
      });
    }
  }

  return { applied: files.length, failed, noFiles: ops.length === 0 && commands.length === 0, files, commandsRun, issues };
}