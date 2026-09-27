import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { Category, ImpactLevel, RepoAnalysis, RepoNode } from "./model";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".agent",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "target",
  ".neutron",
  ".sunny",
]);

const EXT_LANG: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".sql": "SQL",
  ".prisma": "Prisma",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".json": "JSON",
  ".toml": "TOML",
  ".md": "Markdown",
  ".sh": "Shell",
  ".ps1": "PowerShell",
  ".env": "Env",
  ".env.example": "Env",
};

const INFRA_NAMES = new Set([
  ".github",
  "docker",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "infra",
  "deploy",
  ".github/workflows",
  "vercel.json",
  "netlify.toml",
  "render.yaml",
  "fly.toml",
  "k8s",
  "helm",
  "terraform",
  "cloudformation",
  "caddy",
  "nginx.conf",
  "nginx",
]);

const FRONTEND_MARKERS = ["pages", "components", "components/", "src/pages", "src/components", "app/"].map((m) => m.toLowerCase());
const BACKEND_MARKERS = ["controllers", "routes", "services", "api", "middleware", "src/api", "src/services", "src/routes"].map((m) => m.toLowerCase());
const DB_MARKERS = ["models", "migrations", "schema", "prisma"].map((m) => m.toLowerCase());
const TEST_MARKERS = ["test", "spec", "__tests__"];

const HIGH_RISK_NAMES = ["middleware", "auth", "router", "index", "app", "server", "main", "config"];

function isTestFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".test.ts") ||
    lower.endsWith(".test.tsx") ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".test.jsx") ||
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".spec.js") ||
    lower.includes(".test.") ||
    lower.includes(".spec.")
  );
}

function readSafe(file: string, maxBytes = 256_000): string | undefined {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function walkFiles(root: string, max = 1500): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < max) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!EXCLUDED_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (treatAsText(e.name)) out.push(full);
    }
  }
  return out;
}

function treatAsText(name: string): boolean {
  const ext = extname(name).toLowerCase();
  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) return true;
  if (name === "Makefile" || name === "Justfile") return true;
  return [
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
    ".rb", ".php", ".cs", ".sql", ".prisma", ".css", ".scss", ".html", ".yml",
    ".yaml", ".json", ".toml", ".md", ".sh", ".ps1", ".env", ".env.example",
    ".lock", ".vue", ".svelte",
  ].includes(ext);
}

function categorize(rel: string, name: string, content?: string): Category {
  const lower = rel.toLowerCase();
  if (isTestFile(name)) return "tests";
  if (lower === "readme.md" || lower.endsWith("/readme.md") || lower.endsWith(".md")) return "docs";
  if (lower.startsWith(".github") || lower.startsWith("docker/") || lower.startsWith("infra/") || lower.startsWith("deploy/")) return "infrastructure";
  if (name === "Dockerfile" || name === "docker-compose.yml" || name === "docker-compose.yaml" || name === "vercel.json") return "infrastructure";
  if (name === "package.json" || name === "package-lock.json" || name === "pnpm-lock.yaml" || name === "yarn.lock" || name === "tsconfig.json" || name === "tsconfig.app.json" || name === ".env.example" || name === ".env.sample" || name === "vitest.config.ts" || name === "vitest.config.js" || name === "vite.config.ts" || name === "vite.config.js" || name === "next.config.js" || name === "next.config.mjs" || name === ".gitignore" || name === ".npmrc" || name.startsWith(".")) {
    return "config";
  }
  if (lower.includes("prisma") || lower === "schema.sql" || lower.includes("/migrations/") || lower.includes("/models/")) return "database";
  for (const m of FRONTEND_MARKERS) if (lower.includes(m)) return "frontend";
  for (const m of BACKEND_MARKERS) if (lower.includes(m)) return "backend";
  if (lower.includes("/db/") || lower.includes("schema")) return "database";
  for (const m of DB_MARKERS) if (lower.includes(m)) return "database";
  return "other";
}

const IMPORT_RE = /\b(?:import|require)\s*\(?\s*['"]([^'"]+)['"]\)?/g;
const FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/g;

