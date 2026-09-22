import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalDecision, ApprovalResult, ApprovalSource, AuditEvent, Checkpoint, FileChange, HistoryEntry, Metrics, TestResult, SecurityReview, CodeReview, ReleaseGate } from "./model";
import { stateDir } from "../compat";

export interface RunRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  request: string;
  repository: string;
  branch: string;
  stages: Array<{ name: string; status: "done" | "failed" | "skipped"; at: string }>;
  events: AuditEvent[];
  history: HistoryEntry[];
  metrics: Metrics;
  testResult?: TestResult;
  security?: SecurityReview;
  codeReview?: CodeReview;
  release?: ReleaseGate;
  checkpoint?: Checkpoint;
  changeCount: number;
  /** Per-file change list from the last implementation pass. */
  changes: FileChange[];
  /** Full approval decisions (timestamp, decision, gate title, source). */
  approvals: ApprovalDecision[];
  status: string;
}

export class RunRecorder {
  private root: string;
  private dir: string;
  private record: RunRecord;

  constructor(root: string, init?: Partial<RunRecord>) {
    this.root = root;
    this.dir = join(stateDir(root), "runs");
    this.record = {
      id: init?.id ?? `run-${Date.now().toString(36)}`,
      createdAt: init?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      request: init?.request ?? "",
      repository: init?.repository ?? "",
      branch: init?.branch ?? "",
      stages: init?.stages ?? [],
      events: init?.events ?? [],
      history: init?.history ?? [],
      metrics: init?.metrics ?? { repoFilesAnalyzed: 0, affectedFiles: 0, modifiedFiles: 0, agentsExecuted: 0, parallelTasks: 0, maxParallelTasks: 0, testsExecuted: 0, testsPassed: 0, securityFindings: 0, codeReviewFindings: 0, humanApprovals: 0, executionDurationMs: 0 },
      testResult: init?.testResult,
      security: init?.security,
      codeReview: init?.codeReview,
      release: init?.release,
      checkpoint: init?.checkpoint,
      changeCount: init?.changeCount ?? 0,
      changes: init?.changes ?? [],
      approvals: init?.approvals ?? [],
      status: "created",
    };
    void this.dir;
  }

  /** Persist the current record to the run archive (create dirs as needed). */
  save(): void {
    this.record.updatedAt = new Date().toISOString();
    new RunArchive(this.root).add(this.record);
  }

  get(): RunRecord {
    return this.record;
  }

  stage(name: string, status: "done" | "failed" | "skipped"): void {
    const existing = this.record.stages.find((s) => s.name === name);
    const entry = { name, status, at: new Date().toISOString() };
    if (existing) Object.assign(existing, entry);
    else this.record.stages.push(entry);
    this.record.updatedAt = new Date().toISOString();
  }

  audit(agent: string, action: string, detail?: string): void {
    this.record.events.push({ ts: new Date().toISOString(), agent, action, detail });
    this.record.updatedAt = new Date().toISOString();
  }

  history(entry: HistoryEntry): void {
    this.record.history.push({ ...entry, ts: entry.ts ?? new Date().toISOString() });
  }

