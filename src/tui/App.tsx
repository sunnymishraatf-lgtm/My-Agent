import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "../chat/agent-config";
import type { ChatRuntime } from "./runtime";
import { DEFAULT_TIPS } from "./types";
import type {
  TuiAction,
  TuiApproval,
  TuiFileChange,
  TuiItem,
  TuiMcpServer,
  TuiModel,
  TuiProvider,
  TuiSession,
  TuiStats,
  View,
} from "./types";
import { COMMANDS, PALETTE_ACTIONS, filterCommands, type TuiCommand } from "./commands";
import { backspaceAt, classifyRaw, deleteAt, editKind, insertAt, parseToken, sanitizePaste, splitRawKeys, useRawKeys, wordLeft, wordRight, type EditKind } from "./keys";
import { ChatTranscript } from "./ChatTranscript";
import { CommandMenu } from "./CommandMenu";
import { HomeScreen } from "./HomeScreen";
import { InputBox } from "./InputBox";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { ProviderScreen } from "./ProviderScreen";
import { ModelScreen } from "./ModelScreen";
import { ProviderConfigPanel, type ProviderConfigValues } from "./ProviderConfigPanel";
import {
  HelpView,
  ListOverlay,
  TextView,
  agentItems,
  mcpItems,
  modelItems,
  paletteItems,
  providerItems,
  sessionItems,
} from "./Pickers";
import { BottomBar, HelpHint, TipBar } from "./StatusBar";
import { borderStyle } from "./utils";

interface AppProps {
  runtime: ChatRuntime;
  startOpts: { model?: string; provider?: string; autoApprove?: boolean; message?: string };
}

type Action =
  | TuiAction
  | { type: "setPickIndex"; index: number }
  | { type: "setAgents"; agents: AgentConfig[] }
  | { type: "setModels"; models: TuiModel[] }
  | { type: "setProviders"; providers: TuiProvider[] }
  | { type: "setMcpServers"; servers: TuiMcpServer[] }
  | { type: "setSessions"; sessions: TuiSession[] }
  | { type: "setStats"; stats: TuiStats }
  | { type: "setBranch"; branch: string }
  | { type: "setDiff"; text: string }
  | { type: "setDebug"; text: string }
  | { type: "setCmdIndex"; index: number }
  | { type: "setCmdDismissed"; dismissed: boolean }
  | { type: "setScroll"; scrollBack: number }
  | { type: "setRename"; target?: string }
  | { type: "setHistoryIndex"; index: number }
  | { type: "setSearch"; text: string }
  | { type: "appendSearch"; text: string }
  | { type: "setConfig"; target?: string }
  | { type: "setModelScope"; provider?: string }
  | { type: "setModelLoading"; loading: boolean }
  | { type: "systemMessage"; text: string }
  | { type: "clearItems" }
  | { type: "setBusy"; busy: boolean };

interface AppState {
  view: View;
  items: TuiItem[];
  fileChanges: TuiFileChange[];
  streaming: boolean;
  streamingText: string;
  busy: boolean;
  error?: string;
  statusLine: string;
  input: string;
  cursor: number;
  history: string[];
  historyIndex: number;
  pickIndex: number;
  agents: AgentConfig[];
  models: TuiModel[];
  providers: TuiProvider[];
  sessions: TuiSession[];
  mcpServers: TuiMcpServer[];
  approval: TuiApproval | null;
  agentName: string;
  model: string;
  provider: string;
  sessionId: string;
  cwd: string;
  branch: string;
  isRepo: boolean;
  version: string;
  tip: string;
  stats: TuiStats;
  diffText: string;
  debugText: string;
  scrollBack: number;
  renameTarget?: string;
  cmdIndex: number;
  cmdDismissed: boolean;
  search: string;
  configTarget?: string;
  modelScopeProvider?: string;
  modelLoading: boolean;
}

