/**
 * Model comparison (Phase 22) — pure helper tests via window.NeutronUI
 * (ui-utils.js as CJS under vitest).
 */
import { describe, it, expect } from "vitest";
// @ts-ignore - ui-utils.js is a classic script exposing NeutronUI / CJS
import * as UI from "../src/web/app/ui-utils.js";

function okSend(text: string) {
  return function (body: any, opts: any) {
    return Promise.resolve({ text: text || "hello", provider: opts.provider, model: body.model || "auto-m", usage: { input_tokens: 10, output_tokens: 20 } });
  };
}

describe("buildCompareBody", () => {
  it("builds a single-user-message chat body", () => {
    const b = UI.buildCompareBody("Explain this", "m1", 500);
    expect(b.messages).toEqual([{ role: "user", content: "Explain this" }]);
    expect(b.model).toBe("m1");
    expect(b.maxTokens).toBe(500);
  });
  it("omits model/maxTokens when unset (provider default applies)", () => {
    const b = UI.buildCompareBody("hi", "", null);
    expect(b.messages).toEqual([{ role: "user", content: "hi" }]);
    expect("model" in b).toBe(false);
    expect("maxTokens" in b).toBe(false);
  });
  it("coerces null prompt to empty string", () => {
    expect(UI.buildCompareBody(null, "", null).messages[0]!.content).toBe("");
  });
});

describe("compareValidateSlots", () => {
  it("requires at least 2 slots", () => {
    expect(UI.compareValidateSlots([])).toHaveLength(1);
    expect(UI.compareValidateSlots([{ provider: "a" }])).toHaveLength(1);
  });
  it("rejects more than 4 slots", () => {
    const slots = [1, 2, 3, 4, 5].map(() => ({ provider: "a" }));
    expect(UI.compareValidateSlots(slots).join(" ")).toMatch(/at most 4/i);
  });
  it("flags slots without a provider (no silent defaults)", () => {
    const errs = UI.compareValidateSlots([{ provider: "a", model: "m" }, { provider: "", model: "m2" }]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/model 2/i);
  });
  it("accepts 2–4 fully-specified slots", () => {
    expect(UI.compareValidateSlots([{ provider: "a" }, { provider: "b", model: "" }])).toEqual([]);
  });
});

describe("compareEstimateCost", () => {
  const rates = { m1: { in: 1, out: 2 }, m2: { in: 0.5, out: 0.5 } };
  it("estimates input tokens as ceil(chars/4) and applies rates", () => {
    const e = UI.compareEstimateCost({ promptChars: 400, maxOutTok: 100, rates, models: ["m1", "m2"] });
    expect(e.inTok).toBe(100);
    expect(e.outTok).toBe(100);
    // m1: (100*1 + 100*2)/1e6 = 0.0003 ; m2: (100*0.5 + 100*0.5)/1e6 = 0.0001
    expect(e.perSlot[0]!.cost).toBeCloseTo(0.0003, 8);
    expect(e.perSlot[1]!.cost).toBeCloseTo(0.0001, 8);
    expect(e.total).toBeCloseTo(0.0004, 8);
    expect(e.costed).toBe(2);
    expect(e.uncosted).toBe(0);
  });
  it("never invents prices: unrated models get null cost and are excluded", () => {
    const e = UI.compareEstimateCost({ promptChars: 40, maxOutTok: 100, rates, models: ["m1", "unknown-model"] });
    expect(e.perSlot[1]!.cost).toBeNull();
    expect(e.costed).toBe(1);
    expect(e.uncosted).toBe(1);
    expect(e.total).toBeCloseTo((10 * 1 + 100 * 2) / 1e6, 10);
  });
  it("defaults output tokens to the documented assumption", () => {
    const e = UI.compareEstimateCost({ promptChars: 0, rates, models: ["m2"] });
    expect(e.outTok).toBe(UI.COMPARE_DEFAULT_OUT_TOK);
    expect(e.inTok).toBe(1);
  });
});

describe("compareStaggerDelays", () => {
  it("staggers slot starts by the step", () => {
    expect(UI.compareStaggerDelays(3, 300)).toEqual([0, 300, 600]);
    expect(UI.compareStaggerDelays(2)).toEqual([0, UI.COMPARE_STAGGER_MS]);
    expect(UI.compareStaggerDelays(0)).toEqual([]);
  });
});

describe("compareSuggestAlternative", () => {
  const providers = [
    { id: "p1", defaultModels: ["fast-mini", "coder-7b", "big-128k"] },
    { id: "p2", defaultModels: ["solo"] },
  ];
  it("suggests a router pick different from the current model", () => {
    // empty prompt -> "chat" kind -> fast model
    const alt = UI.compareSuggestAlternative(providers, "p1", "coder-7b", "");
    expect(alt).toBe("fast-mini");
  });
  it("falls back to the first other listed model when the router pick matches", () => {
    const alt = UI.compareSuggestAlternative(providers, "p1", "fast-mini", "");
    expect(alt).not.toBe("fast-mini");
    expect(["coder-7b", "big-128k"]).toContain(alt);
  });
  it("returns '' when there is nothing to suggest", () => {
    expect(UI.compareSuggestAlternative(providers, "nope", "x", "")).toBe("");
    expect(UI.compareSuggestAlternative(providers, "p2", "solo", "")).toBe("");
    expect(UI.compareSuggestAlternative([], "p1", "x", "")).toBe("");
  });
  it("never invents model ids", () => {
    const alt = UI.compareSuggestAlternative(providers, "p1", "coder-7b", "some code: function x() {}");
    expect(providers[0]!.defaultModels).toContain(alt);
  });
});