  setStatus(status: string): void {
    this.record.status = status;
    this.record.updatedAt = new Date().toISOString();
  }

addApproval(a: ApprovalResult): void {
    if (a.approved) {
      this.record.metrics.humanApprovals = (this.record.metrics.humanApprovals ?? 0) + 1;
      this.record.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Persist the full approval decision (timestamp, decision, gate title, source)
   * and emit a detailed audit event. Counters behave like addApproval().
   */
  recordApproval(d: { approved: boolean; title?: string; source?: ApprovalSource; reason?: string }): void {
    const ts = new Date().toISOString();
    this.record.approvals.push({ ts, approved: d.approved, title: d.title, source: d.source, reason: d.reason });
    if (d.approved) {
      this.record.metrics.humanApprovals = (this.record.metrics.humanApprovals ?? 0) + 1;
    }
    const decision = d.approved ? "APPROVED" : "DENIED";
    const detail = [decision, d.title ? `gate="${d.title}"` : undefined, d.source ? `source=${d.source}` : undefined, d.reason ? `reason=${d.reason}` : undefined]
      .filter(Boolean)
      .join(" ");
    this.audit("NEUTRON", "approval decision", `${detail} at=${ts}`);
    this.record.updatedAt = ts;
  }

  setMetrics(patch: Partial<Metrics>): void {
    this.record.metrics = { ...this.record.metrics, ...patch };
  }

  setTestResult(t: TestResult): void {
    this.record.testResult = t;
    this.record.metrics.testsExecuted = t.after?.total ?? 0;
    this.record.metrics.testsPassed = t.after?.passed ?? 0;
    this.record.updatedAt = new Date().toISOString();
  }

  setSecurity(s: SecurityReview): void {
    this.record.security = s;
    this.record.metrics.securityFindings = s.findings.length;
    this.record.updatedAt = new Date().toISOString();
  }

  setCodeReview(c: CodeReview): void {
    this.record.codeReview = c;
    this.record.metrics.codeReviewFindings = c.findings.length;
    this.record.updatedAt = new Date().toISOString();
  }

  setRelease(g: ReleaseGate): void {
    this.record.release = g;
    this.record.updatedAt = new Date().toISOString();
  }

  setCheckpoint(c: Checkpoint): void {
    this.record.checkpoint = c;
    this.record.updatedAt = new Date().toISOString();
  }

  setChanges(changes: FileChange[]): void {
    this.record.changes = changes;
    this.record.changeCount = changes.length;
    this.record.updatedAt = new Date().toISOString();
  }
}

export class RunArchive {
  private dir: string;
  private listFile: string;

  constructor(root: string) {
    const base = stateDir(root);
    this.dir = join(base, "runs");
    this.listFile = join(base, "runs.json");
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  add(rec: RunRecord): void {
    this.ensure();
    writeFileSync(join(this.dir, `${rec.id}.json`), JSON.stringify(rec, null, 2), "utf8");
    const list = this.list();
    const idx = list.findIndex((r) => r.id === rec.id);
    if (idx >= 0) list[idx] = rec; else list.unshift(rec);
    if (list.length > 50) list.length = 50;
    writeFileSync(this.listFile, JSON.stringify(list, null, 2), "utf8");
  }

  list(): RunRecord[] {
    if (!existsSync(this.listFile)) {
      // fall back to scanning run files
      if (!existsSync(this.dir)) return [];
      const ids = readdirSync(this.dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
      const recs: RunRecord[] = [];
      for (const id of ids) {
        const r = this.load(id);
        if (r) recs.push(r);
      }
      recs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return recs.slice(0, 50);
    }
    try {
      const raw = JSON.parse(readFileSync(this.listFile, "utf8")) as RunRecord[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  load(id: string): RunRecord | undefined {
    const p = join(this.dir, `${id}.json`);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as RunRecord;
    } catch {
      return undefined;
    }
  }
}

export function formatHistory(entries: HistoryEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    lines.push(`${time} ${e.stage ? e.stage + " " : ""}${e.event}${e.detail ? " â€” " + e.detail : ""}`);
  }
  return lines.join("\n");
}

export function formatAudit(events: AuditEvent[]): string {
  const lines: string[] = [];
  for (const e of events) {
    const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    lines.push(`${time} ${e.agent} ${e.action}${e.detail ? " â€” " + e.detail : ""}`);
  }
  return lines.join("\n");
}

export function formatMetrics(m: Metrics): string {
  const lines: string[] = [];
  lines.push("METRICS");
  lines.push("-------");
  const rows: Array<[string, number]> = [
    ["Repository files analyzed", m.repoFilesAnalyzed],
    ["Affected files", m.affectedFiles],
    ["Modified files", m.modifiedFiles],
    ["Agents executed", m.agentsExecuted],
    ["Parallel tasks", m.parallelTasks],
    ["Max parallel tasks (cap)", m.maxParallelTasks],
    ["Tests executed", m.testsExecuted],
    ["Tests passed", m.testsPassed],
    ["Security findings", m.securityFindings],
    ["Code review findings", m.codeReviewFindings],
    ["Human approvals", m.humanApprovals],
    ["Execution duration (ms)", m.executionDurationMs],
  ];
  for (const [k, v] of rows) lines.push(`  ${k.padEnd(28)} ${String(v).padStart(5)}`);
  return lines.join("\n");
}
