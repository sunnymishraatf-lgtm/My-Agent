/* Type declarations for the plain-JS UI utilities (loaded as a classic script). */
export declare const CHAT_RENDER_CAP: number;

export interface DebouncedFunction {
  (...args: any[]): void;
  cancel(): void;
}

export declare function debounce<T extends (...args: any[]) => void>(
  fn: T,
  wait: number
): DebouncedFunction;

export declare function cappedSlice<T>(arr: T[] | null | undefined, cap: number): T[];

export declare function shouldRefreshPill(
  lastMs: number,
  nowMs: number,
  intervalMs: number
): boolean;

export declare function fetchWithTimeout(
  url: string,
  opts: any,
  ms: number,
  deps?: any
): Promise<any>;

export declare function stripAttachmentData<T>(value: T): T;

export declare function copyText(
  text: string | null | undefined,
  deps?: { navigator?: any; document?: any }
): Promise<boolean>;

export declare function fmtTime(ts: number | string | null | undefined): string;

export declare function sanitizeWizard(mz: any): any | null;

export declare function isValidWizardState(obj: any, validSteps: string[]): boolean;

export declare function sanitizeChatHistory(messages: any, cap?: number): any[];

export declare function renderMarkdown(src: string | null | undefined): string;

export declare function stripMarkdownForSpeech(src: string | null | undefined): string;
export declare function friendlyChatError(err: { message?: string; status?: number } | string | null | undefined): string;

/* ----- project brain (device-local project intelligence) ----- */

export declare const PROJECT_STORE_VERSION: number;
export declare const PROJECT_CONTEXT_MAX: number;
export declare const PROJECT_TEXT_SECTIONS: string[];
export declare const PROJECT_LIST_SECTIONS: string[];

export interface ProjectDependency {
  name: string;
  version: string;
  note: string;
}

