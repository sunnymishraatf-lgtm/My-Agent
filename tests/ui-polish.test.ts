/**
 * UI polish tests: pure helpers in src/web/app/ui-utils.js.
 * No DOM, no CSS keyframes — only the testable logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";

const { debounce, cappedSlice, shouldRefreshPill, CHAT_RENDER_CAP } = uiUtils;

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls the function once after rapid invocations", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes the latest arguments and this-context", () => {
    const seen: unknown[][] = [];
    const d = debounce(function (this: unknown, ...a: unknown[]) {
      seen.push([this, ...a]);
    }, 50);
    const ctx = { tag: "ctx" };
    d.call(ctx, 1);
    d.call(ctx, 2);
    vi.advanceTimersByTime(50);
    expect(seen.length).toBe(1);
    const first = seen[0] as unknown[];
    expect(first[0]).toBe(ctx);
    expect(first[1]).toBe(2);
  });

  it("cancel() prevents the pending call", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("cappedSlice", () => {
  it("returns a copy of the whole array when it fits", () => {
    const a = [1, 2, 3];
    const out = cappedSlice(a, 10);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(a);
  });

  it("returns the last cap items when over the cap", () => {
    const a = [1, 2, 3, 4, 5];
    expect(cappedSlice(a, 3)).toEqual([3, 4, 5]);
    expect(a).toEqual([1, 2, 3, 4, 5]); // no mutation
  });

  it("returns [] for non-arrays", () => {
    expect(cappedSlice(null, 5)).toEqual([]);
    expect(cappedSlice(undefined, 5)).toEqual([]);
  });

  it("CHAT_RENDER_CAP is a sane positive number", () => {
    expect(CHAT_RENDER_CAP).toBeGreaterThan(20);
  });
});

describe("shouldRefreshPill", () => {
  it("refreshes when the interval has elapsed", () => {
    expect(shouldRefreshPill(0, 30000, 30000)).toBe(true);
    expect(shouldRefreshPill(1000, 31000, 30000)).toBe(true);
  });

  it("skips when refreshed recently", () => {
    expect(shouldRefreshPill(29000, 30000, 30000)).toBe(false);
    expect(shouldRefreshPill(30000, 30000, 30000)).toBe(false);
  });

  it("refreshes on a realistic first call (lastMs = 0, nowMs = Date.now())", () => {
    expect(shouldRefreshPill(0, Date.now(), 30000)).toBe(true);
  });
});

describe("fetchWithTimeout", () => {
  const { fetchWithTimeout } = uiUtils;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the response when fetch is fast", async () => {
    const fakeRes = { ok: true };
    const p = fetchWithTimeout("https://x.test/", {}, 5000, {
      fetch: () => Promise.resolve(fakeRes),
      setTimeout, clearTimeout,
    });
    await expect(p).resolves.toBe(fakeRes);
  });

  it("rejects with a timeout error when fetch never settles", async () => {
    let onAbort: (() => void) | null = null;
    const FakeAC = function (this: any) {
      this.signal = {};
      this.abort = () => { if (onAbort) onAbort(); };
    };
    const abortErr = new Error("aborted");
    (abortErr as any).name = "AbortError";
    const p = fetchWithTimeout("https://x.test/", {}, 5000, {
      fetch: () => new Promise((_, rej) => { onAbort = () => rej(abortErr); }),
      AbortController: FakeAC,
      setTimeout, clearTimeout,
    });
    const assertion = expect(p).rejects.toThrow("Request timed out after 5s");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("reports a timeout when fetch rejects with AbortError", async () => {
    const abortErr = new Error("aborted");
    (abortErr as any).name = "AbortError";
    const p = fetchWithTimeout("https://x.test/", {}, 3000, {
      fetch: () => Promise.reject(abortErr),
      setTimeout, clearTimeout,
    });
    await expect(p).rejects.toThrow("Request timed out after 3s");
  });

  it("passes through non-abort fetch errors unchanged", async () => {
    const boom = new Error("network down");
    const p = fetchWithTimeout("https://x.test/", {}, 5000, {
      fetch: () => Promise.reject(boom),
      setTimeout, clearTimeout,
    });
    await expect(p).rejects.toBe(boom);
  });

  it("uses the race fallback when AbortController is unavailable", async () => {
    const p = fetchWithTimeout("https://x.test/", {}, 2000, {
      fetch: () => new Promise(() => {}),
      AbortController: undefined,
      setTimeout, clearTimeout,
    });
    const assertion = expect(p).rejects.toThrow("Request timed out after 2s");
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });
});

describe("stripAttachmentData", () => {
  const { stripAttachmentData } = uiUtils;

  it("replaces attachment base64 with a placeholder", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      attachments: [
        { name: "a.png", mime: "image/png", kind: "image", data: "x".repeat(100), size: 75 },
      ],
    };
    const out: any = stripAttachmentData(body);
    expect(out.attachments[0].data).toBe("[base64 omitted (100 chars)]");
    expect(out.attachments[0].name).toBe("a.png");
    expect(out.messages[0].content).toBe("hi");
  });

  it("does not mutate the input", () => {
    const body = { attachments: [{ name: "a", kind: "image", data: "xyz" }] };
    stripAttachmentData(body);
    expect((body.attachments[0] as any).data).toBe("xyz");
  });

  it("leaves non-attachment data fields alone", () => {
    const body = { data: "short", nested: { data: "also-short" } };
    expect(stripAttachmentData(body)).toEqual(body);
  });

  it("handles arrays, nulls, and primitives", () => {
    expect(stripAttachmentData([1, null, "s"])).toEqual([1, null, "s"]);
    expect(stripAttachmentData(null)).toBe(null);
    expect(stripAttachmentData(42)).toBe(42);
  });
});

describe("copyText", () => {
  const { copyText } = uiUtils;

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ok = await copyText("hello", { navigator: { clipboard: { writeText } } });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard.writeText rejects", async () => {
    const removed: any[] = [];
    const ta = {
      value: "",
      style: {} as any,
      setAttribute: vi.fn(),
      select: vi.fn(),
      parentNode: { removeChild: vi.fn((c: any) => { removed.push(c); }) },
    };
    const fakeDoc = {
      createElement: vi.fn(() => ta),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => true),
    };
    const ok = await copyText("fallback", {
      navigator: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } },
      document: fakeDoc,
    });
    expect(ok).toBe(true);
    expect(ta.value).toBe("fallback");
    expect(fakeDoc.execCommand).toHaveBeenCalledWith("copy");
    expect(removed).toContain(ta);
  });

  it("falls back to execCommand when no clipboard API exists", async () => {
    const ta: any = {
      value: "", style: {}, setAttribute: vi.fn(), select: vi.fn(),
      parentNode: null,
    };
    const fakeDoc = {
      createElement: vi.fn(() => ta),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => false),
    };
    const ok = await copyText("x", { navigator: {}, document: fakeDoc });
    expect(ok).toBe(false);
  });

  it("returns false when nothing is available", async () => {
    const ok = await copyText("x", { navigator: {}, document: undefined });
    expect(ok).toBe(false);
  });

  it("coerces non-string input", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ok = await copyText(null as any, { navigator: { clipboard: { writeText } } });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("");
  });
});

describe("fmtTime", () => {
  const { fmtTime } = uiUtils;

  it("formats an epoch as HH:MM", () => {
    // 2026-09-29T14:05:00 local — construct from parts to avoid TZ issues
    const d = new Date(2026, 8, 29, 14, 5, 0);
    expect(fmtTime(d.getTime())).toBe("14:05");
  });

  it("zero-pads single digits", () => {
    const d = new Date(2026, 8, 29, 9, 7, 0);
    expect(fmtTime(d.getTime())).toBe("09:07");
  });

  it("returns empty string for invalid input", () => {
    expect(fmtTime(NaN)).toBe("");
    expect(fmtTime(null as any)).toBe("");
    expect(fmtTime(undefined as any)).toBe("");
    expect(fmtTime("garbage")).toBe("");
  });
});

describe("wizard persistence helpers", () => {
  const { sanitizeWizard, isValidWizardState } = uiUtils;
  const STEPS = ["REQUEST", "ANALYSIS", "IMPACT", "PLAN", "APPROVAL", "EXECUTE", "RESULT"];

  it("picks the persistable subset and deep-copies", () => {
    const analysis = { files: ["a.ts"] };
    const mz = {
      step: "PLAN", form: { repo: "demo", request: "fix", riskTolerance: "safe", extra: 1 },
      analysisId: "abc", approvalToken: "tok", approved: true, rejected: false,
      analysis, plan: { tasks: [] }, junk: () => {},
    };
    const out: any = sanitizeWizard(mz);
    expect(out.step).toBe("PLAN");
    expect(out.form).toEqual({ repo: "demo", request: "fix", riskTolerance: "safe" });
    expect(out.analysisId).toBe("abc");
    expect(out.approved).toBe(true);
    expect(out.analysis).toEqual({ files: ["a.ts"] });
    expect(out.analysis).not.toBe(analysis); // deep copy
    expect(out.junk).toBeUndefined();
    expect(out.unsupported).toBeUndefined();
  });

  it("returns null for non-objects", () => {
    expect(sanitizeWizard(null)).toBe(null);
    expect(sanitizeWizard("x" as any)).toBe(null);
  });

  it("validates restored state against known steps", () => {
    expect(isValidWizardState({ step: "PLAN" }, STEPS)).toBe(true);
    expect(isValidWizardState({ step: "NOPE" }, STEPS)).toBe(false);
    expect(isValidWizardState({}, STEPS)).toBe(false);
    expect(isValidWizardState(null, STEPS)).toBe(false);
    expect(isValidWizardState({ step: "PLAN" }, [])).toBe(false);
  });
});

describe("sanitizeChatHistory", () => {
  const { sanitizeChatHistory } = uiUtils;

  it("keeps role/text/ts/failed and caps length", () => {
    const msgs = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user", text: "m" + i, ts: 1000 + i,
    }));
    const out: any = sanitizeChatHistory(msgs, 3);
    expect(out.length).toBe(3);
    expect(out[0].text).toBe("m2");
    expect(out[0].ts).toBe(1002);
    expect(out[0].role).toBe("user");
  });

  it("normalizes unknown roles to user and drops junk", () => {
    const out: any = sanitizeChatHistory([
      { role: "system", text: "x" },
      null,
      { role: "assistant", text: "y", failed: true },
    ]);
    expect(out.length).toBe(2);
    expect(out[0].role).toBe("user");
    expect(out[1].failed).toBe(true);
  });

  it("truncates oversized text and artifacts", () => {
    const out: any = sanitizeChatHistory([{
      role: "assistant", text: "a".repeat(30000),
      artifacts: [{ path: "f.txt", content: "b".repeat(200000) }],
    }]);
    expect(out[0].text.length).toBe(20000);
    expect(out[0].artifacts[0].content.length).toBe(100000);
    expect(out[0].artifacts[0].path).toBe("f.txt");
  });

  it("returns [] for invalid input", () => {
    expect(sanitizeChatHistory(null as any)).toEqual([]);
    expect(sanitizeChatHistory("x" as any)).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  const { renderMarkdown } = uiUtils;

  it("escapes HTML before anything else (XSS safe)", () => {
    const out = renderMarkdown('<script>alert(1)</script><img src=x onerror=y>');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("onerror=y>");
  });

  it("renders bold and italic", () => {
    expect(renderMarkdown("a **bold** word")).toBe("a <strong>bold</strong> word");
    expect(renderMarkdown("a *italic* word")).toBe("a <em>italic</em> word");
  });

  it("renders fenced code blocks without touching their content", () => {
    const out = renderMarkdown("```js\nconst a = **not bold**;\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("const a = **not bold**;");
    expect(out).not.toContain("<strong>");
  });

  it("renders inline code", () => {
    expect(renderMarkdown("use `x < y` here")).toBe("use <code>x &lt; y</code> here");
  });

  it("renders http/https links, rejects javascript: URLs", () => {
    const out = renderMarkdown("[docs](https://example.com/a)");
    expect(out).toContain('<a href="https://example.com/a" target="_blank" rel="noopener">docs</a>');
    const evil = renderMarkdown("[x](javascript:alert(1))");
    expect(evil).not.toContain("<a href=");
    expect(evil).toContain("[x](javascript:alert(1))");
  });

  it("converts newlines to <br> and handles empty input", () => {
    expect(renderMarkdown("a\nb")).toBe("a<br>b");
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null as any)).toBe("");
  });

  it("does not let markdown inside code spans leak", () => {
    const out = renderMarkdown("`<b>` and **bold**");
    expect(out).toContain("<code>&lt;b&gt;</code>");
    expect(out).toContain("<strong>bold</strong>");
  });
});
