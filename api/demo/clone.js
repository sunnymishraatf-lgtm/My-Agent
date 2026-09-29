var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/server/demo.ts
import { execFile } from "node:child_process";
import { existsSync as existsSync13, mkdirSync as mkdirSync7, readdirSync as readdirSync6, statSync as statSync5, readFileSync as readFileSync10 } from "node:fs";
import { dirname as dirname4, join as join14, normalize, relative as relative6, resolve as resolve9, sep as sep3 } from "node:path";

// src/neutron/analyzer.ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { execSync } from "node:child_process";
var EXCLUDED_DIRS = /* @__PURE__ */ new Set([
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
  ".sunny"
]);
var EXT_LANG = {
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
  ".env.example": "Env"
};
var FRONTEND_MARKERS = ["pages", "components", "components/", "src/pages", "src/components", "app/"].map((m) => m.toLowerCase());
var BACKEND_MARKERS = ["controllers", "routes", "services", "api", "middleware", "src/api", "src/services", "src/routes"].map((m) => m.toLowerCase());
var DB_MARKERS = ["models", "migrations", "schema", "prisma"].map((m) => m.toLowerCase());
var HIGH_RISK_NAMES = ["middleware", "auth", "router", "index", "app", "server", "main", "config"];
function isTestFile(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(".test.ts") || lower.endsWith(".test.tsx") || lower.endsWith(".test.js") || lower.endsWith(".test.jsx") || lower.endsWith(".spec.ts") || lower.endsWith(".spec.js") || lower.includes(".test.") || lower.includes(".spec.");
}
function readSafe(file, maxBytes = 256e3) {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return void 0;
    return readFileSync(file, "utf8");
  } catch {
    return void 0;
  }
}
function walkFiles(root, max = 1500) {
  const out = [];
  const stack = [root];
  while (stack.length > 0 && out.length < max) {
    const dir = stack.pop();
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
function treatAsText(name) {
  const ext = extname(name).toLowerCase();
  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) return true;
  if (name === "Makefile" || name === "Justfile") return true;
  return [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".rb",
    ".php",
    ".cs",
    ".sql",
    ".prisma",
    ".css",
    ".scss",
    ".html",
    ".yml",
    ".yaml",
    ".json",
    ".toml",
    ".md",
    ".sh",
    ".ps1",
    ".env",
    ".env.example",
    ".lock",
    ".vue",
    ".svelte"
  ].includes(ext);
}
function categorize(rel, name, content) {
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
var IMPORT_RE = /\b(?:import|require)\s*\(?\s*['"]([^'"]+)['"]\)?/g;
var FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
function extractImports(content) {
  const out = [];
  const push = (m2) => {
    const spec = (m2[1] ?? "").trim();
    if (!spec) return;
    if (spec.startsWith(".")) out.push(spec);
    else if (!out.includes(spec)) out.push(spec);
  };
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) push(m);
  FROM_RE.lastIndex = 0;
  while ((m = FROM_RE.exec(content)) !== null) push(m);
  return [...new Set(out)];
}
var EXPORT_RE = /export\s+(?:default\s+)?(?:const|function|class|let|var|async\s+function)?\s*(\w+)/g;
function extractExported(content) {
  const out = [];
  let m;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(content)) !== null) {
    if (m[1] && m[1] !== "default") out.push(m[1]);
  }
  const def = content.match(/export\s+default\s+(\w+)/);
  if (def?.[1]) out.push(def[1]);
  return [...new Set(out)];
}
var ENV_RE = /process\.env\.([A-Z0-9_]+)/g;
function extractEnv(content) {
  const out = [];
  let m;
  ENV_RE.lastIndex = 0;
  while ((m = ENV_RE.exec(content)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return [...new Set(out)];
}
function resolveImportSpecifier(root, rel, spec) {
  if (!spec.startsWith(".")) return void 0;
  const base2 = resolveDir(rel);
  const candidate = normalizePosix(relative(root, resolve(root, base2, spec)));
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js", "/index.tsx", "/index.jsx"];
  for (const e of exts) {
    const p = candidate + e;
    if (p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".mjs") || p.endsWith(".cjs")) {
      return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
    }
  }
  return void 0;
}
function resolveDir(rel) {
  const idx = rel.lastIndexOf("/");
  return idx >= 0 ? rel.slice(0, idx) : ".";
}
function normalizePosix(p) {
  return p.replace(/\\/g, "/");
}
function recentGitFiles(root, limit = 30) {
  const out = /* @__PURE__ */ new Set();
  if (!existsSync(join(root, ".git"))) return out;
  try {
    const raw = execSync("git log --name-only --pretty=format: -20", {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 2e4
    });
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t) out.add(normalizePosix(t).replace(/\\/g, "/"));
    }
  } catch {
  }
  return out;
}
function analyzeRepository(root) {
  const files = walkFiles(root);
  const nodes = [];
  const normalized = /* @__PURE__ */ new Map();
  for (const f of files) {
    const rel = normalizePosix(relative(root, f));
    const content = readSafe(f);
    const name = basename(f);
    const ext = extname(f).toLowerCase();
    const language = EXT_LANG[ext] ?? (name === "Dockerfile" ? "Dockerfile" : void 0);
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
      recentlyChanged: false
    });
  }
  const nodeByKey = /* @__PURE__ */ new Map();
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
  const languages = [...new Set(nodes.map((n) => n.language).filter((l) => !!l))];
  const categories = {
    frontend: [],
    backend: [],
    database: [],
    tests: [],
    infrastructure: [],
    config: [],
    docs: [],
    other: []
  };
  for (const n of nodes) categories[n.category].push(n.id);
  const warnings = [];
  if (nodes.length === 0) warnings.push("No analyzable source files found.");
  if (files.length >= 1500) warnings.push("Repository is large; analysis capped at 1500 files.");
  return {
    root,
    analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
    languages,
    frameworks,
    packageManagers,
    entryPoints,
    nodeCount: nodes.length,
    nodes,
    categories,
    filesAnalyzed: files.length,
    warnings,
    health: healthScore(nodes, entryPoints)
  };
}
function stripExt(p) {
  return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}
function riskFor(node) {
  const base2 = basename(node.id).toLowerCase();
  if (HIGH_RISK_NAMES.some((h) => base2.includes(h)) && (node.category === "backend" || node.category === "config" || node.category === "infrastructure")) {
    return "high";
  }
  if (node.usedIn.length >= 5) return "high";
  if (node.usedIn.length >= 2) return "medium";
  if (node.usedIn.some((u) => u.toLowerCase().includes("middleware") || u.toLowerCase().includes("auth"))) return "medium";
  return "low";
}
function purposeFor(category, node) {
  const name = node.name;
  switch (category) {
    case "tests":
      return `Test suite exercising ${node.usedIn.length} implementation module(s).`;
    case "frontend":
      return `Frontend ${name.includes(".") ? name.split(".")[0] : name} UI module.`;
    case "backend":
      return `Backend module (${name.includes(".") ? name.split(".")[0] : name}).`;
    case "database":
      return `${name.includes(".") ? name.split(".")[0] : name} \u2014 database schema/model/migration.`;
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
function detectEntryPoints(root, nodes) {
  const names = ["server.ts", "server.js", "app.ts", "app.js", "index.ts", "index.js", "main.tsx", "main.jsx", "cli.ts", "cli.js", "entry.ts", "entry.js"];
  const found = [];
  for (const n of nodes) {
    const lower = n.name.toLowerCase();
    if (names.includes(lower) || n.name.startsWith("Dockerfile")) {
      if (n.category === "backend" || n.category === "frontend" || n.category === "other") found.push(n.id);
    }
  }
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const data = JSON.parse(readFileSync(pkg, "utf8"));
      for (const p of [data.main, ...typeof data.bin === "string" ? [data.bin] : Object.values(data.bin ?? {})]) {
        if (p) {
          const rel = normalizePosix(p).replace(/^\.\//, "").replace(/\.(ts|js)$/, "");
          const match = nodes.find((n) => stripExt(n.id) === rel);
          if (match && !found.includes(match.id)) found.push(match.id);
        }
      }
    } catch {
    }
  }
  return found;
}
function detectFrameworks(root) {
  const frameworks = [];
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const data = JSON.parse(readFileSync(pkg, "utf8"));
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
    }
  }
  return [...new Set(frameworks)];
}
function detectPackageManagers(root) {
  const out = [];
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
function healthScore(nodes, entryPoints) {
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

// src/neutron/impact.ts
var ALIASES = {
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
  session: ["session", "auth", "cookie", "jwt"]
};
function tokenizeRequest(request) {
  const raw = request.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).map((s) => s.trim()).filter((s) => s.length > 2);
  const expanded = /* @__PURE__ */ new Set();
  for (const t of raw) {
    expanded.add(t);
    for (const alias of ALIASES[t] ?? []) expanded.add(alias);
  }
  return [...expanded];
}
var STOP = /* @__PURE__ */ new Set(["add", "while", "with", "existing", "preserving", "keep", "change", "into", "from", "the", "and", "our", "system", "application", "product", "support"]);
function meaningful(request) {
  return tokenizeRequest(request).filter((t) => !STOP.has(t));
}
function basenameLower(node) {
  const b = node.name.toLowerCase();
  return b.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/, "");
}
function scoreNode(node, tokens) {
  const base2 = basenameLower(node);
  const full = node.id.toLowerCase();
  const matched = [];
  let score = 0;
  let direct = false;
  for (const tok of tokens) {
    if (base2.includes(tok) || full.includes(tok) || node.exportedNames.some((e) => e.toLowerCase().includes(tok))) {
      matched.push(tok);
      score += 3;
      direct = true;
    }
  }
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
function levelFor(score, direct, dependents, riskTolerance, entry) {
  const criticalDependents = riskTolerance === "safe" ? 5 : riskTolerance === "balanced" ? 6 : 8;
  const highDependents = riskTolerance === "safe" ? 2 : riskTolerance === "balanced" ? 3 : 5;
  const highScore = riskTolerance === "safe" ? 7 : riskTolerance === "balanced" ? 9 : 12;
  if (dependents >= criticalDependents && direct) return "critical";
  if (direct && dependents >= highDependents || score >= highScore) return "high";
  if (direct || dependents >= 2) return "medium";
  if (entry && dependents > 0) return "medium";
  return "low";
}
function reasonFor(node, dependents, entry, matched) {
  const reasons = [];
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
function analyzeImpact(analysis, request) {
  const tokens = meaningful(request.request);
  const rawTokens = request.request.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((s) => s.length > 2);
  const scored = [];
  for (const node of analysis.nodes) {
    const s = scoreNode(node, tokens);
    if (s.score > 0) {
      scored.push({ node, score: s.score, matched: s.matched, direct: s.direct });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.filter((s) => s.score >= 1).slice(0, 60);
  const byKey = new Map(analysis.nodes.map((n) => [n.id, n]));
  const included = /* @__PURE__ */ new Map();
  const edges = [];
  const queue = [];
  for (const s of selected) {
    const entry = s.node.entry;
    const level = levelFor(s.score, s.direct, s.node.usedIn.length, request.riskTolerance, entry);
    included.set(s.node.id, {
      id: s.node.id,
      path: s.node.id,
      category: s.node.category,
      impact: level,
      confidence: Math.min(0.99, 0.5 + s.score * 0.06),
      reasons: [],
      dependents: s.node.usedIn.slice(),
      matched: s.matched
    });
    queue.push({ node: s.node, depth: 0 });
  }
  while (queue.length > 0) {
    const { node, depth } = queue.shift();
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
          matched: []
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
          matched: []
        });
      }
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
  const summary = { files: 0, apis: 0, database: 0, frontend: 0, backend: 0, tests: 0, config: 0, infrastructure: 0 };
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
  const whatCouldBreak = [];
  const warnNames = ["auth", "middleware", "session", "router", "index", "user", "server", "main"];
  const warnByCategory = {
    backend: "Backend module",
    frontend: "Frontend component",
    database: "Database",
    tests: "Test suite",
    config: "Configuration"
  };
  for (const n of nodes) {
    const base2 = n.path.split("/").pop()?.toLowerCase() ?? "";
    if (n.dependents.length > 0 && warnNames.some((w) => base2.includes(w))) {
      whatCouldBreak.push(base2);
    } else if (n.impact === "critical" || n.impact === "high") {
      whatCouldBreak.push(base2);
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
    lowRiskOnes: safeGuesses
  };
}
function impactRank(level) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[level] ?? 0;
}

// src/neutron/planner.ts
var AGENT_BY_CATEGORY = {
  frontend: "frontend",
  backend: "backend",
  database: "database",
  tests: "testing",
  config: "devops",
  infrastructure: "devops",
  docs: "testing",
  other: "backend"
};
var STAGE_ORDER = {
  config: 0,
  backend: 1,
  database: 1,
  frontend: 2,
  tests: 3,
  infrastructure: 4,
  other: 1
};
function buildPlan(graph) {
  const tasks = [];
  const affectedTests = [];
  let databaseMigrations = 0;
  const seenTests = /* @__PURE__ */ new Set();
  const ids = /* @__PURE__ */ new Set();
  const nextId2 = (prefix) => {
    let n = 1;
    let id = `${prefix}-${String(n).padStart(3, "0")}`;
    while (ids.has(id)) {
      n++;
      id = `${prefix}-${String(n).padStart(3, "0")}`;
    }
    ids.add(id);
    return id;
  };
  const registerId = (suggested, category) => {
    if (suggested && !ids.has(suggested)) {
      ids.add(suggested);
      return suggested;
    }
    return nextId2(category.toUpperCase().slice(0, 3));
  };
  const fileNodes = graph.nodes.filter((n) => n.category !== "tests");
  const testNodes = graph.nodes.filter((n) => n.category === "tests");
  const sortNodes = (nodes) => nodes.sort(
    (a, b) => (STAGE_ORDER[a.category] ?? 5) - (STAGE_ORDER[b.category] ?? 5) || impactRank2(b.impact) - impactRank2(a.impact) || b.dependents.length - a.dependents.length
  );
  const byCategory = {};
  for (const n of sortNodes(fileNodes)) {
    byCategory[n.category] = [...byCategory[n.category] ?? [], n];
  }
  const depsByCategory = {};
  const addFileTasks = (category, nodes, depsFrom) => {
    if (!nodes || nodes.length === 0) return;
    const newIds = [];
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
        status: "pending"
      });
    }
    depsByCategory[category] = newIds;
  };
  addFileTasks("config", byCategory.config ?? [], []);
  addFileTasks("database", byCategory.database ?? [], [...depsByCategory.config ?? []]);
  addFileTasks("backend", byCategory.backend ?? [], [...depsByCategory.config ?? []]);
  addFileTasks("other", byCategory.other ?? [], [...depsByCategory.config ?? [], ...depsByCategory.database ?? []]);
  addFileTasks("frontend", byCategory.frontend ?? [], [...depsByCategory.backend ?? [], ...depsByCategory.config ?? [], ...depsByCategory.other ?? []]);
  addFileTasks("infrastructure", byCategory.infrastructure ?? [], [...depsByCategory.backend ?? [], ...depsByCategory.frontend ?? []]);
  if (byCategory.database) databaseMigrations = byCategory.database.length;
  const implDeps = [.../* @__PURE__ */ new Set([...depsByCategory.backend ?? [], ...depsByCategory.frontend ?? [], ...depsByCategory.database ?? [], ...depsByCategory.other ?? []])];
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
      status: "pending"
    });
  }
  const affectedFiles = [...new Set(tasks.map((t) => t.files[0] ?? "").filter(Boolean))];
  const affectedServices = [...new Set(affectedFiles.filter((f) => /controller|service|route|middleware|api|index|app|server/i.test(f)))];
  const overallRisk = overall(graph);
  const summary = `Plan covers ${affectedFiles.length} file(s), ${affectedServices.length} service(s), ${databaseMigrations} migration(s), ${affectedTests.length} test file(s). Overall risk: ${overallRisk.toUpperCase()}.`;
  return { tasks, affectedFiles, affectedServices, databaseMigrations, affectedTests, overallRisk, summary };
}
function findUnderlyingFiles(graph, testPath) {
  const edge = graph.edges.find((e) => e.to === testPath);
  if (!edge) return [];
  const node = graph.nodes.find((n) => n.id === edge.from);
  return node ? [node.path] : [];
}
function overall(graph) {
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  let max = 0;
  for (const n of graph.nodes) max = Math.max(max, rank[n.impact]);
  return ["low", "medium", "high", "critical"][max - 1] ?? "low";
}
function impactRank2(level) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[level] ?? 0;
}

// src/neutron/workflow.ts
import { existsSync as existsSync12, readFileSync as readFileSync9 } from "node:fs";
import { basename as basename3 } from "node:path";