export interface ProjectMemory {
  architecture: string;
  framework: string;
  database: string;
  deployment: string;
  docs: string;
  languages: string[];
  conventions: string[];
  decisions: string[];
  knownBugs: string[];
  importantFiles: string[];
  apis: string[];
  tasks: string[];
  dependencies: ProjectDependency[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  memory: ProjectMemory;
  linkedConversationIds: string[];
  linkedRepoNames: string[];
}

export interface ProjectStore {
  version: number;
  items: Record<string, Project>;
}

export interface DetectedFramework {
  name: string;
  confidence: "high" | "medium" | "low";
}

export interface DetectedLanguage {
  lang: string;
  files: number;
  pct: number;
}

export interface DetectedDependency {
  name: string;
  version: string;
}

export interface DetectedStack {
  framework: DetectedFramework | null;
  languages: DetectedLanguage[];
  importantFiles: string[];
  dependencies: DetectedDependency[];
}

export interface SecretFinding {
  section: string;
  index: number | null;
  pattern: string;
}

export declare function newProject(id: string, name: string, nowMs: number): Project;
export declare function newProjectMemory(): ProjectMemory;
export declare function projectGet(store: ProjectStore | null | undefined, id: string): Project | null;
export declare function projectRename(store: ProjectStore, id: string, name: string): boolean;
export declare function projectDelete(store: ProjectStore, id: string): boolean;
export declare function projectTouch(store: ProjectStore, id: string, nowMs: number): boolean;
export declare function projectMemory(project: Project | null | undefined): ProjectMemory;
export declare function projectMemorySetText(project: Project, section: string, text: string): boolean;
export declare function projectMemoryAdd(project: Project, section: string, entry: any): number;
export declare function projectMemoryRemove(project: Project, section: string, index: number): boolean;
export declare function projectMemoryUpdate(project: Project, section: string, index: number, value: any): boolean;
export declare function linkConversation(project: Project, convId: string): boolean;
export declare function unlinkConversation(project: Project, convId: string): boolean;
export declare function linkRepo(project: Project, name: string): boolean;
export declare function unlinkRepo(project: Project, name: string): boolean;
export declare function sanitizeProject(item: any): Project | null;
export declare function mostRecentProjectId(store: ProjectStore | null | undefined): string | null;
export declare function looksLikeSecret(value: any): string | null;
export declare function scanProjectSecrets(project: Project | null | undefined): SecretFinding[];
export declare function detectProjectStack(
  files: string[] | null | undefined,
  packageJsonText?: string | null,
  fileContents?: Record<string, string> | null
): DetectedStack;
export declare function parsePackageJson(text: string | null | undefined): any | null;
export declare function buildProjectContextBlock(project: Project | null | undefined, maxChars?: number): string;

/* ----- conversation workspace store (device-local, no accounts) ----- */

export declare const CONV_STORE_VERSION: number;

export interface ConvAttachment {
  name: string;
  size: number;
  mime?: string;
  kind?: string;
  data?: string;
  unavailable?: boolean;
}

export interface ConvMessage {
  role: "user" | "assistant";
  text: string;
  ts?: number;
  failed?: boolean;
  local?: boolean;
  attachments?: ConvAttachment[];
  artifacts?: Array<{ path: string; content: string }>;
}

export interface Conversation {
  id: string;
  title: string;
  renamed: boolean;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  provider: string;
  model: string;
  messages: ConvMessage[];
  projectId: string;
  projectContextOn: boolean;
}

export interface ConvStore {
  version: number;
  activeId: string | null;
  items: Record<string, Conversation>;
}

export interface ConvMeta {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
}

export declare function newConversation(id: string, nowMs: number): Conversation;

export declare function autoTitle(text: string | null | undefined, files?: Array<{ name?: string } | null> | null): string;

export declare function convDisplayTitle(item: Conversation | null | undefined): string;

export declare function relativeTime(ts: number, nowMs: number): string;

export declare function convDayBucket(ts: number, nowMs: number): string;

export declare function groupConversations(
  items: Record<string, Conversation> | null | undefined,
  nowMs: number
): { pinned: ConvMeta[]; groups: Array<{ id: string; label: string; items: ConvMeta[] }> };

export declare function archivedConversations(
  items: Record<string, Conversation> | null | undefined
): ConvMeta[];

export declare function searchConversations(
  items: Record<string, Conversation> | null | undefined,
  query: string | null | undefined
): ConvMeta[];

export declare function sanitizeConversation(item: any): Conversation | null;

export declare function migrateLegacyChat(
  messages: any,
  provider: string | null | undefined,
  model: string | null | undefined,
  nowMs: number,
  id: string
): ConvStore;

export declare function convGet(store: ConvStore | null | undefined, id: string): Conversation | null;

export declare function convSetActive(store: ConvStore | null | undefined, id: string): boolean;

export declare function mostRecentConvId(store: ConvStore | null | undefined, excludeId: string | null): string | null;

export declare function convCreate(store: ConvStore, id: string, nowMs: number): Conversation | null;

export declare function convRename(store: ConvStore, id: string, title: string | null | undefined, nowMs: number): boolean;

export declare function convSetPinned(store: ConvStore, id: string, pinned: boolean): boolean;

export declare function convSetArchived(store: ConvStore, id: string, archived: boolean, nowMs: number): boolean;

export declare function convDelete(store: ConvStore, id: string): boolean;

export declare function convDuplicate(store: ConvStore, id: string, newId: string, nowMs: number): Conversation | null;

export declare function convTouch(
  store: ConvStore,
  id: string,
  nowMs: number,
  firstUserText?: string,
  firstUserFiles?: Array<{ name?: string } | null> | null
): boolean;

/* Universal search + command palette (Phases 14+15). */
export interface PaletteGroupDef { id: string; label: string; icon: string }
export interface PaletteEntry {
  key: string; group: string; title: string; detail: string;
  text: string; body: string; ts: number; ref: any;
}
export interface PaletteHit { entry: PaletteEntry; score: number; snippet: string }
export interface PaletteGroup { group: PaletteGroupDef; items: PaletteHit[] }
export interface PaletteCommandDef { id: string; title: string; hint: string; keywords: string }
export declare const PALETTE_GROUPS: PaletteGroupDef[];
export declare const PALETTE_COMMAND_DEFS: PaletteCommandDef[];
export declare function paletteGroupDef(id: string): PaletteGroupDef;
export declare function paletteBuildIndex(sources: {
  conversations?: Array<{ id: string; title?: string; updatedAt?: number; createdAt?: number; archived?: boolean; excerpt?: string }>;
  projects?: Array<{ id: string; name?: string; updatedAt?: number; createdAt?: number; memoryText?: string }>;
  rooms?: Array<{ code: string; name?: string }>;
  runs?: Array<{ id: string; goal?: string; repo?: string; status?: string; createdAt?: string }>;
  checkpoints?: Array<{ id: string; label?: string; repo?: string; createdAt?: string }>;
  files?: Array<{ repo?: string; path?: string }>;
  githubRepos?: Array<{ fullName: string; description?: string; htmlUrl?: string }>;
}): PaletteEntry[];
export declare function paletteScore(title: string, haystack: string, query: string | null | undefined): number;
export declare function paletteSnippet(text: string | null | undefined, query: string | null | undefined, len?: number): string;
export declare function paletteSearch(
  entries: PaletteEntry[] | null | undefined,
  query: string | null | undefined,
  opts?: { perGroup?: number }
): PaletteGroup[];
export declare function paletteFilterCommands(
  defs: PaletteCommandDef[] | null | undefined,
  query: string | null | undefined
): PaletteCommandDef[];
export declare function paletteMoveSelection(cur: number, delta: number, count: number): number;
export declare function looksLikeFileQuery(q: string | null | undefined): boolean;

/* Collaboration rooms (Phase 1): pure client helpers. */
export declare function normalizeRoomCode(code: unknown): string;
export declare function isValidRoomCode(code: unknown): boolean;
export declare function collabBackoffMs(attempt: number): number;
export declare function sanitizeCollabName(name: unknown): string;
export declare function sanitizeCollabText(text: unknown): string;
export declare function timeAgo(ts: number, nowMs: number): string;

/* Collaborative editing (Phase 2): pure client helpers. */
export declare function b64encodeBytes(bytes: Uint8Array): string;
export declare function b64decodeBytes(str: string): Uint8Array | null;
export declare function encodeSyncFrame(type: number, payload: Uint8Array): Uint8Array;
export declare function decodeSyncFrame(buf: Uint8Array): { type: number; payload: Uint8Array } | null;

export interface TextOp {
  retain?: number;
  delete?: number;
  insert?: string;
}

export declare function diffTextToOps(oldText: string | null | undefined, newText: string | null | undefined): TextOp[];
export declare function indexToLineCol(text: string | null | undefined, index: number): { line: number; col: number };
export declare function sanitizeCollabPath(raw: unknown): string | null;
export declare function pickPresenceColor(memberId: unknown): string;
export declare const PRESENCE_STALE_MS: number;
export declare function isPresenceStale(ts: unknown, nowMs: number, maxAgeMs?: number | null): boolean;
export declare function pruneStalePresence(
  map: Record<string, { ts?: unknown } & Record<string, unknown>> | null | undefined,
  nowMs: number,
  maxAgeMs?: number | null
): Record<string, { ts?: unknown } & Record<string, unknown>>;

export interface CollabFileTreeNode {
  name: string;
  path: string;
  dir: boolean;
  id?: string;
  children?: CollabFileTreeNode[];
  meta?: { id: string; path: string };
}

export declare function buildFileTree(files: Array<{ id: string; path: string } | null | undefined> | null | undefined): CollabFileTreeNode[];

/* Voice calls (Phase 3): pure client helpers. */
export declare const MAX_VOICE_PARTICIPANTS: number;
export declare const DEFAULT_STUN_URLS: string[];
export declare const VOICE_SPEAK_THRESHOLD: number;
export declare function shouldInitiateVoiceOffer(myId: unknown, peerId: unknown): boolean;
export declare function voicePeerUiState(
  connState: unknown
): "connecting" | "connected" | "reconnecting" | "failed" | "idle";
export declare function isSpeakingRms(rms: unknown, threshold?: number): boolean;
export declare function diffVoiceMembers(
  prev: Array<{ id: string } | null | undefined> | null | undefined,
  next: Array<{ id: string } | null | undefined> | null | undefined
): { joined: Array<{ id: string }>; left: Array<{ id: string }> };

/* AI in rooms (Phase 4): pure client helpers. */
export interface RoomEditBlock {
  path: string;
  content: string;
}

export declare function parseRoomEditBlocks(text: string | null | undefined): {
  blocks: RoomEditBlock[];
  stripped: string;
};

export interface LineDiffRow {
  t: " " | "add" | "del";
  text: string;
}

export declare function diffLineBlocks(
  oldText: string | null | undefined,
  newText: string | null | undefined
): LineDiffRow[];

export declare function diffLineStats(
  oldText: string | null | undefined,
  newText: string | null | undefined
): { added: number; removed: number };

export interface UnifiedDiffLine {
  t: " " | "+" | "-";
  text: string;
}

export interface UnifiedDiffHunk {
  header: string;
  lines: UnifiedDiffLine[];
}

export interface UnifiedDiffFile {
  path: string;
  hunks: UnifiedDiffHunk[];
}

export declare function parseUnifiedDiff(
  text: string | null | undefined
): { files: UnifiedDiffFile[] };

export interface CompactDiffRow {
  t: "add" | "del" | "ctx" | "note";
  text: string;
}

export declare function parseCompactDiff(
  text: string | null | undefined
): CompactDiffRow[];

export interface ModelOption {
  value: string;
  label: string;
}

export declare function buildModelOptions(
  defs: unknown,
  customValue: unknown,
  storedModel: unknown
): { options: ModelOption[]; selected: string };

export declare function stopSpeechSynthesis(deps?: {
  window?: unknown;
}): boolean;

export declare function redactSecrets(s: unknown): string;

export declare function githubApiUrl(path: string): string;
export declare function githubAuthHeaders(token: string): Record<string, string>;
export declare function githubErrorMessage(status: number, bodyText: string): string;
export declare function githubRepoUrlOk(url: string): boolean;
export declare function redactGithubToken(text: string, token: string): string;
export declare function githubRequest(path: string, token: string, opts?: { method?: string; body?: unknown }, fetchImpl?: unknown): Promise<unknown>;

export interface JobResultSummary {
  deviations: string[];
  errors: string[];
  execution: {
    completed: number; failed: number; blocked: number; noLlm: boolean;
    changeCount: number;
    changes: Array<{ path: string; kind: string; added: number; removed: number; agent: string; risk: string }>;
  } | null;
  tests: {
    command: string; total: number; passed: number; failed: number;
    hasAfter: boolean; regression: boolean;
    failedTests: string[]; failedTestCount: number;
  } | null;
  security: {
    blocked: boolean; summary: string; findingCount: number; truncated: boolean;
    findings: Array<{ severity: string; title: string; file: string; category: string }>;
  } | null;
  review: {
    blocked: boolean; summary: string; findingCount: number; truncated: boolean;
    findings: Array<{ severity: string; title: string; file: string }>;
    score: number; passed: boolean;
  } | null;
  release: {
    status: string; blockedBy: string[];
    checks: Array<{ name: string; ok: boolean; detail: string }>;
  } | null;
}

export declare function summarizeJobResult(result: unknown): JobResultSummary | null;

export declare function parseJobHistory(raw: unknown): unknown[];

export declare const REVIEW_CATEGORIES: string[];
export declare const REVIEW_DIFF_MAX_CHARS: number;
export interface ReviewFinding {
  category: string;
  problem: string;
  evidence: string;
  why_it_matters: string;
  suggested_fix: string;
}
export declare function buildReviewPrompt(
  diff: unknown,
  opts: { maxChars?: number },
): { system: string; user: string; truncated: boolean };
export declare function parseReviewFindings(
  text: unknown,
): { findings: ReviewFinding[]; raw?: string };
export declare function compactDiffsToUnified(
  files: Array<{ path?: string; diff?: string }> | null | undefined,
): string;
export interface HealthSignals {
  git?: { clean: boolean } | null;
  security?: { counts: Record<string, number> } | null;
  deps?: { counts: { vulnerable?: number; updates?: number } } | null;
  build?: "passed" | "failed" | null;
  tests?: "passed" | "failed" | null;
}
export declare function computeHealth(signals: HealthSignals): {
  overall: "healthy" | "attention" | "unknown";
  items: Array<{ key: string; state: "good" | "attention" | "unknown"; label: string }>;
};
/* terminal: minimal ANSI SGR → HTML (Phases 8+13) */
export declare function ansiToHtml(src: string | null | undefined): string;

/* task management + notification center + activity timeline (Phases 16/27/28) */
export declare const TASK_STORE_VERSION: number;
export declare const TASK_STORE_KEY: string;
export declare const NOTIF_STORE_KEY: string;
export declare const ROOM_ACTIVITY_KEY: string;
export declare const TASK_STATUSES: string[];
export declare const TASK_STATUS_LABELS: Record<string, string>;
export declare const TASK_PRIORITIES: string[];
export declare const TASK_PRIORITY_LABELS: Record<string, string>;
export declare const NOTIF_CAP: number;
export declare const NOTIF_TYPES: string[];
export declare const NOTIF_TYPE_LABELS: Record<string, string>;

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee: string;
  projectId: string;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number;
}
export interface TaskStore {
  version: number;
  items: Record<string, Task>;
}
export interface TaskPatch {
  title?: string;
  description?: string;
  priority?: string;
  assignee?: string;
  projectId?: string;
  conversationId?: string;
}
export interface TaskFilter {
  status?: string;
  projectId?: string;
  q?: string;
}
export declare function newTask(id: string, nowMs: number): Task;
export declare function sanitizeTask(t: any): Task | null;
export declare function taskGet(store: TaskStore | null | undefined, id: string): Task | null;
export declare function taskCreate(store: TaskStore, id: string, nowMs: number): Task | null;
export declare function taskUpdate(store: TaskStore, id: string, patch: TaskPatch, nowMs: number): boolean;
export declare function taskSetStatus(store: TaskStore, id: string, status: string, nowMs: number): boolean;
export declare function taskDelete(store: TaskStore, id: string): boolean;
export declare function taskList(store: TaskStore | null | undefined, filter?: TaskFilter): Task[];
export declare function taskCounts(store: TaskStore | null | undefined): Record<string, number>;
export declare function newTaskId(): string;

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  ts: number;
  read: boolean;
}
export declare function newNotification(
  id: string, type: string, title: string | null | undefined,
  body: string | null | undefined, link: string | null | undefined, nowMs: number
): NotificationItem;
export declare function sanitizeNotification(n: any): NotificationItem | null;
export declare function notifAdd(list: NotificationItem[], n: NotificationItem): NotificationItem[];
export declare function notifMarkRead(list: NotificationItem[], id: string): boolean;
export declare function notifMarkAllRead(list: NotificationItem[]): void;
export declare function notifUnreadCount(list: NotificationItem[] | null | undefined): number;
export declare function defaultNotifPrefs(): Record<string, boolean>;
export declare function sanitizeNotifPrefs(p: any): Record<string, boolean>;
export declare function notifShouldShow(prefs: any, type: string): boolean;
export declare function newNotifId(): string;

