export type ImpactLevel = "low" | "medium" | "high" | "critical";

export type ChangeKind = "added" | "modified" | "deleted";

export type TaskStatusLike =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped"
  | "cancelled";

export interface RepoNode {
  id: string;
  path: string;
  kind: string;
  category: Category;
  name: string;
  purpose: string;
  language?: string;
  imports: string[];
  exportedNames: string[];
  usedIn: string[];
  envVars: string[];
  tests: string[];
  entry: boolean;
  dependerCount: number;
  risk: ImpactLevel;
  recentlyChanged: boolean;
}

export type Category =
  | "frontend"
  | "backend"
  | "database"
  | "tests"
  | "infrastructure"
  | "config"
  | "docs"
  | "other";

export interface RepoAnalysis {
  root: string;
  analyzedAt: string;
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  entryPoints: string[];
  nodeCount: number;
  nodes: RepoNode[];
  categories: Record<Category, string[]>;
  filesAnalyzed: number;
  warnings: string[];
  health: number;
}

export interface MaintenanceRequest {
  request: string;
  repository: string;
  branch: string;
  riskTolerance: "safe" | "balanced" | "aggressive";
  execution: "plan-only" | "implement" | "implement-and-test";
}

export interface ImpactNode {
  id: string;
  path: string;
  category: Category;
  impact: ImpactLevel;
  confidence: number;
  reasons: string[];
  dependents: string[];
  matched: string[];
}

export interface ImpactGraph {
  request: MaintenanceRequest;
  requestTokens: string[];
  nodes: ImpactNode[];
  edges: Array<{ from: string; to: string; kind: "import" | "test" | "entry" | "config" }>;
  summary: {
    files: number;
    apis: number;
    database: number;
    frontend: number;
    backend: number;
    tests: number;
    config: number;
    infrastructure: number;
  };
  whatCouldBreak: string[];
  lowRiskOnes: string[];
}

export interface NeutronTask {
  id: string;
  label: string;
  agent: string;
  files: string[];
  dependencies: string[];
  risk: ImpactLevel;
  reason: string;
  status: TaskStatusLike;
}

export interface NeutronPlan {
  tasks: NeutronTask[];
  affectedFiles: string[];
  affectedServices: string[];
  databaseMigrations: number;
  affectedTests: string[];
  overallRisk: ImpactLevel;
  summary: string;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  /** Where the decision came from: interactive prompt, `-y` auto-approve, or fail-closed non-TTY deny. */
  source?: ApprovalSource;
  /** Title of the approval gate (e.g. the plan approval title). */
  title?: string;
}

/** How a human approval decision was obtained. */
export type ApprovalSource = "interactive" | "-y" | "non-tty";

/** A persisted approval decision: timestamp, decision, gate title, source. */
export interface ApprovalDecision {
  ts: string;
  approved: boolean;
  title?: string;
  source?: ApprovalSource;
  reason?: string;
}

export interface FileChange {
  path: string;
  kind: ChangeKind;
  linesAdded: number;
  linesRemoved: number;
  agent: string;
  reason: string;
  taskId?: string;
  risk: ImpactLevel;
  before?: string;
  after?: string;
}

export interface Checkpoint {
  id: string;
  createdAt: string;
  repository: string;
  branch: string;
  commit?: string;
  status: "created" | "restored";
}

export interface AuditEvent {
  ts: string;
  agent: string;
  action: string;
  detail?: string;
}

export interface TestSelection {
  node: string;
  reason: string;
  selected: string[];
}

export interface TestResult {
  selection: TestSelection[];
  command: string;
  before?: { total: number; passed: number; failed: number };
  after?: { total: number; passed: number; failed: number };
  executedAt: string;
  truncatedStdout: string;
  regression: boolean;
  failedTests: string[];
}

export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface SecurityFinding {
  severity: FindingSeverity;
  title: string;
  detail?: string;
  file?: string;
  category: string;
}

export interface SecurityReview {
  findings: SecurityFinding[];
  blocked: boolean;
  summary: string;
  scannedAt: string;
}

export interface ReviewFinding {
  severity: FindingSeverity;
  title: string;
  detail?: string;
  file?: string;
}

export interface CodeReview {
  findings: ReviewFinding[];
  score: number;
  passed: boolean;
  summary: string;
  reviewedAt: string;
}

export type ReleaseStatus = "not-ready" | "ready-for-review" | "blocked" | "released";

export interface ReleaseGate {
  status: ReleaseStatus;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  blockedBy: string[];
  report?: string;
  evaluatedAt: string;
}

export interface Metrics {
  repoFilesAnalyzed: number;
  affectedFiles: number;
  modifiedFiles: number;
  agentsExecuted: number;
  parallelTasks: number;
  /** Configured cap on concurrent maintain tasks (NEUTRON_MAX_PARALLEL). */
  maxParallelTasks: number;
  testsExecuted: number;
  testsPassed: number;
  securityFindings: number;
  codeReviewFindings: number;
  humanApprovals: number;
  executionDurationMs: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface HistoryEntry {
  ts: string;
  event: string;
  stage?: string;
  detail?: string;
  taskId?: string;
  agentId?: string;
}

export interface ProjectMemoryEntry {
  category: string;
  title: string;
  value: string;
}

export interface BobActivity {
  hasActivity: boolean;
  source: string;
  repositoryContext: boolean;
  sessionCount: number;
  taskCount: number;
  filesAnalyzed: number;
  filesModified: number;
  testsAssisted: number;
  reviewTaskCount: number;
  sessions: UpdateableBobSession[];
  samples: string[];
  missing: string[];
}

export interface UpdateableBobSession {
  id: string;
  title?: string;
  createdAt?: string;
  eventCount?: number;
  messageCount?: number;
  filesTouched?: string[];
  summary?: string;
}

export interface BobSession {
  id: string;
  title?: string;
  createdAt?: string;
  eventCount: number;
  messageCount: number;
  filesTouched: string[];
  summary?: string;
}

export interface MaintenanceSummary {
  flat: HistoryEntry[];
  agentCount: { running: number; completed: number; waiting: number };
  testSummary: { passed: number; total: number };
  securitySummary: string;
  releaseStatus: ReleaseStatus;
}