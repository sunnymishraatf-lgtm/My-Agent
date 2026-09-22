import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoAnalysis, NeutronPlan, ImpactGraph, TestResult, SecurityReview, CodeReview, ReleaseGate } from "./model";
import type { RunRecord } from "./record";
import { stateDir, BRANCH_PREFIX, LEGACY_BRANCH_PREFIX } from "../compat";

export interface NeutronState {
  repository?: string;
  repositories?: string[];
  analysis?: RepoAnalysis;
  request?: string;
  branch?: string;
  riskTolerance?: "safe" | "balanced" | "aggressive";
  execution?: "plan-only" | "implement" | "implement-and-test";
  graph?: ImpactGraph;
  plan?: NeutronPlan;
  testResult?: TestResult;
  security?: SecurityReview;
  codeReview?: CodeReview;
  release?: ReleaseGate;
  currentStage?: string;
  runId?: string;
  checkpointId?: string;
  pendingApproval?: string;
  awaitingRelease?: boolean;
}

export class NeutronStore {
  private dir: string;
  private file: string;

  constructor(root: string) {
    this.dir = stateDir(root);
    this.file = join(this.dir, "state.json");
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  load(): NeutronState {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as NeutronState;
    } catch {
      return {};
    }
  }

  save(state: NeutronState): void {
    this.ensure();
    writeFileSync(this.file, JSON.stringify(state, null, 2), "utf8");
  }

  update(patch: Partial<NeutronState>): NeutronState {
    const next = { ...this.load(), ...patch };
    this.save(next);
    return next;
  }

  clear(): void {
    this.ensure();
    writeFileSync(this.file, JSON.stringify({}, null, 2), "utf8");
  }
}

export interface CheckpointInfo {
  id: string;
  createdAt: string;
  branch: string;
  commit?: string;
}

export function checkpointExists(root: string, id: string): boolean {
  return [`${BRANCH_PREFIX}/checkpoint/${id}`, `${LEGACY_BRANCH_PREFIX}/checkpoint/${id}`].some((b) => existsSync(join(root, ".git", "refs", "heads", b)));
}

export function checkpointBranchName(id: string): string {
  return `${BRANCH_PREFIX}/checkpoint/${id}`;
}

export function loadRunRecord(root: string, runId: string): RunRecord | undefined {
  const p = join(stateDir(root), "runs", `${runId}.json`);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as RunRecord;
  } catch {
    return undefined;
  }
}