function extractImports(content: string): string[] {
  const out: string[] = [];
  const push = (m: RegExpExecArray) => {
    const spec = (m[1] ?? "").trim();
    if (!spec) return;
    if (spec.startsWith(".")) out.push(spec);
    else if (!out.includes(spec)) out.push(spec);
  };
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) push(m);
  FROM_RE.lastIndex = 0;
  while ((m = FROM_RE.exec(content)) !== null) push(m);
  return [...new Set(out)];
}

const EXPORT_RE = /export\s+(?:default\s+)?(?:const|function|class|let|var|async\s+function)?\s*(\w+)/g;

function extractExported(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(content)) !== null) {
    if (m[1] && m[1] !== "default") out.push(m[1]);
  }
  const def = content.match(/export\s+default\s+(\w+)/);
  if (def?.[1]) out.push(def[1]);
  return [...new Set(out)];
}

const ENV_RE = /process\.env\.([A-Z0-9_]+)/g;

function extractEnv(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ENV_RE.lastIndex = 0;
  while ((m = ENV_RE.exec(content)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return [...new Set(out)];
}

function resolveImportSpecifier(root: string, rel: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = resolveDir(rel);
  // Resolve against the repository root, never process.cwd(): `resolve` with a
  // relative base would otherwise anchor to the launch directory and break
  // usedIn/test associations whenever cwd != repo root.
  const candidate = normalizePosix(relative(root, resolve(root, base, spec)));
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js", "/index.tsx", "/index.jsx"];
  for (const e of exts) {
    const p = candidate + e;
    if (p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".mjs") || p.endsWith(".cjs")) {
      return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
    }
  }
  return undefined;
}

function resolveDir(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx >= 0 ? rel.slice(0, idx) : ".";
}

function normalizePosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function dagRisk(names: string[]): ImpactLevel {
  for (const f of names) {
    const base = basename(f).toLowerCase();
    if (HIGH_RISK_NAMES.some((h) => base.includes(h))) return "high";
  }
  return "medium";
}

interface RecentSet {
  hasFile(file: string): boolean;
}

function recentGitFiles(root: string, limit = 30): Set<string> {
  const out = new Set<string>();
  if (!existsSync(join(root, ".git"))) return out;
  try {
    const raw = execSync("git log --name-only --pretty=format: -20", {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 20_000,
    });
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t) out.add(normalizePosix(t).replace(/\\/g, "/"));
    }
  } catch {
    /* no git history */
  }
  return out;
}

