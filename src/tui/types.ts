import type { AgentConfig } from "../chat/agent-config";
import type { ChatSession } from "../chat/session";
import type { ChatEvent } from "../chat/agent";

/** Status of a single tool execution. */
export type ToolStatus = "running" | "ok" | "error" | "denied";

/** A rendered conversation message. */
export interface TuiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

/** A tool call rendered inline in the transcript. */
export interface TuiToolCall {
  id: string;
  kind: "tool";
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  output?: string;
}

/** A shell command run directly by the user (e.g. `!npm test`). */
export interface TuiShellCall {
  id: string;
  kind: "shell";
  command: string;
  status: ToolStatus;
  output?: string;
}

export type TuiItem = TuiMessage | TuiToolCall | TuiShellCall;

/** A file change produced by a tool (write/edit). */
export interface TuiFileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  added: number;
  removed: number;
}

/** A pending approval request. */
export interface TuiApproval {
  id: string;
  tool: string;
  command?: string;
  reason: string;
  resolve: (approved: boolean, scope?: "once" | "session") => void;
}

/** Top-level view states for the TUI. */
export type View =
  | "home"
  | "chat"
  | "agents"
  | "models"
  | "providers"
  | "providerConfig"
  | "sessions"
  | "commands"
  | "help"
  | "diff"
  | "debug"
  | "mcps"
  | "approval";

/** Connection status of a provider in the UI. */
export type ProviderStatusKind = "connected" | "unconfigured" | "checking" | "error" | "local";

/** A provider entry surfaced to the UI. */
export interface TuiProvider {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  apiType: string;
  models: TuiModel[];
  modelCount: number;
  configured: boolean;
  enabled: boolean;
  hasKey: boolean;
  local: boolean;
  status: ProviderStatusKind;
  docsUrl: string;
  lastRefresh?: number;
  error?: string;
}

/** A model entry surfaced to the UI. */
export interface TuiModel {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  free?: boolean;
  contextWindow?: number;
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  streaming?: boolean;
  pricing?: { prompt?: number; completion?: number };
}

/** A session entry surfaced to the UI. */
export interface TuiSession {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

/** An MCP server entry surfaced to the UI. */
export interface TuiMcpServer {
  name: string;
  tools: string[];
  enabled: boolean;
  error?: string;
}

export interface TuiStats {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  failures: number;
}

export type TuiAction =
  | { type: "setView"; view: View }
  | { type: "sendMessage"; text: string }
  | { type: "appendDelta"; text: string }
  | { type: "finishAssistant"; text: string }
  | { type: "finishMessage" }
  | { type: "addToolCall"; call: TuiToolCall }
  | { type: "updateToolCall"; id: string; patch: Partial<TuiToolCall> }
  | { type: "addShellCall"; call: TuiShellCall }
  | { type: "updateShellCall"; id: string; patch: Partial<TuiShellCall> }
  | { type: "addFileChange"; change: TuiFileChange }
  | { type: "addApproval"; approval: TuiApproval }
  | { type: "resolveApproval"; id: string; approved: boolean }
  | { type: "setError"; error?: string }
  | { type: "setInput"; text: string; cursor?: number }
  | { type: "setCursor"; cursor: number }
  | { type: "setAgent"; agent: AgentConfig }
  | { type: "setProvider"; provider: string }
  | { type: "setModel"; model: string }
  | { type: "setSessions"; sessions: TuiSession[] }
  | { type: "updateProvider"; id: string; patch: Partial<TuiProvider> }
  | { type: "setStats"; stats: TuiStats }
  | { type: "setStatusLine"; status: string }
  | { type: "setTip"; tip: string }
  | { type: "reset" };

export const DEFAULT_TIPS = [
  "Press ctrl+p to see all available actions and commands",
  "Press Tab to switch agents",
  "Use /models to switch models",
  "Use /connect to configure a provider",
  "Press Ctrl+C to cancel the current operation",
  "Shift+Enter inserts a newline; Enter submits",
  "Use @path to attach a file's contents to your message",
  "Prefix a line with ! to run a shell command directly",
];
