/**
 * Test-output parsers for the Test Lab (Node server only, pure functions).
 *
 * Each parser looks for explicit framework evidence in the output text.
 * When nothing matches, the result is { matched: false } and the UI shows
 * the raw output honestly instead of inventing pass/fail counts.
 */

export interface ParsedTest {
  name: string;
  status: "pass" | "fail";
  detail?: string;
}

export interface TestParseResult {
  matched: boolean;
  framework: string | null;
  passed: number;
  failed: number;
  total: number;
  tests: ParsedTest[];
}

/** Verdict derived from a parse result. Never claims pass without evidence. */
export type TestVerdict = "pass" | "fail" | "unknown";

export function verdictOf(
  parsed: TestParseResult,
  exitCode: number | null,
): TestVerdict {
  if (!parsed.matched) return "unknown";
  if (parsed.failed > 0) return "fail";
  if (parsed.passed > 0) return "pass";
  // Framework evidence but no counts — fall back to the exit code.
  if (exitCode === 0) return "pass";
  if (typeof exitCode === "number") return "fail";
  return "unknown";
}

function empty(framework: string | null = null): TestParseResult {
  return { matched: false, framework, passed: 0, failed: 0, total: 0, tests: [] };
}

function parseVitest(text: string): TestParseResult | null {
  // Vitest prints e.g. "Test Files  3 passed (3)" / "Tests  42 passed (42)"
  // and "FAIL  test/x.test.ts > suite > name" for failures. Require a
  // vitest-specific marker — bare "FAIL <path>" lines also appear in jest
  // output and must not be claimed here.
  if (!/Test Files\s+\d+\s+(passed|failed)/.test(text) && !/RUN\s+v\d/.test(text)) return null;
  const r = empty("vitest");
  r.matched = true;
  const tf = text.match(/Test Files\s+(?:(\d+)\s+failed[^]*?)?(\d+)\s+passed/);
  const tm = text.match(/Tests\s+(?:(\d+)\s+failed[^]*?)?(\d+)\s+passed/);
  if (tm) {
    r.failed = parseInt(tm[1] ?? "0", 10);
    r.passed = parseInt(tm[2] as string, 10);
  } else if (tf) {
    // Fallback to file counts when only "Test Files" is present.
    r.failed = parseInt(tf[1] ?? "0", 10);
    r.passed = parseInt(tf[2] as string, 10);
  }
  const seen = new Set<string>();
  for (const m of text.matchAll(/^\s*FAIL\s+(.+)$/gm)) {
    const name = (m[1] as string).trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      r.tests.push({ name, status: "fail" });
    }
  }
  r.failed = Math.max(r.failed, r.tests.filter((t) => t.status === "fail").length);
  r.total = r.passed + r.failed;
  return r;
}

function parseJest(text: string): TestParseResult | null {
  // Jest summary: "Tests:       1 failed, 11 passed, 12 total"
  const m = text.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/);
  if (!m && !/^\s*✕\s+.+/m.test(text)) return null;
  const r = empty("jest");
  r.matched = true;
  if (m) {
    r.failed = parseInt(m[1] ?? "0", 10);
    r.passed = parseInt(m[2] ?? "0", 10);
    r.total = parseInt(m[3] as string, 10);
  }
  const seen = new Set<string>();
  for (const fm of text.matchAll(/^\s*✕\s+(.+)$/gm)) {
    const name = (fm[1] as string).trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      r.tests.push({ name, status: "fail" });
    }
  }
  r.failed = Math.max(r.failed, r.tests.filter((t) => t.status === "fail").length);
  if (!r.total) r.total = r.passed + r.failed;
  return r;
}

