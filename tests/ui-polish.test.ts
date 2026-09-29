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
