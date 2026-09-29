/* ==========================================================================
   NEUTRON project-intelligence APIs (Node server only).
   - POST /api/insights/security/scan  {repo} → security scan (reuses the
     existing security-scanner) + committed-secrets check over git-tracked
     files. Results cached in memory per repo.
   - GET  /api/insights/security?repo=        → last cached scan or "never".
   - POST /api/insights/deps/scan       {repo} → dependency inventory:
     manifest detection, npm registry "latest" lookups, `npm audit --json`.
   - GET  /api/insights/deps?repo=             → last cached scan or "never".
   Everything here needs the Node server (workspace access, process
   execution); serverless hosting never sees these routes. Every finding
   carries evidence — nothing is invented.
   ========================================================================== */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  scanSecurity,
  scanContentForSecrets,
  severityRank,
} from "../neutron/security-scanner";
import type { SecurityFinding } from "../neutron/model";
import { listWorkspaceRepos } from "./demo";
import { resolveSafePath } from "./agent/tools";

/* ---------- tiny HTTP helpers (local so this module stays self-contained) */

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => {
      data += c.toString();
      if (data.length > 1_000_000) {
        req.resume();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/* ---------- rate limiting (per-IP, same pattern as the git/agent APIs) */

const buckets = new Map<string, { count: number; reset: number }>();
const INSIGHT_LIMIT = 30;
const INSIGHT_WINDOW_MS = 60_000;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = buckets.get(ip);
  if (!e || now > e.reset) {
    buckets.set(ip, { count: 1, reset: now + INSIGHT_WINDOW_MS });
    if (buckets.size > 10_000) buckets.clear();
    return false;
  }
  e.count++;
  return e.count > INSIGHT_LIMIT;
}
/** Test hook. */
export function resetInsightsRateLimit(): void {
  buckets.clear();
}

/* ---------- repo resolution ---------- */

function resolveRepo(workspace: string, repo: unknown): string {
  const name = typeof repo === "string" ? repo : "";
  if (!name) throw new Error("Missing repository name.");
  const known = listWorkspaceRepos(workspace).some((r) => r.name === name);
  if (!known) throw new Error("Unknown repository.");
  return resolveSafePath(workspace, name);
}

function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 8_000_000 }, (err, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: err ? String(stderr ?? err.message) : String(stderr ?? ""),
      });
    });
  });
}

/* ==========================================================================
   SECURITY
   ========================================================================== */

interface CachedScan<T> {
  scannedAt: string;
  data: T;
}
const securityCache = new Map<string, CachedScan<SecurityPayload>>();

interface SecurityPayload {
  findings: SecurityFinding[];
  counts: Record<string, number>;
  summary: string;
  committedSecretsChecked: boolean;
}

/** Run `git ls-files` and scan tracked files for committed secrets. */
async function scanCommittedSecrets(root: string): Promise<{ findings: SecurityFinding[]; checked: boolean }> {
  const findings: SecurityFinding[] = [];
  const { stdout } = await runCmd("git", ["ls-files"], root, 15_000);
  const files = stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 800);
  if (!files.length) return { findings, checked: false };
  for (const rel of files) {
    // Skip obvious non-text / vendored paths.
    if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|mp4|woff2?|ttf|eot)$/i.test(rel)) continue;
    if (/(^|\/)(node_modules|dist|build|coverage|vendor|\.next)(\/|$)/.test(rel)) continue;
    const full = join(root, rel);
    // Containment: ls-files output is relative; never follow "..".
    if (rel.includes("..")) continue;
    let content: string;
    try {
      const st = statSync(full);
      if (!st.isFile() || st.size > 256_000) continue;
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue; // binary
    for (const hit of scanContentForSecrets(content, rel)) {
      findings.push({
        severity: hit.severity,
        category: "committed-secrets",
        title: `Possibly committed secret — ${hit.title}`,
        detail: `${rel}:${hit.line} — ${hit.excerpt}`,
        file: `${rel}:${hit.line}`,
      });
    }
    if (findings.length >= 60) break;
  }
  return { findings, checked: true };
}