function parsePytest(text: string): TestParseResult | null {
  // pytest -q summary: "12 passed, 1 failed in 2.34s" or "1 failed, 12 passed in 2.34s"
  const m = text.match(/(\d+)\s+failed,\s*(\d+)\s+passed|(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/);
  const hasFailedLines = /^FAILED\s+\S+/m.test(text);
  if (!m && !hasFailedLines) return null;
  const r = empty("pytest");
  r.matched = true;
  if (m) {
    if (m[1] !== undefined && m[2] !== undefined) {
      r.failed = parseInt(m[1], 10);
      r.passed = parseInt(m[2], 10);
    } else {
      r.passed = parseInt(m[3] as string, 10);
      r.failed = parseInt(m[4] ?? "0", 10);
    }
  }
  const seen = new Set<string>();
  for (const fm of text.matchAll(/^FAILED\s+(\S+)(?:\s+-\s+(.*))?$/gm)) {
    const name = (fm[1] as string).trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      r.tests.push({ name, status: "fail", detail: (fm[2] as string | undefined)?.trim() || undefined });
    }
  }
  r.failed = Math.max(r.failed, r.tests.filter((t) => t.status === "fail").length);
  r.total = r.passed + r.failed;
  return r;
}

function parseGo(text: string): TestParseResult | null {
  // go test: "--- FAIL: TestName", "--- PASS: TestName", "ok  pkg", "FAIL  pkg"
  if (!/^--- (FAIL|PASS): /m.test(text) && !/^(ok|FAIL|\?)\s+\S+/m.test(text)) return null;
  const r = empty("go");
  r.matched = true;
  const seen = new Set<string>();
  for (const m of text.matchAll(/^--- (FAIL|PASS): (\S+)/gm)) {
    const status = m[1] === "FAIL" ? "fail" : "pass";
    const name = (m[2] as string).trim();
    // Skip indented subtests (they start with spaces — the ^ anchor with
    // the exact "--- " prefix already excludes "    --- FAIL").
    if (name && !seen.has(status + ":" + name)) {
      seen.add(status + ":" + name);
      r.tests.push({ name, status });
    }
  }
  r.passed = r.tests.filter((t) => t.status === "pass").length;
  r.failed = r.tests.filter((t) => t.status === "fail").length;
  r.total = r.passed + r.failed;
  return r;
}

function parseMocha(text: string): TestParseResult | null {
  // mocha: "  12 passing (34ms)" / "  1 failing" + detail section:
  //   "  1) suite\n       testname:\n     Error: ..."
  // The summary counts are authoritative — numbered rows are only parsed
  // from the detail section (after the "N failing" line) so the inline
  // spec-list "N) name" markers don't double-count the same failure.
  const p = text.match(/(\d+)\s+passing/);
  const f = text.match(/(\d+)\s+failing/);
  if (!p && !f) return null;
  const r = empty("mocha");
  r.matched = true;
  r.passed = p ? parseInt(p[1] as string, 10) : 0;
  r.failed = f ? parseInt(f[1] as string, 10) : 0;
  const detail = f ? text.slice(text.indexOf(f[0]) + f[0].length) : text;
  const seen = new Set<string>();
  for (const m of detail.matchAll(/^\s*(\d+)\)\s+(.+)$/gm)) {
    let name = (m[2] as string).trim();
    // Mocha puts the suite on the "N)" line and the test on the next
    // indented "name:" line — join them the way mocha users read it.
    const after = detail.slice((m.index ?? 0) + m[0].length).split("\n");
    const dm = (after[1] ?? "").match(/^\s+(\S[^:]*):\s*$/);
    if (dm) name = name + " › " + (dm[1] as string).trim();
    if (name && !seen.has(name) && !/passing|failing|pending/.test(name)) {
      seen.add(name);
      r.tests.push({ name, status: "fail" });
    }
  }
  r.total = r.passed + r.failed;
  return r;
}

/** Try each framework parser in order; first match wins. */
export function parseTestOutput(text: string): TestParseResult {
  if (typeof text !== "string" || !text.trim()) return empty();
  return (
    parseVitest(text) ??
    parseJest(text) ??
    parsePytest(text) ??
    parseGo(text) ??
    parseMocha(text) ??
    empty()
  );
}
