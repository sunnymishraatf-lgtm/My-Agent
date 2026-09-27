import type { RepoAnalysis, RepoNode, ImpactGraph, ImpactNode, ImpactLevel, MaintenanceRequest } from "./model";

const ALIASES: Record<string, string[]> = {
  auth: ["auth", "login", "session", "jwt", "token", "password", "oauth", "signin", "sso"],
  authentication: ["auth", "login", "session", "jwt", "token", "password", "oauth", "signin", "sso"],
  oauth: ["oauth", "google", "github", "login", "auth", "token", "callback", "provider", "sso"],
  google: ["google", "oauth", "login"],
  login: ["login", "auth", "session", "signin"],
  password: ["password", "auth", "login", "credential", "hash", "bcrypt"],
  user: ["user", "profile", "account", "users", "member"],
  profile: ["profile", "user", "account"],
  token: ["token", "jwt", "session", "auth"],
  task: ["task", "tasks", "todo", "todos"],
  todos: ["todo", "task", "tasks"],
  project: ["project", "projects"],
  database: ["database", "db", "model", "migration", "schema", "prisma", "sql"],
  db: ["database", "migration", "model", "schema"],
  api: ["api", "route", "controller", "endpoint", "router"],
  frontend: ["frontend", "ui", "component", "page", "view", "react"],
  backend: ["backend", "controller", "service", "api", "server"],
  deployment: ["deploy", "docker", "vercel", "ci", "cd", "infra", "github"],
  deploy: ["deploy", "docker", "vercel", "infra", "github"],
  email: ["email", "mail", "user", "account"],
  role: ["role", "permission", "authorization", "access"],
  security: ["security", "auth", "permission", "csrf", "oauth"],
  session: ["session", "auth", "cookie", "jwt"],
};

const HIGH_VALUE_NAMES = ["middleware", "auth", "router", "index", "app", "server", "main", "config"];

interface Scored {
  node: RepoNode;
  score: number;
  matched: string[];
  direct: boolean;
}

export function tokenizeRequest(request: string): string[] {
  const raw = request
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  const expanded = new Set<string>();
  for (const t of raw) {
    expanded.add(t);
    for (const alias of ALIASES[t] ?? []) expanded.add(alias);
  }
  return [...expanded];
}

const STOP = new Set(["add", "while", "with", "existing", "preserving", "keep", "change", "into", "from", "the", "and", "our", "system", "application", "product", "support"]);

function meaningful(request: string): string[] {
  return tokenizeRequest(request).filter((t) => !STOP.has(t));
}

function basenameLower(node: RepoNode): string {
  const b = node.name.toLowerCase();
  return b.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/, "");
}

function scoreNode(node: RepoNode, tokens: string[]): { score: number; matched: string[]; direct: boolean } {
  const base = basenameLower(node);
  const full = node.id.toLowerCase();
  const matched: string[] = [];
  let score = 0;
  let direct = false;

  for (const tok of tokens) {
    if (base.includes(tok) || full.includes(tok) || node.exportedNames.some((e) => e.toLowerCase().includes(tok))) {
      matched.push(tok);
      score += 3;
      direct = true;
    }
  }
  // one-char-ish overlapping names like "api" hit many dirs; prefer basename hits
  if (!direct) {
    for (const tok of tokens) {
      if (full.split("/").some((part) => part.toLowerCase().includes(tok) && part !== "")) {
        matched.push(tok);
        score += 1;
        direct = true;
      }
    }
  }

  const baseName = basenameLower(node);
  for (const tok of ["auth", "login", "session", "token", "user", "oauth"]) {
    if (baseName.includes(tok)) {
      score += direct ? 2 : 1;
      if (direct) score += 2;
      break;
    }
  }

  if (node.entry && direct) score += 1;
  if (node.category === "tests" && direct) score += 1;

  return { score, matched: [...new Set(matched)], direct };
}

