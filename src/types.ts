export interface Model {
  id: string;
  name: string;
  contextWindow: number;
  free: boolean;
  description?: string;
}

export type TaskKind =
  | "architecture"
  | "requirements"
  | "design"
  | "frontend"
  | "backend"
  | "database"
  | "security"
  | "devops"
  | "testing"
  | "review"
  | "simple"
  | "general";

export interface ProviderConfig {
  id: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  enabled: boolean;
  weight?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

export interface ChatResponse {
  text: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface UsageRecord extends ChatResponse {
  ts: number;
  provider: string;
  model: string;
}

export interface ActionResult {
  status: "ok" | "error";
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  interrupted?: boolean;
}

export interface ApprovalRequest {
  message: string;
  command?: string;
  reason: ApprovalReason;
  onApprove: () => Promise<void>;
  onDeny: () => Promise<void>;
}

export type ApprovalReason =
  | "dangerous-command"
  | "destructive"
  | "outside-workspace"
  | "contains-secret"
  | "large-delete"
  | "public-exposure"
  | "package-install";

export interface CompletionGate {
  requirements: number;
  design: number;
  build: number;
  tests: number;
  security: number;
  review: number;
}

export interface ProviderStats {
  totalRequests: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  failoverCount: number;
  cooldownUntil?: number;
}