function stripToolMarkup(text: string): string {
  const fence = text.search(/```[ \t]*tool\b/i);
  const xml = text.search(/<\s*\/?\s*(tool|function|antml)/i);
  const at = Math.min(fence === -1 ? Infinity : fence, xml === -1 ? Infinity : xml);
  return at === Infinity ? text : text.slice(0, at);
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "setView":
      return { ...state, view: action.view, scrollBack: action.view === "chat" ? state.scrollBack : 0 };
    case "setPickIndex":
      return { ...state, pickIndex: action.index };
    case "setAgents":
      return { ...state, agents: action.agents };
    case "setModels":
      return { ...state, models: action.models };
    case "setProviders":
      return { ...state, providers: action.providers };
    case "updateProvider":
      return {
        ...state,
        providers: state.providers.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
      };
    case "setMcpServers":
      return { ...state, mcpServers: action.servers };
    case "setSessions":
      return { ...state, sessions: action.sessions };
    case "setStats":
      return { ...state, stats: action.stats };
    case "setBranch":
      return { ...state, branch: action.branch };
    case "setDiff":
      return { ...state, diffText: action.text };
    case "setDebug":
      return { ...state, debugText: action.text };
    case "setCmdIndex":
      return { ...state, cmdIndex: action.index };
    case "setCmdDismissed":
      return { ...state, cmdDismissed: action.dismissed };
    case "setScroll":
      return { ...state, scrollBack: Math.max(0, action.scrollBack) };
    case "setRename":
      return { ...state, renameTarget: action.target };
    case "setSearch":
      return { ...state, search: action.text };
    case "appendSearch":
      return { ...state, search: state.search + action.text };
    case "setConfig":
      return { ...state, configTarget: action.target };
    case "setModelScope":
      return { ...state, modelScopeProvider: action.provider };
    case "setModelLoading":
      return { ...state, modelLoading: action.loading };
    case "setBusy":
      return { ...state, busy: action.busy };
    case "setStatusLine":
      return { ...state, statusLine: action.status };
    case "setTip":
      return { ...state, tip: action.tip };
    case "setHistoryIndex":
      return { ...state, historyIndex: action.index };
    case "setError":
      // An error ends any in-flight streaming state so the thinking spinner stops.
      return { ...state, error: action.error, streaming: false, streamingText: "" };
    case "setInput":
      // Never yank the cursor to the end while the user is editing: keep it (clamped) unless the caller supplies one.
      return {
        ...state,
        input: action.text,
        cursor: Math.max(0, Math.min(action.text.length, action.cursor ?? state.cursor)),
      };
    case "setCursor":
      return { ...state, cursor: action.cursor };
    case "setAgent":
      return { ...state, agentName: action.agent.name };
    case "setModel":
      return { ...state, model: action.model };
    case "setProvider":
      return { ...state, provider: action.provider };
    case "reset":
      return { ...state, items: [], fileChanges: [], streaming: false, streamingText: "", error: undefined, scrollBack: 0 };
    case "clearItems":
      return { ...state, items: [], fileChanges: [], streaming: false, streamingText: "" };
    case "systemMessage":
      return { ...state, items: [...state.items, { id: `sys-${Date.now()}-${Math.random()}`, role: "system", text: action.text }] };
    case "sendMessage":
      return {
        ...state,
        items: [...state.items, { id: `user-${Date.now()}-${Math.random()}`, role: "user", text: action.text }],
        fileChanges: [],
        streaming: true,
        streamingText: "",
        history: [action.text, ...state.history.filter((h) => h !== action.text)].slice(0, 50),
        historyIndex: -1,
        scrollBack: 0,
        input: "",
        cursor: 0,
      };
    case "appendDelta": {
      const next = state.streamingText + action.text;
      const visible = stripToolMarkup(next);
      return { ...state, streamingText: visible, streaming: true };
    }
    case "finishAssistant": {
      const text = action.text.trim();
      if (!text) return { ...state, streamingText: "", streaming: false };
      return {
        ...state,
        items: [...state.items, { id: `asst-${Date.now()}-${Math.random()}`, role: "assistant", text: action.text }],
        streamingText: "",
        streaming: false,
      };
    }
    case "finishMessage":
      return { ...state, streaming: false, streamingText: "" };
    case "addToolCall":
      return { ...state, streaming: false, streamingText: "", items: [...state.items, action.call] };
    case "updateToolCall":
      return { ...state, items: state.items.map((item) => ("kind" in item && item.kind === "tool" && item.id === action.id ? { ...item, ...action.patch } : item)) };
    case "addShellCall":
      return { ...state, streaming: false, streamingText: "", items: [...state.items, action.call] };
    case "updateShellCall":
      return { ...state, items: state.items.map((item) => ("kind" in item && item.kind === "shell" && item.id === action.id ? { ...item, ...action.patch } : item)) };
    case "addFileChange":
      return { ...state, fileChanges: [...state.fileChanges, action.change] };
    case "addApproval":
      return { ...state, approval: action.approval, view: "approval" };
    case "resolveApproval":
      return { ...state, approval: null, view: state.view === "approval" ? "chat" : state.view };
    default:
      return state;
  }
}

export function App({ runtime, startOpts }: AppProps) {
  const { exit } = useApp();
  const [size, setSize] = useState({ columns: (process.stdout as any).columns ?? 100, rows: (process.stdout as any).rows ?? 30 });
  const running = useRef(false);

  const session = runtime.getCurrentSession();
  const initialAgent = runtime.getActiveAgent();
  const initial: AppState = {
    view: "home",
    items: [],
    fileChanges: [],
    streaming: false,
    streamingText: "",
    busy: false,
    statusLine: "Ready",
    input: "",
    cursor: 0,
    history: [],
    historyIndex: -1,
    pickIndex: 0,
    agents: [],
    models: [],
    providers: [],
    sessions: [],
    mcpServers: [],
    approval: null,
    agentName: initialAgent?.name ?? "build",
    model: runtime.getActiveModel?.() ?? startOpts.model ?? session.model ?? "auto",
    provider: runtime.getActiveProviderId?.() ?? startOpts.provider ?? session.provider ?? "auto",
    sessionId: session.id,
    cwd: runtime.getRoot(),
    branch: "main",
    isRepo: runtime.isGitRepo?.() ?? false,
    version: runtime.getVersion(),
    tip: runtime.getNextTip?.() ?? DEFAULT_TIPS[0]!,
    stats: runtime.getStats?.() ?? { tokens: 0, inputTokens: 0, outputTokens: 0, requests: 0, failures: 0 },
    diffText: "",
    debugText: "",
    scrollBack: 0,
    cmdIndex: 0,
    cmdDismissed: false,
    search: "",
    modelLoading: false,
  };

  const [state, dispatch] = useReducer(reducer, initial);
  const apply = (action: Action) => dispatch(action);

  // Route runtime events into the reducer.
  useEffect(() => {
    (runtime as any).onAction = (action: TuiAction) => {
      switch (action.type) {
        case "appendDelta":
        case "finishAssistant":
        case "finishMessage":
        case "setStatusLine":
        case "setError":
        case "sendMessage":
        case "reset":
          apply(action);
          break;
        case "addToolCall":
        case "updateToolCall":
        case "addShellCall":
        case "updateShellCall":
        case "addFileChange":
        case "addApproval":
          apply(action);
          break;
        case "setAgent":
        case "setModel":
        case "setProvider":
          apply(action);
          break;
        case "updateProvider":
          apply(action);
          break;
        default:
          break;
      }
    };
  }, [runtime]);

  useEffect(() => {
    void runtime.getBranch().then((branch) => apply({ type: "setBranch", branch })).catch(() => {});
  }, [runtime]);

  useEffect(() => {
    if (runtime.getProviders) {
      apply({ type: "setProviders", providers: runtime.getProviders() });
    }
    if (!runtime.ensureModels) return;
    void runtime
      .ensureModels()
      .then(() => {
        apply({ type: "setModel", model: runtime.getActiveModel?.() ?? initial.model });
        apply({ type: "setProviders", providers: runtime.getProviders() });
      })
      .catch(() => {});
  }, [runtime]);

  useEffect(() => {
    const handler = () => setSize({ columns: (process.stdout as any).columns ?? 100, rows: (process.stdout as any).rows ?? 30 });
    (process.stdout as any).on("resize", handler);
    return () => (process.stdout as any).off("resize", handler);
  }, []);

  useEffect(() => {
    const stats = setInterval(() => {
      if (runtime.getStats) apply({ type: "setStats", stats: runtime.getStats() });
    }, 3000);
    const tips = setInterval(() => {
      if (runtime.getNextTip) apply({ type: "setTip", tip: runtime.getNextTip() } as Action);
    }, 15000);
    return () => {
      clearInterval(stats);
      clearInterval(tips);
    };
  }, [runtime]);

  const quit = () => {
    try {
      runtime.destroy?.();
    } catch {
      /* ignore */
    }
    exit();
    process.exit(0);
  };

  const run = async (fn: () => Promise<void> | void) => {
    if (running.current) return;
    running.current = true;
    apply({ type: "setBusy", busy: true });
    try {
      await fn();
    } catch (err) {
      apply({ type: "setError", error: String(err) });
    } finally {
      running.current = false;
      apply({ type: "setBusy", busy: false });
      apply({ type: "setStats", stats: runtime.getStats?.() ?? state.stats });
    }
  };

  const openAgents = () => {
    apply({ type: "setAgents", agents: runtime.getAgents() });
    apply({ type: "setPickIndex", index: 0 });
    apply({ type: "setView", view: "agents" });
  };
  const openModels = (scopeProvider?: string) => {
    const models = scopeProvider
      ? runtime.getModelsForProviderAsModels?.(scopeProvider) ?? []
      : runtime.getAllModels();
    apply({ type: "setModels", models });
    apply({ type: "setModelScope", ...(scopeProvider ? { provider: scopeProvider } : {}) });
    apply({ type: "setSearch", text: "" });
    apply({ type: "setPickIndex", index: 0 });
    apply({ type: "setModelLoading", loading: false });
    apply({ type: "setView", view: "models" });
    if (!scopeProvider && models.length === 0 && runtime.ensureModels) {
      apply({ type: "setModelLoading", loading: true });
      void runtime
        .ensureModels()
        .then(() => {
          apply({ type: "setModels", models: runtime.getAllModels() });
          apply({ type: "setModelLoading", loading: false });
        })
        .catch(() => apply({ type: "setModelLoading", loading: false }));
    }
  };
  const openProviders = () => {
    apply({ type: "setProviders", providers: runtime.getProviders() });
    apply({ type: "setSearch", text: "" });
    apply({ type: "setPickIndex", index: 0 });
    apply({ type: "setView", view: "providers" });
  };
  const openProviderConfig = (id: string) => {
    apply({ type: "setConfig", target: id });
    apply({ type: "setSearch", text: "" });
    apply({ type: "setView", view: "providerConfig" });
  };
  const saveProviderConfig = (values: ProviderConfigValues) => {
    const id = state.configTarget;
    if (!id || !runtime.configureProvider) return;
    const ok = runtime.configureProvider({ id, ...values });
    apply({ type: "setConfig", target: undefined });
    if (!ok) {
      apply({ type: "setError", error: `Failed to save provider ${id}.` });
      apply({ type: "setView", view: "providers" });
      return;
    }
    apply({ type: "setStatusLine", status: `Saved ${id}` });
    apply({ type: "setProviders", providers: runtime.getProviders() });
    apply({ type: "setView", view: "providers" });
    void run(async () => {
      await runtime.refreshProvider?.(id);
      apply({ type: "setProviders", providers: runtime.getProviders() });
    });
  };
  const providerAt = (): TuiProvider | undefined =>
    filteredProviders[state.pickIndex] ?? filteredProviders[0];
  const refreshSelectedProvider = () => {
    const provider = providerAt();
    if (!provider || !runtime.refreshProvider) return;
    void run(async () => {
      await runtime.refreshProvider(provider.id);
      apply({ type: "setProviders", providers: runtime.getProviders() });
    });
  };
  const enterProvider = () => {
    const provider = providerAt();
    if (!provider) return;
    if (!provider.configured) {
      openProviderConfig(provider.id);
      return;
    }
    if (provider.models.length > 0) {
      openModels(provider.id);
      return;
    }
    void run(async () => {
      await runtime.refreshProvider?.(provider.id);
      const models = runtime.getModelsForProviderAsModels?.(provider.id) ?? [];
      apply({ type: "setProviders", providers: runtime.getProviders() });
      if (models.length > 0) openModels(provider.id);
      else apply({ type: "setStatusLine", status: `${provider.label}: no models found` });
    });
  };
  const selectModelEntry = () => {
    const model = filteredModels[state.pickIndex] ?? filteredModels[0];
    if (!model) return;
    void run(async () => {
      if (model.provider !== runtime.getActiveProviderId?.()) await runtime.switchProvider(model.provider);
      await runtime.switchModel(model.id);
      apply({ type: "setModel", model: model.id });
      apply({ type: "setProvider", provider: model.provider });
      apply({ type: "setView", view: "chat" });
    });
  };
  const openSessions = () => {
    apply({ type: "setSessions", sessions: runtime.listSessions() });
    apply({ type: "setPickIndex", index: 0 });
    apply({ type: "setView", view: "sessions" });
  };
  const openMcps = () => {
    apply({ type: "setMcpServers", servers: runtime.getMcpServers?.() ?? [] });
    apply({ type: "setPickIndex", index: 0 });
    apply({ type: "setView", view: "mcps" });
  };
  const openPalette = () => {
    apply({ type: "setPickIndex", index: 0 });
    apply({ type: "setView", view: "commands" });
  };

  const submit = (raw?: string): boolean => {
    const value = (raw ?? state.input).trim();
    if (!value) return false;
    if (state.busy && !value.startsWith("/")) return false;
    apply({ type: "setInput", text: "" });
    apply({ type: "setCursor", cursor: 0 });
    apply({ type: "setCmdDismissed", dismissed: false });
    apply({ type: "setPickIndex", index: 0 });
    if (value.startsWith("/")) {
      void handleSlash(value);
      return true;
    }
    if (value.startsWith("!")) {
      apply({ type: "setView", view: "chat" });
      void run(async () => {
        await runtime.send(value);
      });
      return true;
    }
    apply({ type: "sendMessage", text: value });
    apply({ type: "setView", view: "chat" });
    void run(async () => {
      await runtime.send(value);
    });
    return true;
  };

  // `neutron chat "prompt"` launches the TUI and kicks off the first turn.
  useEffect(() => {
    const initialMessage = startOpts.message;
    if (!initialMessage) return;
    const timer = setTimeout(() => submit(initialMessage), 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSlash = async (value: string): Promise<void> => {
    const [name, ...rest] = value.slice(1).split(/\s+/);
    const command = COMMANDS.find((c) => c.name === name || c.aliases?.includes(name ?? ""));
    if (command) {
      await runCommand(command.name, rest);
      return;
    }
    const custom = runtime.findCustomCommand?.(name ?? "");
    if (custom) {
      apply({ type: "sendMessage", text: value });
      apply({ type: "setView", view: "chat" });
      const expanded = runtime.expandCommand(name!, rest);
      await run(async () => {
        await runtime.send(expanded);
      });
      return;
    }
    apply({ type: "systemMessage", text: `Unknown command: /${name ?? ""}. Type /help to see available commands.` });
  };

  const runCommand = async (name: string, args: string[]): Promise<void> => {
    switch (name) {
      case "help":
        apply({ type: "setView", view: "help" });
        return;
      case "agents":
        openAgents();
        return;
      case "models":
        openModels();
        return;
      case "providers":
        openProviders();
        return;
      case "connect":
        openProviders();
        return;
      case "settings":
      case "themes":
        apply({ type: "setView", view: "chat" });
        apply({ type: "systemMessage", text: "Settings and themes live in the global config. Run `neutron config` to edit them." });
        return;
      case "test":
        apply({ type: "setView", view: "chat" });
        void run(async () => {
          await runtime.runTests?.();
        });
        return;
      case "run":
        apply({ type: "setView", view: "chat" });
        runtime.runProject?.();
        return;
      case "review": {
        apply({ type: "setView", view: "chat" });
        const reviewer = runtime.getAgents?.().find((a) => /review/i.test(a.name));
        if (reviewer) await runtime.switchAgent(reviewer.name);
        apply({ type: "sendMessage", text: "Review the changes in this session and list issues." });
        await run(async () => {
          await runtime.send("Review the changes in this session and list issues by severity.");
        });
        return;
      }
      case "mcps":
        openMcps();
        return;
      case "sessions":
        openSessions();
        return;
      case "debug":
        apply({ type: "setDebug", text: runtime.getDebugText?.() ?? "" });
        apply({ type: "setView", view: "debug" });
        return;
      case "diff":
        apply({ type: "setDiff", text: runtime.getDiffText?.() ?? "" });
        apply({ type: "setView", view: "diff" });
        return;
      case "editor":
        await run(async () => {
          const edited = await runtime.openEditor?.(state.input);
          if (typeof edited === "string") apply({ type: "setInput", text: edited, cursor: edited.length });
        });
        return;
      case "exit":
        quit();
        return;
      case "new":
        runtime.newSession();
        apply({ type: "setView", view: "chat" });
        return;
      case "clear":
        apply({ type: "clearItems" });
        return;
      case "init":
        await run(async () => {
          const result = await runtime.initProject();
          apply({ type: "systemMessage", text: result.created ? `Created ${result.path}` : `${result.path} already exists.` });
        });
        return;
      case "undo":
        await run(async () => {
          const files = await runtime.undo();
          apply({ type: "systemMessage", text: files.length ? `Restored ${files.length} file(s): ${files.join(", ")}` : "Nothing to undo." });
        });
        return;
      case "redo":
        await run(async () => {
          const files = await runtime.redo();
          apply({ type: "systemMessage", text: files.length ? `Re-applied ${files.length} file(s): ${files.join(", ")}` : "Nothing to redo." });
        });
        return;
      case "compact":
        await run(async () => {
          const compacted = await runtime.compact();
          apply({ type: "systemMessage", text: compacted ? "Context compacted." : "Nothing to compact yet." });
        });
        return;
      case "tokens": {
        const stats = runtime.getStats?.() ?? state.stats;
        apply({ type: "systemMessage", text: `~${stats.tokens} tokens · ${stats.inputTokens} in / ${stats.outputTokens} out · ${stats.requests} request(s)` });
        return;
      }
      case "fork": {
        runtime.forkSession();
        apply({ type: "setView", view: "chat" });
        apply({ type: "systemMessage", text: "Forked session." });
        return;
      }
      case "share":
        await run(async () => {
          const { file } = runtime.shareSession();
          apply({ type: "systemMessage", text: `Shared session to ${file}` });
        });
        return;
      case "save":
        await run(async () => {
          try {
            const dir = join(runtime.getRoot(), ".agent", "transcripts");
            mkdirSync(dir, { recursive: true });
            const file = join(dir, `${runtime.getCurrentSession().id}.md`);
            writeFileSync(file, runtime.exportTranscript(), "utf8");
            apply({ type: "systemMessage", text: `Saved transcript to ${file}` });
          } catch (err) {
            apply({ type: "systemMessage", text: `Save failed: ${String(err)}` });
          }
        });
        return;
      case "plugins":
        apply({ type: "systemMessage", text: "Plugin list is available via `neutron plugin list`." });
        return;
      case "skills": {
        const skills = runtime.listSkills?.() ?? [];
        apply({ type: "systemMessage", text: skills.length ? `Skills: ${skills.map((s) => s.name).join(", ")}` : "No skills found." });
        return;
      }
      default:
        apply({ type: "systemMessage", text: `Command /${name} is not available.` });
        return;
    }
  };

  const runPalette = (id: string) => {
    switch (id) {
      case "search":
        apply({ type: "setView", view: "chat" });
        apply({ type: "setInput", text: "/", cursor: 1 });
        apply({ type: "setCmdDismissed", dismissed: false });
        return;
      case "agent":
        openAgents();
        return;
      case "model":
        openModels();
        return;
      case "provider":
        openProviders();
        return;
      case "new":
        runtime.newSession();
        apply({ type: "setView", view: "chat" });
        apply({ type: "systemMessage", text: "Started a new session." });
        return;
      case "sessions":
        openSessions();
        return;
      case "diff":
        apply({ type: "setDiff", text: runtime.getDiffText?.() ?? "" });
        apply({ type: "setView", view: "diff" });
        return;
      case "undo":
        void runCommand("undo", []);
        return;
      case "redo":
        void runCommand("redo", []);
        return;
      case "init":
        void runCommand("init", []);
        return;
      case "test":
        apply({ type: "setView", view: "chat" });
        void run(async () => {
          await runtime.runTests?.();
        });
        return;
      case "run":
        apply({ type: "setView", view: "chat" });
        runtime.runProject?.();
        return;
      case "mcps":
        openMcps();
        return;
      case "settings":
        apply({ type: "setView", view: "chat" });
        apply({ type: "systemMessage", text: "Settings live in the global config. Run `neutron config` to edit them." });
        return;
      case "themes":
        apply({ type: "setView", view: "chat" });
        apply({ type: "systemMessage", text: "Themes live in the global config. Run `neutron config` to change them." });
        return;
      case "review":
        void runCommand("review", []);
        return;
      case "exit":
        quit();
        return;
      default:
        return;
    }
  };

  const selectOverlay = () => {
    const idx = state.pickIndex;
    switch (state.view) {
      case "agents": {
        const agent = state.agents[idx];
        if (!agent) return;
        void run(async () => {
          await runtime.switchAgent(agent.name);
          apply({ type: "setAgent", agent });
          apply({ type: "setView", view: "chat" });
        });
        return;
      }
      case "models": {
        const model = state.models[idx];
        if (!model) return;
        void run(async () => {
          await runtime.switchModel(model.id);
          apply({ type: "setModel", model: model.id });
          apply({ type: "setProvider", provider: model.provider });
          apply({ type: "setView", view: "chat" });
        });
        return;
      }
      case "providers": {
        const provider = state.providers[idx];
        if (!provider) return;
        void run(async () => {
          await runtime.switchProvider(provider.id);
          apply({ type: "setProvider", provider: provider.id });
          apply({ type: "setModel", model: runtime.getActiveModel?.() ?? "" });
          apply({ type: "setView", view: "chat" });
        });
        return;
      }
      case "sessions": {
        const target = state.sessions[idx];
        if (!target) return;
        runtime.loadSession(target.id);
        apply({ type: "reset" });
        apply({ type: "setView", view: "chat" });
        return;
      }
      case "commands": {
        const action = PALETTE_ACTIONS[idx];
        if (action) runPalette(action.id);
        return;
      }
      case "mcps": {
        const server = state.mcpServers[idx];
        if (!server) return;
        runtime.toggleMcp?.(server.name);
        apply({ type: "setMcpServers", servers: runtime.getMcpServers?.() ?? [] });
        return;
      }
      default:
        return;
    }
  };

  const overlayLength = (): number => {
    switch (state.view) {
      case "agents":
        return state.agents.length;
      case "models":
        return filteredModels.length;
      case "providers":
        return filteredProviders.length;
      case "sessions":
        return state.sessions.length;
      case "commands":
        return PALETTE_ACTIONS.length;
      case "mcps":
        return state.mcpServers.length;
      default:
        return 0;
    }
  };

  const menuCommands: TuiCommand[] =
    (state.view === "home" || state.view === "chat") &&
    state.input.startsWith("/") &&
    !state.input.includes(" ") &&
    !state.cmdDismissed
      ? filterCommands(state.input)
      : [];

  const lineBounds = (value: string, cursor: number) => {
    const start = value.lastIndexOf("\n", cursor - 1) + 1;
    let end = value.indexOf("\n", cursor);
    if (end === -1) end = value.length;
    return { start, end };
  };

  const setText = (text: string, cursor: number) => apply({ type: "setInput", text, cursor });

  const insertText = (raw: string) => {
    const text = sanitizePaste(raw);
    if (!text) return;
    const r = insertAt(state.input, state.cursor, text);
    setText(r.text, r.cursor);
  };

  /** Backspace: remove the character BEFORE the cursor. */
  const deleteBack = () => {
    const r = backspaceAt(state.input, state.cursor);
    if (r.text !== state.input) setText(r.text, r.cursor);
  };

  /** Delete: remove the character AT the cursor (cursor does not move). */
  const deleteForward = () => {
    const r = deleteAt(state.input, state.cursor);
    if (r.text !== state.input) setText(r.text, r.cursor);
  };

  const deleteToLineStart = () => {
    const { start } = lineBounds(state.input, state.cursor);
    if (state.cursor === start) return;
    setText(state.input.slice(0, start) + state.input.slice(state.cursor), start);
  };

  const deleteWord = () => {
    const { start } = lineBounds(state.input, state.cursor);
    let i = state.cursor;
    while (i > start && state.input[i - 1] === " ") i--;
    while (i > start && state.input[i - 1] !== " ") i--;
    setText(state.input.slice(0, i) + state.input.slice(state.cursor), i);
  };

  /** Shared cursor movement for Left/Right/Home/End/Ctrl+arrows. Returns true if handled. */
  const moveCursorKey = (kind: EditKind, key: { leftArrow?: boolean; rightArrow?: boolean }): boolean => {
    if (kind === "home") {
      apply({ type: "setCursor", cursor: lineBounds(state.input, state.cursor).start });
      return true;
    }
    if (kind === "end") {
      apply({ type: "setCursor", cursor: lineBounds(state.input, state.cursor).end });
      return true;
    }
    if (kind === "wordLeft") {
      apply({ type: "setCursor", cursor: wordLeft(state.input, state.cursor) });
      return true;
    }
    if (kind === "wordRight") {
      apply({ type: "setCursor", cursor: wordRight(state.input, state.cursor) });
      return true;
    }
    if (key.leftArrow) {
      apply({ type: "setCursor", cursor: Math.max(0, state.cursor - 1) });
      return true;
    }
    if (key.rightArrow) {
      apply({ type: "setCursor", cursor: Math.min(state.input.length, state.cursor + 1) });
      return true;
    }
    return false;
  };

  const moveUp = () => {
    if (state.input.includes("\n")) {
      const { start } = lineBounds(state.input, state.cursor);
      if (start === 0) return;
      const prevEnd = start - 1;
      const prevStart = state.input.lastIndexOf("\n", prevEnd - 1) + 1;
      const col = state.cursor - start;
      apply({ type: "setCursor", cursor: Math.min(prevStart + col, prevEnd) });
      return;
    }
    const nextIndex = state.historyIndex + 1;
    if (nextIndex < state.history.length) {
      const text = state.history[nextIndex]!;
      apply({ type: "setHistoryIndex", index: nextIndex });
      apply({ type: "setInput", text });
      apply({ type: "setCursor", cursor: text.length });
    }
  };

  const moveDown = () => {
    if (state.input.includes("\n")) {
      const { start, end } = lineBounds(state.input, state.cursor);
      if (end >= state.input.length) return;
      const nextStart = end + 1;
      const rawEnd = state.input.indexOf("\n", nextStart);
      const nextEnd = rawEnd === -1 ? state.input.length : rawEnd;
      const col = state.cursor - start;
      apply({ type: "setCursor", cursor: Math.min(nextStart + col, nextEnd) });
      return;
    }
    const nextIndex = state.historyIndex - 1;
    if (nextIndex >= 0) {
      const text = state.history[nextIndex]!;
      apply({ type: "setHistoryIndex", index: nextIndex });
      apply({ type: "setInput", text });
      apply({ type: "setCursor", cursor: text.length });
    } else {
      apply({ type: "setHistoryIndex", index: -1 });
      apply({ type: "setInput", text: "" });
    }
  };

  const resolveApproval = (approved: boolean, scope: "once" | "session" = "once") => {
    runtime.resolveApproval(approved, scope);
    apply({ type: "resolveApproval", id: state.approval?.id ?? "", approved });
  };

  const isEditing = state.view === "home" || state.view === "chat";

  const needle = state.search.trim().toLowerCase();
  const filteredProviders = needle
    ? state.providers.filter(
        (p) => p.label.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle),
      )
    : state.providers;
  const filteredModels = needle
    ? state.models.filter(
        (m) =>
          m.id.toLowerCase().includes(needle) ||
          (m.providerLabel ?? "").toLowerCase().includes(needle) ||
          m.provider.toLowerCase().includes(needle),
      )
    : state.models;

  const rawKeys = useRawKeys();

  /**
   * Handle one keypress. `input`/`key` mirror Ink's `useInput` arguments and
   * `kind` is the raw-byte edit classification (may be null for plain text).
   */
  const handleKey = (
    input: string,
    key: {
      upArrow?: boolean;
      downArrow?: boolean;
      leftArrow?: boolean;
      rightArrow?: boolean;
      pageUp?: boolean;
      pageDown?: boolean;
      return?: boolean;
      escape?: boolean;
      tab?: boolean;
      ctrl?: boolean;
      meta?: boolean;
      shift?: boolean;
      backspace?: boolean;
      delete?: boolean;
    },
    kind: EditKind,
  ): void => {
    // Rename prompt for sessions.
    if (state.renameTarget !== undefined) {
      if (key.escape) {
        apply({ type: "setRename", target: undefined });
        apply({ type: "setInput", text: "" });
        return;
      }
      if (key.return) {
        runtime.renameSession(state.renameTarget, state.input);
        apply({ type: "setRename", target: undefined });
        apply({ type: "setInput", text: "" });
        apply({ type: "setSessions", sessions: runtime.listSessions() });
        return;
      }
      if (kind === "backspace") return deleteBack();
      if (kind === "delete") return deleteForward();
      if (moveCursorKey(kind, key)) return;
      if (input && !key.ctrl && !key.meta) return insertText(input);
      return;
    }

    if (state.view === "approval") {
      if (input === "y" || input === "Y") resolveApproval(true, "once");
      else if (input === "n" || input === "N" || key.escape) resolveApproval(false, "once");
      else if (input === "a" || input === "A") resolveApproval(true, "session");
      return;
    }

    // Overlays other than editing views.
    if (!isEditing && state.view !== "home") {
      if (key.escape) {
        if (state.view === "models" && state.modelScopeProvider) {
          openProviders();
          return;
        }
        apply({ type: "setView", view: "chat" });
        return;
      }
      if (key.upArrow) {
        apply({ type: "setPickIndex", index: Math.max(0, state.pickIndex - 1) });
        return;
      }
      if (key.downArrow) {
        apply({ type: "setPickIndex", index: Math.min(Math.max(0, overlayLength() - 1), state.pickIndex + 1) });
        return;
      }
      if (state.view === "providers" && state.search === "") {
        if (input === "r" || input === "R") {
          refreshSelectedProvider();
          return;
        }
        if (input === "c" || input === "C") {
          const provider = providerAt();
          if (provider) openProviderConfig(provider.id);
          return;
        }
      }
      if (key.return || key.tab) {
        if (state.view === "help" || state.view === "diff" || state.view === "debug") {
          apply({ type: "setView", view: "chat" });
          return;
        }
        if (state.view === "providers") {
          enterProvider();
          return;
        }
        if (state.view === "models") {
          selectModelEntry();
          return;
        }
        selectOverlay();
        return;
      }
      if (state.view === "providers" || state.view === "models") {
        if (kind === "backspace" || kind === "delete") {
          apply({ type: "setSearch", text: state.search.slice(0, -1) });
          apply({ type: "setPickIndex", index: 0 });
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          const printable = input.replace(/[\x00-\x1f\x7f]/g, "");
          if (printable) {
            apply({ type: "appendSearch", text: printable });
            apply({ type: "setPickIndex", index: 0 });
          }
          return;
        }
      }
      if (state.view === "sessions") {
        if (input === "n") {
          runtime.newSession();
          apply({ type: "reset" });
          apply({ type: "setView", view: "chat" });
          return;
        }
        if (input === "d") {
          const target = state.sessions[state.pickIndex];
          if (target) {
            runtime.deleteSession(target.id);
            apply({ type: "setSessions", sessions: runtime.listSessions() });
            apply({ type: "setPickIndex", index: Math.max(0, state.pickIndex - 1) });
          }
          return;
        }
        if (input === "r") {
          const target = state.sessions[state.pickIndex];
          if (target) {
            apply({ type: "setRename", target: target.id });
            apply({ type: "setInput", text: target.title, cursor: target.title.length });
          }
          return;
        }
      }
      return;
    }

    // Input editing (home + chat).
    if (key.ctrl && input === "c") {
      if (state.input) {
        apply({ type: "setInput", text: "" });
        return;
      }
      if (state.busy) {
        apply({ type: "setStatusLine", status: "Cannot cancel an in-flight request. Press ctrl+c again to quit." });
        return;
      }
      quit();
      return;
    }
    if (key.ctrl && input === "p") return openPalette();
    if (key.ctrl && input === "k") return openModels();
    if (key.ctrl && input === "l") return openModels();
    if (key.ctrl && input === "s") return openSessions();
    if (key.ctrl && input === "n") {
      runtime.newSession();
      apply({ type: "setView", view: "chat" });
      apply({ type: "systemMessage", text: "Started a new session." });
      return;
    }
    if (key.ctrl && input === "r") {
      openProviders();
      void runtime.refreshAllProviders?.().then(() => {
        apply({ type: "setProviders", providers: runtime.getProviders() });
      });
      return;
    }
    if (key.ctrl && input === "u") return deleteToLineStart();
    if (key.ctrl && input === "w") return deleteWord();
    if (key.ctrl && input === "a") {
      const { start } = lineBounds(state.input, state.cursor);
      return apply({ type: "setCursor", cursor: start });
    }
    if (key.ctrl && input === "e") {
      const { end } = lineBounds(state.input, state.cursor);
      return apply({ type: "setCursor", cursor: end });
    }
    if (key.pageUp) return apply({ type: "setScroll", scrollBack: state.scrollBack + Math.max(4, Math.floor(size.rows / 2)) });
    if (key.pageDown) return apply({ type: "setScroll", scrollBack: Math.max(0, state.scrollBack - Math.max(4, Math.floor(size.rows / 2))) });

    if (key.tab) {
      if (menuCommands.length > 0) {
        // Clamp: after filtering, a stale cmdIndex must not wrap around to a
        // different command via `%`.
        const cmd = menuCommands[Math.min(state.cmdIndex, menuCommands.length - 1)];
        if (cmd) {
          apply({ type: "setCmdDismissed", dismissed: true });
          void submit(`/${cmd.name}`);
        }
        return;
      }
      return openAgents();
    }
    if (key.escape) {
      if (menuCommands.length > 0) {
        apply({ type: "setCmdDismissed", dismissed: true });
        return;
      }
      apply({ type: "setError", error: undefined });
      return;
    }
    if (key.return && key.shift) return insertText("\n");
    if (key.return) {
      if (menuCommands.length > 0) {
        // Clamp a stale cmdIndex after filtering instead of wrapping with `%`.
        const cmd = menuCommands[Math.min(state.cmdIndex, menuCommands.length - 1)];
        if (cmd) {
          apply({ type: "setCmdDismissed", dismissed: true });
          void submit(`/${cmd.name}`);
          return;
        }
      }
      submit();
      return;
    }
    if (kind === "backspace") return deleteBack();
    if (kind === "delete") return deleteForward();
    if (moveCursorKey(kind, key)) return;
    if (key.upArrow) {
      if (menuCommands.length > 0) {
        apply({ type: "setCmdIndex", index: Math.max(0, state.cmdIndex - 1) });
        return;
      }
      return moveUp();
    }
    if (key.downArrow) {
      if (menuCommands.length > 0) {
        apply({ type: "setCmdIndex", index: Math.min(menuCommands.length - 1, state.cmdIndex + 1) });
        return;
      }
      return moveDown();
    }
    if (input && !key.ctrl && !key.meta) {
      if (menuCommands.length > 0) apply({ type: "setCmdIndex", index: 0 });
      return insertText(input);
    }
  };

  /**
   * Handle several keystrokes that arrived in one stdin chunk (key repeat,
   * fast typing, laggy link, mobile keyboard). Ink parses the whole chunk as
   * a single keypress and silently drops every key after the first, so each
   * token is handled in order here.
   *
   * State updates are async, so the input box is threaded through a local
   * draft for the duration of the chunk; without that, rapid keystrokes
   * would each read the same stale text and clobber each other. Control keys
   * are delegated to `handleKey` after committing the draft.
   */
  const handleKeyChunk = (tokens: string[]): void => {
    // Fast path only applies to the main editing views; overlays, the rename
    // prompt and the approval view keep per-key handling.
    const editingView =
      state.renameTarget === undefined && (state.view === "home" || state.view === "chat");
    if (!editingView) {
      for (const token of tokens) {
        const parsed = parseToken(token);
        handleKey(parsed.input, parsed.key, classifyRaw(token));
      }
      return;
    }
    const draft = { text: state.input, cursor: state.cursor };
    let detached = false; // draft no longer tracks the input box
    const commit = () => {
      if (!detached && (draft.text !== state.input || draft.cursor !== state.cursor)) {
        apply({ type: "setInput", text: draft.text, cursor: draft.cursor });
      }
    };
    for (const token of tokens) {
      const parsed = parseToken(token);
      const kind = classifyRaw(token);
      if (!detached) {
        if (kind === "backspace") {
          const r = backspaceAt(draft.text, draft.cursor);
          draft.text = r.text;
          draft.cursor = r.cursor;
          continue;
        }
        if (kind === "delete") {
          const r = deleteAt(draft.text, draft.cursor);
          draft.text = r.text;
          draft.cursor = r.cursor;
          continue;
        }
        if (kind === "home") {
          draft.cursor = lineBounds(draft.text, draft.cursor).start;
          continue;
        }
        if (kind === "end") {
          draft.cursor = lineBounds(draft.text, draft.cursor).end;
          continue;
        }
        if (kind === "wordLeft") {
          draft.cursor = wordLeft(draft.text, draft.cursor);
          continue;
        }
        if (kind === "wordRight") {
          draft.cursor = wordRight(draft.text, draft.cursor);
          continue;
        }
        if (parsed.key.leftArrow) {
          draft.cursor = Math.max(0, draft.cursor - 1);
          continue;
        }
        if (parsed.key.rightArrow) {
          draft.cursor = Math.min(draft.text.length, draft.cursor + 1);
          continue;
        }
        if (parsed.key.return && !parsed.key.shift) {
          // Commit the composed text, then submit it. The draft is reset only
          // when submit actually consumed the text, so keystrokes after an
          // ignored Enter keep threading correctly.
          commit();
          if (submit(draft.text)) {
            draft.text = "";
            draft.cursor = 0;
          }
          continue;
        }
        if (parsed.input && !parsed.key.ctrl && !parsed.key.meta) {
          const clean = sanitizePaste(parsed.input);
          if (clean) {
            const r = insertAt(draft.text, draft.cursor, clean);
            draft.text = r.text;
            draft.cursor = r.cursor;
          }
          continue;
        }
      }
      // Control key (tab, ctrl combos, history navigation, escape): commit
      // the draft so state is current, then delegate. Later tokens can no
      // longer trust the draft, so they are delegated too.
      commit();
      detached = true;
      handleKey(parsed.input, parsed.key, kind);
    }
    commit();
  };

  useInput((input, key) => {
    if (state.view === "providerConfig") return;
    const raw = rawKeys.current;
    const tokens = splitRawKeys(raw);
    if (tokens.length > 1) {
      handleKeyChunk(tokens);
      return;
    }
    handleKey(input, key, editKind(key, raw));
  });


  const bottomBar = <BottomBar cwd={state.cwd} branch={state.branch} isRepo={state.isRepo} version={state.version} />;

  if (state.view === "approval" && state.approval) {
    return (
      <Box flexDirection="column" width="100%" height="100%">
        <Box flexGrow={1} flexDirection="column" justifyContent="center">
          <ApprovalPrompt
            approval={state.approval}
            width={size.columns}
            onApprove={() => resolveApproval(true, "once")}
            onDeny={() => resolveApproval(false, "once")}
            onApproveSession={() => resolveApproval(true, "session")}
          />
        </Box>
        {bottomBar}
      </Box>
    );
  }

  if (state.view === "home") {
    return (
      <Box flexDirection="column" width="100%" height="100%">
        <HomeScreen
          width={size.columns}
          agentName={state.agentName}
          model={state.model}
          provider={runtime.getProviderLabel?.(state.provider) ?? state.provider}
          menu={
            menuCommands.length > 0 ? (
              <CommandMenu commands={menuCommands} selected={state.cmdIndex} width={Math.max(40, Math.min(size.columns - 4, 76))} />
            ) : null
          }
          input={<InputBox value={state.input} cursor={state.cursor} placeholder="Ask anything..." />}
        />
        <Box marginTop={1} flexDirection="column">
          <TipBar tip={state.tip} />
          <HelpHint />
        </Box>
        {bottomBar}
      </Box>
    );
  }

  if (state.view !== "chat") {
    return (
      <Box flexDirection="column" width="100%" height="100%">
        <Box flexGrow={1} flexDirection="column" justifyContent="center">
          {renderOverlay()}
        </Box>
        {state.renameTarget !== undefined ? (
          <Box borderStyle={borderStyle} borderColor="yellow" paddingX={2} marginX={2}>
            <Text color="yellow">Rename: </Text>
            <InputBox value={state.input} cursor={state.cursor} bare />
          </Box>
        ) : null}
        <TipBar tip={state.tip} />
        {bottomBar}
      </Box>
    );
  }

  // Chat view.
  const inputLines = Math.min(6, state.input.split("\n").length);
  const reserved = inputLines + 3 + 1 + 1 + 1 + (state.statusLine && state.busy ? 1 : 0) + 1;
  const maxRows = Math.max(4, size.rows - reserved);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <ChatTranscript
          items={state.items}
          streamingText={state.streamingText}
          streaming={state.streaming}
          fileChanges={state.fileChanges}
          agentLabel={state.agentName}
          width={Math.max(20, size.columns - 2)}
          maxRows={maxRows}
          scrollBack={state.scrollBack}
        />
      </Box>
      {state.error ? (
        <Box paddingX={2}>
          <Text color="red">{"✗ "}{state.error}</Text>
        </Box>
      ) : null}
      {state.statusLine && state.busy ? (
        <Box paddingX={2}>
          <Text color="yellow">{state.statusLine}</Text>
        </Box>
      ) : null}
      {menuCommands.length > 0 ? (
        <Box paddingX={1}>
          <CommandMenu commands={menuCommands} selected={state.cmdIndex} width={Math.max(40, Math.min(size.columns - 2, 76))} />
        </Box>
      ) : null}
      <Box
        borderStyle={borderStyle}
        borderColor={state.busy ? "yellow" : "blue"}
        paddingX={2}
        marginX={1}
      >
        <InputBox value={state.input} cursor={state.cursor} placeholder="Ask anything..." prefix="/ " />
      </Box>
      <TipBar tip={state.tip} />
      {bottomBar}
    </Box>
  );

  function renderOverlay() {
    const width = size.columns;
    switch (state.view) {
      case "agents":
        return (
          <ListOverlay
            title="Agents"
            items={agentItems(state.agents)}
            selected={state.pickIndex}
            width={width}
            footer="Enter to switch · Esc to cancel"
          />
        );
      case "models": {
        const scope = state.modelScopeProvider;
        const title = scope ? `${runtime.getProviderLabel?.(scope) ?? scope} Models` : "Select Model";
        return (
          <ModelScreen
            title={title}
            models={filteredModels}
            selected={state.pickIndex}
            search={state.search}
            width={width}
            height={size.rows}
            showProvider={!scope}
            loading={state.modelLoading}
            footer={scope ? "↑↓ navigate · Enter select · / search · Esc back" : "↑↓ navigate · Enter select · / search · Esc back"}
          />
        );
      }
      case "providers": {
        const selectedProvider = filteredProviders[state.pickIndex];
        const detail = selectedProvider ? runtime.getProviderDetail?.(selectedProvider.id) : undefined;
        return (
          <ProviderScreen
            providers={filteredProviders}
            selected={state.pickIndex}
            activeId={state.provider}
            width={width}
            height={size.rows}
            search={state.search}
            {...(detail ? { detail } : {})}
          />
        );
      }
      case "providerConfig": {
        const provider = state.providers.find((p) => p.id === state.configTarget);
        if (!provider) return null;
        return (
          <ProviderConfigPanel
            provider={provider}
            width={width}
            onSave={saveProviderConfig}
            onCancel={() => {
              apply({ type: "setConfig", target: undefined });
              apply({ type: "setView", view: "providers" });
            }}
          />
        );
      }
      case "sessions":
        return (
          <ListOverlay
            title="Sessions"
            items={sessionItems(state.sessions)}
            selected={state.pickIndex}
            width={width}
            footer="Enter resume · n new · r rename · d delete · Esc cancel"
            emptyText="No sessions yet."
          />
        );
      case "commands":
        return (
          <ListOverlay
            title="Commands"
            items={paletteItems()}
            selected={state.pickIndex}
            width={width}
            footer="Enter to run · Esc to cancel"
          />
        );
      case "mcps":
        return (
          <ListOverlay
            title="MCP servers"
            items={mcpItems(state.mcpServers)}
            selected={state.pickIndex}
            width={width}
            footer="Enter to toggle · Esc to cancel"
            emptyText="No MCP servers configured."
          />
        );
      case "help":
        return <HelpView commands={COMMANDS.map((c) => ({ name: c.name, description: c.description }))} width={width} />;
      case "diff":
        return <TextView title="Diff" text={state.diffText} width={width} footer="Esc to close" />;
      case "debug":
        return <TextView title="Debug info" text={state.debugText} width={width} footer="Esc to close" />;
      default:
        return null;
    }
  }
}
