export { main } from "./cli";
export { runCommand } from "./cli/run-command";
export type { RunCommandOptions } from "./cli/run-command";
export { runDoctor, formatDoctor } from "./cli/doctor";
export type { DoctorReport } from "./cli/doctor";

export * from "./neutron";

export { Orchestrator, createFallbackTasks } from "./orchestrator";
export type { OrchestratorOptions, PlanResult, RunSummary } from "./orchestrator";
export { TaskScheduler } from "./scheduler/scheduler";
export { freshTask, taskId, isTaskFinished, isTaskBlockingFailure } from "./scheduler/task";
export type { Task, TaskStatus, TaskPriority, Issue } from "./scheduler/task";
export { ApiSystem } from "./api/api-manager";
export { ConcurrencyLimit } from "./api/pool";
export { ProviderRegistry, OpenAICompatibleProvider, normalizeBaseUrl } from "./providers";
export type { LLMProvider, ChatStreamChunk, BaseProviderOptions } from "./providers";
export {
  loadConfig,
  defaultConfig,
  readGlobalProviders,
  writeGlobalConfig,
  globalConfigPath,
  redact,
  registerSecrets,
} from "./config";
export type { Config, ConfigProvider, ResolvedConfig, ApiConfig } from "./config";
export { Terminal, classify } from "./terminal/terminal";
export { Approver, confirm } from "./approval/approver";
export { Git } from "./git";
export {
  parseDesignSystem,
  toDesignSystemJson,
  designSystemToCssTokens,
  sectionContent,
  listItems,
  nextLineValue,
} from "./design/parser";
export type { DesignSystem, DesignSystemJson, DesignTheme } from "./design/design";
export { createAgentRegistry, findAgentForTask } from "./agents/registry";
export type { Agent, AgentContext, AgentResult, ReviewResult, AgentRole } from "./agents/agent";
export { StateStore, AGENT_DIR } from "./store";
export {
  ToolRegistry,
  createDefaultTools,
  resolveInWorkspace,
  relativeTo,
  walkFiles,
  globToRegExp,
  webfetchTool,
  skillTool,
  createTaskTool,
  createTodoTools,
  TodoStore,
} from "./tools";
export type { Tool, ToolContext, ToolResult, ToolParameter, TaskRequest, TaskSpawner, TodoItem } from "./tools";
export {
  ChatAgent,
  SessionStore,
  parseToolCalls,
  buildToolInstructions,
  SnapshotStore,
  restoreTurn,
  captureCurrent,
  loadCommands,
  expandCommand,
  parseInput,
  loadAgents,
  findAgent,
  primaryAgents,
  subagents,
  permissionFor,
  isToolAllowed,
  parseAgentMarkdown,
  parseFrontmatter,
  loadSkills,
  findSkill,
  generateAgentsMd,
  initAgentsFile,
  shareSession,
} from "./chat";
export type {
  ChatAgentOptions,
  ChatEvent,
  ChatSession,
  ChatSessionMeta,
  ToolCall,
  TurnSnapshot,
  CustomCommand,
  ParsedInput,
  AgentConfig,
  AgentMode,
  PermissionAction,
  AgentPermission,
  Skill,
} from "./chat";
export { McpClient, connectMcpServers, readMcpConfig } from "./mcp/client";
export type { McpServerConfig, McpToolInfo, McpConnection } from "./mcp/client";
export { LspClient, diagnoseFile, readLspConfig, findServerFor } from "./lsp/client";
export type { LspServerConfig, Diagnostic } from "./lsp/client";
export { startServer, createRequestHandler } from "./server/server";
export type { ServeOptions, RunningServer } from "./server/server";
export { THEMES, listThemes, resolveTheme, loadTheme, setTheme, paint } from "./cli/theme";
export type { Theme, ThemeKey } from "./cli/theme";
export { PluginRunner, loadPlugins, loadPluginFile } from "./plugins/plugins";
export type { Plugin, PluginHooks } from "./plugins/plugins";
export { unifiedDiff, diffTurn, formatDiff } from "./chat/diff";
export type { FileDiff, DiffKind } from "./chat/diff";
export { AcpServer } from "./acp/server";
export type { AcpServerOptions } from "./acp/server";
export {
  installGitHubWorkflow,
  parseGitHubEvent,
  runGitHubAction,
  postIssueComment,
  readEventFromEnv,
} from "./github/actions";
export type { GitHubEventContext, RunGitHubOptions } from "./github/actions";
export { NeutronClient, createClient } from "./sdk/client";
export type { NeutronClientOptions, ChatResult, AgentInfo, SessionInfo, HealthInfo } from "./sdk/client";
export { getVersion } from "./version";
export { CompletionEngine } from "./completion/engine";
export { detectPlatform } from "./platform/platform";
export type { Platform, HostInfo } from "./platform/platform";
export { getContextForTask, discoverRelevantFiles } from "./context/context";
export type { ContextBundle } from "./context/context";
export { DESIGN_TEMPLATE } from "./templates";
export type {
  Model,
  TaskKind,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  UsageRecord,
  ActionResult,
  ApprovalRequest,
  ApprovalReason,
  ProviderStats,
} from "./types";