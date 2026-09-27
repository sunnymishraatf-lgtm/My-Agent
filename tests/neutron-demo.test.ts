import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldDemoProject, DEMO_REQUESTS } from "../src/neutron/demo";
import { analyzeRepository } from "../src/neutron/analyzer";
import { analyzeImpact } from "../src/neutron/impact";
import { buildPlan, formatPlan } from "../src/neutron/planner";
import type { MaintenanceRequest } from "../src/neutron/model";

// Hero-demo regression tests: demo scaffold determinism + plan agent labels.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "neutron-demo-"));
  dirs.push(d);
  return d;
}

describe("demo scaffold", () => {
  it("writes the same 23 files on repeated scaffolds", () => {
    const a = tmp();
    const b = tmp();
    const ra = scaffoldDemoProject(a);
    const rb = scaffoldDemoProject(b);
    expect(ra.files).toEqual(rb.files);
    expect(ra.files.length).toBe(23);
    expect(ra.files).toContain("package.json");
    expect(ra.files).toContain("src/routes/auth.js");
    expect(ra.files).toContain("tests/auth.test.js");
    expect(ra.files).toContain("NEUTRON_DEMO.md");
  });

  it("scaffolded package.json is valid and names the project taskflow", () => {
    const d = tmp();
    scaffoldDemoProject(d);
    const pkg = JSON.parse(readFileSync(join(d, "package.json"), "utf8")) as { name: string };
    expect(pkg.name).toBe("taskflow");
  });

  it("contains no real credentials — only placeholders", () => {
    const d = tmp();
    scaffoldDemoProject(d);
    const envExample = readFileSync(join(d, ".env.example"), "utf8");
    expect(envExample).toContain("change-me");
    expect(envExample).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });

  it("hero maintenance request is the OAuth task", () => {
    expect(DEMO_REQUESTS.taskflow).toMatch(/google oauth/i);
    expect(DEMO_REQUESTS.taskflow).toMatch(/email\/password/i);
  });
});

describe("plan agent labels", () => {
  const request: MaintenanceRequest = {
    request: DEMO_REQUESTS.taskflow,
    repository: "taskflow",
    branch: "main",
    riskTolerance: "balanced",
    execution: "plan-only",
  };

  function planOnScaffoldedDemo() {
    const d = tmp();
    scaffoldDemoProject(d);
    const analysis = analyzeRepository(d);
    const graph = analyzeImpact(analysis, request);
    return buildPlan(graph);
  }

  it("renders QA Agent (not the raw key 'testing') for test tasks", () => {
    const plan = planOnScaffoldedDemo();
    const testTasks = plan.tasks.filter((t) => t.agent === "testing");
    expect(testTasks.length).toBeGreaterThan(0);
    const out = formatPlan(plan);
    expect(out).toContain("QA Agent");
    expect(out).not.toContain("Agent: testing");
  });

  it("renders known labels for the standard agent keys", () => {
    const out = formatPlan(planOnScaffoldedDemo());
    expect(out).toMatch(/Agent: (QA|Backend|Frontend|Database|DevOps) Agent/);
  });
});