function levelFor(score: number, direct: boolean, dependents: number, riskTolerance: "safe" | "balanced" | "aggressive", entry: boolean): ImpactLevel {
  // Higher risk tolerance raises the bar for flagging a change as high impact:
  // "safe" flags more aggressively, "aggressive" only flags the most severe.
  // ("balanced" keeps the historical thresholds.)
  const criticalDependents = riskTolerance === "safe" ? 5 : riskTolerance === "balanced" ? 6 : 8;
  const highDependents = riskTolerance === "safe" ? 2 : riskTolerance === "balanced" ? 3 : 5;
  const highScore = riskTolerance === "safe" ? 7 : riskTolerance === "balanced" ? 9 : 12;
  if (dependents >= criticalDependents && direct) return "critical";
  if ((direct && dependents >= highDependents) || score >= highScore) return "high";
  if (direct || dependents >= 2) return "medium";
  if (entry && dependents > 0) return "medium";
  return "low";
}

function reasonFor(node: ImpactNode, dependents: string[], entry: boolean, matched: string[]): string[] {
  const reasons: string[] = [];
  if (entry) reasons.push("Detected as an application entry point; a change here affects startup and wiring.");
  if (dependents.length > 0) {
    reasons.push(`Used by ${dependents.length} other module(s) (${dependents.slice(0, 5).join(", ")}${dependents.length > 5 ? ", ..." : ""}).`);
  }
  if (node.category === "tests") reasons.push("Test module: may need updates to match the changed behavior.");
  if (node.category === "database") reasons.push("Database schema/model: changes may require a migration.");
  if (node.category === "config") reasons.push("Configuration: environment/values may need to change for the new behavior.");
  if (node.category === "infrastructure") reasons.push("Infrastructure/deployment: build and release pipeline may be affected.");
  if (matched.length > 0 && !entry && dependents.length === 0) reasons.push(`Touched by the request keywords (${matched.join(", ")}).`);
  if (reasons.length === 0) reasons.push("Reached through a dependency chain from an affected module.");
  return reasons;
}

