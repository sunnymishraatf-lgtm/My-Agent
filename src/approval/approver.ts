import type { ApprovalRequest } from "../types";
import { createInterface } from "node:readline";
import { redact } from "../config";

export interface ApproverOptions {
  autoApprove?: boolean;
  print?: (msg: string) => void;
}

export type ApprovalSource = "interactive" | "-y" | "non-tty";

export interface ApprovalDecision {
  approved: boolean;
  source: ApprovalSource;
}

export class Approver {
  private autoApprove: boolean;
  private onPrint?: (msg: string) => void;

  constructor(opts: ApproverOptions = {}) {
    this.autoApprove = opts.autoApprove ?? false;
    this.onPrint = opts.print;
  }

  private print(msg: string): void {
    if (this.onPrint) this.onPrint(msg);
    else process.stdout.write(redact(msg) + "\n");
  }

  async ask(req: ApprovalRequest): Promise<boolean> {
    const { approved } = await this.askWithSource(req);
    return approved;
  }

  /**
   * Same fail-closed semantics as ask(), but also reports where the decision
   * came from: "-y" (auto-approve), "interactive" (TTY prompt), or "non-tty"
   * (non-interactive auto-deny).
   */
  async askWithSource(req: ApprovalRequest): Promise<ApprovalDecision> {
    if (this.autoApprove) {
      this.print(`[auto-approved] ${req.reason}: ${req.command ?? req.message}`);
      await req.onApprove();
      return { approved: true, source: "-y" };
    }
    if (!process.stdin.isTTY) {
      this.print(`[non-interactive] ${req.reason}: auto-denying ${req.command ?? req.message}`);
      await req.onDeny();
      return { approved: false, source: "non-tty" };
    }

    this.print(`\n⚠ APPROVAL REQUIRED\n`);
    this.print(req.message);
    if (req.command) this.print(`Command: ${req.command}`);
    this.print(`Reason: ${req.reason}`);
    this.print("Allow? [y/N] ");

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => rl.question("", resolve));
    rl.close();

    if (answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes") {
      await req.onApprove();
      return { approved: true, source: "interactive" };
    }
    await req.onDeny();
    return { approved: false, source: "interactive" };
  }
}

export function confirm(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${msg} [y/N] `, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "y" || ans.trim().toLowerCase() === "yes");
    });
  });
}