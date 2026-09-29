/**
 * Onboarding + personal dashboard tests (Phases 36+37): pure helpers in
 * src/web/app/ui-utils.js. No DOM — state machine, greeting logic,
 * dashboard aggregation, name sanitization, project-type templates.
 */
import { describe, it, expect } from "vitest";
import ui from "../src/web/app/ui-utils.js";

const H = (h: number) => new Date(2026, 8, 29, h, 30, 0).getTime();

describe("sanitizeDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(ui.sanitizeDisplayName("  Sunny   Mishra  ")).toBe("Sunny Mishra");
  });
  it("strips control chars and newlines", () => {
    expect(ui.sanitizeDisplayName("A\tB\nC\x00D\x7f")).toBe("ABCD");
    expect(ui.sanitizeDisplayName("A\tB\nC")).toBe("ABC"); // control chars stripped, not spaced
  });
  it("caps at DISPLAY_NAME_MAX", () => {
    const long = "x".repeat(100);
    expect(ui.sanitizeDisplayName(long).length).toBe(ui.DISPLAY_NAME_MAX);
  });
  it("handles null/undefined/empty", () => {
    expect(ui.sanitizeDisplayName(null)).toBe("");
    expect(ui.sanitizeDisplayName(undefined)).toBe("");
    expect(ui.sanitizeDisplayName("   ")).toBe("");
  });
  it("keeps unicode names", () => {
    expect(ui.sanitizeDisplayName("  José García  ")).toBe("José García");
  });
});

describe("onboarding state machine", () => {
  it("initial state is step 0, not done", () => {
    const st = ui.onboardingInitial();
    expect(st).toMatchObject({ done: false, step: 0, name: "", projectType: "" });
  });
  it("next/back move within bounds", () => {
    let st = ui.onboardingInitial();
    st = ui.onboardingNext(st);
    expect(st.step).toBe(1);
    st = ui.onboardingNext(st);
    expect(st.step).toBe(2);
    st = ui.onboardingNext(st); // clamped at last step
    expect(st.step).toBe(2);
    st = ui.onboardingBack(st);
    expect(st.step).toBe(1);
    st = ui.onboardingBack(ui.onboardingInitial());
    expect(st.step).toBe(0);
  });
  it("skip and finish mark done", () => {
    expect(ui.onboardingSkip(ui.onboardingInitial()).done).toBe(true);
    const mid = ui.onboardingNext(ui.onboardingInitial());
    expect(ui.onboardingFinish(mid).done).toBe(true);
    expect(ui.onboardingFinish(mid).step).toBe(1); // step preserved
  });
  it("replay resets to step 0 but keeps the name", () => {
    const done = { ...ui.onboardingInitial(), done: true, step: 2, name: "Sunny" };
    const r = ui.onboardingReplay(done);
    expect(r.done).toBe(false);
    expect(r.step).toBe(0);
    expect(r.name).toBe("Sunny");
  });
  it("sanitizeOnboarding repairs garbage", () => {
    expect(ui.sanitizeOnboarding(null)).toMatchObject({ done: false, step: 0 });
    expect(ui.sanitizeOnboarding({ step: 99, done: "yes", name: "  A  ", projectType: "nope" }))
      .toMatchObject({ step: 0, done: false, name: "A", projectType: "" });
    const ok = ui.sanitizeOnboarding({ step: 1, done: false, name: "Bo", projectType: "api" });
    expect(ok).toMatchObject({ step: 1, projectType: "api", name: "Bo" });
  });
});

describe("greeting logic", () => {
  it("honors time boundaries", () => {
    expect(ui.greetingForHour(4)).toBe("Good evening");
    expect(ui.greetingForHour(5)).toBe("Good morning");
    expect(ui.greetingForHour(11)).toBe("Good morning");
    expect(ui.greetingForHour(12)).toBe("Good afternoon");
    expect(ui.greetingForHour(16)).toBe("Good afternoon");
    expect(ui.greetingForHour(17)).toBe("Good evening");
    expect(ui.greetingForHour(23)).toBe("Good evening");
    expect(ui.greetingForHour(0)).toBe("Good evening");
  });
  it("dashboardGreeting includes sanitized name when present", () => {
    expect(ui.dashboardGreeting(" Sunny ", H(20))).toBe("Good evening, Sunny");
    expect(ui.dashboardGreeting("", H(9))).toBe("Good morning");
    expect(ui.dashboardGreeting(null, H(14))).toBe("Good afternoon");
  });
});

describe("dashboard aggregation", () => {
  const items = [
    { id: "a", updatedAt: 100 },
    { id: "b", updatedAt: 300 },
    { id: "c", updatedAt: 200 },
  ];
  it("latestItems sorts desc and caps", () => {
    expect(ui.latestItems(items, "updatedAt", 2).map((x: any) => x.id)).toEqual(["b", "c"]);
    expect(ui.latestItems(items, "updatedAt", 10).length).toBe(3);
  });
  it("latestItems accepts id→item maps", () => {
    const map = { a: items[0], b: items[1] };
    expect(ui.latestItems(map, "updatedAt", 1)[0].id).toBe("b");
  });
  it("latestItems tolerates junk", () => {
    expect(ui.latestItems(null, "updatedAt", 5)).toEqual([]);
    expect(ui.latestItems([{ id: "x" }], "updatedAt", 5).length).toBe(1);
  });
  it("countOpenTasks excludes done", () => {
    const tasks = [
      { id: "1", status: "todo" },
      { id: "2", status: "done" },
      { id: "3", status: "in_progress" },
    ];
    expect(ui.countOpenTasks(tasks)).toBe(2);
    expect(ui.countOpenTasks({ a: tasks[0], b: tasks[1] })).toBe(1);
    expect(ui.countOpenTasks([])).toBe(0);
  });
  it("countUnreadNotifs counts unread", () => {
    const ns = [{ read: false }, { read: true }, { read: false }, {}];
    expect(ui.countUnreadNotifs(ns)).toBe(3);
    expect(ui.countUnreadNotifs(null)).toBe(0);
  });
});

describe("project type templates", () => {
  it("lists five types with labels and hints", () => {
    const list = ui.projectTypeList();
    expect(list.map((t: any) => t.id)).toEqual(["website", "mobile", "api", "ai", "other"]);
    list.forEach((t: any) => {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.hint.length).toBeGreaterThan(0);
    });
  });
  it("returns a starter template using real memory sections", () => {
    const tpl = ui.projectTypeTemplate("api") as any;
    expect(tpl).not.toBeNull();
    expect(tpl.architecture.length).toBeGreaterThan(0);
    expect(Array.isArray(tpl.conventions)).toBe(true);
    // deep copy: mutating the result must not affect the next call
    tpl.conventions.push("HACK");
    expect((ui.projectTypeTemplate("api") as any).conventions).not.toContain("HACK");
  });
  it("returns null for unknown type ids", () => {
    expect(ui.projectTypeTemplate("nope")).toBeNull();
    expect(ui.projectTypeTemplate("")).toBeNull();
  });
});
