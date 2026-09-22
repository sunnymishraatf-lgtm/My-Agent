import type { ImpactGraph, ImpactNode, NeutronPlan, NeutronTask, ImpactLevel } from "./model";

const AGENT_BY_CATEGORY: Record<string, string> = {
  frontend: "frontend",
  backend: "backend",
  database: "database",
  tests: "testing",
  config: "devops",
  infrastructure: "devops",
  docs: "testing",
  other: "backend",
};

const CATEGORY_LABEL: Record<string, string> = {
  frontend: "Frontend Agent",
  backend: "Backend Agent",
  database: "Database Agent",
  tests: "Testing Agent",
  config: "DevOps Agent",
  infrastructure: "DevOps Agent",
  docs: "Requirements Agent",
  other: "Backend Agent",
};

const STAGE_ORDER: Record<string, number> = {
  config: 0,
  backend: 1,
  database: 1,
  frontend: 2,
  tests: 3,
  infrastructure: 4,
  other: 1,
};

export function buildPlan(graph: ImpactGraph): NeutronPlan {
  const tasks: NeutronTask[] = [];
  const affectedTests: string[] = [];
  let databaseMigrations = 0;
  const seenTests = new Set<string>();
  const ids = new Set<string>();

  const nextId = (prefix: string): string => {
    let n = 1;
    let id = `${prefix}-${String(n).padStart(3, "0")}`;
    while (ids.has(id)) {
      n++;
      id = `${prefix}-${String(n).padStart(3, "0")}`;
    }
    ids.add(id);
    return id;
  };

  const registerId = (suggested: string, category: string): string => {
    if (suggested && !ids.has(suggested)) {
      ids.add(suggested);
      return suggested;
    }
    return nextId(category.toUpperCase().slice(0, 3));
  };

  const fileNodes = graph.nodes.filter((n) => n.category !== "tests");
  const testNodes = graph.nodes.filter((n) => n.category === "tests");

  const sortNodes = (nodes: ImpactNode[]): ImpactNode[] =>
    nodes.sort(
      (a, b) =>
        (STAGE_ORDER[a.category] ?? 5) - (STAGE_ORDER[b.category] ?? 5) ||
        impactRank(b.impact) - impactRank(a.impact) ||
        b.dependents.length - a.dependents.length,
    );

  const byCategory: Record<string, ImpactNode[]> = {};
  for (const n of sortNodes(fileNodes)) {
    byCategory[n.category] = [...(byCategory[n.category] ?? []), n];
  }

  const depsByCategory: Record<string, string[]> = {};

  const addFileTasks = (category: string, nodes: ImpactNode[], depsFrom: string[]): void => {
    if (!nodes || nodes.length === 0) return;
    const newIds: string[] = [];
    for (const n of nodes) {
      const helper = (n.path.split("/").pop() ?? "change").replace(/\.[^.]+$/, "");
      const suggested = `IMP-${helper}`.replace(/[^A-Za-z0-9._-]/g, "-");
      const id = registerId(suggested, category);
      newIds.push(id);
      tasks.push({
        id,
        label: `Modify ${n.path}`,
        agent: AGENT_BY_CATEGORY[category] ?? "backend",
        files: [n.path],
        dependencies: [...depsFrom],
        risk: n.impact,
        reason: `Modify ${n.path}. ${n.reasons[0] ?? "Part of the requested change."}`,
        status: "pending",
      });
    }
    depsByCategory[category] = newIds;
  };

  addFileTasks("config", byCategory.config ?? [], []);
  addFileTasks("database", byCategory.database ?? [], [...(depsByCategory.config ?? [])]);
  addFileTasks("backend", byCategory.backend ?? [], [...(depsByCategory.config ?? [])]);
  addFileTasks("other", byCategory.other ?? [], [...(depsByCategory.config ?? []), ...(depsByCategory.database ?? [])]);
  addFileTasks("frontend", byCategory.frontend ?? [], [...(depsByCategory.backend ?? []), ...(depsByCategory.config ?? []), ...(depsByCategory.other ?? [])]);
  addFileTasks("infrastructure", byCategory.infrastructure ?? [], [...(depsByCategory.backend ?? []), ...(depsByCategory.frontend ?? [])]);

  if (byCategory.database) databaseMigrations = byCategory.database.length;

  const implDeps = [...new Set([...(depsByCategory.backend ?? []), ...(depsByCategory.frontend ?? []), ...(depsByCategory.database ?? []), ...(depsByCategory.other ?? [])])];

  for (const n of sortNodes(testNodes)) {
    const helper = (n.path.split("/").pop() ?? "test").replace(/\.[^.]+$/, "");
    const id = registerId(`TEST-${helper}`, "testing");
    const underlying = findUnderlyingFiles(graph, n.path);
    if (!seenTests.has(n.path)) {
      affectedTests.push(n.path);
      seenTests.add(n.path);
    }
    tasks.push({
      id,
      label: `Update ${n.path}`,
      agent: "testing",
      files: [n.path],
      dependencies: [...implDeps],
      risk: "low",
      reason: `Test module exercising ${underlying.join(", ") || "the changed behavior"}.`,
      status: "pending",
    });
  }

  const affectedFiles = [...new Set(tasks.map((t) => t.files[0] ?? "").filter(Boolean))];
  const affectedServices = [...new Set(affectedFiles.filter((f) => /controller|service|route|middleware|api|index|app|server/i.test(f)))];
  const overallRisk = overall(graph);
  const summary = `Plan covers ${affectedFiles.length} file(s), ${affectedServices.length} service(s), ${databaseMigrations} migration(s), ${affectedTests.length} test file(s). Overall risk: ${overallRisk.toUpperCase()}.`;

  return { tasks, affectedFiles, affectedServices, databaseMigrations, affectedTests, overallRisk, summary };
}

function findUnderlyingFiles(graph: ImpactGraph, testPath: string): string[] {
  const edge = graph.edges.find((e) => e.to === testPath);
  if (!edge) return [];
  const node = graph.nodes.find((n) => n.id === edge.from);
  return node ? [node.path] : [];
}

export function overall(graph: ImpactGraph): ImpactLevel {
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  let max = 0;
  for (const n of graph.nodes) max = Math.max(max, rank[n.impact]);
  return (["low", "medium", "high", "critical"] as ImpactLevel[])[max - 1] ?? "low";
}

export function formatPlan(plan: NeutronPlan, categoryLabel?: (agent: string) => string): string {
  const labelOf = categoryLabel ?? ((agent: string) => CATEGORY_LABEL[agent] ?? agent);
  const lines: string[] = [];
  lines.push("IMPLEMENTATION PLAN");
  lines.push("-------------------");
  lines.push(`Summary: ${plan.summary}`);
  lines.push("");
  let i = 1;
  for (const t of plan.tasks) {
    const deps = t.dependencies.length ? ` (after ${t.dependencies.join(", ")})` : "";
    lines.push(`${i}. ${t.label} ${deps}`);
    lines.push(`   Agent: ${labelOf(t.agent)} | Risk: ${t.risk.toUpperCase()}`);
    lines.push(`   Reason: ${t.reason}`);
    i++;
  }
  return lines.join("\n");
}

export function impactRank(level: ImpactLevel): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[level] ?? 0;
}