export async function runSecurityScan(root: string): Promise<SecurityPayload> {
  const review = scanSecurity(root);
  const committed = await scanCommittedSecrets(root);
  const findings = [...review.findings, ...committed.findings].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const summary =
    findings.length === 0
      ? "No security issues detected."
      : `${findings.length} finding(s) — ${counts.critical} critical, ${counts.high} high, ` +
        `${counts.medium} medium, ${counts.low} low, ${counts.info} info.`;
  return { findings: findings.slice(0, 200), counts, summary, committedSecretsChecked: committed.checked };
}

/* ==========================================================================
   DEPENDENCIES
   ========================================================================== */

const depsCache = new Map<string, CachedScan<DepsPayload>>();

export interface DepVuln {
  severity: string;
  title: string;
  via: string;
}
export interface DepPackage {
  name: string;
  current: string;
  latest: string | null;
  deprecated: boolean;
  updateAvailable: boolean;
  vulns: DepVuln[];
}
export interface DepsPayload {
  manifests: string[];
  packages: DepPackage[];
  auditAvailable: boolean;
  auditNote: string;
  counts: { total: number; updates: number; deprecated: number; vulnerable: number };
  unsupported: string[];
}

const MANIFEST_FILES = ["package.json", "requirements.txt", "go.mod", "pom.xml", "build.gradle", "Cargo.toml"];

function stripVersionRange(v: string): string {
  return v.trim().replace(/^[~^>=<v\s]+/, "").split(" ")[0] ?? "";
}

/** -1 | 0 | 1 — numeric semver-ish comparison; non-numeric parts compare lexically. */
export function compareVersions(a: string, b: string): number {
  const pa = stripVersionRange(a).split(".");
  const pb = stripVersionRange(b).split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = /^\d+$/.test(x) ? parseInt(x, 10) : NaN;
    const ny = /^\d+$/.test(y) ? parseInt(y, 10) : NaN;
    if (!isNaN(nx) && !isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

interface RegistryInfo {
  latest: string | null;
  deprecated: boolean;
}

async function fetchRegistryInfo(name: string, timeoutMs = 8000): Promise<RegistryInfo> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { latest: null, deprecated: false };
    const j = (await res.json()) as { version?: unknown; deprecated?: unknown };
    return {
      latest: typeof j.version === "string" ? j.version : null,
      deprecated: typeof j.deprecated === "string" || j.deprecated === true,
    };
  } catch {
    return { latest: null, deprecated: false };
  } finally {
    clearTimeout(t);
  }
}

/** Parse `npm audit --json` (npm v7+ `vulnerabilities` map; v6 `advisories` fallback). */
export function parseNpmAudit(json: string): Map<string, DepVuln[]> {
  const out = new Map<string, DepVuln[]>();
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return out;
  }
  const d = data as {
    vulnerabilities?: Record<string, { severity?: unknown; title?: unknown; via?: unknown }>;
    advisories?: Record<string, { severity?: unknown; title?: unknown; module_name?: unknown }>;
  };
  const push = (name: string, v: DepVuln) => {
    const arr = out.get(name) ?? [];
    arr.push(v);
    out.set(name, arr);
  };
  if (d.vulnerabilities && typeof d.vulnerabilities === "object") {
    for (const [name, v] of Object.entries(d.vulnerabilities)) {
      const via = Array.isArray(v.via)
        ? v.via.map((x) => (typeof x === "string" ? x : x?.name ?? "?")).join(", ")
        : String(v.via ?? "");
      push(name, {
        severity: String(v.severity ?? "unknown"),
        title: String(v.title ?? "vulnerability"),
        via,
      });
    }
  } else if (d.advisories && typeof d.advisories === "object") {
    for (const adv of Object.values(d.advisories)) {
      const name = String(adv.module_name ?? "unknown");
      push(name, { severity: String(adv.severity ?? "unknown"), title: String(adv.title ?? "vulnerability"), via: "" });
    }
  }
  return out;
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function runDepsScan(
  root: string,
  registryLookup: (name: string) => Promise<RegistryInfo> = fetchRegistryInfo,
): Promise<DepsPayload> {
  const manifests = MANIFEST_FILES.filter((m) => existsSync(join(root, m)));
  const unsupported = manifests.filter((m) => m !== "package.json");
  const packages: DepPackage[] = [];
  let auditAvailable = false;
  let auditNote = "npm audit runs only when package.json is present.";
  let vulnMap = new Map<string, DepVuln[]>();

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      pkg = {};
    }
    const deps: Array<[string, string]> = [
      ...Object.entries(pkg.dependencies ?? {}),
      ...Object.entries(pkg.devDependencies ?? {}),
    ].slice(0, 150);

    // npm audit (best effort — honest when unavailable).
    const { stdout } = await runCmd("npm", ["audit", "--json"], root, 90_000);
    const auditJson = parseNpmAudit(stdout);
    if (stdout.trim().startsWith("{") && auditJson.size > 0) {
      vulnMap = auditJson;
      auditAvailable = true;
      auditNote = "npm audit completed.";
    } else if (stdout.trim().startsWith("{")) {
      // npm printed JSON but it carried no vulnerability data (e.g. an
      // error object for a missing lockfile) — do not invent vulns.
      auditNote = "npm audit returned no vulnerability data (missing lockfile or audit error) — vulnerability data unavailable.";
    } else {
      auditNote = "npm audit did not return JSON (no lockfile or network issue) — vulnerability data unavailable.";
    }

    const infos = await mapConcurrent(deps, 5, async ([name]) => registryLookup(name));
    deps.forEach(([name, current], i) => {
      const info = infos[i] ?? { latest: null, deprecated: false };
      const updateAvailable =
        info.latest !== null && compareVersions(stripVersionRange(current), info.latest) < 0;
      packages.push({
        name,
        current: String(current),
        latest: info.latest,
        deprecated: info.deprecated,
        updateAvailable,
        vulns: vulnMap.get(name) ?? [],
      });
    });
  }

  const counts = {
    total: packages.length,
    updates: packages.filter((p) => p.updateAvailable).length,
    deprecated: packages.filter((p) => p.deprecated).length,
    vulnerable: packages.filter((p) => p.vulns.length > 0).length,
  };
  return { manifests, packages, auditAvailable, auditNote, counts, unsupported };
}

