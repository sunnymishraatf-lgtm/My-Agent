import type { CodeReview, FindingSeverity, ReleaseGate, ReleaseStatus, RepoAnalysis, RepoNode } from "./model";
import { severityRank } from "./security-scanner";

export function buildCodeReview(analysis: RepoAnalysis): CodeReview {
  const findings: Array<{ severity: FindingSeverity; title: string; file: string }> = [];
  for (const n of analysis.nodes) {
    if (n.category === "tests") continue;
    if (n.dependerCount >= 8) {
      findings.push({
        severity: "medium" as FindingSeverity,
        title: `Highly coupled module: ${n.path} is imported by ${n.dependerCount} files`,
        file: n.path,
      });
    }
    if (n.usedIn.length === 0 && n.entry && n.category === "backend") {
      findings.push({
        severity: "info" as FindingSeverity,
        title: `Entry point ${n.path} has no reverse dependencies (expected for a bootstrap file)`,
        file: n.path,
      });
    }
    if (n.recentlyChanged && n.tests.length === 0 && n.category === "backend") {
      findings.push({
        severity: "low" as FindingSeverity,
        title: `Recently changed backend module ${n.path} has no associated tests`,
        file: n.path,
      });
    }
  }

  const testNodes = analysis.nodes.filter((n) => n.category === "tests");
  const implNodes = analysis.nodes.filter((n) => n.category !== "tests" && n.category !== "config" && n.category !== "docs");
  const tested = new Set<string>();
  for (const t of testNodes) {
    for (const use of t.usedIn) tested.add(use);
  }
  const untestedImpl = implNodes.filter((n) => !tested.has(n.id) && !n.entry && n.dependerCount > 0);
  for (const n of untestedImpl.slice(0, 5)) {
    findings.push({
      severity: "low" as FindingSeverity,
      title: `Module ${n.path} is imported but has no direct test coverage`,
      file: n.path,
    });
  }

  const failed = findings.filter((f) => f.severity === "high" || f.severity === "critical");
  const score = Math.max(5, 100 - count(findings, "critical") * 25 - count(findings, "high") * 10 - count(findings, "medium") * 4 - count(findings, "low") * 1 - count(findings, "info") * 0.5);
  const passed = score >= 70 && failed.length === 0;

  return {
    findings,
    score: Math.round(score),
    passed,
    summary: `Code review: ${findings.length} finding(s), score ${Math.round(score)}/100. ${passed ? "PASSED" : "NEEDS ATTENTION"}.`,
    reviewedAt: new Date().toISOString(),
  };
}

function count(findings: Array<{ severity: FindingSeverity }>, s: FindingSeverity): number {
  return findings.filter((f) => f.severity === s).length;
}

export interface ReleaseInput {
  repoAnalysis?: RepoAnalysis;
  implementationDone: boolean;
  buildOk?: boolean;
  /** Optional detail for the Build gate (e.g. "missing node_modules" vs "build failed"). */
  buildDetail?: string;
  tests?: { failed: number; passed: number; total?: number };
  security?: { blocked: boolean };
  codeReview?: { passed: boolean; score: number };
  configOk?: boolean;
  deploymentOk?: boolean;
}

export function evaluateRelease(input: ReleaseInput): ReleaseGate {
  const checks: ReleaseGate["checks"] = [];
  checks.push({ name: "Repository analysis", ok: !!input.repoAnalysis });
  checks.push({ name: "Impact analysis", ok: true });
  checks.push({ name: "Implementation", ok: input.implementationDone });

  const buildOk = input.buildOk === true;
  checks.push({ name: "Build", ok: buildOk, detail: input.buildOk === undefined ? "not evaluated" : input.buildDetail });

  const testsOk = !!input.tests && input.tests.failed === 0;
  checks.push({
    name: "Tests",
    ok: testsOk,
    detail: input.tests && input.tests.total !== undefined ? `${input.tests.passed}/${input.tests.total} passed` : input.tests ? `${input.tests.passed} passed, ${input.tests.failed} failed` : "not evaluated",
  });

  const securityOk = !!input.security && !input.security.blocked;
  checks.push({ name: "Security", ok: securityOk, detail: securityOk ? undefined : "blocking finding(s) present" });

  const reviewOk = !!input.codeReview && input.codeReview.passed;
  checks.push({ name: "Code review", ok: reviewOk, detail: input.codeReview ? `score ${input.codeReview.score}/100` : "not evaluated" });

  const configOk = input.configOk === true;
  checks.push({ name: "Configuration", ok: configOk, detail: input.configOk === undefined ? "not evaluated" : undefined });

  const deploymentOk = input.deploymentOk === true;
  checks.push({ name: "Deployment checks", ok: deploymentOk, detail: input.deploymentOk === undefined ? "not evaluated" : undefined });

  const failedChecks = checks.filter((c) => !c.ok);
  const blockedBy = failedChecks.map((c) => c.name);
  const hardFailures = blockedBy.filter((b) => ["Implementation", "Build", "Tests", "Security"].includes(b));
  const status: ReleaseStatus = hardFailures.length > 0 ? "blocked" : blockedBy.length > 0 ? "not-ready" : "ready-for-review";
  const report = releaseReport(status, checks);

  return { status, checks, blockedBy, report, evaluatedAt: new Date().toISOString() };
}

function releaseReport(status: ReleaseStatus, checks: ReleaseGate["checks"]): string {
  const lines: string[] = [];
  lines.push("RELEASE READINESS");
  lines.push("-----------------");
  for (const c of checks) {
    const mark = c.ok ? "✓" : c.detail ? "⚠" : "✗";
    lines.push(`${mark} ${c.name} ${c.detail ?? ""}`.trimEnd());
  }
  lines.push("");
  lines.push(`STATUS: ${status === "ready-for-review" ? "READY FOR HUMAN REVIEW" : status === "blocked" ? "BLOCKED" : "NOT READY"}`);
  return lines.join("\n");
}

export function formatRelease(gate: ReleaseGate): string {
  return gate.report ?? releaseReport(gate.status, gate.checks);
}

export function severityColor(s: string): string {
  const map: Record<string, string> = { critical: "red", high: "orange", medium: "yellow", low: "green", info: "dim" };
  return map[s] ?? "dim";
}

export function nodeRiskBadge(n: RepoNode): string {
  const map: Record<string, string> = { high: "[HIGH]", medium: "[MED]", low: "[LOW]" };
  return map[n.risk] ?? "[?]";
}