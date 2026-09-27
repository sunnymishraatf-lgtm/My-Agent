import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ApiSystem } from "../api/api-manager";
import type { ChatMessage } from "../types";
import { ToolRegistry, createDefaultTools, type Tool, type ToolContext } from "../tools";
import { createTaskTool, createTodoTools, lspTool, skillTool, webfetchTool, type TaskRequest } from "../tools/extras";
import { loadCustomTools } from "../tools/custom";
import { detectFormatters, formatFile } from "../format/formatter";
import { TodoStore } from "../tools/todos";
import { Terminal } from "../terminal/terminal";
import { Approver } from "../approval/approver";
import { readProjectFile } from "../files/project-files";
import { buildToolInstructions, parseToolCalls } from "./protocol";
import type { PluginRunner } from "../plugins/plugins";
import type { ChatSession } from "./session";
import { SnapshotStore, captureCurrent, restoreTurn } from "./snapshots";
import {
  findAgent,
  isToolAllowed,
  loadAgents,
  permissionFor,
  subagents,
  type AgentConfig,
  type PermissionAction,
} from "./agent-config";

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool-call"; name: string; args: Record<string, unknown> }
  | { type: "tool-result"; name: string; ok: boolean; output: string }
  | { type: "undo"; files: string[] }
  | { type: "redo"; files: string[] }
  | { type: "compaction"; removed: number; kept: number }
  | { type: "step-limit"; limit: number };

export interface ChatAgentOptions {
  root: string;
  api: ApiSystem;
  tools?: Tool[];
  model?: string;
  provider?: string;
  maxSteps?: number;
  autoApprove?: boolean;
  stream?: boolean;
  formatOnWrite?: boolean;
  autoCompact?: boolean;
  snapshots?: SnapshotStore;
  mcpTools?: Tool[];
  agent?: AgentConfig;
  agents?: AgentConfig[];
  approveTool?: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  depth?: number;
  plugins?: PluginRunner;
  maxToolOutput?: number;
  onEvent?: (event: ChatEvent) => void;
}

const MAX_TOOL_OUTPUT = 30_000;

export class ChatAgent {
  readonly root: string;
  private api: ApiSystem;
  private registry: ToolRegistry;
  private model?: string;
  private provider?: string;
  private maxSteps: number;
  private autoApprove: boolean;
  private stream: boolean;
  private formatOnWrite: boolean;
  private autoCompact: boolean;
  private formatters: ReturnType<typeof detectFormatters>;
  private snapshots?: SnapshotStore;
  private turnFiles: Record<string, string | null> = {};
  private onEvent?: (event: ChatEvent) => void;
  readonly agent: AgentConfig;
  private agents: AgentConfig[];
  private todos = new TodoStore();
  private approveTool?: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  private depth: number;
  private plugins?: PluginRunner;
  private maxToolOutput: number;

  constructor(opts: ChatAgentOptions) {
    this.root = opts.root;
    this.api = opts.api;
    this.agents = opts.agents ?? loadAgents(opts.root);
    this.agent = opts.agent ?? findAgent(this.agents, "build") ?? { name: "build", description: "", mode: "primary", permissions: { "*": "allow" } };
    this.model = opts.model;
    this.provider = opts.provider;
    this.maxSteps = opts.maxSteps ?? this.agent.maxSteps ?? 25;
    this.autoApprove = opts.autoApprove ?? false;
    this.stream = opts.stream ?? false;
    this.formatOnWrite = opts.formatOnWrite ?? true;
    this.autoCompact = opts.autoCompact ?? true;
    this.formatters = detectFormatters(this.root);
    this.snapshots = opts.snapshots;
    this.approveTool = opts.approveTool;
    this.depth = opts.depth ?? 0;
    this.plugins = opts.plugins;
    this.maxToolOutput = opts.maxToolOutput ?? MAX_TOOL_OUTPUT;

    const custom = loadCustomTools(this.root);
    const base = [...(opts.tools ?? createDefaultTools()), ...(opts.mcpTools ?? []), ...custom];
    const tools: Tool[] = base.filter((t) => isToolAllowed(this.agent, t.name));
    const extras: Tool[] = [webfetchTool, skillTool, lspTool];
    if (isToolAllowed(this.agent, "todowrite") || isToolAllowed(this.agent, "todoread")) {
      extras.push(...createTodoTools(this.todos));
    }
    if (this.depth < 1 && isToolAllowed(this.agent, "task") && subagents(this.agents).length > 0) {
      const names = subagents(this.agents)
        .filter((a) => !a.hidden)
        .map((a) => a.name);
      extras.push(createTaskTool((req) => this.spawnSubagent(req), names));
    }
    for (const tool of extras) {
      if (isToolAllowed(this.agent, tool.name) && !tools.some((t) => t.name === tool.name)) tools.push(tool);
    }
    this.registry = new ToolRegistry(tools);
    this.onEvent = opts.onEvent;
  }