export function analyzeImpact(analysis: RepoAnalysis, request: MaintenanceRequest): ImpactGraph {
  const tokens = meaningful(request.request);
  const rawTokens = request.request.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((s) => s.length > 2);

  const scored: Scored[] = [];
  for (const node of analysis.nodes) {
    const s = scoreNode(node, tokens);
    if (s.score > 0) {
      scored.push({ node, score: s.score, matched: s.matched, direct: s.direct });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const selected = scored.filter((s) => s.score >= 1).slice(0, 60);

  // Walk dependents transitively (bounded) and include tests that exercise selected nodes.
  const byKey = new Map<string, RepoNode>(analysis.nodes.map((n) => [n.id, n]));
  const included = new Map<string, ImpactNode>();
  const edges: ImpactGraph["edges"] = [];
  const queue: Array<{ node: RepoNode; depth: number }> = [];

  for (const s of selected) {
    const entry = s.node.entry;
    const level: ImpactLevel = levelFor(s.score, s.direct, s.node.usedIn.length, request.riskTolerance, entry);
    included.set(s.node.id, {
      id: s.node.id,
      path: s.node.id,
      category: s.node.category,
      impact: level,
      confidence: Math.min(0.99, 0.5 + s.score * 0.06),
      reasons: [],
      dependents: s.node.usedIn.slice(),
      matched: s.matched,
    });
    queue.push({ node: s.node, depth: 0 });
  }

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (depth >= 3) continue;
    for (const depId of node.usedIn) {
      if (!included.has(depId)) {
        const dep = byKey.get(depId);
        if (!dep) continue;
        included.set(depId, {
          id: depId,
          path: depId,
          category: dep.category,
          impact: depth === 0 ? "medium" : "low",
          confidence: 0.5,
          reasons: [],
          dependents: dep.usedIn.slice(),
          matched: [],
        });
        queue.push({ node: dep, depth: depth + 1 });
      }
      if (!edges.some((e) => e.from === node.id && e.to === depId)) {
        edges.push({ from: node.id, to: depId, kind: "import" });
      }
    }
    for (const testId of node.tests) {
      const t = byKey.get(testId);
      if (!t) continue;
      if (!included.has(testId)) {
        included.set(testId, {
          id: testId,
          path: testId,
          category: "tests",
          impact: "low",
          confidence: 0.7,
          reasons: [],
          dependents: [],
          matched: [],
        });
      }
      // Record the edge even when the test node was already included (e.g. it
      // matched the request directly) — otherwise test coverage edges go missing.
      if (!edges.some((e) => e.from === node.id && e.to === testId)) {
        edges.push({ from: node.id, to: testId, kind: "test" });
      }
    }
  }

  for (const [id, n] of included) {
    n.reasons = reasonFor(n, n.dependents, byKey.get(id)?.entry ?? false, n.matched);
  }

  const nodes = [...included.values()];
  nodes.sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || b.dependents.length - a.dependents.length || a.path.localeCompare(b.path));

  const summary: ImpactGraph["summary"] = { files: 0, apis: 0, database: 0, frontend: 0, backend: 0, tests: 0, config: 0, infrastructure: 0 };
  for (const n of nodes) {
    summary.files++;
    if (n.category === "backend") {
      summary.backend++;
      if (/api|route|controller|server|index/.test(n.path)) summary.apis++;
    }
    if (n.category === "frontend") summary.frontend++;
    if (n.category === "database") summary.database++;
    if (n.category === "tests") summary.tests++;
    if (n.category === "config") summary.config++;
    if (n.category === "infrastructure") summary.infrastructure++;
  }

  const whatCouldBreak: string[] = [];
  const warnNames = ["auth", "middleware", "session", "router", "index", "user", "server", "main"];
  const warnByCategory: Record<string, string> = {
    backend: "Backend module",
    frontend: "Frontend component",
    database: "Database",
    tests: "Test suite",
    config: "Configuration",
  };
  for (const n of nodes) {
    const base = n.path.split("/").pop()?.toLowerCase() ?? "";
    if (n.dependents.length > 0 && warnNames.some((w) => base.includes(w))) {
      whatCouldBreak.push(base);
    } else if (n.impact === "critical" || n.impact === "high") {
      whatCouldBreak.push(base);
    }
  }
  const safeGuesses = nodes.filter((n) => n.impact === "low" && n.category !== "tests").map((n) => n.path);

  return {
    request,
    requestTokens: rawTokens,
    nodes,
    edges,
    summary,
    whatCouldBreak: [...new Set(whatCouldBreak)].slice(0, 12),
    lowRiskOnes: safeGuesses,
  };
}

function impactRank(level: ImpactLevel): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[level] ?? 0;
}

export function formatImpactGraph(graph: ImpactGraph): string {
  const lines: string[] = [];
  lines.push("IMPACT ANALYSIS");
  lines.push("---------------");
  lines.push(
    `${graph.summary.files} files | ${graph.summary.apis} APIs | ${graph.summary.backend} backend | ${graph.summary.frontend} frontend | ${graph.summary.database} database | ${graph.summary.tests} tests | ${graph.summary.config} config | ${graph.summary.infrastructure} infra`,
  );
  lines.push("");
  for (const n of graph.nodes) {
    lines.push(`${badge(n.impact)} ${n.path}`);
    for (const r of n.reasons) lines.push(`      - ${r}`);
  }
  lines.push("");
  if (graph.whatCouldBreak.length > 0) {
    lines.push("WHAT COULD BREAK?");
    lines.push("------------------");
    lines.push(`Potential impact: ${graph.summary.files} files, ${graph.summary.tests} existing tests.`);
    for (const w of graph.whatCouldBreak) lines.push(`  ⚠ ${w}`);
  }
  return lines.join("\n");
}

export function badge(level: ImpactLevel): string {
  const map: Record<ImpactLevel, string> = { critical: "[CRIT]", high: "[HIGH]", medium: "[MED]", low: "[LOW]" };
  return map[level] ?? "[?]";
}