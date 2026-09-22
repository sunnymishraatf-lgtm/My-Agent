import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeRepository } from "../src/neutron/analyzer";
import { analyzeImpact } from "../src/neutron/impact";
import type { MaintenanceRequest, RepoAnalysis, RepoNode } from "../src/neutron/model";

function fakeNode(overrides: Partial<RepoNode> & { id: string }): RepoNode {
  return {
    path: overrides.id,
    kind: "TS",
    category: "backend",
    name: overrides.id.split("/").pop() ?? overrides.id,
    purpose: "",
    imports: [],
    exportedNames: [],
    usedIn: [],
    envVars: [],
    tests: [],
    entry: false,
    dependerCount: 0,
    risk: "low",
    recentlyChanged: false,
    ...overrides,
  };
}

function fakeAnalysis(nodes: RepoNode[]): RepoAnalysis {
  return {
    root: "/fake",
    analyzedAt: new Date().toISOString(),
    languages: ["TypeScript"],
    frameworks: [],
    packageManagers: [],
    entryPoints: [],
    nodeCount: nodes.length,
    nodes,
    categories: { frontend: [], backend: [], database: [], tests: [], infrastructure: [], config: [], docs: [], other: [] },
    filesAnalyzed: nodes.length,
    warnings: [],
    health: 80,
  };
}

function fakeRequest(riskTolerance: MaintenanceRequest["riskTolerance"], request = "harden auth login flow"): MaintenanceRequest {
  return { request, repository: "fake", branch: "main", riskTolerance, execution: "plan-only" };
}

describe("analyzer import resolution", () => {
  it("resolves imports relative to the repo root when cwd differs from the root", () => {
    const root = mkdtempSync(join(tmpdir(), "neutron-analyzer-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "utils.ts"), "export const x = 1;\n");
    writeFileSync(join(root, "src", "index.ts"), "import { x } from './utils';\nconsole.log(x);\n");
    writeFileSync(
      join(root, "src", "utils.test.ts"),
      "import { x } from './utils';\ntest('x', () => { if (x !== 1) throw new Error('bad'); });\n",
    );
    const prevCwd = process.cwd();
    process.chdir(tmpdir()); // cwd != repo root
    try {
      const analysis = analyzeRepository(root);
      const utils = analysis.nodes.find((n) => n.id === "src/utils.ts");
      expect(utils).toBeDefined();
      // usedIn is populated with repo-relative ids, not cwd-anchored paths
      expect(utils!.usedIn).toContain("src/index.ts");
      expect(utils!.usedIn).toContain("src/utils.test.ts");
      expect(utils!.dependerCount).toBe(2);
      // test file association works too
      expect(utils!.tests).toContain("src/utils.test.ts");
    } finally {
      process.chdir(prevCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves imports when cwd equals the repo root", () => {
    const root = mkdtempSync(join(tmpdir(), "neutron-analyzer-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "utils.ts"), "export const x = 1;\n");
    writeFileSync(join(root, "src", "index.ts"), "import { x } from './utils';\n");
    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      const analysis = analyzeRepository(root);
      const utils = analysis.nodes.find((n) => n.id === "src/utils.ts");
      expect(utils!.usedIn).toContain("src/index.ts");
    } finally {
      process.chdir(prevCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("impact riskTolerance", () => {
  it("yields different impact classification for the same input under different riskTolerance", () => {
    const authNode = fakeNode({
      id: "src/auth.ts",
      category: "backend",
      usedIn: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      dependerCount: 4,
    });
    const impactOf = (t: MaintenanceRequest["riskTolerance"]) =>
      analyzeImpact(fakeAnalysis([fakeNode({ ...authNode })]), fakeRequest(t)).nodes.find((n) => n.id === "src/auth.ts")!.impact;

    // 4 dependents, direct match: "safe" flags high, "aggressive" only medium
    expect(impactOf("safe")).toBe("high");
    expect(impactOf("balanced")).toBe("high");
    expect(impactOf("aggressive")).toBe("medium");
    expect(impactOf("safe")).not.toBe(impactOf("aggressive"));
  });
});

describe("impact test edges", () => {
  it("records test edges even when the test node is already included", () => {
    const impl = fakeNode({ id: "src/auth.ts", category: "backend", tests: ["tests/auth.test.ts"], exportedNames: ["authenticate"] });
    const test = fakeNode({ id: "tests/auth.test.ts", category: "tests" });
    // "update auth" directly matches both the impl module and the test file,
    // so the test node is already in the included set when the impl is visited.
    const graph = analyzeImpact(fakeAnalysis([impl, test]), fakeRequest("balanced", "update auth"));
    const edges = graph.edges.filter((e) => e.from === "src/auth.ts" && e.to === "tests/auth.test.ts" && e.kind === "test");
    expect(edges.length).toBe(1);
  });
});