  get tools(): Tool[] {
    return this.registry.list();
  }

  async send(session: ChatSession, userText: string): Promise<string> {
    if (this.autoCompact) {
      try {
        await this.compact(session, false);
      } catch {
        /* compaction is best-effort */
      }
    }
    if (this.plugins) userText = await this.plugins.chatMessage(userText);
    session.messages.push({ role: "user", content: userText });
    const approver = new Approver({ autoApprove: this.autoApprove });
    const terminal = new Terminal({
      cwd: this.root,
      approve: async (req) => {
        if (this.autoApprove) return true;
        // Route command approvals through the host's approval handler (e.g. the TUI)
        // so interactive front-ends control the security prompt.
        if (this.approveTool) return this.approveTool("bash", { command: req.command });
        return approver.ask(req);
      },
    });
    const ctx: ToolContext = {
      root: this.root,
      run: (cmd, opts) => terminal.run(cmd, opts),
      log: () => {},
      todos: this.todos,
    };

    this.turnFiles = {};
    let finalText = "";
    try {
      for (let step = 0; step < this.maxSteps; step++) {
        const assistantText = await this.complete(session);
        session.messages.push({ role: "assistant", content: assistantText });

        const { text, calls } = parseToolCalls(assistantText);
        if (text) {
          finalText = text;
          this.emit({ type: "assistant", text });
        }
        if (calls.length === 0) {
          if (!finalText) {
            finalText = "(no response)";
            this.emit({ type: "assistant", text: finalText });
          }
          break;
        }

        for (const call of calls) {
          this.emit({ type: "tool-call", name: call.name, args: call.args });
          let args = call.args;
          if (this.plugins) {
            const before = await this.plugins.toolBefore(call.name, args);
            args = before.args;
            if (before.cancel) {
              this.emit({ type: "tool-result", name: call.name, ok: false, output: before.cancel });
              session.messages.push({
                role: "user",
                content: formatToolResult(call.name, false, before.cancel, this.maxToolOutput),
              });
              continue;
            }
          }
          const blocker = await this.checkPermission(call.name, args);
          if (blocker) {
            this.emit({ type: "tool-result", name: call.name, ok: false, output: blocker });
            session.messages.push({
              role: "user",
              content: formatToolResult(call.name, false, blocker, this.maxToolOutput),
            });
            continue;
          }
          for (const file of this.toolTargets(call.name, args)) this.captureSnapshot(file);
          const executed = await this.registry.execute(call.name, args, ctx);
          let ok = executed.ok;
          let output = executed.output;
          if (this.plugins) {
            const after = await this.plugins.toolAfter(call.name, args, ok, output);
            ok = after.ok;
            output = after.output;
          }
          if (ok && this.formatOnWrite && (call.name === "write" || call.name === "edit")) {
            const target = this.toolTargets(call.name, args)[0];
            if (target) await this.applyFormatter(target, terminal);
          }
          this.emit({ type: "tool-result", name: call.name, ok, output });
          session.messages.push({
            role: "user",
            content: formatToolResult(call.name, ok, output, this.maxToolOutput),
          });
        }

        if (step === this.maxSteps - 1) {
          this.emit({ type: "step-limit", limit: this.maxSteps });
        }
      }
    } finally {
      this.persistSnapshot(session.id);
    }

    session.updatedAt = new Date().toISOString();
    return finalText;
  }