export function analyzeRepository(root: string): RepoAnalysis {
  const files = walkFiles(root);
  const nodes: RepoNode[] = [];
  const normalized = new Map<string, string>();

  for (const f of files) {
    const rel = normalizePosix(relative(root, f));
    const content = readSafe(f);
    const name = basename(f);
    const ext = extname(f).toLowerCase();
    const language = EXT_LANG[ext] ?? (name === "Dockerfile" ? "Dockerfile" : undefined);
    normalized.set(rel, f);

    nodes.push({
      id: rel,
      path: rel,
      kind: name.includes(".") ? ext.replace(".", "").toUpperCase() : "FILE",
      category: categorize(rel, name, content),
      name,
      purpose: "",
      language,
      imports: content ? extractImports(content).filter((s) => s.startsWith(".")) : [],
      exportedNames: content ? extractExported(content) : [],
      usedIn: [],
      envVars: content ? extractEnv(content) : [],
      tests: [],
      entry: false,
      dependerCount: 0,
      risk: "low",
      recentlyChanged: false,
    });
  }

  const nodeByKey = new Map<string, RepoNode>();
  for (const n of nodes) nodeByKey.set(stripExt(n.id), n);
  for (const f of files) {
    const rel = normalizePosix(relative(root, f));
    const node = nodeByKey.get(stripExt(rel));
    if (!node) continue;
    const content = readSafe(f);
    if (!content) continue;
    for (const spec of extractImports(content)) {
      if (!spec.startsWith(".")) continue;
      const target = resolveImportSpecifier(root, rel, spec);
      if (!target) continue;
      const key = stripExt(target);
      const dep = nodeByKey.get(key);
      if (dep && dep.id !== node.id) {
        if (!dep.usedIn.includes(node.id)) dep.usedIn.push(node.id);
      }
    }
  }

  const recent = recentGitFiles(root);

  for (const n of nodes) {
    n.usedIn.sort();
    n.dependerCount = n.usedIn.length;
    n.recentlyChanged = recent.has(n.id);
    n.risk = riskFor(n);
    n.purpose = purposeFor(categorize(n.id, n.name), n);
  }

  // test association: a test <-depends on-> implementation module
  const testNodes = nodes.filter((n) => n.category === "tests");
  const implById = new Map(nodes.filter((n) => n.category !== "tests").map((n) => [stripExt(n.id), n]));
  for (const t of testNodes) {
    const content = readSafe(join(root, t.id));
    if (!content) continue;
    for (const spec of extractImports(content)) {
      if (!spec.startsWith(".")) continue;
      const target = resolveImportSpecifier(root, t.id, spec);
      if (!target) continue;
      const impl = implById.get(stripExt(target));
      if (impl && !impl.tests.includes(t.id)) impl.tests.push(t.id);
    }
  }
  for (const n of nodes) n.tests.sort();

  const entryPoints = detectEntryPoints(root, nodes);
  for (const e of entryPoints) nodeByKey.get(stripExt(e)) ?? null;
  for (const n of nodes) {
    if (entryPoints.includes(n.id)) n.entry = true;
  }

  const frameworks = detectFrameworks(root);
  const packageManagers = detectPackageManagers(root);
  const languages = [...new Set(nodes.map((n) => n.language).filter((l): l is string => !!l))];

  const categories: RepoAnalysis["categories"] = {
    frontend: [],
    backend: [],
    database: [],
    tests: [],
    infrastructure: [],
    config: [],
    docs: [],
    other: [],
  };
  for (const n of nodes) categories[n.category].push(n.id);

  const warnings: string[] = [];
  if (nodes.length === 0) warnings.push("No analyzable source files found.");
  if (files.length >= 1500) warnings.push("Repository is large; analysis capped at 1500 files.");

  return {
    root,
    analyzedAt: new Date().toISOString(),
    languages,
    frameworks,
    packageManagers,
    entryPoints,
    nodeCount: nodes.length,
    nodes,
    categories,
    filesAnalyzed: files.length,
    warnings,
    health: healthScore(nodes, entryPoints),
  };
}

function stripExt(p: string): string {
  return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

function riskFor(node: RepoNode): ImpactLevel {
  const base = basename(node.id).toLowerCase();
  if (
    HIGH_RISK_NAMES.some((h) => base.includes(h)) &&
    (node.category === "backend" || node.category === "config" || node.category === "infrastructure")
  ) {
    return "high";
  }
  if (node.usedIn.length >= 5) return "high";
  if (node.usedIn.length >= 2) return "medium";
  if (node.usedIn.some((u) => u.toLowerCase().includes("middleware") || u.toLowerCase().includes("auth"))) return "medium";
  return "low";
}

function purposeFor(category: Category, node: RepoNode): string {
  const name = node.name;
  switch (category) {
    case "tests":
      return `Test suite exercising ${node.usedIn.length} implementation module(s).`;
    case "frontend":
      return `Frontend ${name.includes(".") ? name.split(".")[0] : name} UI module.`;
    case "backend":
      return `Backend module (${name.includes(".") ? name.split(".")[0] : name}).`;
    case "database":
      return `${name.includes(".") ? name.split(".")[0] : name} — database schema/model/migration.`;
    case "infrastructure":
      return `Deployment/build infrastructure (${name}).`;
    case "config":
      return `Configuration (${name}).`;
    case "docs":
      return "Documentation.";
    default:
      return "Source module.";
  }
}

function detectEntryPoints(root: string, nodes: RepoNode[]): string[] {
  const names = ["server.ts", "server.js", "app.ts", "app.js", "index.ts", "index.js", "main.tsx", "main.jsx", "cli.ts", "cli.js", "entry.ts", "entry.js"];
  const found: string[] = [];
  for (const n of nodes) {
    const lower = n.name.toLowerCase();
    if (names.includes(lower) || n.name.startsWith("Dockerfile")) {
      if (n.category === "backend" || n.category === "frontend" || n.category === "other") found.push(n.id);
    }
  }
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const data = JSON.parse(readFileSync(pkg, "utf8")) as { main?: string; bin?: Record<string, string> | string };
      for (const p of [data.main, ...(typeof data.bin === "string" ? [data.bin] : Object.values(data.bin ?? {}))]) {
        if (p) {
          const rel = normalizePosix(p).replace(/^\.\//, "").replace(/\.(ts|js)$/, "");
          const match = nodes.find((n) => stripExt(n.id) === rel);
          if (match && !found.includes(match.id)) found.push(match.id);
        }
      }
    } catch {
      /* ignore malformed package.json */
    }
  }
  return found;
}

