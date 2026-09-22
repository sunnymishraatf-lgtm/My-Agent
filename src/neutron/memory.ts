import type { ProjectMemoryEntry, RepoAnalysis } from "./model";

export function deriveProjectMemory(analysis: RepoAnalysis): ProjectMemoryEntry[] {
  const out: ProjectMemoryEntry[] = [];

  const backendNodes = analysis.nodes.filter((n) => n.category === "backend");
  const frontendNodes = analysis.nodes.filter((n) => n.category === "frontend");
  const dbNodes = analysis.nodes.filter((n) => n.category === "database");
  const testNodes = analysis.nodes.filter((n) => n.category === "tests");
  const infraNodes = analysis.nodes.filter((n) => n.category === "infrastructure");

  if (analysis.frameworks.length > 0) {
    out.push({ category: "Architecture", title: "Frameworks", value: analysis.frameworks.join(", ") });
  }

  const authFile = backendNodes.find((n) => /auth|session|login|passport|middleware/i.test(n.path));
  if (authFile) {
    out.push({ category: "Authentication", title: "Auth module", value: authFile.path });
  }
  const envVars = new Set<string>();
  for (const n of analysis.nodes) for (const e of n.envVars) envVars.add(e);
  if (envVars.size > 0) {
    out.push({ category: "Configuration", title: "Environment variables", value: [...envVars].sort().slice(0, 12).join(", ") });
  }

  const risky = analysis.nodes.filter((n) => n.risk === "high" || n.risk === "critical");
  if (risky.length > 0) {
    out.push({ category: "Known risk", title: "Modules with high coupling/risk", value: risky.map((r) => r.path).slice(0, 8).join(", ") });
  } else {
    out.push({ category: "Known risk", title: "Modules with high coupling/risk", value: "none identified" });
  }

  if (testNodes.length > 0) {
    const testDirs = new Set(testNodes.map((t) => t.path.includes("/") ? t.path.split("/").slice(0, -1).join("/") : "."));
    out.push({ category: "Testing", title: "Test locations", value: [...testDirs].join(", ") });
  }

  if (dbNodes.length > 0) {
    out.push({ category: "Database", title: "Schema/migrations", value: dbNodes.map((d) => d.path).join(", ") });
  }

  if (infraNodes.length > 0) {
    out.push({ category: "Deployment", title: "Infrastructure", value: infraNodes.map((i) => i.path).join(", ") });
  }

  if (analysis.entryPoints.length > 0) {
    out.push({ category: "Architecture", title: "Entry points", value: analysis.entryPoints.join(", ") });
  }

  if (out.length === 0) {
    out.push({ category: "Repository", title: "Status", value: "No significant structure identified yet." });
  }

  return out;
}

export function formatMemory(entries: ProjectMemoryEntry[]): string {
  const lines: string[] = [];
  lines.push("PROJECT MEMORY");
  lines.push("--------------");
  let last: string | undefined;
  for (const e of entries) {
    if (e.category !== last) {
      lines.push("");
      lines.push(`${e.category}:`);
      last = e.category;
    }
    lines.push(`  ${e.title}: ${e.value}`);
  }
  return lines.join("\n");
}