  /** Summarize older messages to keep the context small. Force bypasses the size check. */
  async compact(session: ChatSession, force = true): Promise<boolean> {
    const messages = session.messages;
    const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
    const threshold = 80_000;
    if (!force && (messages.length < 8 || totalChars < threshold)) return false;
    const keepCount = Math.max(2, Math.min(6, Math.floor(messages.length / 3)));
    const older = messages.slice(0, messages.length - keepCount);
    const keep = messages.slice(-keepCount);
    if (older.length === 0) return false;
    const transcript = older.map((m) => `${m.role}: ${truncate(m.content, 4000)}`).join("\n\n");
    const res = await this.api.chat(
      "general",
      [
        {
          role: "system",
          content:
            "Summarize this coding session so work can continue with minimal context loss. Capture decisions, files touched, and open tasks. Be concise.",
        },
        { role: "user", content: transcript },
      ],
      {
        ...(this.model ? { model: this.model } : {}),
        ...(this.provider ? { provider: this.provider } : {}),
        temperature: 0.2,
      },
    );
    session.messages = [
      { role: "assistant", content: `[compacted summary of ${older.length} earlier messages]\n${res.text}` },
      ...keep,
    ];
    this.emit({ type: "compaction", removed: older.length, kept: keep.length });
    return true;
  }

  private async checkPermission(name: string, args: Record<string, unknown>): Promise<string | undefined> {
    const argText =
      typeof args.command === "string" ? args.command : typeof args.path === "string" ? args.path : "";
    const action: PermissionAction = permissionFor(this.agent, name, argText);
    if (action === "allow") return undefined;
    if (action === "deny") {
      return `Permission denied: tool "${name}" is not allowed for the ${this.agent.name} agent.`;
    }
    if (this.autoApprove) return undefined;
    if (this.approveTool) {
      const approved = await this.approveTool(name, args);
      return approved ? undefined : `Permission denied by user for tool "${name}".`;
    }
    return `Tool "${name}" requires approval, but no approval handler is available.`;
  }

