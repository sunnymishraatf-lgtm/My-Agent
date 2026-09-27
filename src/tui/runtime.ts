import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { ChatAgent, type ChatEvent } from "../chat/agent";
import { SessionStore, type ChatSession } from "../chat/session";
import { SnapshotStore } from "../chat/snapshots";
import { ApiSystem } from "../api/api-manager";
import { Terminal } from "../terminal/terminal";
import { loadConfig, registerSecrets, redact, upsertProvider, type ConfigProvider } from "../config";
import {
  buildProviderStatuses,
  findProviderStatus,
  type ProviderStatus,
} from "../providers/service";
import { discoverModels } from "../providers/discovery";
import { getCatalogEntry, listCatalog, type ProviderCatalogEntry } from "../providers/catalog";
import { readModelCache, setCachedModels, type CachedModel } from "../providers/model-cache";
import { loadAgents, findAgent, primaryAgents, type AgentConfig } from "../chat/agent-config";
import { loadCommands, expandCommand, type CustomCommand } from "../chat/commands";
import { parseInput } from "../chat/input";
import { loadPlugins, type PluginRunner } from "../plugins/plugins";
import { loadSkills } from "../chat/skills";
import { initAgentsFile } from "../chat/project-init";
import { shareSession } from "../chat/share";
import { connectMcpServers, type McpConnection } from "../mcp/client";
import { Git } from "../git/git";
import { sessionToMarkdown } from "../chat/transcript";
import { diffTurn, formatDiff } from "../chat/diff";
import { getVersion } from "../version";
import { prettyProvider } from "./utils";
import { PALETTE_ACTIONS } from "./commands";
import type {
  TuiAction,
  TuiApproval,
  TuiFileChange,
  TuiMcpServer,
  TuiModel,
  TuiProvider,
  TuiShellCall,
  TuiStats,
  TuiToolCall,
} from "./types";

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export interface ChatRuntimeDeps {
  api: ApiSystem;
  store: SessionStore;
  snapshots: SnapshotStore;
  session: ChatSession;
  activeAgent: AgentConfig;
  agents: AgentConfig[];
  commands: CustomCommand[];
  plugins: PluginRunner;
  mcpTools: import("../mcp/client").McpConnection["tools"];
  mcpClients?: McpConnection["clients"];
  mcpServers?: string[];
  mcpErrors?: string[];
  providerConfigs?: ConfigProvider[];
  root: string;
}

export interface ChatRuntimeOptions {
  autoApprove?: boolean;
  maxSteps?: number;
  plugins?: PluginRunner;
  pluginFiles?: string[];
  model?: string;
  provider?: string;
  agent?: string;
  mode?: string;
  allow?: string[];
  deny?: string[];
  sessionId?: string;
  continue?: boolean;
}

export class ChatRuntime {
  private api: ApiSystem;
  private store: SessionStore;
  private snapshots: SnapshotStore;
  private session: ChatSession;
  private agent: ChatAgent;
  private activeAgent: AgentConfig;
  private agents: AgentConfig[];
  private commands: CustomCommand[];
  private terminal: Terminal;
  private plugins: PluginRunner;
  private mcpToolsAll: McpConnection["tools"];
  private mcpToolGroups: Map<string, string[]>;
  private mcpEnabled: Set<string>;
  private mcpErrors: string[];
  private mcpClients: McpConnection["clients"];
  private providerConfigs: ConfigProvider[];
  private providerStatuses: ProviderStatus[] = [];
  private healthCache = new Map<string, { ok: boolean; latencyMs: number; checkedAt: number }>();
  private checking = new Set<string>();
  private root: string;
  private git: Git;
  private tipIndex = 0;
  private tips: string[] = [];
  private pendingApproval: { resolve: (v: boolean) => void; name: string; args: Record<string, unknown> } | null = null;
  private sessionAllowed = new Set<string>();
  private turnFiles: Record<string, string | null> = {};
  private runningTools: { id: string; name: string; args: Record<string, unknown> }[] = [];
  private toolSeq = 0;
  private shellSeq = 0;
  private onActionCallback?: (action: TuiAction) => void;
  private opts: ChatRuntimeOptions;