describe("runCompareSlots", () => {
  it("dispatches all slots in parallel and isolates failures", async () => {
    const slots = [
      { provider: "pa", model: "m1" },
      { provider: "pb", model: "m2" },
    ];
    const seen: string[] = [];
    const send = function (body: any, opts: any) {
      seen.push(opts.provider);
      if (opts.provider === "pb") return Promise.reject(new Error("HTTP 429"));
      return Promise.resolve({ text: "ok", usage: { input_tokens: 5, output_tokens: 7 } });
    };
    const logs: any[] = [];
    const states: string[] = [];
    const h = UI.runCompareSlots(slots, "prompt", null, {
      send, staggerMs: 0,
      log: (e) => logs.push(e),
      onState: (s) => states.push(s.provider + ":" + s.status),
    });
    const out = await h.promise;
    expect(seen.sort()).toEqual(["pa", "pb"]);
    expect(out[0]!.status).toBe("done");
    expect(out[0]!.text).toBe("ok");
    expect(out[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(out[1]!.status).toBe("error");
    expect(out[1]!.error.message).toBe("HTTP 429");
    // usage logged per slot with real ok flags
    expect(logs.find((l) => l.provider === "pa")!.ok).toBe(true);
    expect(logs.find((l) => l.provider === "pb")!.ok).toBe(false);
    expect(logs.find((l) => l.provider === "pa")!.inTok).toBe(5);
    // per-slot provider override reaches send()
    expect(out[0]!.usage).toEqual({ input_tokens: 5, output_tokens: 7 });
  });

  it("staggers starts by the configured step", async () => {
    const delays: number[] = [];
    const slots = [{ provider: "a" }, { provider: "b" }, { provider: "c" }];
    const h = UI.runCompareSlots(slots, "p", null, {
      send: okSend("x"),
      staggerMs: 300,
      setTimeout: (fn: () => void, ms: number) => { delays.push(ms); return setTimeout(fn, 0); },
    });
    await h.promise;
    expect(delays).toEqual([0, 300, 600]);
  });

  it("maps timeout-shaped rejections to error (not done)", async () => {
    const slots = [{ provider: "a", model: "m" }];
    const h = UI.runCompareSlots(slots, "p", null, {
      send: () => Promise.reject(new Error("Request timed out after 90s")),
      staggerMs: 0,
    });
    const out = await h.promise;
    expect(out[0]!.status).toBe("error");
    expect(out[0]!.error.message).toMatch(/timed out/);
  });

  it("handles a synchronously-throwing send as error", async () => {
    const slots = [{ provider: "a" }];
    const h = UI.runCompareSlots(slots, "p", null, {
      send: () => { throw new Error("boom"); },
      staggerMs: 0,
    });
    const out = await h.promise;
    expect(out[0]!.status).toBe("error");
  });

  it("cancel() aborts in-flight requests and marks them cancelled", async () => {
    const slots = [{ provider: "a" }, { provider: "b" }];
    const send = function (body: any, opts: any) {
      return new Promise((resolve, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }
      });
    };
    const h = UI.runCompareSlots(slots, "p", null, { send, staggerMs: 0 });
    // let both start, then cancel
    await new Promise((r) => setTimeout(r, 20));
    h.cancel();
    const out = await h.promise;
    expect(out[0]!.status).toBe("cancelled");
    expect(out[1]!.status).toBe("cancelled");
  });

  it("cancel() before a staggered start never calls send for that slot", async () => {
    const slots = [{ provider: "a" }, { provider: "b" }];
    let calls = 0;
    const h = UI.runCompareSlots(slots, "p", null, {
      send: () => { calls++; return Promise.resolve({ text: "x" }); },
      staggerMs: 50,
    });
    h.cancel();
    const out = await h.promise;
    expect(calls).toBe(0);
    expect(out.every((s) => s.status === "cancelled")).toBe(true);
  });

  it("passes model and maxTokens through to the request body", async () => {
    let gotBody = null;
    const slots = [{ provider: "a", model: "m9" }];
    const h = UI.runCompareSlots(slots, "the prompt", 777, {
      send: (body) => { gotBody = body; return Promise.resolve({ text: "x" }); },
      staggerMs: 0,
    });
    await h.promise;
    expect(gotBody).not.toBeNull();
    const body = gotBody as any;
    expect(body.messages).toEqual([{ role: "user", content: "the prompt" }]);
    expect(body.model).toBe("m9");
    expect(body.maxTokens).toBe(777);
  });

  it("resolves immediately with no slots", async () => {
    const h = UI.runCompareSlots([], "p", null, { send: okSend("x") });
    expect(await h.promise).toEqual([]);
  });
});