  private async spawnSubagent(req: TaskRequest): Promise<{ ok: boolean; output: string }> {
    const name = req.subagent_type ?? "general";
    const sub = findAgent(this.agents, name);
    if (!sub) return { ok: false, output: `Unknown subagent: ${name}` };
    if (this.depth >= 1) return { ok: false, output: "Subagent recursion limit reached." };
    const child = new ChatAgent({
      root: this.root,
      api: this.api,
      agent: sub,
      agents: this.agents,
      autoApprove: this.autoApprove,
      stream: false,
      depth: this.depth + 1,
      ...(this.model ? { model: this.model } : {}),
      ...(this.provider ? { provider: this.provider } : {}),
      ...(this.approveTool ? { approveTool: this.approveTool } : {}),
    });
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: `sub-${Date.now().toString(36)}`,
      title: req.description,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    try {
      const text = await child.send(session, req.prompt);
      return { ok: true, output: text || "(subagent produced no output)" };
    } catch (err) {
      return { ok: false, output: `Subagent failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async applyFormatter(relPath: string, terminal: Terminal): Promise<void> {
    if (this.formatters.length === 0) return;
    await formatFile(this.root, relPath, (cmd, opts) => terminal.run(cmd, opts), this.formatters);
  }

  private toolTargets(name: string, args: Record<string, unknown>): string[] {
    if (name === "write" || name === "edit") {
      const path = typeof args.path === "string" ? args.path : undefined;
      return path ? [path] : [];
    }
    return [];
  }

  private captureSnapshot(file: string): void {
    if (!this.snapshots) return;
    if (Object.prototype.hasOwnProperty.call(this.turnFiles, file)) return;
    const original = readProjectFile(this.root, file);
    this.turnFiles[file] = original === undefined ? null : original;
  }

  private persistSnapshot(sessionId: string): void {
    if (!this.snapshots) return;
    // A new turn invalidates redo history whether or not it changed files:
    // the redo stack only makes sense for the exact undone state.
    this.snapshots.clearRedo(sessionId);
    const files = this.turnFiles;
    if (Object.keys(files).length === 0) return;
    this.snapshots.push(sessionId, { ts: new Date().toISOString(), files });
    this.turnFiles = {};
  }

  async undo(session: ChatSession): Promise<string[]> {
    if (!this.snapshots) return [];
    const turn = this.snapshots.pop(session.id);
    if (!turn) return [];
    const before = captureCurrent(this.root, Object.keys(turn.files));
    const restored = restoreTurn(this.root, turn);
    this.snapshots.pushRedo(session.id, before);
    this.emit({ type: "undo", files: restored });
    return restored;
  }

  async redo(session: ChatSession): Promise<string[]> {
    if (!this.snapshots) return [];
    const turn = this.snapshots.popRedo(session.id);
    if (!turn) return [];
    const before = captureCurrent(this.root, Object.keys(turn.files));
    const restored = restoreTurn(this.root, turn);
    this.snapshots.push(session.id, before);
    this.emit({ type: "redo", files: restored });
    return restored;
  }

  private async complete(session: ChatSession): Promise<string> {
    const messages = this.buildMessages(session);
    const opts = {
      ...(this.model ? { model: this.model } : {}),
      ...(this.provider ? { provider: this.provider } : {}),
      temperature: 0.2,
    };
    if (this.stream) {
      let text = "";
      let sawDelta = false;
      try {
        for await (const chunk of this.api.stream("general", messages, opts)) {
          if (chunk.delta) {
            text += chunk.delta;
            sawDelta = true;
            this.emit({ type: "delta", text: chunk.delta });
          }
        }
        return text;
      } catch (err) {
        if (sawDelta) throw err;
        // Nothing was streamed; fall through to the non-streaming request.
      }
    }
    const res = await this.api.chat("general", messages, opts);
    return res.text;
  }

  private buildMessages(session: ChatSession): ChatMessage[] {
    return [{ role: "system", content: this.systemPrompt() }, ...session.messages];
  }

  private systemPrompt(): string {
    const parts: string[] = [];
    parts.push(
      "You are NEUTRON, an autonomous software maintenance intelligence system, working directly in the user's project through an interactive terminal.",
      "Be concise and practical. Make changes by calling tools, verify them, and report what you did.",
      "Never invent file contents or command output; always inspect first.",
      "Prefer small, targeted edits. Do not modify files outside the workspace.",
    );
    parts.push(`Workspace root: ${this.root}`);
    parts.push(`Active agent: ${this.agent.name}${this.agent.mode === "subagent" ? " (subagent)" : ""}.`);

    if (this.agent.prompt) {
      parts.push(`## Agent instructions (${this.agent.name})\n${this.agent.prompt}`);
    }

    const rules = this.readRules();
    if (rules) parts.push("## Project rules\n" + rules);

    const agentsFile = this.readInstructionsFile();
    if (agentsFile) {
      parts.push("## Project instructions (AGENTS.md)\n" + agentsFile);
    }

    const design = readProjectFile(this.root, "design.md");
    if (design) {
      parts.push("## design.md\n" + truncate(design, 6000));
    }

    parts.push("## Tools\n" + buildToolInstructions(this.registry.list()));
    return parts.join("\n\n");
  }

  private readRules(): string | undefined {
    const dirs = [join(this.root, ".neutron", "rules"), join(this.root, ".sunny", "rules"), join(this.root, ".opencode", "rules")];
    const chunks: string[] = [];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
      } catch {
        continue;
      }
      for (const file of files) {
        try {
          chunks.push(`### ${file}\n${readFileSync(join(dir, file), "utf8").trim()}`);
        } catch {
          /* ignore */
        }
      }
    }
    return chunks.length > 0 ? truncate(chunks.join("\n\n"), 8000) : undefined;
  }

  private readInstructionsFile(): string | undefined {
    for (const name of ["AGENTS.md", ".neutron/AGENTS.md", ".sunny/AGENTS.md", "CLAUDE.md"]) {
      const p = join(this.root, name);
      if (!existsSync(p)) continue;
      try {
        return truncate(readFileSync(p, "utf8"), 8000);
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }

  private emit(event: ChatEvent): void {
    this.onEvent?.(event);
  }
}

function formatToolResult(name: string, ok: boolean, output: string, max = MAX_TOOL_OUTPUT): string {
  const body = truncate(output, max);
  return `Tool result (${name}) [${ok ? "ok" : "error"}]:\n${body}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}
