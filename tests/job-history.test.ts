/**
 * Job-history parsing tests: parseJobHistory() in src/web/app/ui-utils.js.
 * The Reports view must never break on corrupt or non-array localStorage
 * data — it should fall back to an empty list with a clean empty state.
 */
import { describe, it, expect } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";

const { parseJobHistory } = uiUtils;

describe("parseJobHistory", () => {
  it("parses a valid array", () => {
    const raw = JSON.stringify([{ jobId: "a" }, { jobId: "b" }]);
    const h = parseJobHistory(raw);
    expect(h).toHaveLength(2);
    expect((h[0] as { jobId: string }).jobId).toBe("a");
  });

  it("returns [] for corrupt JSON", () => {
    expect(parseJobHistory("{not json")).toEqual([]);
    expect(parseJobHistory("")).toEqual([]);
  });

  it("returns [] for non-array JSON values", () => {
    expect(parseJobHistory("{}")).toEqual([]);
    expect(parseJobHistory('"abc"')).toEqual([]);
    expect(parseJobHistory("123")).toEqual([]);
    expect(parseJobHistory("null")).toEqual([]);
    expect(parseJobHistory("true")).toEqual([]);
  });

  it("returns [] for null/undefined input", () => {
    expect(parseJobHistory(null)).toEqual([]);
    expect(parseJobHistory(undefined)).toEqual([]);
  });

  it("preserves an empty array", () => {
    expect(parseJobHistory("[]")).toEqual([]);
  });
});
