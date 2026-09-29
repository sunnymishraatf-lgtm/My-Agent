/**
 * Test Lab output parsers: vitest / jest / pytest / go / mocha fixtures,
 * plus the honest unparseable fallback.
 */
import { describe, it, expect } from "vitest";
import { parseTestOutput, verdictOf } from "../src/server/terminal/parsers";

const VITEST_PASS = `
 RUN  v1.2.3 /repo

 ✓ src/a.test.ts (3 tests) 12ms
 ✓ src/b.test.ts (5 tests) 20ms

 Test Files  2 passed (2)
      Tests  8 passed (8)
   Start at  10:00:00
   Duration  1.23s
`;

const VITEST_FAIL = `
 RUN  v1.2.3 /repo

 ✓ src/a.test.ts (3 tests) 12ms
 ❯ src/b.test.ts (5 tests | 1 failed) 20ms
   × adds two numbers
     → expected 3 to be 4

 FAIL  src/b.test.ts > math > adds two numbers
AssertionError: expected 3 to be 4

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 7 passed (8)
`;

const JEST_FAIL = `
 FAIL  src/b.test.js
  math
    ✕ adds two numbers (5 ms)
    ✓ subtracts (1 ms)

  ● math › adds two numbers

Tests:       1 failed, 1 passed, 2 total
Test Suites: 1 failed, 1 total
`;

const PYTEST_PASS = `
test_a.py .....
test_b.py ...

12 passed in 2.34s
`;

const PYTEST_FAIL = `
test_a.py ....F
FAILED test_a.py::test_divide - ZeroDivisionError: division by zero

1 failed, 4 passed in 1.02s
`;

const GO_PASS = `
ok      example.com/mypkg    0.123s
?       example.com/other    [no test files]
`;

const GO_FAIL = `
--- FAIL: TestDivide (0.00s)
    main_test.go:12: got 0, want 2
FAIL    example.com/mypkg    0.123s
`;

const MOCHA_MIXED = `
  math
    ✓ adds
    1) divides

  1 passing (10ms)
  1 failing

  1) math
       divides:
     Error: boom
`;

const GARBAGE = `
compiling widgets...
warning: unused variable 'x'
Build finished. Have a nice day.
`;

describe("parseTestOutput", () => {
  it("parses a passing vitest run", () => {
    const r = parseTestOutput(VITEST_PASS);
    expect(r.matched).toBe(true);
    expect(r.framework).toBe("vitest");
    expect(r.passed).toBe(8);
    expect(r.failed).toBe(0);
    expect(verdictOf(r, 0)).toBe("pass");
  });

  it("parses a failing vitest run with FAIL rows", () => {
    const r = parseTestOutput(VITEST_FAIL);
    expect(r.matched).toBe(true);
    expect(r.failed).toBe(1);
    expect(r.tests.some((t) => t.status === "fail" && t.name.includes("adds two numbers"))).toBe(true);
    expect(verdictOf(r, 1)).toBe("fail");
  });

  it("parses jest summary and ✕ rows", () => {
    const r = parseTestOutput(JEST_FAIL);
    expect(r.matched).toBe(true);
    expect(r.framework).toBe("jest");
    expect(r.failed).toBe(1);
    expect(r.passed).toBe(1);
    expect(r.tests.some((t) => t.status === "fail")).toBe(true);
    expect(verdictOf(r, 1)).toBe("fail");
  });

  it("parses pytest -q summaries and FAILED rows", () => {
    const ok = parseTestOutput(PYTEST_PASS);
    expect(ok.matched).toBe(true);
    expect(ok.framework).toBe("pytest");
    expect(ok.passed).toBe(12);
    expect(verdictOf(ok, 0)).toBe("pass");

    const bad = parseTestOutput(PYTEST_FAIL);
    expect(bad.failed).toBe(1);
    expect(bad.tests[0]?.name).toContain("test_divide");
    expect(bad.tests[0]?.detail).toContain("ZeroDivisionError");
    expect(verdictOf(bad, 1)).toBe("fail");
  });

  it("parses go test output", () => {
    const ok = parseTestOutput(GO_PASS);
    expect(ok.matched).toBe(true);
    expect(ok.framework).toBe("go");
    expect(verdictOf(ok, 0)).toBe("pass");

    const bad = parseTestOutput(GO_FAIL);
    expect(bad.failed).toBe(1);
    expect(bad.tests[0]?.name).toBe("TestDivide");
    expect(verdictOf(bad, 1)).toBe("fail");
  });

  it("parses mocha passing/failing counts", () => {
    const r = parseTestOutput(MOCHA_MIXED);
    expect(r.matched).toBe(true);
    expect(r.framework).toBe("mocha");
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(verdictOf(r, 1)).toBe("fail");
  });

  it("returns unmatched for unparseable output — never invents a verdict", () => {
    const r = parseTestOutput(GARBAGE);
    expect(r.matched).toBe(false);
    expect(r.framework).toBeNull();
    expect(verdictOf(r, 0)).toBe("unknown");
    expect(verdictOf(r, 1)).toBe("unknown");
  });

  it("returns unmatched for empty input", () => {
    expect(parseTestOutput("").matched).toBe(false);
    expect(parseTestOutput("   \n  ").matched).toBe(false);
  });

  it("a failing framework run is fail even with exit code 0", () => {
    const r = parseTestOutput(VITEST_FAIL);
    expect(verdictOf(r, 0)).toBe("fail");
  });
});