function detectFrameworks(root: string): string[] {
  const frameworks: string[] = [];
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const data = JSON.parse(readFileSync(pkg, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const all = { ...data.dependencies, ...data.devDependencies };
      for (const dep of Object.keys(all)) {
        const d = dep.toLowerCase();
        if (d === "react" || d === "next") frameworks.push(d === "next" ? "Next.js" : "React");
        else if (d === "express") frameworks.push("Express");
        else if (d === "fastify") frameworks.push("Fastify");
        else if (d === "@nestjs/core") frameworks.push("NestJS");
        else if (d === "vue" || d === "nuxt") frameworks.push(d === "nuxt" ? "Nuxt" : "Vue");
        else if (d === "svelte" || d === "@sveltejs/kit") frameworks.push("Svelte");
        else if (d === "@prisma/client") frameworks.push("Prisma");
        else if (d === "django" || d === "flask") frameworks.push(d === "django" ? "Django" : "Flask");
        else if (d === "express-session") frameworks.push("Express-session");
      }
    } catch {
      /* ignore */
    }
  }
  return [...new Set(frameworks)];
}

function detectPackageManagers(root: string): string[] {
  const out: string[] = [];
  if (existsSync(join(root, "package-lock.json"))) out.push("npm");
  if (existsSync(join(root, "pnpm-lock.yaml"))) out.push("pnpm");
  if (existsSync(join(root, "yarn.lock"))) out.push("yarn");
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) out.push("bun");
  if (out.length === 0 && existsSync(join(root, "package.json"))) out.push("npm");
  if (existsSync(join(root, "requirements.txt"))) out.push("pip");
  if (existsSync(join(root, "go.mod"))) out.push("go modules");
  if (existsSync(join(root, "Cargo.toml"))) out.push("cargo");
  return out;
}

function healthScore(nodes: RepoNode[], entryPoints: string[]): number {
  let score = 60;
  if (nodes.length > 0) score += 10;
  if (entryPoints.length > 0) score += 5;
  const tests = nodes.filter((n) => n.category === "tests").length;
  if (tests > 0) score += Math.min(15, tests * 2);
  const config = nodes.filter((n) => n.category === "config").length;
  if (config > 0) score += 5;
  const hasReadme = nodes.some((n) => n.category === "docs");
  if (hasReadme) score += 5;
  return Math.max(0, Math.min(99, score));
}

export function repoNodeIds(analysis: RepoAnalysis): Map<string, RepoNode> {
  return new Map(analysis.nodes.map((n) => [n.id, n]));
}

export function toRepoMap(analysis: RepoAnalysis): { name: string; children: RepoNode[] }[] {
  const byCat: Record<string, RepoNode[]> = {
    Frontend: [],
    Backend: [],
    Database: [],
    Tests: [],
    Infrastructure: [],
    Config: [],
    Docs: [],
    Other: [],
  };
  for (const n of analysis.nodes) {
    const key = n.category === "frontend" ? "Frontend" : n.category === "backend" ? "Backend" : n.category === "database" ? "Database" : n.category === "tests" ? "Tests" : n.category === "infrastructure" ? "Infrastructure" : n.category === "config" ? "Config" : n.category === "docs" ? "Docs" : "Other";
    byCat[key]?.push(n);
  }
  return Object.entries(byCat)
    .filter(([, v]) => v.length > 0)
    .map(([name, children]) => ({ name, children }));
}