  constructor(deps: ChatRuntimeDeps, opts: ChatRuntimeOptions = {}) {
    this.api = deps.api;
    this.store = deps.store;
    this.snapshots = deps.snapshots;
    this.session = deps.session;
    this.activeAgent = deps.activeAgent;
    this.agents = deps.agents;
    this.commands = deps.commands;
    this.plugins = deps.plugins;
    this.mcpToolsAll = deps.mcpTools;
    this.mcpClients = deps.mcpClients ?? [];
    this.mcpErrors = deps.mcpErrors ?? [];
    this.providerConfigs = deps.providerConfigs ?? [];
    this.providerStatuses = buildProviderStatuses(this.providerConfigs);
    this.root = deps.root;
    this.opts = opts;
    this.git = new Git(this.root);
    this.mcpToolGroups = this.groupMcpTools(deps.mcpServers ?? []);
    this.mcpEnabled = new Set(this.mcpToolGroups.keys());
    this.tips = this.generateTips();
    this.terminal = this.createTerminal();
    this.agent = this.createAgent();
  }

  set onAction(cb: (action: TuiAction) => void) {
    this.onActionCallback = cb;
  }

  private emit(action: TuiAction): void {
    this.onActionCallback?.(action);
  }

  private groupMcpTools(servers: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const name of servers) groups.set(name, []);
    for (const tool of this.mcpToolsAll) {
      let server = "";
      for (const name of servers) {
        if (tool.name.startsWith(`${name}_`) || tool.name === name) {
          server = name;
          break;
        }
      }
      if (!server) server = "mcp";
      const list = groups.get(server) ?? [];
      list.push(tool.name);
      groups.set(server, list);
    }
    return groups;
  }

  private enabledMcpTools(): McpConnection["tools"] {
    const enabled = this.mcpEnabled;
    return this.mcpToolsAll.filter((tool) => {
      for (const [server, names] of this.mcpToolGroups) {
        if (names.includes(tool.name)) return enabled.has(server);
      }
      return true;
    });
  }

  private createTerminal(): Terminal {
    return new Terminal({
      cwd: this.root,
      approve: async (req) => {
        if (this.opts.autoApprove) return true;
        if (this.sessionAllowed.has("shell")) return true;
        return new Promise((resolve) => {
          const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          this.pendingApproval = { resolve, name: "shell", args: { command: req.command } };
          const approval: TuiApproval = {
            id,
            tool: "shell",
            command: req.command,
            reason: req.reason,
            resolve: (approved) => resolve(approved),
          };
          this.emit({ type: "addApproval", approval });
        });
      },
    });
  }

  private createAgent(): ChatAgent {
    const permissionOverrides: Record<string, "allow" | "ask" | "deny"> = {};
    if (this.opts.allow) for (const t of this.opts.allow) permissionOverrides[t] = "allow";
    if (this.opts.deny) for (const t of this.opts.deny) permissionOverrides[t] = "deny";
    const applyOverrides = (agent: AgentConfig): AgentConfig =>
      Object.keys(permissionOverrides).length === 0
        ? agent
        : { ...agent, permissions: { ...agent.permissions, ...permissionOverrides } };

    return new ChatAgent({
      root: this.root,
      api: this.api,
      model: this.session.model,
      provider: this.session.provider,
      autoApprove: this.opts.autoApprove ?? false,
      stream: true,
      snapshots: this.snapshots,
      mcpTools: this.enabledMcpTools(),
      agent: applyOverrides(this.activeAgent),
      agents: this.agents,
      plugins: this.plugins,
      maxToolOutput: 5000,
      approveTool: async (name, args) => {
        if (this.opts.autoApprove) return true;
        if (this.sessionAllowed.has(name)) return true;
        return new Promise((resolve) => {
          const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          this.pendingApproval = { resolve, name, args };
          const approval: TuiApproval = {
            id,
            tool: name,
            reason: `Tool "${name}" requires approval`,
            ...(typeof args.command === "string" ? { command: args.command } : {}),
            resolve: (approved) => resolve(approved),
          };
          this.emit({ type: "addApproval", approval });
        });
      },
      onEvent: (event) => {
        void this.handleEvent(event);
      },
      maxSteps: this.opts.maxSteps ?? 25,
    });
  }

  private async handleEvent(event: ChatEvent): Promise<void> {
    switch (event.type) {
      case "delta":
        this.emit({ type: "appendDelta", text: redact(event.text) });
        break;
      case "assistant":
        this.emit({ type: "finishAssistant", text: redact(event.text) });
        this.emit({ type: "finishMessage" });
        break;
      case "tool-call": {
        const id = `tc-${++this.toolSeq}`;
        this.runningTools.push({ id, name: event.name, args: event.args });
        this.emit({ type: "addToolCall", call: { id, kind: "tool", name: event.name, args: event.args, status: "running" } });
        if (event.name === "write" || event.name === "edit") {
          const p = event.args.path as string | undefined;
          if (p && !Object.prototype.hasOwnProperty.call(this.turnFiles, p)) {
            try {
              this.turnFiles[p] = readFileSync(join(this.root, p), "utf8");
            } catch {
              this.turnFiles[p] = null;
            }
          }
        }
        break;
      }
      case "tool-result": {
        const idx = this.runningTools.findIndex((t) => t.name === event.name);
        const entry = idx >= 0 ? this.runningTools.splice(idx, 1)[0] : undefined;
        const id = entry?.id ?? `tc-${++this.toolSeq}`;
        this.emit({
          type: "updateToolCall",
          id,
          patch: { status: event.ok ? "ok" : "error", output: event.output },
        });
        if ((event.name === "write" || event.name === "edit") && event.ok) {
          const p = entry?.args.path as string | undefined;
          if (p) {
            const before = this.turnFiles[p];
            try {
              const after = readFileSync(join(this.root, p), "utf8");
              if (before !== after) {
                const added = after.split("\n").length;
                const removed = before?.split("\n").length ?? 0;
                this.emit({
                  type: "addFileChange",
                  change: { path: p, kind: before == null ? "added" : "modified", added, removed },
                });
              }
            } catch {
              /* best-effort */
            }
          }
        }
        break;
      }
      case "undo":
        this.emit({ type: "setStatusLine", status: `Restored ${event.files.length} file(s)` });
        break;
      case "redo":
        this.emit({ type: "setStatusLine", status: `Re-applied ${event.files.length} file(s)` });
        break;
      case "compaction":
        this.emit({ type: "setStatusLine", status: `Compacted ${event.removed} messages` });
        break;
      case "step-limit":
        this.emit({ type: "setError", error: `Reached ${event.limit}-step limit` });
        break;
    }
  }

  private generateTips(): string[] {
    const tips = [
      "Press ctrl+p to see all available actions and commands",
      "Press Tab to switch agents",
      "Use /models to switch models",
      "Use /connect to configure a provider",
      "Press Ctrl+C to cancel the current operation",
      "Shift+Enter inserts a newline; Enter submits",
      "Use @path to attach a file's contents to your message",
      "Prefix a line with ! to run a shell command without asking the model",
      "Type /help to see all available commands",
    ];
    if (existsSync(join(this.root, "design.md"))) {
      tips.unshift("design.md found - run `neutron run` to start the engineering team");
    }
    if (existsSync(join(this.root, ".git"))) {
      tips.unshift(`On branch: ${this.currentBranchSync()}`);
    }
    return tips;
  }

  private currentBranchSync(): string {
    try {
      const head = readFileSync(join(this.root, ".git", "HEAD"), "utf8").trim();
      const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      if (match) return match[1]!;
      return head.slice(0, 7);
    } catch {
      return "main";
    }
  }

  async send(text: string): Promise<void> {
    const parsed = parseInput(this.root, text);
    if (parsed.kind === "shell") {
      await this.runShell(parsed.text);
      return;
    }
    if (this.session.messages.length === 0 && this.session.title === "Untitled session") {
      this.session.title = parsed.text.slice(0, 60) || "Untitled session";
    }
    this.emit({ type: "setStatusLine", status: "Thinking..." });
    try {
      await this.agent.send(this.session, parsed.text);
      this.store.save(this.session);
      this.emit({ type: "setStatusLine", status: "Ready" });
    } catch (err) {
      this.emit({ type: "setError", error: redact(String(err)) });
      this.emit({ type: "setStatusLine", status: "Error" });
    }
  }

  async runShell(command: string): Promise<void> {
    const id = `sh-${++this.shellSeq}`;
    const call: TuiShellCall = { id, kind: "shell", command, status: "running" };
    this.emit({ type: "addShellCall", call });
    this.emit({ type: "setStatusLine", status: `Running: ${command}` });
    try {
      const res = await this.terminal.run(command);
      const output = [res.stdout, res.stderr].filter((part) => part && part.trim()).join("\n").trim();
      this.emit({
        type: "updateShellCall",
        id,
        patch: { status: res.exitCode === 0 ? "ok" : "error", output },
      });
      this.emit({ type: "setStatusLine", status: `Exit ${res.exitCode}` });
    } catch (err) {
      this.emit({ type: "updateShellCall", id, patch: { status: "error", output: redact(String(err)) } });
    }
  }

  async switchAgent(name: string): Promise<boolean> {
    const next = findAgent(this.agents, name);
    if (!next) return false;
    this.activeAgent = next;
    this.agent = this.createAgent();
    this.emit({ type: "setAgent", agent: this.activeAgent });
    this.emit({ type: "setStatusLine", status: `Switched to ${name}` });
    return true;
  }

  async switchModel(model: string): Promise<void> {
    this.session.model = model;
    this.agent = this.createAgent();
    this.store.save(this.session);
    this.emit({ type: "setModel", model });
    this.emit({ type: "setStatusLine", status: `Model: ${model}` });
  }

  async switchProvider(provider: string): Promise<void> {
    this.session.provider = provider;
    const models = this.modelsFor(provider);
    if (!this.session.model || !models.includes(this.session.model)) {
      this.session.model = models[0];
    }
    this.agent = this.createAgent();
    this.store.save(this.session);
    this.emit({ type: "setProvider", provider });
    if (this.session.model) this.emit({ type: "setModel", model: this.session.model });
    this.emit({ type: "setStatusLine", status: `Provider: ${provider}` });
  }

  newSession(): ChatSession {
    this.session = this.store.create(undefined, {
      model: this.session.model,
      provider: this.session.provider,
    });
    this.sessionAllowed.clear();
    this.agent = this.createAgent();
    this.emit({ type: "reset" });
    this.emit({ type: "setStatusLine", status: "New session" });
    return this.session;
  }

  loadSession(id: string): boolean {
    const session = this.store.load(id);
    if (!session) return false;
    this.session = session;
    this.agent = this.createAgent();
    this.emit({ type: "reset" });
    this.emit({ type: "setStatusLine", status: `Loaded ${id.slice(0, 8)}` });
    return true;
  }

  renameSession(id: string, title: string): boolean {
    const ok = this.store.rename(id, title);
    if (ok && id === this.session.id) this.session.title = title;
    return ok;
  }

  deleteSession(id: string): boolean {
    const ok = this.store.remove(id);
    if (ok && id === this.session.id) this.newSession();
    return ok;
  }

  listSessions(): { id: string; title: string; messageCount: number; updatedAt: string }[] {
    return this.store.list().map((s) => ({
      id: s.id,
      title: s.title,
      messageCount: s.messageCount,
      updatedAt: s.updatedAt,
    }));
  }

  async compact(): Promise<boolean> {
    const compacted = await this.agent.compact(this.session);
    this.store.save(this.session);
    return compacted;
  }

  async undo(): Promise<string[]> {
    const undone = await this.agent.undo(this.session);
    this.store.save(this.session);
    return undone;
  }

  async redo(): Promise<string[]> {
    const redone = await this.agent.redo(this.session);
    this.store.save(this.session);
    return redone;
  }

  /** Display name for a provider, derived from its endpoint when the id is generic. */
  getProviderLabel(id: string | undefined): string {
    if (!id) return prettyProvider(id);
    const cfg = this.providerConfigs.find((p) => p.id === id);
    if (cfg?.baseUrl) {
      try {
        const host = new URL(cfg.baseUrl).host;
        const base = host.split(".")[0];
        if (base && !["api", "www", "localhost", "127"].includes(base)) return prettyProvider(base);
      } catch {
        /* fall through to the id */
      }
    }
    return prettyProvider(id);
  }

  private statusFor(providerId: string): ProviderStatus | undefined {
    return findProviderStatus(this.providerStatuses, providerId);
  }

  private toTuiModel(model: CachedModel, providerId: string): TuiModel {
    const status = this.statusFor(providerId);
    return {
      id: model.id,
      name: model.name || model.id,
      provider: providerId,
      providerLabel: status?.displayName ?? this.getProviderLabel(providerId),
      ...(model.free !== undefined ? { free: model.free } : {}),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.vision !== undefined ? { vision: model.vision } : {}),
      ...(model.tools !== undefined ? { tools: model.tools } : {}),
      ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
      ...(model.streaming !== undefined ? { streaming: model.streaming } : {}),
      ...(model.pricing ? { pricing: model.pricing } : {}),
    };
  }

  private toTuiProvider(status: ProviderStatus): TuiProvider {
    return {
      id: status.id,
      label: status.displayName,
      description: status.description,
      baseUrl: status.baseUrl,
      apiType: status.apiType,
      models: status.models.map((m) => this.toTuiModel(m, status.id)),
      modelCount: status.modelCount,
      configured: status.configured,
      enabled: status.enabled,
      hasKey: status.hasKey,
      local: status.local,
      status: this.checking.has(status.id) ? "checking" : status.status,
      docsUrl: status.docsUrl,
      ...(status.lastRefresh ? { lastRefresh: status.lastRefresh } : {}),
      ...(status.error ? { error: status.error } : {}),
    };
  }

  private customEntry(status: ProviderStatus): ProviderCatalogEntry {
    return {
      id: status.id,
      displayName: status.displayName,
      description: status.description,
      baseUrl: status.baseUrl,
      apiType: status.apiType,
      auth: status.auth,
      env: [],
      docsUrl: status.docsUrl,
      color: status.color,
      local: status.local,
    };
  }

  private modelsFor(providerId: string): string[] {
    const status = this.statusFor(providerId);
    if (status && status.models.length > 0) return status.models.map((m) => m.id);
    return this.api.registry.modelsFor(providerId);
  }

  private reloadProviderStatuses(): void {
    this.providerConfigs = loadConfig().providers;
    this.providerStatuses = buildProviderStatuses(this.providerConfigs);
  }

  /** Discover models for configured providers that have none cached yet. */
  async ensureModels(providerId?: string): Promise<void> {
    const targets = this.providerStatuses.filter((s) => {
      if (providerId && s.id !== providerId) return false;
      if (!s.configured) return false;
      return s.models.length === 0;
    });
    await Promise.all(targets.map((s) => this.refreshProvider(s.id, { silent: true })));
  }

  /** Query a provider's model API, cache the result and update the UI. */
  async refreshProvider(id: string, opts: { silent?: boolean } = {}): Promise<boolean> {
    const status = this.statusFor(id);
    if (!status) return false;
    const entry = getCatalogEntry(id) ?? this.customEntry(status);
    const cfg = this.providerConfigs.find((p) => p.id === id);
    this.checking.add(id);
    if (!opts.silent) this.emit({ type: "updateProvider", id, patch: { status: "checking" } });
    const result = await discoverModels(entry, {
      ...(cfg?.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg?.apiKey ? { apiKey: cfg.apiKey } : {}),
    });
    this.checking.delete(id);
    setCachedModels(id, result.models.length > 0 ? result.models : status.models, result.error);
    this.reloadProviderStatuses();
    const next = this.statusFor(id);
    if (next) this.emit({ type: "updateProvider", id, patch: this.toTuiProvider(next) });
    if (!opts.silent) {
      this.emit({
        type: "setStatusLine",
        status: result.error
          ? `${status.displayName}: could not fetch models`
          : `${status.displayName}: ${result.models.length} models found`,
      });
    }
    return !result.error;
  }

  async refreshAllProviders(): Promise<void> {
    await Promise.all(
      this.providerStatuses.filter((s) => s.configured).map((s) => this.refreshProvider(s.id, { silent: true })),
    );
  }

  /** Non-blocking connectivity check for a single provider. */
  async checkProviderHealth(id: string): Promise<{ ok: boolean; latencyMs: number }> {
    const status = this.statusFor(id);
    if (!status || !status.configured) return { ok: false, latencyMs: 0 };
    const entry = getCatalogEntry(id) ?? this.customEntry(status);
    const cfg = this.providerConfigs.find((p) => p.id === id);
    this.checking.add(id);
    this.emit({ type: "updateProvider", id, patch: { status: "checking" } });
    const started = Date.now();
    const result = await discoverModels(entry, {
      ...(cfg?.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg?.apiKey ? { apiKey: cfg.apiKey } : {}),
      timeoutMs: 10_000,
    });
    this.checking.delete(id);
    this.healthCache.set(id, { ok: !result.error, latencyMs: Date.now() - started, checkedAt: Date.now() });
    if (result.models.length > 0) setCachedModels(id, result.models);
    this.reloadProviderStatuses();
    const next = this.statusFor(id);
    if (next) this.emit({ type: "updateProvider", id, patch: this.toTuiProvider(next) });
    return { ok: !result.error, latencyMs: Date.now() - started };
  }

  /** Persist a provider through NEUTRON's existing config system. */
  configureProvider(input: {
    id: string;
    baseUrl?: string;
    apiKey?: string;
    models?: string[];
    enabled?: boolean;
  }): boolean {
    const existing = this.providerConfigs.find((p) => p.id === input.id);
    const catalog = getCatalogEntry(input.id);
    const baseUrl = input.baseUrl || existing?.baseUrl || catalog?.baseUrl || "";
    if (!baseUrl) return false;
    const apiKey = input.apiKey ?? existing?.apiKey;
    const provider: ConfigProvider = {
      id: input.id,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      models: input.models ?? existing?.models ?? [],
      enabled: input.enabled ?? true,
    };
    if (!upsertProvider(provider)) return false;
    if (provider.apiKey) registerSecrets([provider.apiKey]);
    this.reloadProviderStatuses();
    this.api.configure(this.providerConfigs.filter((p) => p.enabled));
    const next = this.statusFor(input.id);
    if (next) this.emit({ type: "updateProvider", id: input.id, patch: this.toTuiProvider(next) });
    return true;
  }

  getAgents(): AgentConfig[] { return this.agents; }
  getPrimaryAgents(): AgentConfig[] { return primaryAgents(this.agents); }
  getActiveAgent(): AgentConfig { return this.activeAgent; }
  getProviderIds(): string[] { return this.api.registry.ids(); }
  getModelsForProvider(providerId: string): string[] { return this.api.registry.modelsFor(providerId); }

  getProviders(): TuiProvider[] {
    return this.providerStatuses.map((status) => this.toTuiProvider(status));
  }

  getProviderCatalog(): ProviderCatalogEntry[] {
    return listCatalog();
  }

  getConfiguredProviderIds(): string[] {
    return this.providerStatuses.filter((s) => s.configured).map((s) => s.id);
  }

  /** Provider detail text for the info panel (never includes the API key). */
  getProviderDetail(id: string): string {
    const status = this.statusFor(id);
    if (!status) return "Provider not found.";
    const health = this.healthCache.get(id);
    return [
      `Provider:      ${status.displayName}`,
      `Status:        ${this.checking.has(id) ? "checking" : status.status}`,
      `Base URL:      ${status.baseUrl || "(not set)"}`,
      `API type:      ${status.apiType}`,
      `Models:        ${status.modelCount}`,
      `Streaming:     yes`,
      `Tools:         ${status.apiType === "google" ? "unknown" : "yes"}`,
      `Auth:          ${status.hasKey ? "key set" : status.local ? "not required" : "missing"}`,
      `Last updated:  ${status.lastRefresh ? new Date(status.lastRefresh).toISOString() : "never"}`,
      ...(health ? [`Health:        ${health.ok ? "ok" : "failed"} (${health.latencyMs}ms)`] : []),
      ...(status.error ? [`Error:         ${status.error}`] : []),
    ].join("\n");
  }

  getAllModels(): TuiModel[] {
    return this.providerStatuses.flatMap((status) => status.models.map((m) => this.toTuiModel(m, status.id)));
  }

  getModelsForProviderAsModels(providerId: string): TuiModel[] {
    const status = this.statusFor(providerId);
    if (!status) return [];
    return status.models.map((m) => this.toTuiModel(m, providerId));
  }

  getActiveProviderId(): string {
    if (this.session.provider) {
      const status = this.statusFor(this.session.provider);
      if (status?.configured) return this.session.provider;
    }
    return this.providerStatuses.find((s) => s.configured)?.id ?? this.api.registry.ids()[0] ?? "";
  }

  getActiveModel(): string {
    if (this.session.model) return this.session.model;
    const pid = this.getActiveProviderId();
    return (pid ? this.modelsFor(pid)[0] : undefined) ?? "auto";
  }

  getMcpServers(): TuiMcpServer[] {
    return [...this.mcpToolGroups.entries()].map(([name, tools]) => ({
      name,
      tools,
      enabled: this.mcpEnabled.has(name),
      ...(this.mcpErrors.find((e) => e.startsWith(`${name}:`)) ? { error: this.mcpErrors.find((e) => e.startsWith(`${name}:`))! } : {}),
    }));
  }

  toggleMcp(name: string): boolean {
    if (!this.mcpToolGroups.has(name)) return false;
    if (this.mcpEnabled.has(name)) this.mcpEnabled.delete(name);
    else this.mcpEnabled.add(name);
    this.agent = this.createAgent();
    return this.mcpEnabled.has(name);
  }

  getDiffText(): string {
    const turns = this.snapshots.list(this.session.id);
    const turn = turns[turns.length - 1];
    if (!turn) return "No changes recorded in this session yet.";
    return formatDiff(diffTurn(this.root, turn)) || "No changes in the last turn.";
  }

  getDebugText(): string {
    const stats = this.getStats();
    return [
      `neutron        v${this.getVersion()}`,
      `node         ${process.version}`,
      `platform     ${process.platform} ${process.arch}`,
      `cwd          ${this.root}`,
      `git          ${this.isGitRepo() ? this.currentBranchSync() : "(not a repository)"}`,
      `session      ${this.session.id}`,
      `messages     ${this.session.messages.length}`,
      `agent        ${this.activeAgent.name} [${this.activeAgent.mode}]`,
      `model        ${this.getActiveModel()}`,
      `provider     ${this.getProviderLabel(this.getActiveProviderId())}`,
      `tokens       ${stats.inputTokens} in / ${stats.outputTokens} out`,
      `requests     ${stats.requests} (${stats.failures} failed)`,
      `agents       ${this.agents.length}`,
      `mcp servers  ${this.mcpToolGroups.size} (${this.mcpEnabled.size} enabled)`,
      `plugins      ${this.plugins.plugins.length}`,
    ].join("\n");
  }

  getPaletteActions() { return PALETTE_ACTIONS; }

  getCurrentSession(): ChatSession { return this.session; }
  getRoot(): string { return this.root; }
  isGitRepo(): boolean { return existsSync(join(this.root, ".git")); }
  async getBranch(): Promise<string> { return this.git.currentBranch(); }
  getVersion(): string { return getVersion(); }

  getStats(): TuiStats {
    const stats = this.api.stats;
    return {
      tokens: stats.inputTokens + stats.outputTokens,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      requests: stats.requests,
      failures: stats.failures,
    };
  }

  getNextTip(): string {
    if (this.tips.length === 0) return "";
    const tip = this.tips[this.tipIndex % this.tips.length] ?? "";
    this.tipIndex = (this.tipIndex + 1) % this.tips.length;
    return tip;
  }

  resolveApproval(approved: boolean, scope: "once" | "session" = "once"): void {
    if (!this.pendingApproval) return;
    if (approved && scope === "session") this.sessionAllowed.add(this.pendingApproval.name);
    this.pendingApproval.resolve(approved);
    this.pendingApproval = null;
  }

  isBusy(): boolean { return this.pendingApproval !== null; }

  forkSession(): ChatSession {
    this.store.save(this.session);
    const forked = this.store.fork(this.session.id);
    if (forked) {
      this.session = forked;
      this.agent = this.createAgent();
      this.emit({ type: "reset" });
      return forked;
    }
    return this.session;
  }

  shareSession(): { file: string } {
    this.store.save(this.session);
    return shareSession(this.root, this.session);
  }

  exportTranscript(): string {
    return sessionToMarkdown(this.session);
  }

  async initProject(): Promise<{ created: boolean; path: string }> {
    return initAgentsFile(this.root);
  }

  listSkills(): { name: string; description: string }[] {
    return loadSkills(this.root).map((s) => ({ name: s.name, description: s.description }));
  }

  getCommandNames(): { name: string; description: string }[] {
    return this.commands.map((c) => ({ name: c.name, description: c.description }));
  }

  findCustomCommand(name: string): CustomCommand | undefined {
    return this.commands.find((c) => c.name === name);
  }

  expandCommand(name: string, args: string[]): string {
    const cmd = this.commands.find((c) => c.name === name);
    if (!cmd) return `/${name} ${args.join(" ")}`;
    return expandCommand(cmd, args.join(" "));
  }

  private packageScript(name: string): string | undefined {
    try {
      const pkg = JSON.parse(readFileSync(join(this.root, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      const script = pkg.scripts?.[name];
      return script ? `npm run ${name}` : undefined;
    } catch {
      return undefined;
    }
  }

  async runTests(): Promise<void> {
    const cmd = this.packageScript("test");
    if (!cmd) {
      this.emit({ type: "setStatusLine", status: "No test script found in package.json" });
      return;
    }
    await this.runShell(cmd);
  }

  runProject(): string {
    const cmd = this.packageScript("dev") ?? this.packageScript("start");
    if (!cmd) {
      this.emit({ type: "setStatusLine", status: "No dev/start script found in package.json" });
      return "";
    }
    const isWindows = process.platform === "win32";
    const shell = isWindows ? (process.env.ComSpec ?? "cmd") : "/bin/sh";
    const args = isWindows ? ["/d", "/s", "/c", cmd] : ["-c", cmd];
    try {
      const child = spawn(shell, args, { cwd: this.root, detached: true, stdio: "ignore" });
      child.unref();
      this.emit({ type: "setStatusLine", status: `Started ${cmd} (pid ${child.pid ?? "?"})` });
      return cmd;
    } catch (err) {
      this.emit({ type: "setStatusLine", status: `Failed to start: ${redact(String(err))}` });
      return "";
    }
  }

  async openEditor(text: string): Promise<string> {
    const dir = join(this.root, ".agent", "tmp");
    const file = join(dir, "prompt.md");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, text, "utf8");
    } catch {
      return text;
    }
    const editor =
      process.env.VISUAL ||
      process.env.EDITOR ||
      (process.platform === "win32" ? "notepad" : "vi");
    try {
      const result = spawnSync(editor, [file], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (result.error) return text;
    } catch {
      return text;
    }
    try {
      return readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");
    } catch {
      return text;
    }
  }

  destroy(): void {
    for (const client of this.mcpClients) {
      try {
        client.stop();
      } catch {
        /* ignore */
      }
    }
    this.agent = null!;
  }
}

export async function createChatRuntime(
  root: string,
  opts: ChatRuntimeOptions = {},
): Promise<ChatRuntime | null> {
  const config = loadConfig();
  registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));

  const api = new ApiSystem({ config, logger: silentLogger });
  const store = new SessionStore(root);
  const snapshots = new SnapshotStore(root);
  const plugins = opts.plugins ?? (await loadPlugins(root, opts.pluginFiles ?? []));
  const mcp = await connectMcpServers(root);
  const commands = loadCommands(root);
  const agents = loadAgents(root);

  const fallbackName = opts.mode === "plan" ? "plan" : "build";
  const activeAgent =
    (opts.agent ? findAgent(agents, opts.agent) : undefined) ??
    findAgent(agents, fallbackName) ??
    agents[0]!;

  let session: ChatSession | undefined;
  if (opts.sessionId) {
    session = store.load(opts.sessionId);
    if (!session) {
      console.log(`Session not found: ${opts.sessionId}. Run \`neutron sessions\` to list them.`);
      return null;
    }
  } else if (opts.continue) {
    session = store.latest();
  }
  if (!session) {
    session = store.create(undefined, { model: opts.model, provider: opts.provider });
  }

  const mcpServers = mcp.clients.map((c) => c.name);
  return new ChatRuntime(
    {
      api,
      store,
      snapshots,
      session,
      activeAgent,
      agents,
      commands,
      plugins,
      mcpTools: mcp.tools,
      mcpClients: mcp.clients,
      mcpServers,
      mcpErrors: mcp.errors,
      providerConfigs: config.providers,
      root,
    },
    opts,
  );
}