/* ==========================================================================
   HTTP dispatch
   ========================================================================== */

export async function handleInsightsApi(
  workspace: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) {
    sendJson(res, 429, { ok: false, error: "Too many insight requests. Please slow down." });
    return;
  }
  const path = url.pathname;

  try {
    if (req.method === "POST" && path === "/api/insights/security/scan") {
      const body = (await readJson(req)) as { repo?: unknown };
      const root = resolveRepo(workspace, body.repo);
      const repo = String(body.repo);
      const payload = await runSecurityScan(root);
      securityCache.set(repo, { scannedAt: new Date().toISOString(), data: payload });
      sendJson(res, 200, { ok: true, repo, scannedAt: new Date().toISOString(), ...payload });
      return;
    }
    if (req.method === "GET" && path === "/api/insights/security") {
      const repo = url.searchParams.get("repo") ?? "";
      resolveRepo(workspace, repo); // validates the name even for cache reads
      const hit = securityCache.get(repo);
      if (!hit) {
        sendJson(res, 200, { ok: true, repo, scannedAt: null });
        return;
      }
      sendJson(res, 200, { ok: true, repo, scannedAt: hit.scannedAt, ...hit.data });
      return;
    }
    if (req.method === "POST" && path === "/api/insights/deps/scan") {
      const body = (await readJson(req)) as { repo?: unknown };
      const root = resolveRepo(workspace, body.repo);
      const repo = String(body.repo);
      const payload = await runDepsScan(root);
      depsCache.set(repo, { scannedAt: new Date().toISOString(), data: payload });
      sendJson(res, 200, { ok: true, repo, scannedAt: new Date().toISOString(), ...payload });
      return;
    }
    if (req.method === "GET" && path === "/api/insights/deps") {
      const repo = url.searchParams.get("repo") ?? "";
      resolveRepo(workspace, repo);
      const hit = depsCache.get(repo);
      if (!hit) {
        sendJson(res, 200, { ok: true, repo, scannedAt: null });
        return;
      }
      sendJson(res, 200, { ok: true, repo, scannedAt: hit.scannedAt, ...hit.data });
      return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /Unknown repository|Missing repository/.test(msg) ? 400 : 500;
    sendJson(res, status, { ok: false, error: msg });
    return;
  }
  sendJson(res, 404, { ok: false, error: `Not found: ${req.method} ${path}` });
}
