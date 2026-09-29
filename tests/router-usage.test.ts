/**
 * Model router + usage dashboard + cost control (Phases 21/23/31).
 * Pure-function tests via window.NeutronUI (ui-utils.js as CJS under vitest).
 */
import { describe, it, expect } from "vitest";
// @ts-ignore - ui-utils.js is a classic script exposing NeutronUI / CJS
import * as UI from "../src/web/app/ui-utils.js";

const DAY = 86400000;

describe("sanitizeRouterMode", () => {
  it("accepts the three modes, defaults to auto", () => {
    expect(UI.sanitizeRouterMode("auto")).toBe("auto");
    expect(UI.sanitizeRouterMode("MANUAL")).toBe("manual");
    expect(UI.sanitizeRouterMode("locked")).toBe("locked");
    expect(UI.sanitizeRouterMode("")).toBe("auto");
    expect(UI.sanitizeRouterMode(null)).toBe("auto");
    expect(UI.sanitizeRouterMode("turbo")).toBe("auto");
  });
});

describe("classifyTask", () => {
  it("classifies image tasks as vision first", () => {
    const c = UI.classifyTask({ text: "fix this bug", hasImages: true });
    expect(c.kind).toBe("vision");
  });
  it("classifies very long input as long-context", () => {
    const c = UI.classifyTask({ text: "x".repeat(9000), hasImages: false });
    expect(c.kind).toBe("long");
    expect(c.reason).toContain("9000");
  });
  it("classifies code tasks by fences and keywords", () => {
    expect(UI.classifyTask({ text: "```js\nconst x = 1;\n```" }).kind).toBe("code");
    expect(UI.classifyTask({ text: "please debug this stack trace" }).kind).toBe("code");
    expect(UI.classifyTask({ text: "refactor the login function" }).kind).toBe("code");
  });
  it("classifies plain questions as chat", () => {
    expect(UI.classifyTask({ text: "what is the capital of France?" }).kind).toBe("chat");
    expect(UI.classifyTask(null).kind).toBe("chat");
  });
});

describe("tagModelCapabilities", () => {
  it("tags vision / long-context / code / fast from model ids", () => {
    expect(UI.tagModelCapabilities("gpt-4o-vision").vision).toBe(true);
    expect(UI.tagModelCapabilities("claude-3-5-sonnet-200k").longContext).toBe(true);
    expect(UI.tagModelCapabilities("deepseek-coder-v2").code).toBe(true);
    expect(UI.tagModelCapabilities("llama-3.1-8b-instant").fast).toBe(true);
    expect(UI.tagModelCapabilities("meta/llama-3.1-70b-instruct").fast).toBe(false);
  });
});

describe("routeModel", () => {
  const models = [
    { id: "llama-3.1-8b-instant", providerId: "nvidia" },
    { id: "deepseek-coder-v2", providerId: "nvidia" },
    { id: "gpt-4o-vision", providerId: "openrouter" },
  ];
  it("routes vision tasks to vision models", () => {
    const r = UI.routeModel({ kind: "vision", models });
    expect(r!.modelId).toBe("gpt-4o-vision");
    expect(r!.usedFallback).toBe(false);
  });
  it("routes code tasks to coding models", () => {
    const r = UI.routeModel({ kind: "code", models });
    expect(r!.modelId).toBe("deepseek-coder-v2");
  });
  it("routes chat to fast models", () => {
    const r = UI.routeModel({ kind: "chat", models });
    expect(r!.modelId).toBe("llama-3.1-8b-instant");
  });
  it("falls back honestly when no tagged model matches", () => {
    const r = UI.routeModel({ kind: "vision", models: [{ id: "plain-model", providerId: "x" }] });
    expect(r!.modelId).toBe("plain-model");
    expect(r!.usedFallback).toBe(true);
    expect(r!.reason).toContain("no vision-tagged");
  });
  it("returns null for an empty model list — never invents ids", () => {
    expect(UI.routeModel({ kind: "chat", models: [] })).toBeNull();
    const r = UI.routeModel({ kind: "vision", models });
    expect(r).not.toBeNull();
    expect(r!.modelId).toBeTruthy();
  });
});

