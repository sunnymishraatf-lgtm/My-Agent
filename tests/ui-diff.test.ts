/**
 * Diff parser tests: pure helpers in src/web/app/ui-utils.js.
 */
import { describe, it, expect } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";

const { parseUnifiedDiff, parseCompactDiff } = uiUtils;

describe("parseUnifiedDiff", () => {
  it("parses files, hunks, and line types", () => {
    const text = [
      "--- a/app.txt",
      "+++ b/app.txt",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-old",
      "+new",
      " tail",
      "--- a/other.txt",
      "+++ b/other.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");
    const parsed = parseUnifiedDiff(text);
    expect(parsed.files).toHaveLength(2);
    const f0 = parsed.files[0]!;
    const f1 = parsed.files[1]!;
    expect(f0.path).toBe("app.txt");
    expect(f0.hunks).toHaveLength(1);
    const h0 = f0.hunks[0]!;
    expect(h0.header).toContain("@@");
    const types = h0.lines.map((l) => l.t + l.text);
    expect(types).toEqual([" keep", "-old", "+new", " tail"]);
    expect(f1.path).toBe("other.txt");
  });

  it("ignores truncation markers and stray lines", () => {
    const text = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "... (diff truncated at 400 lines)",
      "\\ No newline at end of file",
    ].join("\n");
    const parsed = parseUnifiedDiff(text);
    const h = parsed.files[0]!.hunks[0]!;
    expect(h.lines.map((l) => l.t + l.text)).toEqual(["-a", "+b"]);
  });

  it("treats a bare empty line in a hunk as empty context", () => {
    const parsed = parseUnifiedDiff("--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\n+b");
    const h = parsed.files[0]!.hunks[0]!;
    expect(h.lines).toEqual([
      { t: "-", text: "a" },
      { t: " ", text: "" },
      { t: "+", text: "b" },
    ]);
  });

  it("returns no files for empty input", () => {
    expect(parseUnifiedDiff("").files).toEqual([]);
    expect(parseUnifiedDiff(null).files).toEqual([]);
  });
});

describe("parseCompactDiff", () => {
  it("maps - / + lines and notes", () => {
    const rows = parseCompactDiff("- removed\n+ added\n… (+3 more lines)");
    expect(rows).toEqual([
      { t: "del", text: "removed" },
      { t: "add", text: "added" },
      { t: "note", text: "… (+3 more lines)" },
    ]);
  });

  it("maps the no-changes marker to a note", () => {
    expect(parseCompactDiff("(no changes)")).toEqual([{ t: "note", text: "(no changes)" }]);
  });

  it("returns [] for empty input", () => {
    expect(parseCompactDiff("")).toEqual([]);
  });
});
