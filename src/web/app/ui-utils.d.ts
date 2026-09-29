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

export interface RoomAiContextOptions {
  files?: Array<{ id: string; path: string } | null | undefined> | null;
  activeFileId?: string | null;
  mode?: "file" | "snippet" | "list";
  getText?: (fileId: string) => string | undefined;
  selection?: string | null;
}

export declare function buildRoomAiContext(o: RoomAiContextOptions | null | undefined): {
  text: string;
  filesIncluded: string[];
  truncated: boolean;
};
