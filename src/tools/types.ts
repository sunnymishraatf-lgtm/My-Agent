import type { ActionResult, ApprovalRequest } from "../types";
import type { TodoStore } from "./todos";

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface ToolContext {
  root: string;
  run: (cmd: string, opts?: { timeoutMs?: number }) => Promise<ActionResult>;
  log?: (msg: string) => void;
  approve?: (req: ApprovalRequest) => Promise<boolean>;
  todos?: TodoStore;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export function ok(output: string): ToolResult {
  return { ok: true, output };
}

export function fail(output: string): ToolResult {
  return { ok: false, output };
}

export function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

export function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function booleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return undefined;
}
