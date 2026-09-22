import { spawn } from "node:child_process";
import type { ActionResult, ApprovalRequest, ApprovalReason } from "../types";
import { redact } from "../config";
import { Logger } from "../logger";

export interface TerminalOptions {
  allowList?: string[];
  denyList?: string[];
  cwd?: string;
  approve?: (req: ApprovalRequest) => Promise<boolean>;
  logger?: Logger;
}

const DEFAULT_ALLOW = [
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "git add",
  "git commit",
  "git worktree",
  "git checkout",
  "git rev-parse",
  "npm test",
  "npm run",
  "npm ls",
  "npm audit",
  "node -v",
  "node --version",
  "npm -v",
  "tsc --noEmit",
  "vitest run",
  "npx tsc",
  "npx vitest",
];

const DEFAULT_DENY = [
  "rm -rf /",
  "rm -fr /",
  "format c:",
  "shred /dev/",
  "mkfs",
  "dd if=/dev/zero of=/dev/",
  ":(){:|:&};:",
  "> /dev/sda",
];

export function classify(cmd: string): { reason?: ApprovalReason; requiresApproval: boolean } {
  const lowered = cmd.toLowerCase();
  const dangerPatterns: Array<{ re: RegExp; reason: ApprovalReason }> = [
    { re: /\brm\s+(?:-[\w]*[rf][\w]*|--recursive|-\s*fr)\b/i, reason: "dangerous-command" },
    { re: /\brmdir\s+\/s\b/i, reason: "dangerous-command" },
    { re: /remove-item\s+.*-recurse/i, reason: "dangerous-command" },
    { re: /\bdrop\s+(?:table|database|schema)\b/i, reason: "destructive" },
    { re: /\btruncate\s+table\b/i, reason: "destructive" },
    { re: /\bdelete\s+from\s+\w+\b/i, reason: "destructive" },
    { re: /\bgit\s+push\b/i, reason: "public-exposure" },
    { re: /\bgit\s+reset\s+--hard\b/i, reason: "dangerous-command" },
    { re: /\bgit\s+clean\s+-[fxd]/i, reason: "dangerous-command" },
    { re: /\bsudo\b/i, reason: "dangerous-command" },
    { re: /\bshutdown\b|\breboot\b/i, reason: "dangerous-command" },
    { re: /\bchmod\s+777\b/i, reason: "dangerous-command" },
    { re: /\bkill\s+-9\b|\btaskkill\b/i, reason: "dangerous-command" },
    { re: /\b(curl|wget)\b[^|]*\|\s*(ba)?sh\b/i, reason: "dangerous-command" },
    { re: /\bpowershell\s+.*-enc\b/i, reason: "dangerous-command" },
    { re: /\bapi[_-]?key\s*=\s*['"]?[A-Za-z0-9_-]{8,}/i, reason: "contains-secret" },
    { re: /\b(password|secret|token)\s*=\s*['"]?[^\s'"]{8,}/i, reason: "contains-secret" },
    { re: /\bnpm\s+(?:install|i|add)\b/i, reason: "package-install" },
    { re: /\bpnpm\s+(?:install|add)\b/i, reason: "package-install" },
    { re: /\byarn\s+(?:install|add)\b/i, reason: "package-install" },
  ];
  for (const p of dangerPatterns) {
    if (p.re.test(lowered)) return { reason: p.reason, requiresApproval: true };
  }
  return { requiresApproval: false };
}

export class Terminal {
  private allowList: string[];
  private denyList: string[];
  private cwd: string;
  private approve?: (req: ApprovalRequest) => Promise<boolean>;
  private logger?: Logger;

  constructor(opts: TerminalOptions) {
    this.allowList = opts.allowList ?? DEFAULT_ALLOW;
    this.denyList = opts.denyList ?? DEFAULT_DENY;
    this.cwd = opts.cwd ?? process.cwd();
    this.approve = opts.approve;
    this.logger = opts.logger;
  }

  private evaluate(cmd: string): { blocked?: string; approvalReason?: ApprovalReason } {
    const trimmed = cmd.trim();
    const isAllowed = this.allowList.some((allowed) => trimmed.startsWith(allowed));
    const segments = cmd.split(/&&|;/).map((s) => s.trim()).filter(Boolean);
    for (const deny of this.denyList) {
      if (cmd.toLowerCase().includes(deny.toLowerCase()) || segments.some((s) => s.toLowerCase().includes(deny.toLowerCase()))) {
        return { blocked: deny };
      }
    }
    if (isAllowed) return {};
    for (const seg of segments) {
      const verdict = classify(seg);
      if (verdict.requiresApproval && verdict.reason) {
        return { approvalReason: verdict.reason };
      }
    }
    return {};
  }

  async run(cmd: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<ActionResult> {
    const verdict = this.evaluate(cmd);
    if (verdict.blocked) {
      this.logger?.warn(`blocked command: ${redact(cmd)}`);
      return {
        status: "error",
        stdout: "",
        stderr: `Command blocked by deny rule: ${verdict.blocked}`,
        exitCode: 99,
        durationMs: 0,
        timedOut: false,
      };
    }
    if (verdict.approvalReason && this.approve) {
      const allowed = await this.approve({
        message: `The terminal wants to run a command classified as ${verdict.approvalReason}.`,
        command: cmd,
        reason: verdict.approvalReason,
        onApprove: async () => {},
        onDeny: async () => {},
      });
      if (!allowed) {
        this.logger?.warn(`denied by user: ${redact(cmd)}`);
        return {
          status: "error",
          stdout: "",
          stderr: "Command denied by user.",
          exitCode: 98,
          durationMs: 0,
          timedOut: false,
        };
      }
    }

    const timeoutMs = opts?.timeoutMs ?? 120_000;
    const cwd = opts?.cwd ?? this.cwd;
    const isWindows = process.platform === "win32";
    const shell = isWindows ? (process.env.ComSpec ?? "cmd") : "/bin/sh";
    const args: string[] = isWindows ? ["/d", "/s", "/c", cmd] : ["-c", cmd];

    this.logger?.info(`$ ${redact(cmd)}`);

    return new Promise<ActionResult>((resolve) => {
      const child = spawn(shell, args, {
        cwd,
        env: process.env,
        shell: false,
        windowsHide: true,
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      let timedOut = false;
      const started = Date.now();
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout?.on("data", (d: Buffer) => {
        stdoutBuf += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderrBuf += d.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          status: "error",
          stdout: stdoutBuf,
          stderr: stderrBuf + "\n" + err.message,
          exitCode: 1,
          durationMs: Date.now() - started,
          timedOut,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const failed = code !== 0 || /BUILD FAILED|error TS|npm error|SyntaxError/i.test(stdoutBuf + stderrBuf);
        resolve({
          status: failed ? "error" : "ok",
          stdout: stdoutBuf,
          stderr: stderrBuf,
          exitCode: code ?? 1,
          durationMs: Date.now() - started,
          timedOut,
        });
      });
    });
  }

  async runChecked(cmd: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<ActionResult> {
    const result = await this.run(cmd, opts);
    if (result.status === "error") {
      this.logger?.warn(`command failed (${result.exitCode}): ${redact(cmd)}`);
    }
    return result;
  }
}