// src/neutron/security-scanner.ts
import { readFileSync as readFileSync2, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { join as join2, relative as relative2, resolve as resolve2 } from "node:path";
var EXCLUDED = /* @__PURE__ */ new Set(["node_modules", ".git", ".agent", "dist", "build", "coverage", "venv", "__pycache__", "target", ".next"]);
var DEFAULT_CONFIG = {
  ignoredPatterns: [/.env$/, /\.env\.example$/, /\.env\.sample$/, /package\.json$/, /package-lock\.json$/, /README\.md$/],
  skipDirs: EXCLUDED
};
function walk(root, skipDirs, max = 2e3) {
  const out = [];
  const stack = [root];
  while (stack.length > 0 && out.length < max) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join2(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}
function readSafe2(file, maxBytes = 256e3) {
  try {
    const s = statSync2(file);
    if (!s.isFile() || s.size > maxBytes) return void 0;
    return readFileSync2(file, "utf8");
  } catch {
    return void 0;
  }
}
var SECRET_PATTERNS = [
  {
    re: /(?:sk|pk|rk|AKIA|AIza|ghp_|gho_|xox[baprs]-|eyJ)[A-Za-z0-9_\-]{10,}/g,
    severity: "critical",
    category: "secrets",
    title: "Hard-coded credential or API key looks like it may be committed"
  },
  {
    re: /\b(?:api[_-]?key|apikey|secret|auth[_-]?token|access[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
    severity: "high",
    category: "secrets",
    title: "Suspected secret assigned inline in source"
  },
  {
    re: /\bpassword\s*[:=]\s*["'][^"'\s]{4,}["']/gi,
    severity: "high",
    category: "secrets",
    title: "Hard-coded password detected"
  }
];
var AUTH_PATTERNS = [
  {
    re: /\bpassport\.(?:use|authenticate)\s*\(/i,
    severity: "low",
    category: "auth",
    title: "Authentication dependency detected; verify sessions/cookies are secured"
  },
  {
    re: /\bexpress\.session\s*\(/i,
    severity: "low",
    category: "auth",
    title: "Express session middleware usage detected"
  },
  {
    re: /\brequire\(["']jsonwebtoken["']\)/i,
    severity: "low",
    category: "auth",
    title: "jsonwebtoken import detected; verify token validation"
  }
];
var UNSAFE_INPUT = [
  {
    re: /\beval\s*\(/g,
    severity: "high",
    category: "unsafe-input",
    title: "'eval' usage can execute arbitrary code"
  },
  {
    re: /dangerouslySetInnerHTML|v-html|innerHTML\s*=/g,
    severity: "medium",
    category: "unsafe-input",
    title: "HTML injection surface (XSS) \u2014 sanitize user input"
  },
  {
    re: /\bexec(?:File)?\s*\(|child_process|shell:\s*true/g,
    severity: "medium",
    category: "unsafe-input",
    title: "Shell command execution detected \u2014 validate and escape inputs"
  },
  {
    re: /\bSQL\b.{0,40}\b(?:exec|execute|query)|\$\{.{0,40}\}.*\bquery\b|\b(buildQuery|\+)\s*["']?select/gi,
    severity: "medium",
    category: "unsafe-input",
    title: "Possible SQL string interpolation \u2014 prefer parameterized queries"
  }
];
var AUTHZ_PATTERNS = [
  {
    re: /(?:isAuthenticated|requireAuth|authorize|roles?\s*:)/gi,
    severity: "info",
    category: "authz",
    title: "Authorization guard detected \u2014 verify coverage across protected routes"
  }
];
function scanSecurity(root, graph) {
  const findings = [];
  const cfg = DEFAULT_CONFIG;
  const files = walk(root, cfg.skipDirs);
  const impactedPaths = /* @__PURE__ */ new Set();
  if (graph) for (const n of graph.nodes) impactedPaths.add(resolve2(root, n.path));
  for (const file of files) {
    const rel = relative2(root, file);
    const content = readSafe2(file);
    if (content === void 0) continue;
    const isEnvFile = cfg.ignoredPatterns.some((p) => p.test(file));
    for (const { re, severity, category, title } of SECRET_PATTERNS) {
      if (isEnvFile) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        findings.push(makeFinding(severity, category, rel, title));
        if (findings.length >= 120) break;
      }
      if (findings.length >= 120) break;
    }
    if (findings.length >= 120) break;
    for (const { re, severity, category, title } of [...AUTH_PATTERNS, ...UNSAFE_INPUT, ...AUTHZ_PATTERNS]) {
      if (isEnvFile && (category === "secrets" || category === "auth")) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        findings.push(makeFinding(severity, category, rel, title));
        if (findings.length >= 120) break;
      }
      if (findings.length >= 120) break;
    }
    if (findings.length >= 120) break;
  }
  const oauthStateFindings = findOAuthStateIssue(root, files, impactedPaths);
  findings.push(...oauthStateFindings);
  const oauthReported = new Set(oauthStateFindings.map((f) => f.file));
  const authFile = files.find((f) => /auth/.test(basenameOf(f)));
  if (authFile) {
    const content = readSafe2(authFile) ?? "";
    if (!/state|\bcsrf\b|nonce/.test(content)) {
      const rel = relative2(root, authFile);
      if (!oauthReported.has(rel)) {
        findings.push({
          severity: "medium",
          category: "auth",
          title: "OAuth callback does not validate 'state' (CSRF protection for OAuth flows)",
          detail: `${rel} exchanges an authorization code without a state/nonce parameter.`,
          file: rel
        });
      }
    }
  }
  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const blocked = findings.some((f) => f.severity === "critical" || f.severity === "high");
  const summary = summarize(findings);
  return { findings, blocked, summary, scannedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
function basenameOf(p) {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}
function findOAuthStateIssue(root, files, impactedPaths) {
  const out = [];
  for (const file of files) {
    if (!isInImpacted(file, impactedPaths)) continue;
    const rel = relative2(root, file);
    const content = readSafe2(file);
    if (content === void 0) continue;
    const low = content.toLowerCase();
    const isOauth = /oauth|passport\.google|passport\.github|callback/.test(low);
    if (!isOauth) continue;
    if (/state|csrf|nonce/.test(low)) continue;
    out.push({
      severity: "medium",
      category: "auth",
      title: "OAuth callback does not validate 'state' (CSRF protection for OAuth flows)",
      detail: `${rel} handles an OAuth callback without a state/nonce comparison. Add state validation.`,
      file: rel
    });
  }
  return out;
}
function isInImpacted(file, impactedPaths) {
  if (impactedPaths.size === 0) return true;
  return [...impactedPaths].some((p) => file === p || file.startsWith(p + "/"));
}
function makeFinding(severity, category, rel, title) {
  return {
    severity,
    category,
    title: title ?? "",
    detail: `Found in ${rel}`,
    file: rel
  };
}
function summarize(findings) {
  const parts = [];
  const count2 = (s) => findings.filter((f) => f.severity === s).length;
  parts.push(`Security scan: ${findings.length} finding(s) \xE2\u20AC\u201D ${count2("critical")} critical, ${count2("high")} high, ${count2("medium")} medium, ${count2("low")} low, ${count2("info")} info.`);
  if (findings.length === 0) parts.push("No security issues detected.");
  else parts.push(findings.slice(0, 3).map((f) => `- [${f.severity.toUpperCase()}] ${f.title}`).join("\n"));
  return parts.join("\n");
}
function severityRank(s) {
  return { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[s] ?? 1;
}

// src/neutron/test-runner.ts
import { existsSync as existsSync5, readFileSync as readFileSync4 } from "node:fs";
import { join as join5 } from "node:path";

// src/terminal/terminal.ts
import { spawn } from "node:child_process";

// src/config.ts
import { existsSync as existsSync4, mkdirSync, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join as join4 } from "node:path";

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base2 = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base2))
          return INVALID;
        const result = effect.transform(base2.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base2) => {
          if (!isValid(base2))
            return INVALID;
          return Promise.resolve(effect.transform(base2.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/compat.ts
import { existsSync as existsSync3 } from "node:fs";
import { join as join3 } from "node:path";
function envVar(name) {
  const next = process.env[`NEUTRON_${name}`];
  if (next !== void 0 && next !== "") return next;
  const legacy = process.env[`SUNNY_${name}`];
  return legacy !== void 0 && legacy !== "" ? legacy : void 0;
}
var STATE_DIR = "neutron";
var LEGACY_STATE_DIR = "sun";
function stateDir(root) {
  const next = join3(root, ".agent", STATE_DIR);
  const legacy = join3(root, ".agent", LEGACY_STATE_DIR);
  return !existsSync3(next) && existsSync3(legacy) ? legacy : next;
}

// src/providers/catalog.ts
var BUILTIN = [
  {
    id: "agentrouter",
    displayName: "AgentRouter",
    description: "AgentRouter gateway for many models",
    baseUrl: "https://agentrouter.org/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["AGENTROUTER", "AGENT_ROUTER"],
    docsUrl: "https://agentrouter.org",
    color: "cyan"
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    description: "Aggregated access to hundreds of models",
    baseUrl: "https://openrouter.ai/api/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["OPENROUTER"],
    docsUrl: "https://openrouter.ai/docs",
    color: "magenta"
  },
  {
    id: "nous",
    displayName: "NousResearch",
    description: "NousResearch direct inference (Nous Portal). Portal auth is OAuth with short-lived JWTs \u2014 a pasted API key will NOT authenticate here. For Hermes models with an API key, use OpenRouter instead.",
    baseUrl: "https://inference-api.nousresearch.com/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["NOUS", "NOUSRESEARCH"],
    docsUrl: "https://github.com/NousResearch/hermes-agent",
    color: "cyan"
  },
  {
    id: "nvidia",
    displayName: "NVIDIA",
    description: "NVIDIA NIM \u2014 open models via build.nvidia.com (free nvapi- key). OpenAI-compatible endpoint.",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["NVIDIA"],
    docsUrl: "https://build.nvidia.com",
    color: "green"
  },
  {
    id: "tokenharbor",
    displayName: "Token Harbor",
    description: "OpenAI-compatible model gateway",
    baseUrl: "https://tokenharbor.ai/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["TOKENHARBOR", "TOKEN_HARBOR"],
    docsUrl: "https://tokenharbor.ai",
    color: "cyanBright"
  },
  {
    id: "openai",
    displayName: "OpenAI",
    description: "OpenAI GPT models",
    baseUrl: "https://api.openai.com/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["OPENAI"],
    docsUrl: "https://platform.openai.com/docs",
    color: "green"
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    description: "Claude models via the Messages API",
    baseUrl: "https://api.anthropic.com",
    apiType: "anthropic",
    auth: "x-api-key",
    env: ["ANTHROPIC"],
    docsUrl: "https://docs.anthropic.com",
    color: "yellow"
  },
  {
    id: "google",
    displayName: "Google Gemini",
    description: "Gemini models via the Generative Language API",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiType: "google",
    auth: "query",
    env: ["GOOGLE", "GEMINI", "GOOGLE_GEMINI"],
    docsUrl: "https://ai.google.dev/docs",
    color: "blue"
  },
  {
    id: "groq",
    displayName: "Groq",
    description: "Ultra-fast inference on open models",
    baseUrl: "https://api.groq.com/openai/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["GROQ"],
    docsUrl: "https://console.groq.com/docs",
    color: "red"
  },
  {
    id: "mistral",
    displayName: "Mistral",
    description: "Mistral AI models",
    baseUrl: "https://api.mistral.ai/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["MISTRAL"],
    docsUrl: "https://docs.mistral.ai",
    color: "yellowBright"
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    description: "DeepSeek chat and reasoning models",
    baseUrl: "https://api.deepseek.com/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["DEEPSEEK"],
    docsUrl: "https://api-docs.deepseek.com",
    color: "blueBright"
  },
  {
    id: "xai",
    displayName: "xAI",
    description: "Grok models from xAI",
    baseUrl: "https://api.x.ai/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["XAI", "X_AI"],
    docsUrl: "https://docs.x.ai",
    color: "white"
  },
  {
    id: "cohere",
    displayName: "Cohere",
    description: "Cohere Command models (compatibility API)",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["COHERE"],
    docsUrl: "https://docs.cohere.com",
    color: "greenBright"
  },
  {
    id: "qwen",
    displayName: "Alibaba Qwen",
    description: "Qwen models via DashScope compatibility mode",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["QWEN", "DASHSCOPE", "ALIBABA"],
    docsUrl: "https://help.aliyun.com/zh/model-studio",
    color: "magentaBright"
  },
  {
    id: "ollama",
    displayName: "Ollama",
    description: "Local models served by Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiType: "openai-compatible",
    auth: "none",
    env: ["OLLAMA"],
    docsUrl: "https://ollama.com",
    color: "white",
    local: true
  },
  {
    id: "free-llm",
    displayName: "Free LLM",
    description: "Local OpenAI-compatible gateway",
    baseUrl: "http://localhost:3001/v1",
    apiType: "openai-compatible",
    auth: "none",
    env: ["LLM", "FREE_LLM"],
    docsUrl: "https://github.com/FreeLLMAPI",
    color: "green",
    local: true
  },
  {
    id: "custom",
    displayName: "Any Custom",
    description: "Any OpenAI-compatible endpoint you host",
    baseUrl: "",
    apiType: "openai-compatible",
    auth: "bearer",
    env: ["ANY", "CUSTOM"],
    docsUrl: "",
    color: "gray"
  }
];
var registry = /* @__PURE__ */ new Map();
for (const entry of BUILTIN) registry.set(entry.id, entry);
function listCatalog() {
  return [...registry.values()];
}
function getCatalogEntry(id) {
  return registry.get(id);
}
function findCatalogEntry(query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return void 0;
  for (const entry of registry.values()) {
    if (entry.id.toLowerCase() === needle || entry.displayName.toLowerCase() === needle) return entry;
  }
  return void 0;
}
function envPrefixesFor(entry) {
  const idUpper = entry.id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return [.../* @__PURE__ */ new Set([...entry.env, idUpper])];
}
function resolveEnvProviderFields(entry) {
  const fields = { id: entry.id, matched: false };
  for (const prefix of envPrefixesFor(entry)) {
    const baseUrl = process.env[`${prefix}_BASE_URL`];
    const apiKey = process.env[`${prefix}_API_KEY`];
    const models = process.env[`${prefix}_MODELS`];
    if (!baseUrl && !apiKey && !models) continue;
    fields.matched = true;
    if (baseUrl) fields.baseUrl = baseUrl;
    if (apiKey) fields.apiKey = apiKey;
    if (models) fields.models = models.split(",").map((m) => m.trim()).filter(Boolean);
    break;
  }
  return fields;
}
function resolveEnvProvider(entry) {
  const fields = resolveEnvProviderFields(entry);
  if (!fields.matched || !fields.baseUrl && !fields.apiKey) return void 0;
  const baseUrl = fields.baseUrl ?? entry.baseUrl;
  if (!baseUrl) return void 0;
  return {
    id: entry.id,
    baseUrl,
    apiKey: fields.apiKey,
    models: fields.models ?? [],
    enabled: true
  };
}

// src/config.ts
var configSchema = external_exports.object({
  api: external_exports.object({
    maxConcurrentRequests: external_exports.number().min(1).max(64).default(8),
    maxRetries: external_exports.number().min(0).max(10).default(3),
    timeoutMs: external_exports.number().min(1e3).max(6e5).default(12e4),
    backoffBaseMs: external_exports.number().min(100).max(6e4).default(1e3),
    providerCooldownMs: external_exports.number().min(0).max(6e5).default(3e4),
    requestCooldownMs: external_exports.number().min(0).max(6e4).default(0)
  }).default({}),
  routing: external_exports.record(external_exports.string(), external_exports.string()).default({}),
  completion: external_exports.object({
    maxIterations: external_exports.number().min(0).max(20).default(5)
  }).default({})
});
function configDirFor(name) {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (process.platform === "win32") {
    return process.env.APPDATA ? join4(process.env.APPDATA, name) : join4(homedir(), `.${name}`);
  }
  if (xdg) return join4(xdg, name);
  return join4(homedir(), ".config", name);
}
function configDir() {
  const explicit = envVar("CONFIG_DIR");
  if (explicit) return explicit;
  const next = configDirFor("neutron");
  const legacy = configDirFor("sunny");
  return !existsSync4(next) && existsSync4(legacy) ? legacy : next;
}
function globalConfigPath() {
  return join4(configDir(), "config.json");
}
function providerEnv(prefix, id) {
  const baseUrl = process.env[`${prefix}_BASE_URL`] || process.env[`${id.toUpperCase()}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`] || process.env[`${id.toUpperCase()}_API_KEY`];
  const models = process.env[`${prefix}_MODELS`] || process.env[`${id.toUpperCase()}_MODELS`];
  if (!baseUrl && !apiKey) return void 0;
  const resolvedBase = baseUrl || knownBaseUrls[id];
  if (!resolvedBase) return void 0;
  return {
    id,
    baseUrl: resolvedBase,
    apiKey,
    models: models ? models.split(",").map((m) => m.trim()).filter(Boolean) : [],
    enabled: true
  };
}
var freeProviders = [
  { id: "free-llm", env: "LLM", desc: "FreeLLMAPI (OpenAI-compatible gateway)" },
  { id: "groq", env: "GROQ", desc: "Groq (OpenAI-compatible)" },
  { id: "openrouter", env: "OPENROUTER", desc: "OpenRouter (OpenAI-compatible)" },
  { id: "openai", env: "OPENAI", desc: "OpenAI" },
  { id: "ollama", env: "OLLAMA", desc: "Local Ollama" },
  { id: "any", env: "ANY", desc: "Any OpenAI-compatible endpoint" }
];
var knownBaseUrls = {
  "free-llm": "http://localhost:3001/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434/v1"
};
function normalizeProvider(prov) {
  if (!prov || typeof prov !== "object") return void 0;
  const raw = prov;
  const p = {
    id: String(raw.id || ""),
    baseUrl: String(raw.baseUrl || ""),
    apiKey: raw.apiKey !== void 0 ? String(raw.apiKey) : void 0,
    models: Array.isArray(raw.models) ? raw.models.map(String) : [],
    enabled: raw.enabled !== false,
    weight: typeof raw.weight === "number" ? raw.weight : void 0
  };
  if (!p.id || !p.baseUrl) return void 0;
  return p;
}
function readFileProviders() {
  const raw = readRawConfig();
  const list = Array.isArray(raw.providers) ? raw.providers : [];
  return list.map(normalizeProvider).filter((p) => !!p);
}
function readGlobalProviders() {
  const fromFile = readFileProviders();
  const fileById = new Map(fromFile.map((p) => [p.id, p]));
  const fromEnv = [];
  const envIds = /* @__PURE__ */ new Set();
  for (const entry of listCatalog()) {
    if (entry.id === "custom" || envIds.has(entry.id)) continue;
    const fields = resolveEnvProviderFields(entry);
    if (!fields.matched) continue;
    envIds.add(entry.id);
    const fileEntry = fileById.get(entry.id);
    if (fileEntry && (fields.baseUrl || fields.apiKey || fields.models)) {
      fromEnv.push({
        ...fileEntry,
        baseUrl: fields.baseUrl ?? fileEntry.baseUrl ?? entry.baseUrl,
        ...fields.apiKey !== void 0 ? { apiKey: fields.apiKey } : {},
        ...fields.models !== void 0 ? { models: fields.models } : {},
        enabled: true
      });
    } else {
      const resolved = resolveEnvProvider(entry);
      if (resolved) fromEnv.push(resolved);
      else if (fileEntry) fromEnv.push(fileEntry);
    }
  }
  for (const p of freeProviders) {
    if (envIds.has(p.id)) continue;
    const env = providerEnv(p.env, p.id);
    if (!env) continue;
    envIds.add(p.id);
    const fileEntry = fileById.get(p.id);
    if (fileEntry) {
      const explicitBase = process.env[`${p.env}_BASE_URL`] || process.env[`${p.id.toUpperCase()}_BASE_URL`];
      const explicitModels = process.env[`${p.env}_MODELS`] || process.env[`${p.id.toUpperCase()}_MODELS`];
      fromEnv.push({
        ...fileEntry,
        // An explicit env base URL wins; otherwise the file's base URL is
        // kept, and the known-base-URL fallback applies only when the file
        // has none either.
        baseUrl: explicitBase || fileEntry.baseUrl || env.baseUrl,
        ...env.apiKey !== void 0 ? { apiKey: env.apiKey } : {},
        ...explicitModels !== void 0 ? { models: explicitModels.split(",").map((m) => m.trim()).filter(Boolean) } : {},
        enabled: true
      });
    } else {
      fromEnv.push(env);
    }
  }
  const fileKept = fromFile.filter((p) => !envIds.has(p.id));
  return [...fileKept, ...fromEnv];
}
function loadConfig(params) {
  const parsed = configSchema.parse(params?.raw ?? {});
  const providers = params?.providers ?? readGlobalProviders();
  return {
    api: parsed.api,
    routing: parsed.routing,
    completion: parsed.completion,
    providers
  };
}
function readRawConfig() {
  const file = globalConfigPath();
  if (!existsSync4(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync3(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function secretPatterns() {
  return [
    /sk-[A-Za-z0-9_-]{12,}/g,
    /[A-Za-z0-9]{32,}/g,
    /Bearer\s+[A-Za-z0-9._-]{10,}/gi
  ];
}
var keySet = /* @__PURE__ */ new Set();
function registerSecrets(newKeys) {
  for (const k of newKeys) {
    if (k && k.length >= 8) keySet.add(k);
  }
}
function redact(text) {
  if (!text) return text;
  let out = text;
  for (const k of keySet) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.split(k).join("sk-****************");
  }
  for (const re of secretPatterns()) {
    out = out.replace(re, (m) => {
      if (m.length < 8) return m;
      return `${m.slice(0, 3)}-****************`;
    });
  }
  return out;
}

// src/terminal/terminal.ts
var DEFAULT_ALLOW = [
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "git add",
  "git commit",
  "git worktree",
  "git checkout",
  "git rev-parse",
  "npm test",
  "npm run",
  "npm ls",
  "npm audit",
  "node -v",
  "node --version",
  "npm -v",
  "tsc --noEmit",
  "vitest run",
  "npx tsc",
  "npx vitest"
];
var DEFAULT_DENY = [
  "rm -rf /",
  "rm -fr /",
  "format c:",
  "shred /dev/",
  "mkfs",
  "dd if=/dev/zero of=/dev/",
  ":(){:|:&};:",
  "> /dev/sda"
];
function classify(cmd) {
  const lowered = cmd.toLowerCase();
  const dangerPatterns = [
    { re: /\brm\s+(?:-[\w]*[rf][\w]*|--recursive|-\s*fr)\b/i, reason: "dangerous-command" },
    { re: /\brmdir\s+\/s\b/i, reason: "dangerous-command" },
    { re: /remove-item\s+.*-recurse/i, reason: "dangerous-command" },
    { re: /\bdrop\s+(?:table|database|schema)\b/i, reason: "destructive" },
    { re: /\btruncate\s+table\b/i, reason: "destructive" },
    { re: /\bdelete\s+from\s+\w+\b/i, reason: "destructive" },
    { re: /\bgit\s+push\b/i, reason: "public-exposure" },
    { re: /\bgit\s+reset\s+--hard\b/i, reason: "dangerous-command" },
    { re: /\bgit\s+clean\s+-[fxd]/i, reason: "dangerous-command" },
    { re: /\bsudo\b/i, reason: "dangerous-command" },
    { re: /\bshutdown\b|\breboot\b/i, reason: "dangerous-command" },
    { re: /\bchmod\s+777\b/i, reason: "dangerous-command" },
    { re: /\bkill\s+-9\b|\btaskkill\b/i, reason: "dangerous-command" },
    { re: /\b(curl|wget)\b[^|]*\|\s*(ba)?sh\b/i, reason: "dangerous-command" },
    { re: /\bpowershell\s+.*-enc\b/i, reason: "dangerous-command" },
    { re: /\bapi[_-]?key\s*=\s*['"]?[A-Za-z0-9_-]{8,}/i, reason: "contains-secret" },
    { re: /\b(password|secret|token)\s*=\s*['"]?[^\s'"]{8,}/i, reason: "contains-secret" },
    { re: /\bnpm\s+(?:install|i|add)\b/i, reason: "package-install" },
    { re: /\bpnpm\s+(?:install|add)\b/i, reason: "package-install" },
    { re: /\byarn\s+(?:install|add)\b/i, reason: "package-install" }
  ];
  for (const p of dangerPatterns) {
    if (p.re.test(lowered)) return { reason: p.reason, requiresApproval: true };
  }
  return { requiresApproval: false };
}
var Terminal = class {
  allowList;
  denyList;
  cwd;
  approve;
  logger;
  constructor(opts) {
    this.allowList = opts.allowList ?? DEFAULT_ALLOW;
    this.denyList = opts.denyList ?? DEFAULT_DENY;
    this.cwd = opts.cwd ?? process.cwd();
    this.approve = opts.approve;
    this.logger = opts.logger;
  }
  evaluate(cmd) {
    const segments = cmd.split(/&&|;/).map((s) => s.trim()).filter(Boolean);
    for (const deny of this.denyList) {
      if (cmd.toLowerCase().includes(deny.toLowerCase()) || segments.some((s) => s.toLowerCase().includes(deny.toLowerCase()))) {
        return { blocked: deny };
      }
    }
    for (const seg of segments) {
      const verdict = classify(seg);
      if (verdict.requiresApproval && verdict.reason) {
        return { approvalReason: verdict.reason };
      }
    }
    return {};
  }
  async run(cmd, opts) {
    const verdict = this.evaluate(cmd);
    if (verdict.blocked) {
      this.logger?.warn(`blocked command: ${redact(cmd)}`);
      return {
        status: "error",
        stdout: "",
        stderr: `Command blocked by deny rule: ${verdict.blocked}`,
        exitCode: 99,
        durationMs: 0,
        timedOut: false
      };
    }
    if (verdict.approvalReason && this.approve) {
      const allowed = await this.approve({
        message: `The terminal wants to run a command classified as ${verdict.approvalReason}.`,
        command: cmd,
        reason: verdict.approvalReason,
        onApprove: async () => {
        },
        onDeny: async () => {
        }
      });
      if (!allowed) {
        this.logger?.warn(`denied by user: ${redact(cmd)}`);
        return {
          status: "error",
          stdout: "",
          stderr: "Command denied by user.",
          exitCode: 98,
          durationMs: 0,
          timedOut: false
        };
      }
    }
    const timeoutMs = opts?.timeoutMs ?? 12e4;
    const cwd = opts?.cwd ?? this.cwd;
    const isWindows = process.platform === "win32";
    const shell = isWindows ? process.env.ComSpec ?? "cmd" : "/bin/sh";
    const args = isWindows ? ["/d", "/s", "/c", cmd] : ["-c", cmd];
    this.logger?.info(`$ ${redact(cmd)}`);
    return new Promise((resolve10) => {
      const child = spawn(shell, args, {
        cwd,
        env: process.env,
        shell: false,
        windowsHide: true
      });
      let stdoutBuf = "";
      let stderrBuf = "";
      let timedOut = false;
      const started = Date.now();
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout?.on("data", (d) => {
        stdoutBuf += d.toString();
      });
      child.stderr?.on("data", (d) => {
        stderrBuf += d.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve10({
          status: "error",
          stdout: stdoutBuf,
          stderr: stderrBuf + "\n" + err.message,
          exitCode: 1,
          durationMs: Date.now() - started,
          timedOut
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const failed = code !== 0 || /BUILD FAILED|error TS|npm error|SyntaxError/i.test(stdoutBuf + stderrBuf);
        resolve10({
          status: failed ? "error" : "ok",
          stdout: stdoutBuf,
          stderr: stderrBuf,
          exitCode: code ?? 1,
          durationMs: Date.now() - started,
          timedOut
        });
      });
    });
  }
  async runChecked(cmd, opts) {
    const result = await this.run(cmd, opts);
    if (result.status === "error") {
      this.logger?.warn(`command failed (${result.exitCode}): ${redact(cmd)}`);
    }
    return result;
  }
};

// src/neutron/test-runner.ts
var TestHangError = class extends Error {
};
function npmBinAvailable(root, name) {
  const local = join5(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
  if (existsSync5(local)) return true;
  const pkg = join5(root, "node_modules", name);
  if (existsSync5(pkg)) return true;
  return false;
}
function stripExt2(p) {
  return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}
function readPackageScripts(root) {
  const pkgPath = join5(root, "package.json");
  if (!existsSync5(pkgPath)) return void 0;
  try {
    const data = JSON.parse(readFileSync4(pkgPath, "utf8"));
    return data.scripts;
  } catch {
    return void 0;
  }
}
function defaultBuildRunner(root) {
  const term = new Terminal({ cwd: root });
  return async (cmd) => {
    const r = await term.run(cmd, { timeoutMs: 24e4, cwd: root });
    return { ok: r.status === "ok", stdout: `$ ${cmd}
${r.stdout}
${r.stderr}
` };
  };
}
async function validateBuild(root, run) {
  const runCmd = run ?? defaultBuildRunner(root);
  const buildScript = readPackageScripts(root)?.["build"];
  if (buildScript) {
    if (!existsSync5(join5(root, "node_modules"))) {
      return {
        ok: false,
        reason: "missing-node-modules",
        command: "npm run build",
        stdout: "$ npm run build\n[SKIPPED] node_modules not found. Run 'npm install' first.\n"
      };
    }
    const r = await runCmd("npm run build");
    return r.ok ? { ok: true, command: "npm run build", stdout: r.stdout } : { ok: false, reason: "build-failed", command: "npm run build", stdout: r.stdout };
  }
  if (existsSync5(join5(root, "tsconfig.json"))) {
    const r = await runCmd("npx tsc --noEmit");
    return r.ok ? { ok: true, command: "npx tsc --noEmit", stdout: r.stdout } : { ok: false, reason: "build-failed", command: "npx tsc --noEmit", stdout: r.stdout };
  }
  return { ok: true, stdout: "" };
}
function selectTests(root, analysis, touchedPaths) {
  const touched = touchedPaths.map((t) => normalizeSep(t));
  const selections = [];
  const implByKey = /* @__PURE__ */ new Map();
  for (const n of analysis.nodes) {
    if (n.category === "tests") continue;
    implByKey.set(stripExt2(n.id), n.id);
  }
  for (const t of touched) {
    const key = stripExt2(t);
    const implPath = implByKey.get(key);
    const implNode = analysis.nodes.find((n) => n.id === (implPath ?? t));
    const tests = implNode?.tests ?? [];
    const testNodes = analysis.nodes.filter((n) => n.category === "tests" && (n.usedIn.includes(t) || n.path.includes(key)));
    const selected = [.../* @__PURE__ */ new Set([...tests, ...testNodes.map((n) => normalizeSep(n.path))])];
    if (selected.length === 0) continue;
    selections.push({
      node: t,
      reason: tests.length > 0 ? `Directly exercised by ${tests.length} test file(s).` : `Test modules reference '${t}'.`,
      selected
    });
  }
  return selections;
}
function normalizeSep(p) {
  return p.replace(/\\/g, "/");
}
function sanitizeShellPath(p) {
  return p.replace(/\\/g, "/").replace(/["`$&;|<>*?~^()[\]{}!#%]/g, "");
}
function suggestedTestCommand(root, selections, analysis) {
  if (existsSync5(join5(root, "vitest.config.ts")) || existsSync5(join5(root, "vitest.config.js")) || existsSync5(join5(root, "vite.config.ts"))) {
    if (!analysis) analysis = analyzeRepository(root);
    const testFiles = [...new Set(selections.flatMap((s) => s.selected))];
    let cmd = "npx vitest run --concurrency 1";
    if (testFiles.length > 0) cmd = `npx vitest run ${testFiles.map((t) => `"${sanitizeShellPath(t)}"`).join(" ")} --concurrency 1`;
    return cmd;
  }
  if (existsSync5(join5(root, "package.json"))) {
    return "npm test -- --run";
  }
  return "";
}
function parsePassFail(stdout) {
  const failed = [];
  const lines = stdout.split(/\r?\n/);
  const scope = lines.filter((l) => /^\s*(tests?|✓|✗)\b/i.test(l) || /tests?\s*:/i.test(l)).join("\n") || stdout;
  const passed = [...scope.matchAll(/(\d+)\s+passed/g)].map((m) => Number(m[1]));
  const failedCount = [...scope.matchAll(/(\d+)\s+failed/g)].map((m) => Number(m[1]));
  for (const l of lines) {
    if (/^\s*(FAIL|✗)\s/.test(l) || l.startsWith("FAIL ") || l.startsWith("\u2717 ")) {
      const parts = l.split(/\s+/);
      const candidate = parts.filter((p) => p.includes("/") || p.endsWith(".ts") || p.endsWith(".js")).pop();
      if (candidate) failed.push(candidate);
    }
  }
  return {
    pass: passed.length > 0 ? passed[passed.length - 1] : 0,
    fail: failedCount.length > 0 ? failedCount[failedCount.length - 1] : 0,
    tests: [...new Set(failed)].slice(0, 10)
  };
}
async function runSelectedTests(input) {
  const selections = selectTests(input.root, input.analysis, input.touchedPaths);
  const command = suggestedTestCommand(input.root, selections, input.analysis);
  const term = new Terminal({ cwd: input.root, allowList: [...DEFAULT_ALLOW2, "npx vitest"] });
  let after;
  let stdout = "";
  let failedTests = [];
  let exitError;
  if (command) {
    if (command.startsWith("npx vitest run") && !npmBinAvailable(input.root, "vitest")) {
      exitError = "vitest is not installed in this repository (node_modules missing). Returning an honest 'not executed' result. Run `npm install` first.";
    } else if (existsSync5(join5(input.root, "package.json")) && !existsSync5(join5(input.root, "node_modules")) && command.startsWith("npm test")) {
      exitError = "node_modules are not installed. Returning an honest 'not executed' result. Run `npm install` first.";
    } else {
      try {
        const r = await term.run(command, { timeoutMs: 24e4, cwd: input.root });
        stdout = r.stdout;
        if (r.status !== "ok") exitError = r.stderr.slice(-400);
        const parsed = parsePassFail(stdout);
        const total = parsed.pass + parsed.fail;
        after = { total: total > 0 ? total : parsed.pass, passed: parsed.pass, failed: parsed.fail };
        failedTests = parsed.tests;
        if (r.status !== "ok" && parsed.pass === 0 && parsed.fail === 0) {
          after = { total: 0, passed: 0, failed: 0 };
        }
      } catch (err) {
        if (err instanceof TestHangError) {
          exitError = err.message;
        } else {
          exitError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }
  const before = input.before;
  const regression = !!after && !!before && (after.failed > before.failed || after.failed === 0 && after.total < before.total);
  const truncStdout = (stdout || exitError || "").slice(-6e3);
  return {
    selection: selections,
    command,
    before,
    after,
    executedAt: (/* @__PURE__ */ new Date()).toISOString(),
    truncatedStdout: truncStdout,
    regression: regression ?? false,
    failedTests
  };
}
var DEFAULT_ALLOW2 = [
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "git add",
  "git commit",
  "git worktree",
  "git checkout",
  "git rev-parse",
  "npm test",
  "npm run",
  "npm ls",
  "node -v",
  "npm -v",
  "tsc --noEmit",
  "vitest run",
  "npx vitest",
  "npm audit"
];

// src/neutron/review.ts
function buildCodeReview(analysis) {
  const findings = [];
  for (const n of analysis.nodes) {
    if (n.category === "tests") continue;
    if (n.dependerCount >= 8) {
      findings.push({
        severity: "medium",
        title: `Highly coupled module: ${n.path} is imported by ${n.dependerCount} files`,
        file: n.path
      });
    }
    if (n.usedIn.length === 0 && n.entry && n.category === "backend") {
      findings.push({
        severity: "info",
        title: `Entry point ${n.path} has no reverse dependencies (expected for a bootstrap file)`,
        file: n.path
      });
    }
    if (n.recentlyChanged && n.tests.length === 0 && n.category === "backend") {
      findings.push({
        severity: "low",
        title: `Recently changed backend module ${n.path} has no associated tests`,
        file: n.path
      });
    }
  }
  const testNodes = analysis.nodes.filter((n) => n.category === "tests");
  const implNodes = analysis.nodes.filter((n) => n.category !== "tests" && n.category !== "config" && n.category !== "docs");
  const tested = /* @__PURE__ */ new Set();
  for (const t of testNodes) {
    for (const use of t.usedIn) tested.add(use);
  }
  const untestedImpl = implNodes.filter((n) => !tested.has(n.id) && !n.entry && n.dependerCount > 0);
  for (const n of untestedImpl.slice(0, 5)) {
    findings.push({
      severity: "low",
      title: `Module ${n.path} is imported but has no direct test coverage`,
      file: n.path
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
    reviewedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function count(findings, s) {
  return findings.filter((f) => f.severity === s).length;
}
function evaluateRelease(input) {
  const checks = [];
  checks.push({ name: "Repository analysis", ok: !!input.repoAnalysis });
  checks.push({ name: "Impact analysis", ok: true });
  checks.push({ name: "Implementation", ok: input.implementationDone });
  const buildOk = input.buildOk === true;
  checks.push({ name: "Build", ok: buildOk, detail: input.buildOk === void 0 ? "not evaluated" : input.buildDetail });
  const testsOk = !!input.tests && input.tests.failed === 0;
  checks.push({
    name: "Tests",
    ok: testsOk,
    detail: input.tests && input.tests.total !== void 0 ? `${input.tests.passed}/${input.tests.total} passed` : input.tests ? `${input.tests.passed} passed, ${input.tests.failed} failed` : "not evaluated"
  });
  const securityOk = !!input.security && !input.security.blocked;
  checks.push({ name: "Security", ok: securityOk, detail: securityOk ? void 0 : "blocking finding(s) present" });
  const reviewOk = !!input.codeReview && input.codeReview.passed;
  checks.push({ name: "Code review", ok: reviewOk, detail: input.codeReview ? `score ${input.codeReview.score}/100` : "not evaluated" });
  const configOk = input.configOk === true;
  checks.push({ name: "Configuration", ok: configOk, detail: input.configOk === void 0 ? "not evaluated" : void 0 });
  const deploymentOk = input.deploymentOk === true;
  checks.push({ name: "Deployment checks", ok: deploymentOk, detail: input.deploymentOk === void 0 ? "not evaluated" : void 0 });
  const failedChecks = checks.filter((c) => !c.ok);
  const blockedBy = failedChecks.map((c) => c.name);
  const hardFailures = blockedBy.filter((b) => ["Implementation", "Build", "Tests", "Security"].includes(b));
  const status = hardFailures.length > 0 ? "blocked" : blockedBy.length > 0 ? "not-ready" : "ready-for-review";
  const report = releaseReport(status, checks);
  return { status, checks, blockedBy, report, evaluatedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
function releaseReport(status, checks) {
  const lines = [];
  lines.push("RELEASE READINESS");
  lines.push("-----------------");
  for (const c of checks) {
    const mark = c.ok ? "\u2713" : c.detail ? "\u26A0" : "\u2717";
    lines.push(`${mark} ${c.name} ${c.detail ?? ""}`.trimEnd());
  }
  lines.push("");
  lines.push(`STATUS: ${status === "ready-for-review" ? "READY FOR HUMAN REVIEW" : status === "blocked" ? "BLOCKED" : "NOT READY"}`);
  return lines.join("\n");
}

// src/context/context.ts
import { existsSync as existsSync6, readFileSync as readFileSync5, readdirSync as readdirSync3, statSync as statSync3 } from "node:fs";
import { execSync as execSync2 } from "node:child_process";
import { join as join6, relative as relative3, resolve as resolve3 } from "node:path";
var EXCLUDED_DIRS2 = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".agent",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  "target"
]);
var INCLUDED_EXT = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".sql",
  ".prisma",
  ".yml",
  ".yaml",
  ".toml",
  ".env.example",
  ".env.sample",
  ".sh",
  ".ps1"
]);
function listFiles(root, max = 300) {
  const result = [];
  const stack = [root];
  while (stack.length > 0 && result.length < max) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync3(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (EXCLUDED_DIRS2.has(e.name)) continue;
      const full = join6(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (result.length >= max) break;
      const ext = e.name.includes(".") ? `.${e.name.split(".").pop()}` : "";
      if (INCLUDED_EXT.has(ext)) result.push(full);
    }
  }
  return result;
}
function readFileSafe(p) {
  try {
    if (existsSync6(p)) {
      const stat = statSync3(p);
      if (stat.size > 1e5) return void 0;
      return { path: p, content: readFileSync5(p, "utf8") };
    }
  } catch {
  }
  return void 0;
}
function discoverRelevantFiles(task, root) {
  const keywords = task.description.toLowerCase().replace(/[^a-z0-9_\s/]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  const all = listFiles(root);
  const scored = all.map((p) => {
    const rel = relative3(root, p).toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (rel.includes(kw)) score += 3;
    }
    const agent = task.agent.toLowerCase();
    const agentDirs = {
      frontend: ["src/pages", "app", "components", "src/styles", "public", "src/App"],
      backend: ["src/api", "src/routes", "src/controllers", "src/services"],
      database: ["prisma", "src/db", "migrations", "models"],
      devops: ["docker", ".github", "infra", "deploy"],
      security: ["auth", "middleware"]
    };
    for (const dir of agentDirs[agent] ?? []) {
      if (rel.startsWith(dir)) score += 2;
    }
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, 30).map((s) => s.p);
}
async function getContextForTask(task, root) {
  const relevant = discoverRelevantFiles(task, root);
  const files = [];
  for (const p of relevant.slice(0, 20)) {
    const entry = readFileSafe(p);
    if (entry) files.push({ path: relative3(root, entry.path), content: entry.content });
  }
  let history = "";
  const gitDir = join6(root, ".git");
  if (existsSync6(gitDir)) {
    try {
      history = execSync2("git log --oneline -15", { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).toString();
    } catch {
      history = "";
    }
  }
  let designExcerpt;
  for (const name of ["design.md", "DESIGN.md", "design.MD"]) {
    const p = join6(root, name);
    if (existsSync6(p)) {
      const content = readFileSync5(p, "utf8");
      designExcerpt = content.slice(0, 6e3);
      break;
    }
  }
  return {
    task: task.description,
    relevantFiles: files.map((f) => f.path),
    files,
    history,
    designExcerpt
  };
}

// src/prompts.ts
var PROMPTS = {
  manager: (params) => `${basePrompt("engineering manager", params.task)}
The user gave this project goal. Break it down into concrete engineering tasks. Identify which specialist agents should run, their order, and dependencies. Only create tasks that are necessary. Do not implement code yourself.

- Required output format:
  1. A list of tasks (id, agent, description, dependencies, priority)
  2. A short dependency rationale
  3. Any risks or assumptions
`,
  requirements: (params) => `${basePrompt("requirements analyst", params.task)}
Analyze the design and project requirements. Translate them into structured, testable requirements. Identify edge cases and gaps. Produce a list of acceptance criteria.

- Output: a "### REQ-xxx: <description>" section per requirement, then a final section titled "ACCEPTANCE CRITERIA" with one "- " bullet per criterion.
`,
  design: (params) => `${basePrompt("design agent", params.task)}
Treat design.md as the source of truth. Derive a design system (colors, typography, spacing, radius, layout, components, responsive rules). Point out any missing favorites that should be agreed before FE work.
`,
  frontend: (params) => `${basePrompt("frontend agent", params.task)}
You build frontend code. Follow design.md strictly. Use design tokens (CSS variables), implement responsive behavior, loading/error/empty states, and connect to APIs. Do not modify backend or DB architecture.

${FILE_FORMAT}
`,
  backend: (params) => `${basePrompt("backend agent", params.task)}
You build APIs and backend logic. Follow design.md architecture. Handle auth, validation, error handling, logging, tests. Do not touch the frontend without explicit instruction.

${FILE_FORMAT}
`,
  database: (params) => `${basePrompt("database agent", params.task)}
You design and evolve the database: schema, migrations, models, indexes, relationships, integrity checks. Record schema decisions clearly.

${FILE_FORMAT}
`,
  security: (params) => `${basePrompt("security agent", params.task)}
Audit auth, authorization, secrets, env vars, API security, input validation, SQL injection, XSS, CSRF, dependency vulnerabilities, insecure config, exposed credentials, file permissions, command execution. Produce a security report with severity levels. Block completion if critical findings exist.

- Output format: for every finding emit one line in the exact form: "SEVERITY: title" where SEVERITY is CRITICAL, HIGH, MEDIUM or LOW, followed by indented detail lines. End with a "SUMMARY" section listing counts per severity.
`,
  devops: (params) => `${basePrompt("devops agent", params.task)}
You handle Docker, CI/CD, env configuration, build scripts, deployment, health checks, logging, and production config.

${FILE_FORMAT}
`,
  qa: (params) => `${basePrompt("QA/test agent", params.task)}
Run unit, integration, E2E tests, exercise APIs, check critical flows and error conditions, and see if the build passes. NEVER claim a test passed without running it. Report ACTUAL results (pass/fail counts) \u2014 not assumptions.
`,
  reviewer: (params) => `${basePrompt("code reviewer", params.task)}
Review the project for bugs, wrong architecture, duplication, dead code, security issues, poor error handling, missing tests, API misuse, performance problems, accessibility and design inconsistencies. Rate severity. Produce review.md content and a score.

- Output format: for every issue emit one line in the exact form "[SEVERITY] title" where SEVERITY is critical, high, medium or low, followed by detail lines. End with "SCORE: <0-100>".
`
};
var FILE_FORMAT = `When you create or modify files, use EXACTLY this output format (no markdown fences around the markers):

FILE: <relative/path/from/project/root>
TYPE: write
<full file content, complete and final>

TYPE may be "write" (create/overwrite), "append", or "delete".

After all files, you may add commands, one per line:
RUN: <single shell command, no chaining with && or ;>

Rules:
- Write COMPLETE file contents, never placeholders or diffs.
- Only touch files needed for this task.
- Never invent test results; only RUN commands you are asked to.`;
function basePrompt(role, task) {
  return `You are the ${role} in the NEUTRON multi-agent team (Autonomous Software Maintenance Intelligence).

TASK ${task.id}: ${task.description}
PRIORITY: ${task.priority}
STATUS: ${task.status}
`;
}
function buildPromptForTask(task, key, context, extraInstructions) {
  const promptFn = PROMPTS[key];
  const base2 = promptFn({ task, context });
  const parts = [base2];
  if (context.designExcerpt) {
    parts.push("\n=== DESIGN.MD EXCERPT ===\n" + context.designExcerpt);
  }
  if (context.files.length > 0) {
    parts.push("\n=== RELEVANT FILES ===");
    for (const f of context.files) {
      parts.push(`
--- ${f.path} ---
${f.content.slice(0, 12e3)}`);
    }
  } else {
    parts.push("\nFiles: none found relevant yet.");
  }
  if (context.history) {
    parts.push("\n=== RECENT COMMITS ===\n" + context.history);
  }
  if (extraInstructions) {
    parts.push(`
=== EXTRA INSTRUCTIONS ===
${extraInstructions}`);
  }
  return parts.join("\n");
}

// src/files/workspace.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync2, readdirSync as readdirSync4, realpathSync, statSync as statSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { basename as basename2, dirname, isAbsolute, join as join7, relative as relative4, resolve as resolve4, sep } from "node:path";
function isWithinWorkspace(root, p) {
  return isSubpath(resolveRealPath(root), resolveRealPath(p));
}
function resolveRealPath(p) {
  try {
    return realpathSync(p);
  } catch {
  }
  const parts = [];
  let cur = resolve4(p);
  while (!existsSync7(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return resolve4(p);
    parts.unshift(basename2(cur));
    cur = parent;
  }
  try {
    return join7(realpathSync(cur), ...parts);
  } catch {
    return resolve4(p);
  }
}
function isSubpath(parent, child) {
  const from = resolve4(parent);
  const to = resolve4(child);
  if (from === to) return true;
  const rel = relative4(from, to);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../")) return false;
  return true;
}

// src/agents/base.ts
var BaseAgent = class {
  id;
  role;
  label;
  promptsKey;
  constructor(opts) {
    this.id = opts.id;
    this.role = opts.role;
    this.label = opts.label;
    this.promptsKey = opts.promptsKey;
  }
  canHandle(task) {
    return task.agent === this.id || task.agent === this.label;
  }
  async execute(task, ctx) {
    ctx.log(`[${this.label}] executing ${task.id}`);
    return this.executeInternal(task, ctx);
  }
  async runLlm(task, ctx, extraInstructions) {
    const context = await getContextForTask(task, ctx.root);
    const prompt = buildPromptForTask(task, this.promptsKey, context, extraInstructions);
    const messages = [
      { role: "system", content: this.systemPrompt(ctx) },
      { role: "user", content: prompt }
    ];
    const kind = roleToKind(this.role);
    const res = await ctx.api.chat(kind, messages, {
      temperature: 0.2
    });
    return res.text;
  }
  systemPrompt(ctx) {
    return `You are the ${this.label} agent in a multi-agent software engineering platform called NEUTRON (Autonomous Software Maintenance Intelligence).
You operate inside a project repository. Your job: complete the assigned task precisely, follow design.md where relevant, guard against over-engineering, and never touch unrelated files.
Never fabricate test results. Never reveal API keys. Only run commands through the provided run() tool.`;
  }
  async runLlmWithTask(task, ctx, opts) {
    return this.runLlm(task, ctx);
  }
  review(_result, _ctx) {
    return Promise.resolve({ passed: true, score: 100, issues: [], notes: [] });
  }
};
function roleToKind(role) {
  const map = {
    manager: "architecture",
    requirements: "requirements",
    design: "design",
    frontend: "frontend",
    backend: "backend",
    database: "database",
    security: "security",
    devops: "devops",
    qa: "testing",
    reviewer: "review"
  };
  return map[role];
}

// src/files/project-files.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync6, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname2, join as join8, resolve as resolve5 } from "node:path";
function readProjectFile(root, p) {
  const full = resolve5(root, p);
  if (!isWithinWorkspace(root, full)) return void 0;
  try {
    return readFileSync6(full, "utf8");
  } catch {
    return void 0;
  }
}
function writeProjectFile(root, p, content) {
  const full = resolve5(root, p);
  if (!isWithinWorkspace(root, full)) return false;
  try {
    mkdirSync3(dirname2(full), { recursive: true });
    writeFileSync3(full, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

// src/agents/requirements.ts
var RequirementsAgent = class extends BaseAgent {
  constructor() {
    super({ id: "requirements", role: "requirements", label: "Requirements", promptsKey: "requirements" });
  }
  async executeInternal(task, ctx) {
    const out = await this.runLlm(task, ctx);
    const requirements = out.trim();
    const file = ".agent/requirements.md";
    const metadata = readAgentMetadata(ctx);
    const ok = writeProjectFile(ctx.root, file, `# Requirements

${requirements}
`);
    const issues = [];
    if (!/ACCEPTANCE CRITERIA/i.test(requirements)) {
      issues.push({
        severity: "medium",
        category: "requirements",
        title: "Acceptance criteria not clearly listed",
        detail: "The requirements output did not include an explicit ACCEPTANCE CRITERIA section."
      });
    }
    if (metadata?.requirementsFileVersion && metadata.requirementsFileVersion === 1) {
      issues.push({
        severity: "info",
        category: "requirements",
        title: "requirements.md has previous content"
      });
    }
    return {
      status: issues.some((i) => i.severity === "medium") ? "success" : "success",
      summary: `Wrote ${requirements.length} chars to ${file}`,
      filesChanged: ok ? [file] : [],
      commandsRun: [],
      testsRun: [],
      issues,
      nextActions: []
    };
  }
};
function readAgentMetadata(ctx) {
  const raw = ctx.readFile(".agent/project.json");
  if (!raw) return void 0;
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}

// src/design/parser.ts
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function splitSections(md, prefix) {
  const sections2 = /* @__PURE__ */ new Map();
  const re = new RegExp(`^${prefix}\\s+(.+?)\\s*$`);
  let current = null;
  const buf = [];
  const flush = () => {
    if (current === null) return;
    const body = buf.join("\n");
    const prev = sections2.get(current);
    sections2.set(current, prev !== void 0 ? `${prev}
${body}` : body);
    buf.length = 0;
  };
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) {
      flush();
      current = m[1].trim();
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections2;
}
function sections(md) {
  const out = /* @__PURE__ */ new Map();
  for (const [name, body] of splitSections(md, "##")) {
    const key = name.toLowerCase();
    const prev = out.get(key);
    out.set(key, prev !== void 0 ? `${prev}
${body}` : body);
  }
  return out;
}
function sectionContent(md, heading) {
  return sections(md).get(heading.toLowerCase()) ?? "";
}
function listItems(content) {
  if (!content) return [];
  return content.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean).filter((l) => !l.startsWith("#"));
}
function nextLineValue(content, key) {
  if (!content) return void 0;
  const esc = escapeRe(key);
  const same = content.match(new RegExp(`^${esc}:\\s*(\\S.*?)\\s*$`, "im"));
  if (same?.[1]) return same[1].trim();
  const next = content.match(new RegExp(`^${esc}:\\s*\\r?\\n+\\s*(.+?)\\s*$`, "im"));
  if (next?.[1]) return next[1].trim();
  return void 0;
}
function normalizeColorKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}
function parseColorsSection(content) {
  const out = {};
  if (!content) return out;
  const subs = splitSections(content, "###");
  for (const [name, body] of subs) {
    const hex = body.match(/#[0-9a-fA-F]{3,8}/);
    if (hex) out[normalizeColorKey(name)] = hex[0].toUpperCase();
  }
  for (const m of content.matchAll(/^\s*(?:[-*•]\s*)?([A-Za-z0-9 ]+?)\s*:\s*(#[0-9a-fA-F]{3,8})\s*$/gm)) {
    out[normalizeColorKey(m[1])] = m[2].toUpperCase();
  }
  return out;
}
function parseNumber(v) {
  if (!v) return void 0;
  const n = Number(v.replace(/px/g, "").trim());
  return Number.isFinite(n) ? n : void 0;
}
function parseSpacing(content) {
  if (!content) return [];
  const line = content.split("\n").map((l) => l.trim()).find((l) => /^\d+px(\s*\/\s*\d+px|\s+\d+px)+$/.test(l));
  if (!line) return [];
  return line.match(/\d+/g)?.map(Number) ?? [];
}
function parseSubsectionList(content) {
  if (!content) return [];
  const subs = splitSections(content, "###");
  if (subs.size === 0) {
    return listItems(content).map((n) => ({ name: n, description: "" }));
  }
  return [...subs.entries()].map(([name, body]) => ({ name, description: body.trim() }));
}
function parseResponsive(content) {
  const out = {};
  for (const [name, body] of splitSections(content, "###")) {
    out[name.toLowerCase()] = body.trim();
  }
  return out;
}
function parseGrid(content) {
  const out = {};
  if (!content) return out;
  for (const m of content.matchAll(/^\s*([A-Za-z]+)\s*:\s*(\d+)\s*(?:columns)?\s*$/gim)) {
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
}
function parseLayoutType(spec) {
  const v = (spec ?? "").toLowerCase();
  if (v.includes("sidebar")) return "sidebar";
  if (v.includes("top") || v.includes("header") || v.includes("navbar")) return "topnav";
  if (v.includes("center")) return "centered";
  return "sidebar";
}
function parseDesignSystem(md, sourcePath = "design.md") {
  const colorMap = parseColorsSection(sectionContent(md, "Colors"));
  const typographySection = sectionContent(md, "Typography");
  const out = {
    project: nextLineValue(sectionContent(md, "Project"), "Name") ?? nextLineValue(sectionContent(md, "Project"), "Project") ?? "",
    vision: sectionContent(md, "Vision"),
    users: sectionContent(md, "Users"),
    features: listItems(sectionContent(md, "Core Features")),
    pages: parseSubsectionList(sectionContent(md, "Pages")),
    flow: listItems(sectionContent(md, "User Flow")),
    uiux: sectionContent(md, "UI / UX") || sectionContent(md, "UI/UX") || sectionContent(md, "Design Direction"),
    colors: {
      primary: colorMap["primary"],
      secondary: colorMap["secondary"],
      background: colorMap["background"],
      surface: colorMap["surface"],
      card: colorMap["card"],
      text: colorMap["text"],
      mutedText: colorMap["mutedtext"] ?? colorMap["muted"],
      border: colorMap["border"],
      success: colorMap["success"],
      warning: colorMap["warning"],
      error: colorMap["error"]
    },
    typography: {
      font: nextLineValue(typographySection, "Font family") ?? nextLineValue(typographySection, "Font") ?? nextLineValue(typographySection, "Body font"),
      heading: nextLineValue(typographySection, "Heading font") ?? nextLineValue(typographySection, "Heading"),
      body: nextLineValue(typographySection, "Body font") ?? nextLineValue(typographySection, "Body"),
      headingWeights: nextLineValue(typographySection, "Heading weights") ?? nextLineValue(typographySection, "Heading weight"),
      bodyWeight: nextLineValue(typographySection, "Body weight")
    },
    layout: {
      maxWidth: nextLineValue(sectionContent(md, "Layout"), "Maximum content width"),
      pageLayout: nextLineValue(sectionContent(md, "Layout"), "Page layout"),
      sidebarWidth: nextLineValue(sectionContent(md, "Layout"), "Sidebar width"),
      headerHeight: nextLineValue(sectionContent(md, "Layout"), "Header height"),
      contentPadding: nextLineValue(sectionContent(md, "Layout"), "Content padding")
    },
    grid: parseGrid(sectionContent(md, "Grid")),
    spacing: parseSpacing(sectionContent(md, "Spacing")),
    radius: {
      button: nextLineValue(sectionContent(md, "Border Radius"), "Buttons"),
      card: nextLineValue(sectionContent(md, "Border Radius"), "Cards"),
      inputs: nextLineValue(sectionContent(md, "Border Radius"), "Inputs")
    },
    shadows: listItems(sectionContent(md, "Shadows")),
    components: parseSubsectionList(sectionContent(md, "Components")),
    responsive: parseResponsive(sectionContent(md, "Responsive Design")),
    animations: listItems(sectionContent(md, "Animations")),
    icons: nextLineValue(sectionContent(md, "Icons"), "Icon library") ?? nextLineValue(sectionContent(md, "Icons"), "Icons"),
    images: sectionContent(md, "Images"),
    accessibility: listItems(sectionContent(md, "Accessibility")),
    doNot: listItems(sectionContent(md, "Do Not")),
    frontend: {
      framework: nextLineValue(sectionContent(md, "Frontend"), "Framework") ?? "",
      componentLibrary: nextLineValue(sectionContent(md, "Frontend"), "Component library") ?? nextLineValue(sectionContent(md, "Frontend"), "Component")
    },
    backend: {
      framework: nextLineValue(sectionContent(md, "Backend"), "Framework"),
      apiStyle: nextLineValue(sectionContent(md, "Backend"), "API style") ?? nextLineValue(sectionContent(md, "Backend"), "API")
    },
    database: {
      database: nextLineValue(sectionContent(md, "Database"), "Database") ?? nextLineValue(sectionContent(md, "Backend"), "Database"),
      entities: nextLineValue(sectionContent(md, "Database"), "Main entities") ?? nextLineValue(sectionContent(md, "Database"), "Entities")
    },
    authentication: sectionContent(md, "Authentication"),
    security: sectionContent(md, "Security"),
    integrations: sectionContent(md, "Integrations"),
    acceptanceCriteria: listItems(sectionContent(md, "Acceptance Criteria")),
    warnings: [],
    raw: md,
    parsedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  out.warnings = validateDesign(out, sourcePath);
  return out;
}
function validateDesign(d, source) {
  const warnings = [];
  if (!d.colors.primary) warnings.push(`${source}: missing Primary color`);
  if (!d.colors.background) warnings.push(`${source}: missing Background color`);
  if (!d.colors.text) warnings.push(`${source}: missing Text color`);
  if (!d.typography.font) warnings.push(`${source}: missing Typography`);
  if (!d.layout.pageLayout) warnings.push(`${source}: missing Layout definition`);
  if (!d.responsive.mobile) warnings.push(`${source}: missing Mobile responsive definition`);
  if (!d.responsive.desktop) warnings.push(`${source}: missing Desktop responsive definition`);
  if (d.components.length === 0) warnings.push(`${source}: missing Component styles`);
  return warnings;
}
function toDesignSystemJson(d) {
  const theme = (() => {
    const t = (d.uiux + " " + d.raw.slice(0, 2e3)).toLowerCase();
    if (t.includes("light + dark") || t.includes("light+dark") || t.includes("allow theme switching")) return "system";
    if (t.includes("dark")) return "dark";
    if (t.includes("light")) return "light";
    return "system";
  })();
  const colors = {};
  for (const [k, v] of Object.entries(d.colors)) {
    if (v) colors[k === "mutedText" ? "muted" : k] = v;
  }
  return {
    theme,
    colors,
    layout: {
      type: parseLayoutType(d.layout.pageLayout ?? ""),
      sidebarWidth: parseNumber(d.layout.sidebarWidth),
      headerHeight: parseNumber(d.layout.headerHeight),
      maxWidth: parseNumber(d.layout.maxWidth)
    },
    typography: {
      font: d.typography.font ?? d.typography.heading ?? "Inter"
    },
    radius: {
      card: parseNumber(d.radius.card ?? d.radius.inputs),
      button: parseNumber(d.radius.button)
    },
    spacing: d.spacing.length ? d.spacing : [4, 8, 12, 16, 24, 32, 48, 64],
    components: d.components,
    responsive: d.responsive,
    features: d.features,
    pages: d.pages,
    warnings: d.warnings,
    raw: d.raw
  };
}
function designSystemToCssTokens(json) {
  const lines = [];
  lines.push(":root {");
  for (const [k, v] of Object.entries(json.colors)) {
    if (v) lines.push(`  --color-${k}: ${v};`);
  }
  if (json.layout.sidebarWidth) lines.push(`  --layout-sidebar-width: ${json.layout.sidebarWidth}px;`);
  if (json.layout.headerHeight) lines.push(`  --layout-header-height: ${json.layout.headerHeight}px;`);
  if (json.layout.maxWidth) lines.push(`  --layout-max-width: ${json.layout.maxWidth}px;`);
  if (json.radius.card) lines.push(`  --radius-card: ${json.radius.card}px;`);
  if (json.radius.button) lines.push(`  --radius-button: ${json.radius.button}px;`);
  for (const s of json.spacing) {
    lines.push(`  --space-${s}: ${s}px;`);
  }
  lines.push("}");
  return lines.join("\n");
}

// src/agents/design-agent.ts
var DesignAgent = class extends BaseAgent {
  constructor() {
    super({ id: "design", role: "design", label: "Design", promptsKey: "design" });
  }
  async executeInternal(task, ctx) {
    const design = ctx.design;
    if (!design) {
      return {
        status: "failed",
        summary: "No design.md found; Design Agent requires design.md.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [{ severity: "high", category: "design", title: "design.md missing" }],
        nextActions: ["Ask the user to create design.md."]
      };
    }
    const dsj = toDesignSystemJson(design);
    const ok = writeProjectFile(ctx.root, "design-system.json", JSON.stringify(dsj, null, 2));
    const tokens = designSystemToCssTokens(dsj);
    const tokOk = writeProjectFile(ctx.root, ".agent/design-tokens.css", tokens);
    const issues = design.warnings.map((w) => ({
      severity: "medium",
      category: "design",
      title: w
    }));
    return {
      status: "success",
      summary: `Parsed design.md into design-system.json${issues.length ? ` (${issues.length} warnings)` : ""}`,
      filesChanged: [...ok ? ["design-system.json"] : [], ...tokOk ? [".agent/design-tokens.css"] : []],
      commandsRun: [],
      testsRun: [],
      issues,
      nextActions: []
    };
  }
  async review(result, ctx) {
    const design = ctx.design;
    if (!design) return { passed: false, score: 0, issues: [], notes: ["design.md missing"] };
    let score = 100;
    const notes = [];
    const issues = [];
    if (!design.colors.primary && !design.colors.background) {
      issues.push({ severity: "medium", category: "design", title: "design.md lacks colors" });
      score -= 30;
    }
    if (!design.responsive.mobile && !design.responsive.tablet) {
      issues.push({ severity: "medium", category: "design", title: "design.md lacks responsive definitions" });
      score -= 20;
    }
    if (!design.typography.font) {
      issues.push({ severity: "low", category: "design", title: "design.md lacks typography" });
      score -= 10;
    }
    notes.push(`Design system parsed with ${design.features.length} features, ${design.pages.length} pages.`);
    if (issues.length > 0) notes.push(`${issues.length} design gaps reported.`);
    return { passed: score >= 60, score, issues, notes };
  }
};

// src/agents/apply.ts
import { promises as fs } from "node:fs";
import { isAbsolute as isAbsolute2, relative as relative5, resolve as resolve6, sep as sep2 } from "node:path";
function resolveInWorkspace(root, p) {
  const base2 = resolve6(root);
  const target = isAbsolute2(p) ? resolve6(p) : resolve6(base2, p);
  const rel = relative5(base2, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep2}`) || isAbsolute2(rel)) return void 0;
  return target;
}
function parseFileOps(text) {
  const ops = [];
  const commands = [];
  const blocks = text.match(/```(\w+)\n([\s\S]*?)```/g) ?? [];
  const src = blocks.length ? blocks.join("\n") : text;
  const writeRe = /FILE:\s*([^\n]+)\n(?:TYPE:\s*(\w+)\n)?([\s\S]*?)(?=\nFILE:|$)/g;
  let m;
  while ((m = writeRe.exec(src)) !== null) {
    const path = m[1].trim();
    const opRaw = (m[2] ?? "write").toLowerCase();
    const op = opRaw === "append" || opRaw === "delete" ? opRaw : "write";
    ops.push({ path, op, content: m[3].trim() });
  }
  const cmdRe = /(?:RUN|COMMAND):\s*(.+)/g;
  let c;
  while ((c = cmdRe.exec(src)) !== null) {
    commands.push(c[1].trim());
  }
  return { ops, commands };
}
async function applyFileOps(ctx, text) {
  const { ops, commands } = parseFileOps(text);
  const files = [];
  const issues = [];
  let failed = 0;
  const commandsRun = [];
  for (const op of ops) {
    if (!op.path || op.path.includes("..")) {
      failed++;
      issues.push({ severity: "medium", category: "agent", title: `Skipped unsafe path: ${op.path}` });
      continue;
    }
    if (op.op === "delete") {
      if (!await ctx.getApproval({ message: `An agent wants to delete ${op.path}`, reason: "destructive" })) {
        failed++;
        issues.push({ severity: "medium", category: "agent", title: `Delete not approved: ${op.path}` });
        continue;
      }
      const target = resolveInWorkspace(ctx.root, op.path);
      if (!target) {
        failed++;
        issues.push({ severity: "medium", category: "agent", title: `Refused to delete outside workspace: ${op.path}` });
        continue;
      }
      ctx.log(`deleting ${op.path}`);
      try {
        await fs.unlink(target);
        files.push({ path: op.path, op: "delete" });
      } catch (err) {
        failed++;
        issues.push({
          severity: "medium",
          category: "agent",
          title: `Failed to delete ${op.path}`,
          detail: err instanceof Error ? err.message : String(err)
        });
      }
      continue;
    }
    const ok = ctx.writeFile(op.path, op.content ?? "");
    if (ok) {
      files.push({ path: op.path, op: op.op });
    } else {
      failed++;
      issues.push({ severity: "medium", category: "agent", title: `Failed to write ${op.path}` });
    }
  }
  for (const cmd of commands) {
    if (cmd.includes("&&") || cmd.includes(";") || cmd.includes("|")) {
      issues.push({ severity: "low", category: "agent", title: "Skipped chained shell command" });
      continue;
    }
    const result = await ctx.run(cmd);
    commandsRun.push(cmd);
    if (result.status === "error") {
      failed++;
      issues.push({
        severity: "medium",
        category: "agent",
        title: `Command failed (${result.exitCode}): ${cmd}`,
        detail: result.stderr.slice(0, 600)
      });
    }
  }
  return { applied: files.length, failed, noFiles: ops.length === 0 && commands.length === 0, files, commandsRun, issues };
}

// src/agents/frontend.ts
var FrontendAgent = class extends BaseAgent {
  constructor() {
    super({ id: "frontend", role: "frontend", label: "Frontend", promptsKey: "frontend" });
  }
  async executeInternal(task, ctx) {
    if (!ctx.design) {
      return {
        status: "blocked",
        summary: "Frontend requires design.md before implementation.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [{ severity: "high", category: "design", title: "Frontend task blocked: no design.md" }],
        nextActions: ["Create design.md first."]
      };
    }
    const out = await this.runLlm(task, ctx);
    const { files, failed, noFiles, commandsRun, issues } = await applyFileOps(ctx, out);
    if (noFiles && files.length === 0) {
      return {
        status: "blocked",
        summary: "Frontend agent produced no file operations.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [],
        nextActions: ["Re-run task with explicit file-content output."]
      };
    }
    return {
      status: failed === 0 ? "success" : "failed",
      summary: `Frontend changes applied: ${files.map((f) => f.path).join(", ")}`,
      filesChanged: files.map((f) => f.path),
      commandsRun,
      testsRun: [],
      issues,
      nextActions: []
    };
  }
};

// src/agents/backend.ts
var BackendAgent = class extends BaseAgent {
  constructor() {
    super({ id: "backend", role: "backend", label: "Backend", promptsKey: "backend" });
  }
  async executeInternal(task, ctx) {
    const out = await this.runLlm(task, ctx);
    const issues = [];
    const { files, commandsRun, failed, noFiles } = await applyFileOps(ctx, out);
    if (noFiles && files.length === 0) {
      return {
        status: "blocked",
        summary: "Backend agent produced no file operations.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [],
        nextActions: ["Re-run task with explicit file-content output."]
      };
    }
    return {
      status: failed === 0 ? "success" : "failed",
      summary: `Backend changes applied: ${files.map((f) => f.path).join(", ")}`,
      filesChanged: files.map((f) => f.path),
      commandsRun,
      testsRun: [],
      issues,
      nextActions: []
    };
  }
};

// src/agents/database.ts
var DatabaseAgent = class extends BaseAgent {
  constructor() {
    super({ id: "database", role: "database", label: "Database", promptsKey: "database" });
  }
  async executeInternal(task, ctx) {
    const out = await this.runLlm(task, ctx);
    const { files, failed, noFiles, commandsRun, issues } = await applyFileOps(ctx, out);
    if (noFiles && files.length === 0) {
      return {
        status: "blocked",
        summary: "Database agent produced no file operations.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [],
        nextActions: ["Re-run task with explicit file-content output."]
      };
    }
    return {
      status: failed === 0 ? "success" : "failed",
      summary: `Database changes applied: ${files.map((f) => f.path).join(", ")}`,
      filesChanged: files.map((f) => f.path),
      commandsRun,
      testsRun: [],
      issues,
      nextActions: []
    };
  }
};

// src/agents/security.ts
var SECURITY_AREAS = [
  "Authentication",
  "Authorization",
  "Secrets & environment variables",
  "API security",
  "Input validation",
  "SQL injection",
  "XSS",
  "CSRF",
  "Dependency vulnerabilities",
  "Insecure configuration",
  "Exposed credentials",
  "File permissions",
  "Command execution"
];
var SecurityAgent = class extends BaseAgent {
  constructor() {
    super({ id: "security", role: "security", label: "Security", promptsKey: "security" });
  }
  async executeInternal(task, ctx) {
    const out = await this.runLlm(task, ctx, SECURITY_AREAS.map((a) => `- ${a}`).join("\n"));
    const report = redact(out);
    const file = ".agent/security-report.md";
    const ok = writeProjectFile(ctx.root, file, `# Security Report

${report}
`);
    const issues = [];
    const criticalCount = (report.match(/^\s*(?:[-*]\s*)?\[?critical\]?\s*:/im) ?? []).length;
    const highCount = (report.match(/^\s*(?:[-*]\s*)?\[?high\]?\s*:/im) ?? []).length;
    if (criticalCount > 0) {
      issues.push({
        severity: "critical",
        category: "security",
        title: "Critical security findings present",
        detail: report.slice(0, 1e3)
      });
    } else if (highCount > 0) {
      issues.push({ severity: "high", category: "security", title: "High-severity security findings present" });
    }
    return {
      status: ok ? issues.some((i) => i.severity === "critical") ? "blocked" : "success" : "failed",
      summary: `Security audit wrote ${report.length} chars to ${file}`,
      filesChanged: ok ? [file] : [],
      commandsRun: [],
      testsRun: [],
      issues,
      nextActions: issues.some((i) => i.severity === "critical") ? ["Fix critical security findings before completion."] : []
    };
  }
  async review(result, ctx) {
    const issues = result.issues ?? [];
    const critical = issues.filter((i) => i.severity === "critical").length;
    const high = issues.filter((i) => i.severity === "high").length;
    const score = Math.max(0, 100 - critical * 40 - high * 15);
    return {
      passed: critical === 0,
      score,
      issues,
      notes: [`Critical: ${critical}, High: ${high}`]
    };
  }
};

// src/agents/devops.ts
var DevOpsAgent = class extends BaseAgent {
  constructor() {
    super({ id: "devops", role: "devops", label: "DevOps", promptsKey: "devops" });
  }
  async executeInternal(task, ctx) {
    const out = await this.runLlm(task, ctx);
    const { files, failed, noFiles, commandsRun, issues } = await applyFileOps(ctx, out);
    if (noFiles && files.length === 0) {
      return {
        status: "blocked",
        summary: "DevOps agent produced no file operations.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [],
        nextActions: ["Re-run task with explicit file-content output."]
      };
    }
    return {
      status: failed === 0 ? "success" : "failed",
      summary: `DevOps changes applied: ${files.map((f) => f.path).join(", ")}`,
      filesChanged: files.map((f) => f.path),
      commandsRun,
      testsRun: [],
      issues,
      nextActions: []
    };
  }
};

// src/agents/qa.ts
import { existsSync as existsSync8 } from "node:fs";
import { join as join9 } from "node:path";
function parseTestOutput(stdout) {
  const lines = stdout.split(/\r?\n/);
  const testLines = lines.filter((l) => /^\s*(tests?|✓|✗)\b/i.test(l) || /tests?\s*:/i.test(l));
  const scope = testLines.length > 0 ? testLines.join("\n") : stdout;
  const passed = [...scope.matchAll(/(\d+)\s+passed/g)].map((m) => Number(m[1]));
  const failed = [...scope.matchAll(/(\d+)\s+failed/g)].map((m) => Number(m[1]));
  return {
    pass: passed.length > 0 ? passed[passed.length - 1] : 0,
    fail: failed.length > 0 ? failed[failed.length - 1] : 0
  };
}
var QAAgent = class extends BaseAgent {
  constructor() {
    super({ id: "qa", role: "qa", label: "QA", promptsKey: "qa" });
  }
  async executeInternal(task, ctx) {
    const tests = await this.detectAndRunTests(ctx);
    const file = ".agent/test-results.md";
    const report = buildTestReport(tests);
    writeProjectFile(ctx.root, file, report);
    const issues = [];
    if (tests.fail > 0) {
      issues.push({
        severity: "high",
        category: "testing",
        title: `${tests.fail} test(s) failed`,
        detail: tests.stdout.slice(-2e3)
      });
    }
    if (tests.buildOk === false) {
      if (tests.buildReason === "missing-node-modules") {
        issues.push({
          severity: "high",
          category: "build",
          title: "Build blocked: node_modules not found",
          detail: `The configured build (${tests.buildCommand ?? "npm run build"}) could not run because dependencies are not installed. Run 'npm install' first.`,
          fixRecommendation: "npm install"
        });
      } else {
        issues.push({
          severity: "critical",
          category: "build",
          title: "Build failed",
          detail: tests.stdout.slice(-2e3)
        });
      }
    }
    if (tests.blocked) {
      issues.push({
        severity: "medium",
        category: "testing",
        title: "Test run blocked",
        detail: tests.blocked
      });
    }
    const failed = tests.fail > 0 || tests.buildOk === false;
    return {
      status: failed ? "failed" : tests.blocked ? "blocked" : "success",
      summary: `Tests: ${tests.pass} passed, ${tests.fail} failed${tests.blocked ? " (BLOCKED)" : ""}; build ${buildStatusLabel(tests)}`,
      filesChanged: [file],
      commandsRun: tests.commands,
      testsRun: tests.commands.filter((c) => c.includes("test") || c.includes("build")),
      issues,
      nextActions: tests.fail > 0 ? ["Fix failing tests (see issues)."] : tests.blocked ? ["Resolve the blocked test run (see issues)."] : []
    };
  }
  async review(result, ctx) {
    const issues = result.issues ?? [];
    const fail = issues.filter((i) => i.category === "testing" && i.severity === "high").length > 0;
    const build = issues.some((i) => i.category === "build" && i.severity === "critical");
    return {
      passed: !fail && !build,
      score: fail || build ? 40 : 100,
      issues,
      notes: [`Tests passed=${result.testsRun.length > 0} buildOk=${!build}`]
    };
  }
  async detectAndRunTests(ctx) {
    const files = ctx.listDir();
    const hasPkg = files.some((f) => f === "package.json");
    const commands = [];
    let pass = 0;
    let fail = 0;
    let stdout = "";
    let blocked;
    const term = new Terminal({ cwd: ctx.root, logger: void 0 });
    const runCmd = async (cmd) => {
      commands.push(cmd);
      const r = await term.run(cmd, { timeoutMs: 18e4 });
      const out = `$ ${cmd}
${r.stdout}
${r.stderr}
`;
      stdout += out;
      const counts2 = parseTestOutput(r.stdout);
      pass += counts2.pass;
      fail += counts2.fail;
      return { ok: r.status === "ok", stdout: out };
    };
    const build = await validateBuild(ctx.root, runCmd);
    if (hasPkg) {
      if (existsSync8(join9(ctx.root, "node_modules"))) {
        const suggested = suggestedTestCommand(ctx.root, []);
        const testCmd = suggested || "npm test -- --run";
        await runCmd(testCmd);
      } else {
        blocked = "node_modules not found \u2014 the test run could not start. Run 'npm install' first.";
        stdout += `$ npm test -- --run
[BLOCKED] ${blocked}
`;
      }
    } else {
      blocked = "no package.json found \u2014 no test command is configured; the test run could not start.";
      stdout += `[BLOCKED] ${blocked}
`;
    }
    const counts = parseTestOutput(stdout);
    return {
      pass: counts.pass || pass,
      fail: counts.fail || fail,
      buildOk: build.ok,
      buildReason: build.reason,
      buildCommand: build.command,
      blocked,
      stdout,
      commands
    };
  }
};
function buildStatusLabel(t) {
  if (t.buildOk) return t.buildCommand ? `OK (${t.buildCommand})` : "OK (no build configured)";
  if (t.buildReason === "missing-node-modules") return "BLOCKED (node_modules not found)";
  return `FAILED${t.buildCommand ? ` (${t.buildCommand})` : ""}`;
}
function buildTestReport(t) {
  return [
    "# Test Results",
    "",
    `Passed: ${t.pass}`,
    `Failed: ${t.fail}`,
    `Build: ${buildStatusLabel(t)}`,
    ...t.blocked ? [`Tests: BLOCKED \u2014 ${t.blocked}`] : [],
    "",
    "## Output",
    "",
    "```",
    t.stdout.slice(-4e3),
    "```"
  ].join("\n");
}

// src/agents/reviewer.ts
var ReviewerAgent = class extends BaseAgent {
  constructor() {
    super({ id: "reviewer", role: "reviewer", label: "Reviewer", promptsKey: "reviewer" });
  }
  async executeInternal(task, ctx) {
    const out = await this.runLlm(task, ctx);
    const file = ".agent/review.md";
    writeProjectFile(ctx.root, file, `# Code Review

${out}
`);
    const issues = extractIssues(out);
    return {
      status: issues.some((i) => i.severity === "high" || i.severity === "critical") ? "failed" : "success",
      summary: `Review wrote ${out.length} chars to ${file}; ${issues.length} issues found`,
      filesChanged: [file],
      commandsRun: [],
      testsRun: [],
      issues,
      nextActions: issues.length ? ["Assign fix tasks for review issues."] : []
    };
  }
  async review(result, ctx) {
    const issues = result.issues ?? [];
    const high = issues.filter((i) => i.severity === "high" || i.severity === "critical").length;
    const low = issues.length - high;
    const score = Math.max(0, 100 - high * 20 - low * 5);
    return {
      passed: high === 0,
      score,
      issues,
      notes: [`Reviewer found ${high} high-severity issues, ${low} lower-severity issues.`]
    };
  }
};
function extractIssues(text) {
  const issues = [];
  const lines = text.split("\n");
  const severityMap = {
    "critical": "critical",
    "high": "high",
    "medium": "medium",
    "low": "low"
  };
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) continue;
    const match = line.match(/^(?:[-*]\s*)?(?:\[(critical|high|medium|low)\]|(critical|high|medium|low)\s*:)\s*(.+)$/i);
    if (match) {
      if (current?.title) issues.push(current);
      const sev = (match[1] ?? match[2]).toLowerCase();
      current = {
        severity: severityMap[sev] ?? "medium",
        category: "review",
        title: match[3].trim()
      };
      continue;
    }
    if (current && line) {
      current.detail = (current.detail ? current.detail + "\n" : "") + line;
    }
  }
  if (current?.title) issues.push(current);
  return issues;
}

// src/scheduler/task.ts
function freshTask(partial) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: partial.id,
    agent: partial.agent,
    description: partial.description,
    dependencies: partial.dependencies ?? [],
    priority: partial.priority ?? "medium",
    status: partial.status ?? "pending",
    retries: 0,
    createdAt: now,
    updatedAt: now,
    metadata: partial.metadata ?? {}
  };
}

// src/agents/manager.ts
var ManagerAgent = class extends BaseAgent {
  constructor() {
    super({ id: "manager", role: "manager", label: "Manager", promptsKey: "manager" });
  }
  async executeInternal(task, ctx) {
    const out = await this.runLlm(task, ctx);
    return {
      status: "success",
      summary: `Manager produced plan of ${out.length} chars`,
      filesChanged: [],
      commandsRun: [],
      testsRun: [],
      issues: [],
      nextActions: []
    };
  }
  async buildTaskGraph(ctx) {
    const designText = ctx.readFile("design.md");
    const design = designText ? parseDesignSystem(designText) : void 0;
    const frontend = design && (design.pages.length > 0 || design.features.length > 0);
    const backend = design ? design.backend.framework !== void 0 || design.authentication !== void 0 : false;
    const db = design ? design.database.database !== void 0 : false;
    const tasks = [];
    let n = 1;
    const PREFIX = {
      requirements: "REQ",
      design: "DSN",
      frontend: "FE",
      backend: "BE",
      database: "DB",
      security: "SEC",
      devops: "DEV",
      qa: "QA",
      reviewer: "REV",
      manager: "MGR"
    };
    const add = (agent, description, deps, priority) => {
      const id = `${PREFIX[agent] ?? agent.toUpperCase().slice(0, 3)}-${String(n++).padStart(3, "0")}`;
      tasks.push(
        freshTask({
          id,
          agent,
          description,
          dependencies: deps,
          priority,
          status: "pending"
        })
      );
      return id;
    };
    const rid = add("requirements", "Convert requirements into requirements.md with acceptance criteria", [], "high");
    const did = add("design", "Parse design.md into design-system.json and validate", [rid], "high");
    let dbid = null;
    let backendId = null;
    let frontendId = null;
    if (db || backend) {
      if (db) {
        dbid = add("database", "Design and create database schema/migrations", [rid], "high");
      }
      if (backend) {
        backendId = add("backend", "Implement backend APIs, auth and business logic", [rid, ...dbid ? [dbid] : []], "high");
      }
    }
    if (frontend) {
      frontendId = add("frontend", "Implement frontend following design.md exactly", [did, ...backendId ? [backendId] : []], "high");
    }
    const secId = add("security", "Audit security and produce security-report.md", [rid, ...backendId ? [backendId] : [], ...frontendId ? [frontendId] : []], "high");
    const devId = add("devops", "Add deployment, env and build configuration", [rid], "medium");
    const qaDeps = [backendId ?? rid, frontendId ?? did, dbid ?? rid];
    const qaId = add("qa", "Run tests and build; produce test-results.md", [...new Set(qaDeps)], "high");
    const revId = add("reviewer", "Review complete project; produce review.md", [qaId, secId], "high");
    return tasks;
  }
};

// src/agents/registry.ts
function createAgentRegistry() {
  return [
    new ManagerAgent(),
    new RequirementsAgent(),
    new DesignAgent(),
    new FrontendAgent(),
    new BackendAgent(),
    new DatabaseAgent(),
    new SecurityAgent(),
    new DevOpsAgent(),
    new QAAgent(),
    new ReviewerAgent()
  ];
}

// src/neutron/agents.ts
import { resolve as resolve7 } from "node:path";

// src/approval/approver.ts
import { createInterface } from "node:readline";
var Approver = class {
  autoApprove;
  onPrint;
  constructor(opts = {}) {
    this.autoApprove = opts.autoApprove ?? false;
    this.onPrint = opts.print;
  }
  print(msg) {
    if (this.onPrint) this.onPrint(msg);
    else process.stdout.write(redact(msg) + "\n");
  }
  async ask(req) {
    const { approved } = await this.askWithSource(req);
    return approved;
  }
  /**
   * Same fail-closed semantics as ask(), but also reports where the decision
   * came from: "-y" (auto-approve), "interactive" (TTY prompt), or "non-tty"
   * (non-interactive auto-deny).
   */
  async askWithSource(req) {
    if (this.autoApprove) {
      this.print(`[auto-approved] ${req.reason}: ${req.command ?? req.message}`);
      await req.onApprove();
      return { approved: true, source: "-y" };
    }
    if (!process.stdin.isTTY) {
      this.print(`[non-interactive] ${req.reason}: auto-denying ${req.command ?? req.message}`);
      await req.onDeny();
      return { approved: false, source: "non-tty" };
    }
    this.print(`
\u26A0 APPROVAL REQUIRED
`);
    this.print(req.message);
    if (req.command) this.print(`Command: ${req.command}`);
    this.print(`Reason: ${req.reason}`);
    this.print("Allow? [y/N] ");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve10) => rl.question("", resolve10));
    rl.close();
    if (answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes") {
      await req.onApprove();
      return { approved: true, source: "interactive" };
    }
    await req.onDeny();
    return { approved: false, source: "interactive" };
  }
};

// src/chat/diff.ts
var MAX_LINES = 3e3;
function splitLines(text) {
  return text.length === 0 ? [] : text.replace(/\r\n/g, "\n").split("\n");
}
function unifiedDiff(before, after, path, context = 3) {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    if (before === after) return "";
    return [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${a.length} +1,${b.length} @@`,
      ...a.map((l) => `-${l}`),
      ...b.map((l) => `+${l}`)
    ].join("\n");
  }
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      lcs[i2][j2] = a[i2] === b[j2] ? lcs[i2 + 1][j2 + 1] + 1 : Math.max(lcs[i2 + 1][j2], lcs[i2][j2 + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: " ", text: a[i], aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "-", text: a[i], aLine: i + 1, bLine: j + 1 });
      i++;
    } else {
      ops.push({ type: "+", text: b[j], aLine: i + 1, bLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "-", text: a[i], aLine: i + 1, bLine: m + 1 });
    i++;
  }
  while (j < m) {
    ops.push({ type: "+", text: b[j], aLine: n + 1, bLine: j + 1 });
    j++;
  }
  const changed = ops.map((op, idx) => op.type === " " ? -1 : idx).filter((idx) => idx >= 0);
  if (changed.length === 0) return "";
  const hunks = [];
  for (const idx of changed) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length - 1, idx + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }
  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    const slice = ops.slice(hunk.start, hunk.end + 1);
    const aStart = slice.find((op) => op.type !== "+")?.aLine ?? 0;
    const bStart = slice.find((op) => op.type !== "-")?.bLine ?? 0;
    const aCount = slice.filter((op) => op.type !== "+").length;
    const bCount = slice.filter((op) => op.type !== "-").length;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of slice) out.push(`${op.type}${op.text}`);
  }
  return out.join("\n");
}

// src/neutron/agents.ts
var AGENT_MAP = {
  frontend: "frontend",
  backend: "backend",
  database: "database",
  testing: "qa",
  devops: "devops",
  other: "backend"
};
function detectFileChanges(root, tasks, snapshots) {
  const changes = [];
  for (const s of snapshots) {
    if (!isWithinWorkspace(root, resolve7(root, s.path))) continue;
    const entry = tasks.find((t) => t.files.includes(s.path));
    const agent = entry?.agent ?? "backend";
    const risk = entry?.risk ?? "low";
    if (s.after === void 0 && s.before !== void 0) {
      changes.push({
        path: s.path,
        kind: "deleted",
        linesAdded: 0,
        linesRemoved: lineCount(s.before),
        agent: agentLabel(agent),
        reason: entry?.reason ?? "Removed as part of the maintenance task",
        taskId: entry?.id,
        risk
      });
    } else if (s.after !== void 0 && s.before === void 0) {
      changes.push({
        path: s.path,
        kind: "added",
        linesAdded: lineCount(s.after),
        linesRemoved: 0,
        agent: agentLabel(agent),
        reason: entry?.reason ?? "Created as part of the maintenance task",
        taskId: entry?.id,
        risk,
        after: s.after
      });
    } else if (s.after !== void 0 && s.before !== void 0 && s.after !== s.before) {
      const patch = unifiedDiff(s.before, s.after, s.path);
      const minuses = (patch.match(/(?:^|\n)-(?!-)/g) ?? []).length;
      const pluses = (patch.match(/(?:^|\n)\+(?!\+)/g) ?? []).length;
      changes.push({
        path: s.path,
        kind: "modified",
        linesAdded: pluses,
        linesRemoved: minuses,
        agent: agentLabel(agent),
        reason: entry?.reason ?? "Modified as part of the maintenance task",
        taskId: entry?.id,
        risk,
        before: s.before,
        after: s.after
      });
    }
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return changes;
}
function maxBatchWidth(widths) {
  return widths.reduce((m, w) => Math.max(m, w), 0);
}
var DEFAULT_MAX_PARALLEL = 4;
function resolveMaxParallel(explicit) {
  const envRaw = process.env.NEUTRON_MAX_PARALLEL;
  const envVal = envRaw !== void 0 && envRaw.trim() !== "" ? Number(envRaw) : NaN;
  const candidate = explicit ?? (Number.isInteger(envVal) && envVal > 0 ? envVal : NaN);
  if (Number.isInteger(candidate) && candidate > 0) return candidate;
  return DEFAULT_MAX_PARALLEL;
}
function boundedChunks(items, cap) {
  const width = Math.max(1, Math.floor(cap));
  const chunks = [];
  for (let i = 0; i < items.length; i += width) {
    chunks.push(items.slice(i, i + width));
  }
  return chunks;
}
async function implementPlan(opts, tasks) {
  const log = opts.log ?? (() => {
  });
  const root = opts.root;
  const outcome = {
    completed: 0,
    failed: 0,
    blocked: 0,
    changes: [],
    extended: [],
    tasksWithResults: 0,
    noLlm: false
  };
  const providers = readGlobalProviders();
  const apiHasProviders = !!opts.api && opts.api.registry.ids().length > 0;
  const canRun = apiHasProviders || providers.some((p) => p.enabled && p.baseUrl) && !!opts.api;
  const beforeMap = /* @__PURE__ */ new Map();
  const touchSet = /* @__PURE__ */ new Set();
  for (const t of tasks) for (const f of t.files) touchSet.add(f);
  for (const f of touchSet) {
    const content = readProjectFile(root, f);
    if (content !== void 0) beforeMap.set(f, content);
  }
  if (!canRun) {
    outcome.noLlm = true;
    for (const t of tasks) {
      const task = {
        id: t.id,
        agent: AGENT_MAP[t.agent] ?? "backend",
        description: `${t.label}. ${t.reason}`,
        dependencies: t.dependencies,
        priority: riskToPriority(t.risk),
        status: "failed",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        retries: 0
      };
      const result = {
        status: "failed",
        summary: "No LLM provider configured. Cannot fabricate an implementation.",
        filesChanged: [],
        commandsRun: [],
        testsRun: [],
        issues: [
          {
            severity: "critical",
            category: "provider",
            title: "No LLM provider configured \u2014 implementation not possible",
            detail: "Run `neutron config` to add an OpenAI-compatible provider, then retry. NEUTRON will not fabricate code changes or test results.",
            fixRecommendation: "neutron config && neutron maintain run --resume"
          }
        ],
        nextActions: [
          "Retry",
          "Reassign",
          "Inspect Logs",
          "Continue Without Agent"
        ]
      };
      outcome.failed++;
      outcome.extended.push({ task: t, result });
      log(
        `[FAILED] ${t.id} (${t.agent}) ${t.label} \u2014 no LLM provider configured`
      );
      opts.recorder?.audit(
        agentLabel(t.agent),
        `Blocked task ${t.id}`,
        "no LLM provider configured"
      );
    }
    opts.recorder?.setChanges(outcome.changes);
    return outcome;
  }
  const approver = new Approver({ autoApprove: opts.autoApprove === true });
  const term = new Terminal({
    cwd: root,
    approve: (req) => approver.ask(req)
  });
  const ctx = {
    root,
    design: void 0,
    designJson: void 0,
    api: opts.api,
    log: (m) => {
      log(m);
      opts.recorder?.audit("orchestrator", m);
    },
    run: async (cmd) => term.run(cmd, { timeoutMs: 24e4 }).then((r) => ({
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode ?? 1
    })),
    readFile: (p) => readProjectFile(root, p),
    writeFile: (p, c) => writeProjectFile(root, p, c),
    listDir: () => [],
    getApproval: async (req) => approver.ask(req)
  };
  const agents = createAgentRegistry();
  const byAgent = /* @__PURE__ */ new Map();
  for (const a of agents) byAgent.set(a.id, a);
  const done = /* @__PURE__ */ new Map();
  outcome.extended = tasks.map((t) => ({ task: t, result: void 0 }));
  const runnable = new Set(tasks.map((t) => t.id));
  const batchWidths = [];
  const cap = resolveMaxParallel(opts.maxParallel);
  const observedWidths = [];
  let guard = 0;
  while (runnable.size > 0 && guard++ < 100) {
    const batch = [];
    for (const t of tasks) {
      if (!runnable.has(t.id)) continue;
      if (done.has(t.id)) continue;
      const depsReady = t.dependencies.every((d) => done.has(d));
      if (depsReady) batch.push(t);
    }
    batchWidths.push(batch.length);
    if (batch.length === 0) {
      for (const t of tasks) {
        if (!done.has(t.id)) {
          outcome.blocked++;
          done.set(t.id, void 0);
          opts.recorder?.audit(
            agentLabel(t.agent),
            `Blocked task ${t.id}`,
            "dependency not satisfiable"
          );
        }
      }
      break;
    }
    const runTask = async (t) => {
      runnable.delete(t.id);
      const agentMeta = byAgent.get(AGENT_MAP[t.agent] ?? "backend");
      const task = {
        id: t.id,
        agent: AGENT_MAP[t.agent] ?? "backend",
        description: `${t.label}. ${t.reason}`,
        dependencies: t.dependencies,
        priority: riskToPriority(t.risk),
        status: "running",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        retries: 0
      };
      opts.recorder?.audit(
        agentLabel(t.agent),
        `Started task ${t.id}`,
        t.label
      );
      try {
        if (!agentMeta) {
          throw new Error(`No agent available for ${t.agent}`);
        }
        const result = await agentMeta.execute(task, ctx);
        outcome.tasksWithResults++;
        const entry = outcome.extended.find((e) => e.task.id === t.id);
        if (entry) entry.result = result;
        if (result.status === "success") {
          outcome.completed++;
          done.set(t.id, task);
          opts.recorder?.audit(
            agentLabel(t.agent),
            `Completed task ${t.id}`,
            `modified ${result.filesChanged.length} file(s)`
          );
        } else if (result.status === "blocked") {
          outcome.blocked++;
          done.set(t.id, void 0);
          opts.recorder?.audit(
            agentLabel(t.agent),
            `Blocked task ${t.id}`,
            result.summary
          );
        } else {
          outcome.failed++;
          done.set(t.id, void 0);
          opts.recorder?.audit(
            agentLabel(t.agent),
            `Failed task ${t.id}`,
            result.summary
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcome.failed++;
        const result = {
          status: "failed",
          summary: message,
          filesChanged: [],
          commandsRun: [],
          testsRun: [],
          issues: [
            {
              severity: "high",
              category: "agent",
              title: `Agent crashed: ${message}`
            }
          ],
          nextActions: [
            "Retry",
            "Reassign",
            "Inspect Logs",
            "Continue Without Agent"
          ]
        };
        const entry = outcome.extended.find((e) => e.task.id === t.id);
        if (entry) {
          entry.result = result;
          entry.error = message;
        }
        done.set(t.id, void 0);
        opts.recorder?.audit(
          agentLabel(t.agent),
          `Failed task ${t.id}`,
          message
        );
      }
    };
    for (const chunk of boundedChunks(batch, cap)) {
      observedWidths.push(chunk.length);
      await Promise.all(chunk.map(runTask));
    }
  }
  const touched = [...new Set(tasks.flatMap((t) => t.files))];
  outcome.changes = detectFileChanges(
    root,
    tasks,
    touched.map((f) => ({
      path: f,
      before: beforeMap.get(f),
      after: readProjectFile(root, f)
    }))
  );
  opts.recorder?.setChanges(outcome.changes);
  opts.recorder?.setMetrics({
    agentsExecuted: outcome.extended.length,
    parallelTasks: maxBatchWidth(observedWidths),
    maxParallelTasks: cap,
    modifiedFiles: outcome.changes.length
  });
  return outcome;
}
function lineCount(content) {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}
function agentLabel(agent) {
  const map = {
    frontend: "Frontend Agent",
    backend: "Backend Agent",
    database: "Database Agent",
    testing: "Testing Agent",
    devops: "DevOps Agent",
    other: "Backend Agent",
    orchestrator: "NEUTRON"
  };
  return map[agent] ?? agent;
}
function riskToPriority(risk) {
  return risk === "critical" ? "critical" : risk === "high" ? "high" : risk === "medium" ? "medium" : "low";
}

// src/neutron/store.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync4, readFileSync as readFileSync7, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join10 } from "node:path";
var NeutronStore = class {
  dir;
  file;
  constructor(root) {
    this.dir = stateDir(root);
    this.file = join10(this.dir, "state.json");
  }
  ensure() {
    mkdirSync4(this.dir, { recursive: true });
  }
  load() {
    if (!existsSync9(this.file)) return {};
    try {
      return JSON.parse(readFileSync7(this.file, "utf8"));
    } catch {
      return {};
    }
  }
  save(state) {
    this.ensure();
    writeFileSync4(this.file, JSON.stringify(state, null, 2), "utf8");
  }
  update(patch) {
    const next = { ...this.load(), ...patch };
    this.save(next);
    return next;
  }
  clear() {
    this.ensure();
    writeFileSync4(this.file, JSON.stringify({}, null, 2), "utf8");
  }
};

// src/neutron/record.ts
import { existsSync as existsSync10, mkdirSync as mkdirSync5, readFileSync as readFileSync8, writeFileSync as writeFileSync5, readdirSync as readdirSync5 } from "node:fs";
import { join as join11 } from "node:path";
var RunRecorder = class {
  root;
  dir;
  record;
  constructor(root, init) {
    this.root = root;
    this.dir = join11(stateDir(root), "runs");
    this.record = {
      id: init?.id ?? `run-${Date.now().toString(36)}`,
      createdAt: init?.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
      status: "created"
    };
    void this.dir;
  }
  /** Persist the current record to the run archive (create dirs as needed). */
  save() {
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    new RunArchive(this.root).add(this.record);
  }
  get() {
    return this.record;
  }
  stage(name, status) {
    const existing = this.record.stages.find((s) => s.name === name);
    const entry = { name, status, at: (/* @__PURE__ */ new Date()).toISOString() };
    if (existing) Object.assign(existing, entry);
    else this.record.stages.push(entry);
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  audit(agent, action, detail) {
    this.record.events.push({ ts: (/* @__PURE__ */ new Date()).toISOString(), agent, action, detail });
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  history(entry) {
    this.record.history.push({ ...entry, ts: entry.ts ?? (/* @__PURE__ */ new Date()).toISOString() });
  }
  setStatus(status) {
    this.record.status = status;
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  addApproval(a) {
    if (a.approved) {
      this.record.metrics.humanApprovals = (this.record.metrics.humanApprovals ?? 0) + 1;
      this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
  }
  /**
   * Persist the full approval decision (timestamp, decision, gate title, source)
   * and emit a detailed audit event. Counters behave like addApproval().
   */
  recordApproval(d) {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    this.record.approvals.push({ ts, approved: d.approved, title: d.title, source: d.source, reason: d.reason });
    if (d.approved) {
      this.record.metrics.humanApprovals = (this.record.metrics.humanApprovals ?? 0) + 1;
    }
    const decision = d.approved ? "APPROVED" : "DENIED";
    const detail = [decision, d.title ? `gate="${d.title}"` : void 0, d.source ? `source=${d.source}` : void 0, d.reason ? `reason=${d.reason}` : void 0].filter(Boolean).join(" ");
    this.audit("NEUTRON", "approval decision", `${detail} at=${ts}`);
    this.record.updatedAt = ts;
  }
  setMetrics(patch) {
    this.record.metrics = { ...this.record.metrics, ...patch };
  }
  setTestResult(t) {
    this.record.testResult = t;
    this.record.metrics.testsExecuted = t.after?.total ?? 0;
    this.record.metrics.testsPassed = t.after?.passed ?? 0;
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  setSecurity(s) {
    this.record.security = s;
    this.record.metrics.securityFindings = s.findings.length;
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  setCodeReview(c) {
    this.record.codeReview = c;
    this.record.metrics.codeReviewFindings = c.findings.length;
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  setRelease(g) {
    this.record.release = g;
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  setCheckpoint(c) {
    this.record.checkpoint = c;
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  setChanges(changes) {
    this.record.changes = changes;
    this.record.changeCount = changes.length;
    this.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
};
var RunArchive = class {
  dir;
  listFile;
  constructor(root) {
    const base2 = stateDir(root);
    this.dir = join11(base2, "runs");
    this.listFile = join11(base2, "runs.json");
  }
  ensure() {
    mkdirSync5(this.dir, { recursive: true });
  }
  add(rec) {
    this.ensure();
    writeFileSync5(join11(this.dir, `${rec.id}.json`), JSON.stringify(rec, null, 2), "utf8");
    const list = this.list();
    const idx = list.findIndex((r) => r.id === rec.id);
    if (idx >= 0) list[idx] = rec;
    else list.unshift(rec);
    if (list.length > 50) list.length = 50;
    writeFileSync5(this.listFile, JSON.stringify(list, null, 2), "utf8");
  }
  list() {
    if (!existsSync10(this.listFile)) {
      if (!existsSync10(this.dir)) return [];
      const ids = readdirSync5(this.dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
      const recs = [];
      for (const id of ids) {
        const r = this.load(id);
        if (r) recs.push(r);
      }
      recs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return recs.slice(0, 50);
    }
    try {
      const raw = JSON.parse(readFileSync8(this.listFile, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  load(id) {
    const p = join11(this.dir, `${id}.json`);
    if (!existsSync10(p)) return void 0;
    try {
      return JSON.parse(readFileSync8(p, "utf8"));
    } catch {
      return void 0;
    }
  }
};

// src/git/git.ts
import { existsSync as existsSync11 } from "node:fs";
import { join as join12, resolve as resolve8 } from "node:path";
function normPath(p) {
  return resolve8(p);
}
function shq(arg) {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
function parsePorcelainStatus(stdout) {
  const items = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    if (x === " " && y === " ") continue;
    const path = line.slice(3);
    if (!path) continue;
    items.push({
      path,
      staged: x === "A" || x === "M" || x === "R" || x === "C",
      index: x,
      worktree: y
    });
  }
  return items;
}
function parseWorktreeList(stdout) {
  const entries = [];
  let path = "";
  let branch = "";
  const flush = () => {
    if (path) entries.push({ path, branch });
    path = "";
    branch = "";
  };
  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
  }
  flush();
  return entries;
}
var Git = class {
  term;
  logger;
  root;
  constructor(cwd, opts) {
    this.root = cwd;
    this.logger = opts?.logger;
    this.term = new Terminal({ cwd, logger: opts?.logger });
  }
  isRepo() {
    return existsSync11(join12(this.root, ".git"));
  }
  async init() {
    const r = await this.term.run("git init -q");
    return r.status === "ok";
  }
  async isWorkingClean() {
    const r = await this.term.run("git status --porcelain");
    return r.status === "ok" && r.stdout.trim() === "";
  }
  async currentBranch() {
    const r = await this.term.run("git rev-parse --abbrev-ref HEAD");
    if (r.status !== "ok") return "main";
    return r.stdout.trim() || "main";
  }
  async status() {
    const r = await this.term.run("git status --porcelain");
    if (r.status !== "ok") return [];
    return parsePorcelainStatus(r.stdout);
  }
  async diff() {
    const r = await this.term.run("git diff HEAD");
    return r.status === "ok" ? r.stdout : "";
  }
  async log(limit = 10) {
    const safeLimit = Math.max(1, Math.floor(limit));
    const r = await this.term.run(`git log --oneline -${safeLimit}`);
    return r.status === "ok" ? r.stdout : "";
  }
  async add(paths) {
    if (paths.length === 0) return true;
    const r = await this.term.run(`git add -- ${paths.map((p) => shq(p)).join(" ")}`);
    return r.status === "ok";
  }
  async commit(message) {
    const r = await this.term.run(`git commit -m ${shq(message)} --no-verify`);
    return r.status === "ok";
  }
  async createBranch(name) {
    const r = await this.term.run(`git checkout -b ${shq(name)}`);
    return r.status === "ok";
  }
  async hasWorktree(path) {
    const r = await this.term.run("git worktree list --porcelain");
    if (r.status !== "ok") return false;
    const target = normPath(path);
    return parseWorktreeList(r.stdout).some((w) => normPath(w.path) === target);
  }
  async addWorktree(path, branch) {
    const r = await this.term.run(`git worktree add ${shq(path)} -b ${shq(branch)}`);
    return r.status === "ok";
  }
};

// src/neutron/memory.ts
function deriveProjectMemory(analysis) {
  const out = [];
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
  const envVars = /* @__PURE__ */ new Set();
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

// src/neutron/workflow.ts
function defaultApprover(autoApprove) {
  return async () => autoApprove ? { approved: true, reason: "auto-approved (explicit --yes / autoApprove)", source: "-y" } : { approved: false, reason: "human approval required; no approver available in this context", source: "non-tty" };
}
function createNeutronWorkflow(opts) {
  const log = opts.log ?? (() => {
  });
  const root = opts.root;
  const store = opts.store ?? new NeutronStore(root);
  const approve = opts.invokeApproval ?? defaultApprover(opts.autoApprove);
  const git = new Git(root);
  const term = new Terminal({
    cwd: root,
    approve: async (req) => {
      const r = await approve({ title: "NEUTRON command approval", lines: [req.message, req.command ? `Command: ${req.command}` : ""].filter(Boolean) });
      return r.approved;
    }
  });
  return {
    root,
    store,
    log,
    async analyze() {
      log("Analyzing repository...");
      const analysis = analyzeRepository(root);
      store.update({ repository: packageName(root), analysis });
      return analysis;
    },
    async impact(req, analysis) {
      log("Computing impact...");
      const graph = analyzeImpact(analysis, req);
      store.update({ request: req.request, branch: req.branch, riskTolerance: req.riskTolerance, execution: req.execution, graph });
      return graph;
    },
    async plan(graph) {
      log("Building implementation plan...");
      const plan = buildPlan(graph);
      store.update({ plan });
      return plan;
    },
    async requestApproval(plan) {
      const lines = [
        "IMPLEMENTATION PLAN",
        "",
        `${plan.affectedFiles.length} files affected`,
        `${plan.affectedServices.length} services affected`,
        `${plan.databaseMigrations} database migration(s)`,
        `${plan.affectedTests.length} tests affected`,
        "",
        `Risk: ${plan.overallRisk.toUpperCase()}`
      ];
      const result = await approve({ title: "NEUTRON Implementation Plan Approval", lines, metadata: { kind: "plan-approval" } });
      return { ...result, title: "NEUTRON Implementation Plan Approval" };
    },
    async prepareCheckpoint() {
      if (!git.isRepo()) return void 0;
      const current = await git.currentBranch();
      if (current === "main") {
        const id = `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 5)}`;
        const branch = `neutron/maintenance/${id}`;
        const created = await git.createBranch(branch);
        if (!created) {
          log(`[checkpoint] warning: could not create branch ${branch}`);
          return void 0;
        }
        const checkpoint = { id, createdAt: (/* @__PURE__ */ new Date()).toISOString(), repository: packageName(root), branch, status: "created" };
        store.update({ checkpointId: id });
        return checkpoint;
      }
      return void 0;
    },
    async implement(graph, plan, recorder) {
      log(`Implementing ${plan.tasks.length} tasks (parallel where possible)...`);
      recorder.audit("NEUTRON", "implementation started");
      try {
        const outcome = await implementPlan(
          {
            root,
            api: opts.api,
            autoApprove: opts.autoApprove,
            log: (m) => log(m),
            recorder
          },
          plan.tasks
        );
        recorder.stage("implementation", "done");
        return outcome;
      } catch (err) {
        recorder.stage("implementation", "failed");
        throw err;
      }
    },
    async runTests(graph, recorder) {
      const touched = graph.nodes.map((n) => n.path);
      const analysis = analyzeRepository(root);
      const result = await runSelectedTests({ root, touchedPaths: touched, analysis });
      recorder.setTestResult(result);
      return result;
    },
    async security(recorder) {
      const review = scanSecurity(root);
      recorder.setSecurity(review);
      return review;
    },
    async codeReview(recorder) {
      const analysis = analyzeRepository(root);
      const review = buildCodeReview(analysis);
      recorder.setCodeReview(review);
      return review;
    },
    async release(recorder, checks) {
      const analysis = analyzeRepository(root);
      const build = await validateBuild(root);
      const gate = evaluateRelease({
        repoAnalysis: analysis,
        implementationDone: checks?.implOk ?? true,
        buildOk: build.ok,
        buildDetail: build.reason === "missing-node-modules" ? "blocked: node_modules not found" : build.reason === "build-failed" ? `failed: ${build.command ?? "build"}` : build.command ? `passed: ${build.command}` : "no build configured",
        tests: checks?.tests,
        security: checks?.securityBlocked !== void 0 ? { blocked: checks.securityBlocked } : void 0,
        codeReview: checks?.reviewPassed !== void 0 ? { passed: checks.reviewPassed, score: checks.reviewPassed ? 100 : 50 } : void 0
      });
      recorder.setRelease(gate);
      return gate;
    },
    memory() {
      const analysis = analyzeRepository(root);
      return deriveProjectMemory(analysis).map((e) => `${e.category}: ${e.title} -> ${e.value}`).join("\n");
    }
  };
}
function packageName(root) {
  const pkg = `${root.replace(/[\\/]+$/, "/")}package.json`;
  if (existsSync12(pkg)) {
    try {
      const data = JSON.parse(readFileSync9(pkg, "utf8"));
      return data.name ?? basename3(root);
    } catch {
    }
  }
  return basename3(root) ?? "repository";
}

// src/neutron/demo.ts
import { mkdirSync as mkdirSync6, writeFileSync as writeFileSync6 } from "node:fs";
import { dirname as dirname3, join as join13 } from "node:path";
var GENERATED_NOTE = "# Generated by NEUTRON demo (scaffold)";
var TASKFLOW = {
  "package.json": JSON.stringify(
    {
      name: "taskflow",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { dev: "node server.js", start: "node server.js", test: "vitest run", build: "node server.js --check" },
      dependencies: {
        express: "^4.19.2",
        "express-session": "^1.18.0",
        bcryptjs: "^2.4.3",
        jsonwebtoken: "^9.0.2",
        "dotenv": "^16.4.1",
        "passport": "^0.7.0",
        "passport-google-oauth20": "^2.0.0"
      },
      devDependencies: { vitest: "^2.1.0" }
    },
    null,
    2
  ),
  "README.md": [
    "# TaskFlow",
    "",
    "A task management app with email/password login, user profiles and a REST API.",
    "",
    "Stack: React, Node.js, Express, PostgreSQL."
  ].join("\n"),
  ".env.example": [
    "SESSION_SECRET=change-me",
    "DATABASE_URL=postgres://user:pass@localhost:5432/taskflow",
    "JWT_SECRET=change-me",
    "GOOGLE_CLIENT_ID=",
    "GOOGLE_CLIENT_SECRET="
  ].join("\n"),
  "server.js": `const express = require("express");
const session = require("express-session");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

const authRoutes = require("./src/routes/auth");
app.use("/api/auth", authRoutes);

const userRoutes = require("./src/routes/users");
app.use("/api/users", userRoutes);

const taskRoutes = require("./src/routes/tasks");
app.use("/api/tasks", taskRoutes);

module.exports = app;
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`TaskFlow listening on :\${PORT}\`));
`,
  "src/config/index.js": `const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

module.exports = {
  sessionSecret: process.env.SESSION_SECRET || "dev-secret",
  jwtSecret: process.env.JWT_SECRET || "dev-jwt",
  databaseUrl: process.env.DATABASE_URL || "postgres://localhost:5432/taskflow",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/api/auth/google/callback",
  },
};
`,
  "src/middleware/auth.js": `const { verifyToken } = require("../services/token");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid session" });
  }
}

module.exports = { requireAuth };
`,
  "src/services/token.js": `const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config");

function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: "7d" });
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

module.exports = { issueToken, verifyToken };
`,
  "src/services/password.js": `const bcrypt = require("bcryptjs");

async function hash(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

async function verify(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}

module.exports = { hash, verify };
`,
  "src/services/users.js": `const users = require("../db/users");

async function createUser({ email, password }) {
  const existing = await users.findByEmail(email);
  if (existing) throw new Error("EMAIL_TAKEN");
  return users.insert({ email, password });
}

async function findById(id) {
  return users.findById(id);
}

module.exports = { createUser, findById };
`,
  "src/routes/auth.js": `const express = require("express");
const router = express.Router();
const passport = require("passport");
const { issueToken } = require("../services/token");
const { verify } = require("../services/password");
const users = require("../db/users");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await users.findByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await verify(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    res.json({ token: issueToken(user), user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const hashService = require("../services/password");
    const passwordHash = await hashService.hash(password);
    const user = await users.insert({ email, passwordHash });
    res.status(201).json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    const token = issueToken(req.user);
    res.json({ token, user: { id: req.user.id, email: req.user.email } });
  }
);

module.exports = router;
`,
  "src/routes/users.js": `const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { findById } = require("../services/users");

router.get("/me", requireAuth, async (req, res) => {
  const user = await findById(req.user.id);
  res.json({ user });
});

router.put("/me", requireAuth, async (req, res) => {
  const user = await findById(req.user.id);
  res.json({ user: { ...user, ...req.body } });
});

module.exports = router;
`,
  "src/routes/tasks.js": `const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const tasks = require("../db/tasks");

router.get("/", requireAuth, async (req, res) => {
  const items = await tasks.listByUser(req.user.id);
  res.json({ tasks: items });
});

router.post("/", requireAuth, async (req, res) => {
  const task = await tasks.insert({ ownerId: req.user.id, title: req.body.title });
  res.status(201).json({ task });
});

module.exports = router;
`,
  "src/db/index.js": `const { databaseUrl } = require("../config");

// In-memory + environment-driven store for the demo. Production would use PostgreSQL.
const MAP = new Map();

function init() {
  void databaseUrl;
}

module.exports = { MAP, init };
`,
  "src/db/users.js": `const { MAP } = require("./index");

const users = [];

async function findByEmail(email) {
  return users.find((u) => u.email === email) || null;
}

async function findById(id) {
  return users.find((u) => u.id === id) || null;
}

async function insert({ email, passwordHash }) {
  const user = { id: users.length + 1, email, passwordHash, createdAt: new Date().toISOString() };
  users.push(user);
  return user;
}

module.exports = { findByEmail, findById, insert };
`,
  "src/db/tasks.js": `const tasks = [];

async function listByUser(ownerId) {
  return tasks.filter((t) => t.ownerId === ownerId);
}

async function insert({ ownerId, title }) {
  const task = { id: tasks.length + 1, ownerId, title, done: false, createdAt: new Date().toISOString() };
  tasks.push(task);
  return task;
}

module.exports = { listByUser, insert };
`,
  "src/frontend/pages/Login.jsx": `import React, { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      window.location.href = "/dashboard";
    }
  }

  return (
    <div>
      <h1>Login</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      <button onClick={submit}>Sign in</button>
      <a href="/api/auth/google">Continue with Google</a>
    </div>
  );
}
`,
  "src/frontend/pages/Dashboard.jsx": `import React, { useEffect, useState } from "react";

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks));
  }, []);
  return (
    <div>
      <h1>Dashboard</h1>
      <ul>{tasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
    </div>
  );
}
`,
  "src/frontend/pages/Profile.jsx": `import React, { useEffect, useState } from "react";

export default function Profile() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user));
  }, []);
  return <div><h1>Profile</h1>{user && <p>{user.email}</p>}</div>;
}
`,
  "src/frontend/services/api.js": `export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}
`,
  "tests/auth.test.js": `const { describe, it, expect } = require("vitest");
const request = require("supertest");
const app = require("../server");
const users = require("../src/db/users");

describe("auth", () => {
  it("registers a user", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "a@b.c", password: "secret123" });
    expect(res.statusCode).toBe(201);
  });
  it("logs in with valid credentials", async () => {
    await request(app).post("/api/auth/register").send({ email: "a@b.c", password: "secret123" });
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.c", password: "secret123" });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
  it("rejects invalid credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.c", password: "wrong" });
    expect(res.statusCode).toBe(401);
  });
});
`,
  "tests/tasks.test.js": `const { describe, it, expect } = require("vitest");
const request = require("supertest");
const app = require("../server");
const { issueToken } = require("../src/services/token");

describe("tasks", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.statusCode).toBe(401);
  });
  it("lists and creates tasks with a token", async () => {
    const token = issueToken({ id: 1, email: "a@b.c" });
    const create = await request(app).post("/api/tasks").set("authorization", \`Bearer \${token}\`).send({ title: "Do it" });
    expect(create.statusCode).toBe(201);
    const list = await request(app).get("/api/tasks").set("authorization", \`Bearer \${token}\`);
    expect(list.statusCode).toBe(200);
  });
});
`,
  "tests/security.test.js": `const { describe, it, expect } = require("vitest");

describe("security posture", () => {
  it("uses safe password hashing", async () => {
    const pw = require("../src/services/password");
    const hash = await pw.hash("secret123");
    expect(hash).not.toContain("secret123");
    expect(await pw.verify("secret123", hash)).toBe(true);
  });
});
`
};
function scaffoldDemoProject(root, project = "taskflow") {
  const files = TASKFLOW;
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const target = join13(root, rel);
    mkdirSync6(dirname3(target), { recursive: true });
    writeFileSync6(target, content, "utf8");
    written.push(rel);
  }
  const note = join13(root, "NEUTRON_DEMO.md");
  writeFileSync6(note, `${GENERATED_NOTE}
Demo project: TaskFlow
`, "utf8");
  written.push("NEUTRON_DEMO.md");
  return { files: written };
}
var DEMO_REQUESTS = {
  taskflow: "Add Google OAuth while preserving the existing email/password login."
};
var DEMO_DESCRIPTIONS = {
  taskflow: "TaskFlow \u2014 a task management app with email/login, user profiles, a REST API and tests. Add Google OAuth."
};

// src/server/byok.ts
function providerFromRequestKey(key, providerId) {
  const k = (key ?? "").trim();
  if (k.length < 8 || /\s/.test(k)) return void 0;
  const wanted = (providerId ?? "").trim().toLowerCase();
  if (!wanted) return void 0;
  const entry = getCatalogEntry(wanted);
  if (!entry?.baseUrl) return void 0;
  return {
    id: entry.id,
    baseUrl: entry.baseUrl,
    apiKey: k,
    models: [],
    enabled: true
  };
}
function configForRequest(apiKey, providerId) {
  const provider = apiKey ? providerFromRequestKey(apiKey, providerId) : void 0;
  if (provider?.apiKey) {
    registerSecrets([provider.apiKey]);
    return loadConfig({ providers: [provider] });
  }
  return loadConfig();
}

// src/providers/provider.ts
function normalizeBaseUrl(baseUrl) {
  let url = baseUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  return url;
}

// src/providers/errors.ts
function base(ctx, kind, reason, retryable, suggestion) {
  const err = new Error(`${ctx.provider}: ${reason}`);
  err.kind = kind;
  err.retryable = retryable;
  err.reason = reason;
  err.suggestion = suggestion;
  err.provider = ctx.provider;
  err.endpoint = ctx.endpoint;
  err.model = ctx.model;
  return err;
}
function keySuggestion(ctx, fallback) {
  return ctx.keyEnv ? `check ${ctx.keyEnv}` : fallback;
}
function keyEnvVar(providerId) {
  const entry = getCatalogEntry(providerId);
  if (!entry) return `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const prefixes = envPrefixesFor(entry);
  return prefixes.length > 0 ? `${prefixes[0]}_API_KEY` : void 0;
}
function rootCause(err) {
  let current = err;
  let depth = 0;
  let last = { code: void 0, message: "", name: "" };
  while (current && depth < 6) {
    last = {
      code: typeof current.code === "string" ? current.code : last.code,
      message: typeof current.message === "string" ? current.message : last.message,
      name: typeof current.name === "string" ? current.name : last.name
    };
    const next = current.cause;
    if (!next || typeof next !== "object") break;
    current = next;
    depth++;
  }
  return last;
}
var TLS_CODES = /* @__PURE__ */ new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_ALTNAME_FORMAT_INVALID"
]);
function classifyNetworkError(err, ctx) {
  const { code, message, name } = rootCause(err);
  const msg = `${name}: ${message}`.toLowerCase();
  const timeout = name === "TimeoutError" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || msg.includes("aborted due to timeout") || msg.includes("timeout");
  if (timeout) {
    return base(
      ctx,
      "timeout",
      "request timed out",
      true,
      "the provider may be slow or unreachable; try again, or run `neutron doctor`"
    );
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || msg.includes("getaddrinfo")) {
    const host = safeHost(ctx.endpoint);
    return base(
      ctx,
      "dns",
      `could not resolve host${host ? ` "${host}"` : ""} (DNS failure)`,
      true,
      "check the base URL and your network/DNS settings"
    );
  }
  if (code === "ECONNREFUSED") {
    return base(
      ctx,
      "connection-refused",
      "connection refused \u2014 nothing is listening at that address",
      false,
      "check the base URL (host/port); for local providers make sure the server is running"
    );
  }
  if (code === "ECONNRESET" || code === "EPIPE" || msg.includes("socket hang up") || msg.includes("other side closed")) {
    return base(
      ctx,
      "connection-reset",
      "connection reset by the server",
      true,
      "transient network issue; try again"
    );
  }
  if (code && TLS_CODES.has(code) || msg.includes("certificate") || msg.includes("ssl")) {
    return base(
      ctx,
      "tls",
      `TLS/SSL failure (${code ?? "certificate error"})`,
      false,
      "check for a proxy/MITM, VPN, or an expired certificate; do not disable TLS verification"
    );
  }
  if (!ctx.endpoint) {
    return base(ctx, "config", "provider has no base URL configured", false, "run `neutron config` or set <PROVIDER>_BASE_URL");
  }
  return base(
    ctx,
    "network",
    `network error${code ? ` (${code})` : ""}${message ? `: ${truncate(message, 120)}` : ""}`,
    true,
    "check your network connection, then run `neutron doctor`"
  );
}
function classifyHttpError(status, detail, ctx) {
  const err = classifyHttp(status, detail, ctx);
  err.status = status;
  return err;
}
function classifyHttp(status, detail, ctx) {
  const clean = truncate(detail, 200);
  const withDetail = clean ? `: ${clean}` : "";
  switch (status) {
    case 400:
      return base(
        ctx,
        "http",
        `invalid request (HTTP 400)${withDetail}`,
        false,
        "check the model id and request parameters"
      );
    case 401:
      return base(
        ctx,
        "http",
        `authentication failed (HTTP 401)${withDetail}`,
        false,
        keySuggestion(ctx, "check the provider API key")
      );
    case 403:
      return base(
        ctx,
        "http",
        `forbidden (HTTP 403)${withDetail}`,
        false,
        "the key may lack access to this model or endpoint"
      );
    case 404:
      return base(
        ctx,
        "http",
        `not found (HTTP 404)${withDetail}`,
        false,
        "check the base URL (a wrong /v1 prefix is a common cause) and the model id"
      );
    case 408:
      return base(ctx, "http", "request timeout (HTTP 408)", true, "try again");
    case 429:
      return base(
        ctx,
        "http",
        `rate limited (HTTP 429)${withDetail}`,
        true,
        "slow down or wait before retrying"
      );
    default:
      if (status >= 500) {
        return base(
          ctx,
          "http",
          `provider server error (HTTP ${status})${withDetail}`,
          true,
          "the provider is having issues; try again later"
        );
      }
      return base(
        ctx,
        "http",
        `request failed (HTTP ${status})${withDetail}`,
        false,
        "run `neutron doctor` for details"
      );
  }
}
function classifyInvalidJson(ctx, snippet) {
  return base(
    ctx,
    "invalid-json",
    `provider returned invalid JSON${snippet ? `: ${truncate(snippet, 120)}` : ""}`,
    false,
    "the endpoint may not be an LLM API; check the base URL"
  );
}
function isClassified(err) {
  return !!err && typeof err === "object" && typeof err.kind === "string" && typeof err.retryable === "boolean";
}
function isRetryable(err) {
  if (isClassified(err)) return err.retryable;
  const e = err;
  if (typeof e?.retryable === "boolean") return e.retryable;
  if (typeof e?.status === "number") return e.status === 408 || e.status === 429 || e.status >= 500;
  return true;
}
function summarizeError(err) {
  if (isClassified(err)) {
    return err.suggestion ? `${err.reason} \u2014 ${err.suggestion}` : err.reason;
  }
  const e = err;
  if (typeof e?.status === "number") return `HTTP ${e.status} \u2014 ${truncate(err instanceof Error ? err.message : String(err), 160)}`;
  return truncate(err instanceof Error ? err.message : String(err), 160);
}
function formatFailoverError(failures) {
  const lines = ["All LLM providers failed after retries and failover.", "", "Provider failures:"];
  for (const f of failures) {
    lines.push(`- ${f.id}: ${summarizeError(f.error)}`);
  }
  lines.push("", "Suggestion: run `neutron doctor` to diagnose each provider.");
  const err = new Error(lines.join("\n"));
  err.failures = failures;
  return err;
}
function safeHost(endpoint) {
  if (!endpoint) return "";
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}
function truncate(s, n) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}\u2026` : t;
}

// src/providers/openai.ts
async function requestJson(ctx, url, init, endpointLabel) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err, ctx) };
  }
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = "";
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message ?? (typeof parsed.message === "string" ? parsed.message : "");
    } catch {
      detail = body.slice(0, 200);
    }
    const classified = classifyHttpError(res.status, detail, ctx);
    classified.status = res.status;
    classified.cooldown = res.status === 429;
    classified.detail = body.slice(0, 1e3);
    void endpointLabel;
    return { ok: false, error: classified };
  }
  if (!body) return { ok: false, error: classifyInvalidJson(ctx, "") };
  try {
    return { ok: true, data: JSON.parse(body) };
  } catch {
    return { ok: false, error: classifyInvalidJson(ctx, body.slice(0, 200)) };
  }
}
var OpenAICompatibleProvider = class {
  name;
  baseUrl;
  apiKey;
  timeoutMs;
  cachedModels;
  lastModelsFetch = 0;
  constructor(opts) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 12e4;
  }
  ctx(model) {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...model ? { model } : {},
      keyEnv: keyEnvVar(this.name)
    };
  }
  async models() {
    if (this.cachedModels && Date.now() - this.lastModelsFetch < 5 * 6e4) {
      return this.cachedModels;
    }
    const result = await requestJson(
      this.ctx(),
      `${this.baseUrl}/models`,
      {
        headers: this.headers(),
        signal: AbortSignal.timeout(1e4)
      },
      "/models"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    this.cachedModels = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      contextWindow: 32768,
      free: false
    }));
    this.lastModelsFetch = Date.now();
    return this.cachedModels;
  }
  async chat(request) {
    const started = Date.now();
    const result = await requestJson(
      this.ctx(request.model),
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers()
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/chat/completions"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - started
    };
  }
  async *stream(request) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers()
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop,
          stream: true
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      throw classifyNetworkError(err, this.ctx(request.model));
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(body);
        detail = parsed.error?.message ?? "";
      } catch {
        detail = body.slice(0, 200);
      }
      const classified = classifyHttpError(res.status, detail, this.ctx(request.model));
      classified.status = res.status;
      classified.cooldown = res.status === 429;
      throw classified;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunkRaw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = chunkRaw.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            yield { delta: "", done: true };
            return;
          }
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) yield { delta, done: false };
          } catch {
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  async healthCheck() {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(1e4)
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }
};

// src/providers/adapters.ts
function joinUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}
async function requestJson2(ctx, url, init, endpointLabel) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err, ctx) };
  }
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = "";
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message ?? (typeof parsed.message === "string" ? parsed.message : "");
    } catch {
      detail = body.slice(0, 200);
    }
    const classified = classifyHttpError(res.status, detail, ctx);
    classified.status = res.status;
    classified.cooldown = res.status === 429;
    classified.detail = body.slice(0, 1e3);
    void endpointLabel;
    return { ok: false, error: classified };
  }
  if (!body) return { ok: false, error: classifyInvalidJson(ctx, "") };
  try {
    return { ok: true, data: JSON.parse(body) };
  } catch {
    return { ok: false, error: classifyInvalidJson(ctx, body.slice(0, 200)) };
  }
}
async function* sseEvents(res) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of raw.split("\n")) {
          if (line.startsWith("data:")) yield line.slice(5).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
async function openStream(ctx, url, init, endpointLabel) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err, ctx) };
  }
  if (res.ok && res.body) return { ok: true, res };
  const body = await res.text().catch(() => "");
  let detail = "";
  try {
    const parsed = JSON.parse(body);
    detail = parsed.error?.message ?? "";
  } catch {
    detail = body.slice(0, 200);
  }
  const classified = classifyHttpError(res.status, detail, ctx);
  classified.status = res.status;
  classified.cooldown = res.status === 429;
  void endpointLabel;
  return { ok: false, error: classified };
}
var AnthropicProvider = class _AnthropicProvider {
  name;
  baseUrl;
  apiKey;
  timeoutMs;
  constructor(opts) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 12e4;
  }
  headers() {
    const h = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01"
    };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }
  ctx(model) {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...model ? { model } : {},
      keyEnv: keyEnvVar(this.name)
    };
  }
  static splitMessages(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    return { ...system ? { system } : {}, messages: rest };
  }
  async models() {
    const result = await requestJson2(
      this.ctx(),
      joinUrl(this.baseUrl, "v1/models"),
      { headers: this.headers(), signal: AbortSignal.timeout(15e3) },
      "/v1/models"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    return (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id, contextWindow: 0, free: false }));
  }
  async chat(request) {
    const started = Date.now();
    const { system, messages } = _AnthropicProvider.splitMessages(request.messages);
    const result = await requestJson2(
      this.ctx(request.model),
      joinUrl(this.baseUrl, "v1/messages"),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          ...system ? { system } : {},
          messages
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/v1/messages"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      latencyMs: Date.now() - started
    };
  }
  async *stream(request) {
    const { system, messages } = _AnthropicProvider.splitMessages(request.messages);
    const opened = await openStream(
      this.ctx(request.model),
      joinUrl(this.baseUrl, "v1/messages"),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          stream: true,
          ...system ? { system } : {},
          messages
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/v1/messages"
    );
    if (!opened.ok) throw opened.error;
    for await (const payload of sseEvents(opened.res)) {
      if (payload === "[DONE]") {
        yield { delta: "", done: true };
        return;
      }
      try {
        const json = JSON.parse(payload);
        if (json.type === "content_block_delta" && json.delta?.text) {
          yield { delta: json.delta.text, done: false };
        } else if (json.type === "message_stop") {
          yield { delta: "", done: true };
          return;
        }
      } catch {
      }
    }
    yield { delta: "", done: true };
  }
  async healthCheck() {
    const started = Date.now();
    try {
      const res = await fetch(joinUrl(this.baseUrl, "v1/models"), {
        headers: this.headers(),
        signal: AbortSignal.timeout(1e4)
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
};
var GoogleProvider = class _GoogleProvider {
  name;
  baseUrl;
  apiKey;
  timeoutMs;
  constructor(opts) {
    this.name = opts.id;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 12e4;
  }
  keyParam(sep4) {
    return this.apiKey ? `${sep4}key=${encodeURIComponent(this.apiKey)}` : "";
  }
  ctx(model) {
    return {
      provider: this.name,
      endpoint: this.baseUrl,
      ...model ? { model } : {},
      keyEnv: keyEnvVar(this.name)
    };
  }
  static splitMessages(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    return { ...system ? { system } : {}, contents };
  }
  async models() {
    const result = await requestJson2(
      this.ctx(),
      `${this.baseUrl}/models?pageSize=1000${this.keyParam("&")}`,
      { headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15e3) },
      "/models"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    return (data.models ?? []).map((m) => ({
      id: m.name.replace(/^models\//, ""),
      name: m.displayName ?? m.name.replace(/^models\//, ""),
      contextWindow: 0,
      free: false
    }));
  }
  async chat(request) {
    const started = Date.now();
    const { system, contents } = _GoogleProvider.splitMessages(request.messages);
    const result = await requestJson2(
      this.ctx(request.model),
      `${this.baseUrl}/models/${request.model}:generateContent${this.keyParam("?")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...system ? { systemInstruction: { parts: [{ text: system }] } } : {},
          generationConfig: {
            ...request.temperature !== void 0 ? { temperature: request.temperature } : {},
            ...request.maxTokens !== void 0 ? { maxOutputTokens: request.maxTokens } : {}
          }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/generateContent"
    );
    if (!result.ok) throw result.error;
    const data = result.data;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return {
      text,
      provider: this.name,
      model: request.model ?? "unknown",
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - started
    };
  }
  async *stream(request) {
    const { system, contents } = _GoogleProvider.splitMessages(request.messages);
    const opened = await openStream(
      this.ctx(request.model),
      `${this.baseUrl}/models/${request.model}:streamGenerateContent?alt=sse${this.keyParam("&")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...system ? { systemInstruction: { parts: [{ text: system }] } } : {},
          generationConfig: {
            ...request.temperature !== void 0 ? { temperature: request.temperature } : {},
            ...request.maxTokens !== void 0 ? { maxOutputTokens: request.maxTokens } : {}
          }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      },
      "/streamGenerateContent"
    );
    if (!opened.ok) throw opened.error;
    for await (const payload of sseEvents(opened.res)) {
      try {
        const json = JSON.parse(payload);
        const delta = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (delta) yield { delta, done: false };
      } catch {
      }
    }
    yield { delta: "", done: true };
  }
  async healthCheck() {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models?pageSize=1${this.keyParam("&")}`, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(1e4)
      });
      return { ok: res.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
};

// src/providers/registry.ts
function resolveApiType(p) {
  if (p.apiType) return p.apiType;
  const entry = findCatalogEntry(p.id);
  if (entry) return entry.apiType;
  const url = p.baseUrl.toLowerCase();
  if (url.includes("api.anthropic.com")) return "anthropic";
  if (url.includes("generativelanguage.googleapis.com")) return "google";
  return "openai-compatible";
}
function createRegistryProvider(p, opts) {
  const apiOpts = {
    id: p.id,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    // Honors config.api.timeoutMs; the default matches the old hardcoded value.
    timeoutMs: opts?.timeoutMs ?? 12e4
  };
  switch (resolveApiType(p).toLowerCase()) {
    case "anthropic":
      return new AnthropicProvider(apiOpts);
    case "google":
      return new GoogleProvider(apiOpts);
    default:
      return new OpenAICompatibleProvider(apiOpts);
  }
}
var ProviderRegistry = class {
  providers = /* @__PURE__ */ new Map();
  configuredModels = /* @__PURE__ */ new Map();
  health = /* @__PURE__ */ new Map();
  rrIndex = 0;
  defaultTimeoutMs = 12e4;
  configure(list, opts) {
    if (opts?.timeoutMs !== void 0) this.defaultTimeoutMs = opts.timeoutMs;
    this.providers.clear();
    this.configuredModels.clear();
    for (const p of list) {
      if (!p.enabled) continue;
      this.providers.set(p.id, createRegistryProvider(p, { timeoutMs: this.defaultTimeoutMs }));
      this.configuredModels.set(p.id, [...p.models]);
    }
  }
  add(id, provider, models = []) {
    this.providers.set(id, provider);
    this.configuredModels.set(id, [...models]);
  }
  modelsFor(id) {
    return this.configuredModels.get(id) ?? [];
  }
  get(id) {
    return this.providers.get(id);
  }
  all() {
    return [...this.providers.values()];
  }
  ids() {
    return [...this.providers.keys()];
  }
  has(id) {
    return this.providers.has(id);
  }
  async healthCheck(id) {
    const provider = this.providers.get(id);
    if (!provider) return { ok: false, latencyMs: 0 };
    const result = await provider.healthCheck();
    this.health.set(id, { ...result, checkedAt: Date.now() });
    return result;
  }
  isHealthy(id) {
    const h = this.health.get(id);
    if (!h) return true;
    if (Date.now() - h.checkedAt > 6e4) return true;
    return h.ok;
  }
  nextHealthy() {
    const ids = this.ids();
    if (ids.length === 0) return void 0;
    for (let i = 0; i < ids.length; i++) {
      const idx = (this.rrIndex + i) % ids.length;
      const id = ids[idx];
      if (this.isHealthy(id)) {
        this.rrIndex = (idx + 1) % ids.length;
        return this.providers.get(id);
      }
    }
    return this.providers.get(ids[0]);
  }
};

// src/api/pool.ts
var ConcurrencyLimit = class {
  max;
  active = 0;
  queue = [];
  constructor(max) {
    this.max = Math.max(1, max);
  }
  get running() {
    return this.active;
  }
  get queued() {
    return this.queue.length;
  }
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  acquire() {
    return new Promise((resolve10) => {
      if (this.active < this.max) {
        this.active++;
        resolve10();
      } else {
        this.queue.push(resolve10);
      }
    });
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
  width(newMax) {
    const clamped = Math.max(1, newMax);
    const delta = clamped - this.max;
    this.max = clamped;
    if (delta > 0) {
      const wake = Math.min(delta, this.queue.length);
      for (let i = 0; i < wake; i++) {
        this.active++;
        this.queue.shift()();
      }
    }
  }
};

// src/api/api-manager.ts
var ApiSystem = class {
  config;
  routing;
  registry;
  pool;
  cooldowns = /* @__PURE__ */ new Map();
  usageMap = /* @__PURE__ */ new Map();
  discoveredModels = /* @__PURE__ */ new Map();
  requestsCompleted = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  totalLatencyMs = 0;
  totalFailures = 0;
  totalFailovers = 0;
  logger;
  stopFlag = false;
  constructor(opts) {
    const cfg = opts.config;
    this.config = cfg.api;
    this.routing = cfg.routing;
    this.pool = new ConcurrencyLimit(this.config.maxConcurrentRequests);
    this.registry = opts.registry ?? new ProviderRegistry();
    this.registry.configure(cfg.providers, { timeoutMs: this.config.timeoutMs });
    this.logger = opts.logger;
  }
  configure(providers) {
    this.registry.configure(providers);
  }
  log(msg) {
    this.logger?.info(msg);
  }
  clearCooldowns() {
    this.cooldowns.clear();
  }
  isCooldown(id) {
    const until = this.cooldowns.get(id);
    return until !== void 0 && until > Date.now();
  }
  setCooldown(id, ms) {
    this.cooldowns.set(id, Date.now() + ms);
  }
  availableProviderIds() {
    return this.registry.ids().filter((id) => !this.isCooldown(id));
  }
  get stats() {
    return {
      active: this.pool.running,
      queued: this.pool.queued,
      requests: this.requestsCompleted,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      failures: this.totalFailures,
      failovers: this.totalFailovers,
      latencyMs: this.totalLatencyMs,
      providers: this.usageMap
    };
  }
  async health() {
    const out = {};
    for (const id of this.registry.ids()) {
      out[id] = await this.registry.healthCheck(id);
    }
    return out;
  }
  async chat(kind, messages, opts) {
    if (this.stopFlag) {
      throw new Error("API system is stopped");
    }
    if (this.registry.ids().length === 0) {
      throw new Error(
        "No LLM provider configured. Run `neutron config` to set one, or set LLM_BASE_URL/LLM_API_KEY (or OPENAI_BASE_URL/OPENAI_API_KEY) environment variables."
      );
    }
    const req = {
      messages,
      model: opts?.model,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens
    };
    return this.pool.run(() => this.runWithFailover(kind, req, opts?.provider));
  }
  async *stream(kind, messages, opts) {
    if (this.stopFlag) throw new Error("API system is stopped");
    if (this.registry.ids().length === 0) {
      throw new Error("No LLM provider configured. Run `neutron config` to set one.");
    }
    const tried = /* @__PURE__ */ new Set();
    let current = this.pickNext(kind, opts?.model, tried, opts?.provider);
    const failures = [];
    while (current) {
      tried.add(current.id);
      let emitted = false;
      try {
        let model = current.model;
        if (!model) {
          model = await this.discoverModel(current.id, current.provider);
          if (!model) {
            throw new Error(`Provider ${current.id} has no models configured and discovery failed.`);
          }
        }
        for await (const chunk of current.provider.stream({
          messages,
          model,
          temperature: opts?.temperature,
          maxTokens: opts?.maxTokens
        })) {
          emitted = true;
          yield { delta: chunk.delta, done: chunk.done, provider: current.id, model };
        }
        this.requestsCompleted++;
        return;
      } catch (err) {
        this.totalFailures++;
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ id: current.id, error: err });
        this.log(`provider ${current.id} stream failed: ${message}`);
        if (emitted) throw err;
        this.totalFailovers++;
      }
      current = this.pickNext(kind, opts?.model, tried, void 0);
    }
    throw formatFailoverError(failures);
  }
  async runWithFailover(kind, req, forcedProvider) {
    const tried = /* @__PURE__ */ new Set();
    let current = this.pickNext(kind, req.model, tried, forcedProvider);
    const failures = [];
    while (current) {
      if (this.stopFlag) throw new Error("API system is stopped");
      tried.add(current.id);
      try {
        let model = current.model;
        if (!model) {
          model = await this.discoverModel(current.id, current.provider);
          if (!model) {
            throw new Error(
              `Provider ${current.id} has no models configured and model discovery failed. Add a model to your provider config or set routing.`
            );
          }
        }
        const res = await this.executeWithRetry(current.provider, current.id, { ...req, model });
        this.recordUsage(res, current.id);
        return res;
      } catch (err) {
        const e = err;
        if (e.cooldown) this.setCooldown(current.id, this.config.providerCooldownMs);
        this.totalFailures++;
        this.totalFailovers++;
        failures.push({ id: current.id, error: err });
        const message = err instanceof Error ? err.message : String(err);
        this.log(`provider ${current.id} failed: ${message}; failing over`);
      }
      current = this.pickNext(kind, req.model, tried, void 0);
    }
    throw formatFailoverError(failures);
  }
  preferFree(ids) {
    const free = ids.filter((id) => id.toLowerCase().includes("free"));
    return [...free, ...ids.filter((id) => !free.includes(id))];
  }
  async discoverModel(id, provider) {
    const configured = this.registry.modelsFor(id);
    if (configured.length > 0) return this.preferFree(configured)[0];
    const cached = this.discoveredModels.get(id);
    if (cached) return cached[0];
    const models = await provider.models();
    const ids = models.map((m) => m.id).filter(Boolean);
    if (ids.length > 0) {
      const ordered = this.preferFree(ids);
      this.discoveredModels.set(id, ordered);
      this.log(`provider ${id}: discovered ${ordered.length} models, using ${ordered[0]}`);
      return ordered[0];
    }
    return void 0;
  }
  pickNext(kind, modelHint, tried, forced) {
    if (forced && !tried.has(forced) && this.registry.has(forced) && !this.isCooldown(forced)) {
      return { id: forced, provider: this.registry.get(forced), model: this.resolveModel(forced, modelHint ?? this.routing[kind]) };
    }
    const pool = this.availableProviderIds().filter((id2) => !tried.has(id2));
    if (pool.length === 0) return void 0;
    const preferredModel = modelHint ?? this.routing[kind];
    if (preferredModel) {
      for (const id2 of pool) {
        if (this.registry.modelsFor(id2).includes(preferredModel)) {
          return { id: id2, provider: this.registry.get(id2), model: preferredModel };
        }
      }
    }
    for (const id2 of pool) {
      if (id2 === "free-llm" || id2 === "openai") {
        return { id: id2, provider: this.registry.get(id2), model: this.resolveModel(id2, preferredModel) };
      }
    }
    const id = pool[0];
    return { id, provider: this.registry.get(id), model: this.resolveModel(id, preferredModel) };
  }
  resolveModel(providerId, hint) {
    if (hint) return hint;
    const models = this.registry.modelsFor(providerId);
    if (models.length > 0) return this.preferFree(models)[0];
    return void 0;
  }
  async executeWithRetry(provider, id, req) {
    const started = Date.now();
    let lastErr;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (this.stopFlag) throw new Error("API system is stopped");
      try {
        const res = await provider.chat(req);
        res.latencyMs = Date.now() - started;
        return res;
      } catch (err) {
        lastErr = err;
        const e = err;
        if (e.cooldown) this.setCooldown(id, this.config.providerCooldownMs);
        if (!isRetryable(err)) break;
        if (attempt < this.config.maxRetries) {
          const wait = Math.min(this.config.backoffBaseMs * 2 ** attempt, 3e4) + (this.config.requestCooldownMs ?? 0);
          this.log(`retrying ${id} attempt ${attempt + 2} in ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`Provider ${id} failed`);
  }
  recordUsage(res, providerId) {
    this.requestsCompleted++;
    this.totalInputTokens += res.inputTokens ?? 0;
    this.totalOutputTokens += res.outputTokens ?? 0;
    this.totalLatencyMs += res.latencyMs ?? 0;
    let stat = this.usageMap.get(providerId);
    if (!stat) {
      stat = { totalRequests: 0, failures: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, failoverCount: 0, cooldownUntil: void 0 };
      this.usageMap.set(providerId, stat);
    }
    stat.totalRequests++;
    stat.inputTokens += res.inputTokens ?? 0;
    stat.outputTokens += res.outputTokens ?? 0;
    stat.latencyMs += res.latencyMs ?? 0;
  }
  stop() {
    this.stopFlag = true;
  }
};

// src/server/demo.ts
var DEMO_PROJECT = "taskflow";
function resolveDemoWorkspace(explicit) {
  const fromEnv = process.env.NEUTRON_DEMO_WORKSPACE?.trim();
  const dir = explicit?.trim() || fromEnv || join14(process.cwd(), "neutron-demo-workspace");
  const abs = resolve9(dir);
  mkdirSync7(abs, { recursive: true });
  return abs;
}
var REPO_INPUT_RE = /^[A-Za-z0-9][A-Za-z0-9_.\-\\/]{0,119}$/;
function resolveRepoDir(workspace, input) {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "demo") {
    return { dir: join14(workspace, DEMO_PROJECT), name: DEMO_PROJECT, isDemo: true };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    throw new DemoError(
      "Repository URL cloning is disabled on this demo deployment. Use the demo repository or a path inside the demo workspace.",
      400
    );
  }
  if (!REPO_INPUT_RE.test(trimmed)) {
    throw new DemoError('Invalid repository reference. Use "demo" or a workspace-relative path.', 400);
  }
  const abs = normalize(resolve9(workspace, trimmed));
  if (abs !== workspace && !abs.startsWith(workspace + sep3)) {
    throw new DemoError("Repository path escapes the demo workspace.", 400);
  }
  if (!existsSync13(abs) || !statSync5(abs).isDirectory()) {
    throw new DemoError(`Repository not found in the demo workspace: ${trimmed}`, 404);
  }
  return { dir: abs, name: relative6(workspace, abs) || trimmed, isDemo: false };
}
var DemoError = class extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var GITHUB_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/;
function cloneAllowed() {
  return process.env.NEUTRON_DEMO_ALLOW_CLONE === "1";
}
function cloneRepo(workspace, url) {
  return new Promise((resolvePromise, reject) => {
    if (!cloneAllowed()) {
      reject(new DemoError("Repository URL cloning is disabled on this demo deployment.", 400));
      return;
    }
    const m = GITHUB_URL_RE.exec(url.trim());
    if (!m) {
      reject(new DemoError("Only https://github.com/<owner>/<repo> URLs can be cloned.", 400));
      return;
    }
    const dest = join14(workspace, `${m[1]}-${m[2]}`.slice(0, 80));
    if (existsSync13(dest)) {
      reject(new DemoError("That repository is already cloned in the demo workspace.", 409));
      return;
    }
    execFile("git", ["clone", "--depth", "1", url.trim(), dest], { timeout: 9e4 }, (err) => {
      if (err) {
        reject(new DemoError(`Clone failed: ${shortErr(err)}`, 502));
        return;
      }
      resolvePromise({ dir: dest, name: `${m[1]}/${m[2]}`, isDemo: false });
    });
  });
}
function shortErr(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0].slice(0, 200);
}
var REPO_PKG_CAP = 50 * 1024;
function prepareDemoRepo(workspace) {
  const dir = join14(workspace, DEMO_PROJECT);
  const reused = existsSync13(join14(dir, "package.json"));
  const files = reused ? [] : scaffoldDemoProject(dir, DEMO_PROJECT).files;
  return {
    repository: "demo",
    name: DEMO_PROJECT,
    description: DEMO_DESCRIPTIONS[DEMO_PROJECT],
    defaultRequest: DEMO_REQUESTS[DEMO_PROJECT],
    reused,
    files: reused ? countFilesHint(dir) : files.length
  };
}
function countFilesHint(_dir) {
  return 23;
}
var STAGE_DEFS = [
  ["repository-analysis", "Repository Analysis"],
  ["impact-analysis", "Impact Analysis"],
  ["implementation-plan", "Implementation Plan"],
  ["human-approval", "Human Approval"],
  ["agent-execution", "Agent Execution"],
  ["testing", "Testing"],
  ["security", "Security"],
  ["code-review", "Code Review"],
  ["release-readiness", "Release Readiness"]
];
function freshStages() {
  return STAGE_DEFS.map(([key, label]) => ({ key, label, status: "pending" }));
}
var silentLogger = { debug: () => {
}, info: () => {
}, warn: () => {
}, error: () => {
} };
function buildApi(apiKey, providerId) {
  const config = configForRequest(apiKey, providerId);
  if (!config.providers.some((p) => p.enabled && p.baseUrl)) return {};
  registerSecrets(config.providers.map((p) => p.apiKey).filter((k) => !!k));
  return { api: new ApiSystem({ config, logger: silentLogger }) };
}
var idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
var DemoManager = class {
  workspace;
  analyses = /* @__PURE__ */ new Map();
  /** Single-use plan approvals: analysisId -> approval timestamp. In-memory only. */
  approvals = /* @__PURE__ */ new Map();
  jobs = /* @__PURE__ */ new Map();
  maxJobs;
  constructor(workspace, opts = {}) {
    this.workspace = workspace;
    this.maxJobs = Number(process.env.NEUTRON_DEMO_MAX_JOBS ?? opts.maxJobs ?? 2) || 2;
  }
  /* ---------------- analyze ---------------- */
  analyze(repoInput, request, riskTolerance) {
    if (!request || !request.trim()) throw new DemoError("A maintenance request is required.", 400);
    if (request.trim().length > 2e3) throw new DemoError("Maintenance request is too long (max 2000 chars).", 400);
    const repo = resolveRepoDir(this.workspace, repoInput);
    if (repo.isDemo) {
      prepareDemoRepo(this.workspace);
    }
    const analysis = analyzeRepository(repo.dir);
    const maintRequest = {
      request: request.trim(),
      repository: repo.name,
      branch: "main",
      riskTolerance,
      execution: "implement-and-test"
    };
    const graph = analyzeImpact(analysis, maintRequest);
    const plan = buildPlan(graph);
    const store = new NeutronStore(repo.dir);
    try {
      store.ensure();
      const prev = store.load();
      store.save({ ...prev, request: maintRequest.request, repository: repo.name, branch: "main", riskTolerance, execution: "implement-and-test", analysis, graph, plan });
    } catch {
    }
    const record = {
      id: nextId("analysis"),
      repoDir: repo.dir,
      repository: repo.name,
      isDemo: repo.isDemo,
      request: maintRequest.request,
      riskTolerance,
      analysis,
      graph,
      plan,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.analyses.set(record.id, record);
    for (const [aid, rec] of this.analyses) {
      if (aid !== record.id && rec.repoDir === repo.dir) this.approvals.delete(aid);
    }
    return record;
  }
  getAnalysis(id) {
    const rec = this.analyses.get(id);
    if (!rec) throw new DemoError("Analysis not found. Run the analysis step first.", 404);
    return rec;
  }
  /* ---------------- approve / reject ---------------- */
  approve(analysisId) {
    const rec = this.getAnalysis(analysisId);
    if (!rec.plan || rec.plan.tasks.length === 0) {
      throw new DemoError("No plan to approve for this analysis.", 409);
    }
    this.approvals.set(analysisId, (/* @__PURE__ */ new Date()).toISOString());
    return { approved: true, analysisId };
  }
  reject(analysisId) {
    this.getAnalysis(analysisId);
    this.approvals.delete(analysisId);
    return { rejected: true, analysisId };
  }
  /* ---------------- execute (background job) ---------------- */
  activeJobCount() {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === "queued" || j.status === "running" || j.status === "awaiting-approval") n += 1;
    }
    return n;
  }
  execute(analysisId, apiKey, providerId) {
    const rec = this.getAnalysis(analysisId);
    const approvalAt = this.approvals.get(analysisId);
    if (!approvalAt) {
      throw new DemoError("Plan approval required. Review the plan and approve it before execution.", 409);
    }
    this.approvals.delete(analysisId);
    if (this.activeJobCount() >= this.maxJobs) {
      throw new DemoError(`Too many demo jobs running (max ${this.maxJobs}). Try again shortly.`, 429);
    }
    const job = {
      id: nextId("job"),
      status: "queued",
      request: rec.request,
      repository: rec.repository,
      isDemo: rec.isDemo,
      stages: freshStages(),
      events: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.jobs.set(job.id, job);
    void this.runJob(job, rec, apiKey, providerId).catch((err) => {
      job.status = "failed";
      job.error = redact(err instanceof Error ? err.message : String(err));
      job.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      pushEvent(job, "job", `Job failed: ${job.error}`);
    });
    return job;
  }
  getJob(id) {
    const job = this.jobs.get(id);
    if (!job) throw new DemoError("Job not found.", 404);
    return job;
  }
  /* ---------------- job runner: the real NEUTRON stages ---------------- */
  async runJob(job, rec, apiKey, providerId) {
    const { api } = buildApi(apiKey, providerId);
    const noLlm = !api;
    job.noLlm = noLlm;
    job.status = "running";
    pushEvent(job, "job", `Starting NEUTRON workflow on "${rec.repository}"${noLlm ? " (no LLM provider configured \u2014 implementation will be honestly skipped)" : ""}.`);
    const recorder = new RunRecorder(rec.repoDir, {
      id: job.id,
      request: rec.request,
      repository: rec.repository,
      branch: "main"
    });
    const wf = createNeutronWorkflow({
      root: rec.repoDir,
      ...api ? { api } : {},
      autoApprove: false,
      log: (m) => pushEvent(job, "activity", m),
      // Only the already-granted plan approval passes here. Every other approval
      // (terminal commands, etc.) is denied: fail-closed in the web context.
      invokeApproval: async ({ metadata }) => metadata?.kind === "plan-approval" ? { approved: true, reason: "plan approved in the NEUTRON web demo", source: "interactive" } : { approved: false, reason: "interactive approval is not available in the web demo", source: "non-tty" }
    });
    const deviations = [];
    const errors = [];
    const setStage = (key, status, detail) => {
      const s = job.stages.find((x) => x.key === key);
      if (s) {
        s.status = status;
        if (detail !== void 0) s.detail = detail;
      }
      pushEvent(job, key, `${labelOf(key)}: ${status}${detail ? ` \u2014 ${detail}` : ""}`);
    };
    const step = async (key, fn) => {
      setStage(key, "running");
      try {
        await fn();
        setStage(key, "completed");
        recorder.stage(key, "done");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStage(key, "failed", message);
        recorder.stage(key, "failed");
        errors.push(`${key}: ${message}`);
      }
    };
    let analysis;
    let graph;
    let plan;
    let outcome;
    let testResult;
    let security;
    let codeReview;
    let release;
    await step("repository-analysis", async () => {
      analysis = await wf.analyze();
      recorder.setMetrics({ repoFilesAnalyzed: analysis.filesAnalyzed });
    });
    await step("impact-analysis", async () => {
      const req = { request: rec.request, repository: rec.repository, branch: "main", riskTolerance: rec.riskTolerance, execution: "implement-and-test" };
      graph = await wf.impact(req, analysis);
      recorder.setMetrics({ affectedFiles: graph.nodes.length });
    });
    await step("implementation-plan", async () => {
      plan = await wf.plan(graph);
    });
    setStage("human-approval", "running");
    const approval = await wf.requestApproval(plan);
    recorder.recordApproval({
      approved: approval.approved,
      title: approval.title ?? "NEUTRON Implementation Plan Approval",
      source: approval.source,
      reason: approval.reason
    });
    if (!approval.approved) {
      setStage("human-approval", "failed", "Plan was not approved \u2014 nothing was changed.");
      job.status = "denied";
      job.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      recorder.setStatus("plan-denied");
      try {
        recorder.save();
      } catch {
      }
      return;
    }
    setStage("human-approval", "completed", approval.reason ?? "approved");
    await step("agent-execution", async () => {
      outcome = await wf.implement(graph, plan, recorder);
      if (outcome.noLlm) {
        deviations.push("No LLM provider configured \u2014 implementation tasks were recorded as not-executed (nothing was fabricated).");
      } else if (outcome.failed > 0) {
        deviations.push(`Implementation: ${outcome.failed} task(s) failed.`);
      }
      recorder.setChanges(outcome.changes);
    });
    await step("testing", async () => {
      testResult = await wf.runTests(graph, recorder);
      if (testResult?.regression) deviations.push("Regression detected in tests.");
    });
    await step("security", async () => {
      security = await wf.security(recorder);
      if (security?.blocked) deviations.push("Security review blocked the change.");
    });
    await step("code-review", async () => {
      codeReview = await wf.codeReview(recorder);
      if (codeReview && !codeReview.passed) deviations.push(`Code review not clean (score ${codeReview.score}).`);
    });
    await step("release-readiness", async () => {
      const implOk = outcome !== void 0 && outcome.failed === 0 && outcome.blocked === 0;
      release = await wf.release(recorder, {
        implOk,
        tests: testResult?.after ? { failed: testResult.after.failed, passed: testResult.after.passed, total: testResult.after.total } : void 0,
        securityBlocked: security?.blocked,
        reviewPassed: codeReview?.passed
      });
    });
    const failedStages = job.stages.filter((s) => s.status === "failed");
    job.status = failedStages.length > 0 ? "failed" : "completed";
    job.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    job.result = sanitizeResult({
      analysis,
      graph,
      plan,
      outcome,
      testResult,
      security,
      codeReview,
      release,
      runId: job.id,
      deviations,
      errors,
      noLlm: noLlm || outcome?.noLlm === true
    });
    recorder.setStatus(job.status === "completed" ? "completed" : "failed");
    try {
      recorder.save();
    } catch {
    }
    pushEvent(job, "job", `Workflow ${job.status}.`);
  }
};
function labelOf(key) {
  return STAGE_DEFS.find(([k]) => k === key)?.[1] ?? key;
}
function pushEvent(job, stage, message) {
  job.events.push({ ts: (/* @__PURE__ */ new Date()).toISOString(), stage, message: message.slice(0, 2e3) });
  if (job.events.length > 500) job.events.splice(0, job.events.length - 500);
}
var MAX_NODES = 200;
var MAX_FINDINGS = 50;
function sanitizeResult(r) {
  const a = r.analysis;
  const g = r.graph;
  return {
    runId: r.runId ?? "",
    noLlm: r.noLlm,
    ...r.noLlm ? { llmNote: "No LLM provider is configured on this demo server, so the agent implementation step was honestly skipped \u2014 no code was fabricated. Repository analysis, impact analysis, planning, tests, security scan, code review and the release gate all ran for real." } : {},
    analysis: {
      filesAnalyzed: a.filesAnalyzed,
      nodeCount: a.nodeCount,
      languages: a.languages,
      frameworks: a.frameworks,
      packageManagers: a.packageManagers,
      entryPoints: a.entryPoints.slice(0, 20),
      health: a.health,
      warnings: a.warnings.slice(0, 20),
      analyzedAt: a.analyzedAt
    },
    impact: {
      files: g.summary.files,
      apis: g.summary.apis,
      database: g.summary.database,
      frontend: g.summary.frontend,
      backend: g.summary.backend,
      tests: g.summary.tests,
      whatCouldBreak: g.whatCouldBreak.slice(0, 30),
      lowRisk: g.lowRiskOnes.slice(0, 30),
      nodesTruncated: g.nodes.length > MAX_NODES,
      nodes: g.nodes.slice(0, MAX_NODES).map((n) => ({
        path: n.path,
        category: n.category,
        impact: n.impact,
        confidence: n.confidence,
        reasons: n.reasons.slice(0, 4),
        dependents: n.dependents.slice(0, 10)
      }))
    },
    plan: r.plan,
    ...r.outcome ? {
      execution: {
        completed: r.outcome.completed,
        failed: r.outcome.failed,
        blocked: r.outcome.blocked,
        noLlm: r.outcome.noLlm,
        changes: r.outcome.changes.slice(0, 100).map((c) => ({
          path: c.path,
          kind: c.kind,
          linesAdded: c.linesAdded,
          linesRemoved: c.linesRemoved,
          agent: c.agent,
          reason: c.reason,
          risk: c.risk
        }))
      }
    } : {},
    ...r.testResult ? {
      tests: {
        command: r.testResult.command,
        ...r.testResult.after ? { after: r.testResult.after } : {},
        regression: r.testResult.regression,
        failedTests: r.testResult.failedTests.slice(0, 20),
        stdoutTail: r.testResult.truncatedStdout.slice(-4e3)
      }
    } : {},
    ...r.security ? {
      security: {
        blocked: r.security.blocked,
        summary: r.security.summary,
        findingsTruncated: r.security.findings.length > MAX_FINDINGS,
        findings: r.security.findings.slice(0, MAX_FINDINGS).map((f) => ({
          severity: f.severity,
          title: f.title,
          ...f.file ? { file: f.file } : {},
          category: f.category
        }))
      }
    } : {},
    ...r.codeReview ? {
      codeReview: {
        score: r.codeReview.score,
        passed: r.codeReview.passed,
        summary: r.codeReview.summary,
        findingsTruncated: r.codeReview.findings.length > MAX_FINDINGS,
        findings: r.codeReview.findings.slice(0, MAX_FINDINGS).map((f) => ({
          severity: f.severity,
          title: f.title,
          ...f.file ? { file: f.file } : {}
        }))
      }
    } : {},
    ...r.release ? {
      release: {
        status: r.release.status,
        checks: r.release.checks,
        blockedBy: r.release.blockedBy
      }
    } : {},
    deviations: r.deviations,
    errors: r.errors
  };
}

// api-src/_lib.ts
function sendJson(res, status, body) {
  setCorsHeaders(res);
  res.status(status).json(body);
}
var CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key, x-provider"
};
function setCorsHeaders(res) {
  const r = res;
  if (typeof r.setHeader === "function") {
    for (const [k, v] of Object.entries(CORS_HEADERS)) r.setHeader(k, v);
  }
}
function handlePreflight(req, res) {
  setCorsHeaders(res);
  if ((req.method ?? "").toUpperCase() === "OPTIONS") {
    sendJson(res, 204, {});
    return true;
  }
  return false;
}
function requireMethod(req, res, method) {
  if (req.method !== method) {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return false;
  }
  return true;
}
function readJsonBody(req) {
  const raw = req.body;
  if (raw === void 0 || raw === null) return {};
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
    }
    throw new DemoError("Invalid JSON body", 400);
  }
  if (typeof raw === "object") return raw;
  throw new DemoError("Invalid JSON body", 400);
}
function demoWorkspace() {
  return resolveDemoWorkspace(process.env.NEUTRON_DEMO_WORKSPACE?.trim() || "/tmp/neutron-demo");
}
function newDemoManager() {
  return new DemoManager(demoWorkspace());
}
var TOKEN_TTL_MS = 30 * 60 * 1e3;
function handleApiError(res, err) {
  if (err instanceof DemoError) {
    sendJson(res, err.status, { ok: false, error: err.message });
    return;
  }
  sendJson(res, 500, { ok: false, error: "Internal server error" });
}

// api-src/demo/clone.ts
async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "POST")) return;
  try {
    const body = readJsonBody(req);
    if (typeof body.url !== "string" || !body.url.trim()) {
      sendJson(res, 400, { ok: false, error: "url is required" });
      return;
    }
    const repo = await cloneRepo(newDemoManager().workspace, body.url);
    sendJson(res, 200, { ok: true, repository: repo.name, isDemo: repo.isDemo });
  } catch (err) {
    handleApiError(res, err);
  }
}
export {
  handler as default
};