describe("usage log", () => {
  it("sanitizeUsageEntry keeps nulls for unreported tokens (never zero-fills)", () => {
    const e = UI.sanitizeUsageEntry({ provider: "nvidia", model: "m", ok: true });
    expect(e).not.toBeNull();
    expect(e!.inTok).toBeNull();
    expect(e!.outTok).toBeNull();
    expect(e!.ok).toBe(true);
  });
  it("usageAdd caps the log", () => {
    let log: any[] = [];
    for (let i = 0; i < 10; i++) log = UI.usageAdd(log, { provider: "p", model: "m", ts: i }, 5);
    expect(log.length).toBe(5);
    expect(log[4].ts).toBe(9);
  });
  it("usageRollup groups by day/model/provider and counts unreported", () => {
    const now = new Date(2026, 8, 29, 12, 0, 0).getTime();
    const log = [
      { ts: now - 3600000, provider: "nvidia", model: "m1", inTok: 100, outTok: 50, ok: true },
      { ts: now - 7200000, provider: "nvidia", model: "m1", ok: true }, // unreported
      { ts: now - DAY, provider: "openrouter", model: "m2", inTok: 10, outTok: 5, ok: false },
      { ts: now - 40 * DAY, provider: "nvidia", model: "m1", inTok: 1, outTok: 1, ok: true }, // outside 30d
    ];
    const r7 = UI.usageRollup(log, 7, now);
    expect(r7.requests).toBe(3);
    expect(r7.succeeded).toBe(2);
    expect(r7.failed).toBe(1);
    expect(r7.inTok).toBe(110);
    expect(r7.outTok).toBe(55);
    expect(r7.unreported).toBe(1);
    expect(r7.perModel["m1"]!.requests).toBe(2);
    expect(r7.perProvider["openrouter"]!.requests).toBe(1);
    expect(r7.perDay.length).toBe(2);
    const r1 = UI.usageRollup(log, 1, now);
    expect(r1.requests).toBe(2); // today only
    const r30 = UI.usageRollup(log, 30, now);
    expect(r30.requests).toBe(3);
  });
});

describe("cost control math", () => {
  it("validateRate accepts sane values, rejects junk", () => {
    expect(UI.validateRate("2.5")).toBe(2.5);
    expect(UI.validateRate(0)).toBe(0);
    expect(UI.validateRate("")).toBeNull();
    expect(UI.validateRate("-1")).toBeNull();
    expect(UI.validateRate("abc")).toBeNull();
    expect(UI.validateRate("1e9")).toBeNull();
  });
  it("estimateCost returns null when anything is missing — never guesses", () => {
    expect(UI.estimateCost(1000, 500, { in: 3, out: 15 })).toBeCloseTo(0.0105, 6);
    expect(UI.estimateCost(null, null, { in: 3, out: 15 })).toBeNull();
    expect(UI.estimateCost(1000, 500, null)).toBeNull();
    expect(UI.estimateCost(1000, 500, { in: 3, out: null })).toBeNull();
  });
  it("budgetStatus thresholds: warn at 80%, over at 100%", () => {
    expect(UI.budgetStatus(0, null)).toBe("unset");
    expect(UI.budgetStatus(5, 10)).toBe("ok");
    expect(UI.budgetStatus(7.99, 10)).toBe("ok");
    expect(UI.budgetStatus(8, 10)).toBe("warn");
    expect(UI.budgetStatus(9.5, 10)).toBe("warn");
    expect(UI.budgetStatus(10, 10)).toBe("over");
    expect(UI.budgetStatus(12, 10)).toBe("over");
  });
  it("sumEstimatedSpend skips entries without rates or tokens", () => {
    const entries = [
      { provider: "p", model: "m1", inTok: 1_000_000, outTok: 0, ok: true },
      { provider: "p", model: "m2", inTok: 100, outTok: 0, ok: true }, // no rate
      { provider: "p", model: "m1", ok: true }, // no tokens
      { provider: "p", model: "m1", inTok: 100, outTok: 0, ok: false }, // failed
    ];
    const s = UI.sumEstimatedSpend(entries, { m1: { in: 3, out: 15 } });
    expect(s.dollars).toBeCloseTo(3, 6);
    expect(s.costed).toBe(1);
    expect(s.skipped).toBe(2);
  });
  it("sanitizeBudget / sanitizeMaxTokens", () => {
    expect(UI.sanitizeBudget({ daily: "5", monthly: "" })).toEqual({ daily: 5, monthly: null });
    expect(UI.sanitizeBudget({ daily: "-2" })).toEqual({ daily: null, monthly: null });
    expect(UI.sanitizeMaxTokens("4096")).toBe(4096);
    expect(UI.sanitizeMaxTokens("5")).toBeNull();
    expect(UI.sanitizeMaxTokens("")).toBeNull();
  });
});