export interface TimelineEvent {
  source: string;
  kind: string;
  title: string;
  detail: string;
  ts: number;
  link: string;
}
export declare function timelineEvent(
  source: string, kind: string, title: string | null | undefined,
  detail: string | null | undefined, ts: number, link: string | null | undefined
): TimelineEvent;
export declare function timelineMerge(lists: Array<Array<TimelineEvent> | null | undefined> | null | undefined): TimelineEvent[];
export declare function timelineDayLabel(dayStartMs: number, nowMs: number): string;
export declare function timelineGroupByDay(
  events: TimelineEvent[] | null | undefined, nowMs: number
): Array<{ dayStart: number; label: string; events: TimelineEvent[] }>;

/* Model router + usage dashboard + cost control (Phases 21/23/31) */
export declare const ROUTER_MODE_KEY: string;
export declare const ROUTER_MODES: string[];
export declare const USAGE_STORE_KEY: string;
export declare const USAGE_CAP: number;
export declare const RATES_STORE_KEY: string;
export declare const BUDGET_STORE_KEY: string;
export declare const MAXTOK_STORE_KEY: string;
export declare function sanitizeRouterMode(m: any): "auto" | "manual" | "locked";
export interface TaskClassification { kind: "vision" | "code" | "long" | "chat"; reason: string }
export declare function classifyTask(input: { text?: string | null; hasImages?: boolean } | null | undefined): TaskClassification;
export interface ModelCapabilities { vision: boolean; longContext: boolean; code: boolean; fast: boolean }
export declare function tagModelCapabilities(modelId: string | null | undefined): ModelCapabilities;
export interface RouteCandidate { id: string; providerId?: string }
export interface RouteResult { modelId: string; providerId: string; reason: string; want: string; usedFallback: boolean }
export declare function routeModel(opts: { kind: string; models: RouteCandidate[] } | null | undefined): RouteResult | null;
export interface UsageEntry { ts: number; provider: string; model: string; inTok: number | null; outTok: number | null; latencyMs: number | null; ok: boolean }
export declare function sanitizeUsageEntry(e: any): UsageEntry | null;
export declare function usageAdd(log: any, entry: any, cap?: number): UsageEntry[];
export interface UsageBucket { key: string; label: string; requests: number; inTok: number; outTok: number; unreported: number }
export interface UsageDay { dayStart: number; requests: number; inTok: number; outTok: number }
export interface UsageRollupResult {
  requests: number; succeeded: number; failed: number;
  inTok: number; outTok: number; unreported: number;
  perModel: { [key: string]: UsageBucket };
  perProvider: { [key: string]: UsageBucket };
  perDay: UsageDay[];
}
export declare function usageRollup(log: any, days: number, nowMs?: number): UsageRollupResult;
export declare function validateRate(v: any): number | null;
export interface ModelRate { in: number; out: number }
export declare function estimateCost(inTok: number | null, outTok: number | null, rate: { in?: number | null; out?: number | null } | null | undefined): number | null;
export declare function budgetStatus(spent: any, limit: any): "unset" | "ok" | "warn" | "over";
export declare function sumEstimatedSpend(entries: any, rates: { [modelId: string]: { in: number; out: number } } | null | undefined): { dollars: number; costed: number; skipped: number };
export declare function sanitizeBudget(b: any): { daily: number | null; monthly: number | null };
export declare function sanitizeMaxTokens(v: any): number | null;
export declare const ONBOARDING_STORE_KEY: string;
export declare const ONBOARDING_STEP_COUNT: number;
export declare const DISPLAY_NAME_MAX: number;
export interface OnboardingState { version: number; done: boolean; step: number; name: string; projectType: string }
export declare function sanitizeDisplayName(name: any): string;
export declare function onboardingInitial(): OnboardingState;
export declare function sanitizeOnboarding(raw: any): OnboardingState;
export declare function onboardingNext(st: any): OnboardingState;
export declare function onboardingBack(st: any): OnboardingState;
export declare function onboardingSkip(st: any): OnboardingState;
export declare function onboardingFinish(st: any): OnboardingState;
export declare function onboardingReplay(st: any): OnboardingState;
export declare function greetingForHour(h: any): string;
export declare function dashboardGreeting(name: any, nowMs?: number): string;
export declare function latestItems(items: any, key: string, n: number): any[];
export declare function countOpenTasks(tasks: any): number;
export declare function countUnreadNotifs(notifs: any): number;
export interface ProjectTypeInfo { id: string; label: string; hint: string }
export declare function projectTypeIds(): string[];
export declare function projectTypeList(): ProjectTypeInfo[];
export declare function projectTypeTemplate(typeId: string): { [section: string]: any } | null;
