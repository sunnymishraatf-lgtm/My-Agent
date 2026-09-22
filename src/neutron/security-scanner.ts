import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import type { SecurityFinding, SecurityReview, FindingSeverity, ImpactGraph } from "./model";

const EXCLUDED = new Set(["node_modules", ".git", ".agent", "dist", "build", "coverage", "venv", "__pycache__", "target", ".next"]);

interface ScanConfig {
  ignoredPatterns: RegExp[]; // file paths whose references to env vars should be silently allowed
  skipDirs: Set<string>;
}

const DEFAULT_CONFIG: ScanConfig = {
  ignoredPatterns: [/.env$/, /\.env\.example$/, /\.env\.sample$/, /package\.json$/, /package-lock\.json$/, /README\.md$/],
  skipDirs: EXCLUDED,
};

function walk(root: string, skipDirs: Set<string>, max = 2000): string[] {
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
        if (!skipDirs.has(e.name)) stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function readSafe(file: string, maxBytes = 256_000): string | undefined {
  try {
    const s = statSync(file);
    if (!s.isFile() || s.size > maxBytes) return undefined;
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

const SECRET_PATTERNS: Array<{ re: RegExp; severity: FindingSeverity; category: string; title: string }> = [
  {
    re: /(?:sk|pk|rk|AKIA|AIza|ghp_|gho_|xox[baprs]-|eyJ)[A-Za-z0-9_\-]{10,}/g,
    severity: "critical",
    category: "secrets",
    title: "Hard-coded credential or API key looks like it may be committed",
  },
  {
    re: /\b(?:api[_-]?key|apikey|secret|auth[_-]?token|access[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
    severity: "high",
    category: "secrets",
    title: "Suspected secret assigned inline in source",
  },
  {
    re: /\bpassword\s*[:=]\s*["'][^"'\s]{4,}["']/gi,
    severity: "high",
    category: "secrets",
    title: "Hard-coded password detected",
  },
];

const AUTH_PATTERNS: Array<{ re: RegExp; severity: FindingSeverity; category: string; title: string }> = [
  {
    re: /\bpassport\.(?:use|authenticate)\s*\(/i,
    severity: "low",
    category: "auth",
    title: "Authentication dependency detected; verify sessions/cookies are secured",
  },
  {
    re: /\bexpress\.session\s*\(/i,
    severity: "low",
    category: "auth",
    title: "Express session middleware usage detected",
  },
  {
    re: /\brequire\(["']jsonwebtoken["']\)/i,
    severity: "low",
    category: "auth",
    title: "jsonwebtoken import detected; verify token validation",
  },
];

const UNSAFE_INPUT: Array<{ re: RegExp; severity: FindingSeverity; category: string; title: string }> = [
  {
    re: /\beval\s*\(/g,
    severity: "high",
    category: "unsafe-input",
    title: "'eval' usage can execute arbitrary code",
  },
  {
    re: /dangerouslySetInnerHTML|v-html|innerHTML\s*=/g,
    severity: "medium",
    category: "unsafe-input",
    title: "HTML injection surface (XSS) — sanitize user input",
  },
  {
    re: /\bexec(?:File)?\s*\(|child_process|shell:\s*true/g,
    severity: "medium",
    category: "unsafe-input",
    title: "Shell command execution detected — validate and escape inputs",
  },
  {
    re: /\bSQL\b.{0,40}\b(?:exec|execute|query)|\$\{.{0,40}\}.*\bquery\b|\b(buildQuery|\+)\s*["']?select/gi,
    severity: "medium",
    category: "unsafe-input",
    title: "Possible SQL string interpolation — prefer parameterized queries",
  },
];

const AUTHZ_PATTERNS: Array<{ re: RegExp; severity: FindingSeverity; category: string; title: string }> = [
  {
    re: /(?:isAuthenticated|requireAuth|authorize|roles?\s*:)/gi,
    severity: "info",
    category: "authz",
    title: "Authorization guard detected — verify coverage across protected routes",
  },
];

export function scanSecurity(root: string, graph?: ImpactGraph): SecurityReview {
  const findings: SecurityFinding[] = [];
  const cfg = DEFAULT_CONFIG;
  const files = walk(root, cfg.skipDirs);

  const impactedPaths = new Set<string>();
  if (graph) for (const n of graph.nodes) impactedPaths.add(resolve(root, n.path));

  for (const file of files) {
    const rel = relative(root, file);
    const content = readSafe(file);
    if (content === undefined) continue;
    const isEnvFile = cfg.ignoredPatterns.some((p) => p.test(file));

    for (const { re, severity, category, title } of SECRET_PATTERNS) {
      if (isEnvFile) continue;
      re.lastIndex = 0;
      let m: RegExpMatchArray | null;
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
      let m: RegExpMatchArray | null;
      while ((m = re.exec(content)) !== null) {
        findings.push(makeFinding(severity, category, rel, title));
        if (findings.length >= 120) break;
      }
      if (findings.length >= 120) break;
    }
    if (findings.length >= 120) break;
  }

  // OAuth-specific check: callback endpoints should validate state
  const oauthStateFindings = findOAuthStateIssue(root, files, impactedPaths);
  findings.push(...oauthStateFindings);
  const oauthReported = new Set(oauthStateFindings.map((f) => f.file));

  // config/authorization summary checks
  const authFile = files.find((f) => /auth/.test(basenameOf(f)));
  if (authFile) {
    const content = readSafe(authFile) ?? "";
    if (!/state|\bcsrf\b|nonce/.test(content)) {
      const rel = relative(root, authFile);
      // Don't double-report the same file the detailed OAuth check already flagged.
      if (!oauthReported.has(rel)) {
        findings.push({
          severity: "medium",
          category: "auth",
          title: "OAuth callback does not validate 'state' (CSRF protection for OAuth flows)",
          detail: `${rel} exchanges an authorization code without a state/nonce parameter.`,
          file: rel,
        });
      }
    }
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const blocked = findings.some((f) => f.severity === "critical" || f.severity === "high");
  const summary = summarize(findings);

  return { findings, blocked, summary, scannedAt: new Date().toISOString() };
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function findOAuthStateIssue(root: string, files: string[], impactedPaths: Set<string>): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const file of files) {
    if (!isInImpacted(file, impactedPaths)) continue;
    const rel = relative(root, file);
    const content = readSafe(file);
    if (content === undefined) continue;
    const low = content.toLowerCase();
    const isOauth = /oauth|passport\.google|passport\.github|callback/.test(low);
    if (!isOauth) continue;
    if (/state|csrf|nonce/.test(low)) continue;
    out.push({
      severity: "medium",
      category: "auth",
      title: "OAuth callback does not validate 'state' (CSRF protection for OAuth flows)",
      detail: `${rel} handles an OAuth callback without a state/nonce comparison. Add state validation.`,
      file: rel,
    });
  }
  return out;
}

function isInImpacted(file: string, impactedPaths: Set<string>): boolean {
  if (impactedPaths.size === 0) return true;
  return [...impactedPaths].some((p) => file === p || file.startsWith(p + "/"));
}

function makeFinding(
  severity: FindingSeverity,
  category: string,
  rel: string,
  title?: string,
): SecurityFinding {
  return {
    severity,
    category,
    title: title ?? "",
    detail: `Found in ${rel}`,
    file: rel,
  };
}

function summarize(findings: SecurityFinding[]): string {
  const parts: string[] = [];
  const count = (s: FindingSeverity) => findings.filter((f) => f.severity === s).length;
  parts.push(`Security scan: ${findings.length} finding(s) â€” ${count("critical")} critical, ${count("high")} high, ${count("medium")} medium, ${count("low")} low, ${count("info")} info.`);
  if (findings.length === 0) parts.push("No security issues detected.");
  else parts.push(findings.slice(0, 3).map((f) => `- [${f.severity.toUpperCase()}] ${f.title}`).join("\n"));
  return parts.join("\n");
}

export function severityRank(s: FindingSeverity): number {
  return { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[s] ?? 1;
}

export function formatSecurityReview(review: SecurityReview): string {
  const lines: string[] = [];
  lines.push("SECURITY REVIEW");
  lines.push("---------------");
  lines.push(review.summary);
  if (review.blocked) lines.push("Release: BLOCKED until critical/high findings are resolved.");
  const ok = review.findings.filter((f) => f.severity === "info" || f.severity === "low").map((f) => f.title);
  if (ok.length > 0) {
    lines.push("");
    lines.push("âœ“ " + ok.slice(0, 5).join("\nâœ“ "));
  }
  return lines.join("\n");
}
