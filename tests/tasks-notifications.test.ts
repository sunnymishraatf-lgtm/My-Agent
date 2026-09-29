/**
 * Tasks + notification center + activity timeline (Phases 16/27/28):
 * pure helpers in src/web/app/ui-utils.js. No DOM — only testable logic:
 * task CRUD/status transitions/timestamps/filters, notification bus
 * (emit/cap/read/prefs), timeline aggregation (merge/sort/group/empty).
 */
import { describe, it, expect } from "vitest";
import ui from "../src/web/app/ui-utils.js";

/* Fixed local noon — avoids midnight/DST boundary flakiness. */
const NOW = new Date(2026, 8, 29, 12, 0, 0).getTime();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function mkStore(items: Record<string, any> = {}): any {
  return { version: 1, items };
}

describe("task store", () => {
  it("creates tasks with sane defaults", () => {
    const s = mkStore();
    const t = ui.taskCreate(s, "t1", NOW);
    expect(t).toBeTruthy();
    expect(t!.status).toBe("todo");
    expect(t!.priority).toBe("medium");
    expect(t!.createdAt).toBe(NOW);
    expect(t!.completedAt).toBe(0);
    expect(ui.taskGet(s, "t1")).toBe(t);
  });

  it("refuses duplicate ids and missing stores", () => {
    const s = mkStore();
    ui.taskCreate(s, "t1", NOW);
    expect(ui.taskCreate(s, "t1", NOW)).toBeNull();
    expect(ui.taskCreate(null as any, "t2", NOW)).toBeNull();
    expect(ui.taskGet(s, "nope")).toBeNull();
  });

  it("updates fields, trims, and bumps updatedAt only on change", () => {
    const s = mkStore();
    ui.taskCreate(s, "t1", NOW);
    expect(ui.taskUpdate(s, "t1", { title: "  Fix  login  " }, NOW + 10)).toBe(true);
    expect(ui.taskGet(s, "t1")!.title).toBe("Fix login");
    expect(ui.taskGet(s, "t1")!.updatedAt).toBe(NOW + 10);
    // empty title keeps the old one
    expect(ui.taskUpdate(s, "t1", { title: "   " }, NOW + 20)).toBe(false);
    expect(ui.taskGet(s, "t1")!.title).toBe("Fix login");
    // no-op patch returns false and does not touch updatedAt
    expect(ui.taskUpdate(s, "t1", { title: "Fix login" }, NOW + 30)).toBe(false);
    expect(ui.taskGet(s, "t1")!.updatedAt).toBe(NOW + 10);
    // invalid priority is ignored
    expect(ui.taskUpdate(s, "t1", { priority: "urgent" }, NOW + 40)).toBe(false);
    expect(ui.taskGet(s, "t1")!.priority).toBe("medium");
    expect(ui.taskUpdate(s, "t1", { priority: "high", assignee: " Sunny " }, NOW + 50)).toBe(true);
    expect(ui.taskGet(s, "t1")!.priority).toBe("high");
    expect(ui.taskGet(s, "t1")!.assignee).toBe("Sunny");
  });

  it("tracks status transitions and completedAt honestly", () => {
    const s = mkStore();
    ui.taskCreate(s, "t1", NOW);
    expect(ui.taskSetStatus(s, "t1", "in_progress", NOW + 5)).toBe(true);
    expect(ui.taskGet(s, "t1")!.completedAt).toBe(0);
    expect(ui.taskSetStatus(s, "t1", "done", NOW + 100)).toBe(true);
    expect(ui.taskGet(s, "t1")!.completedAt).toBe(NOW + 100);
    // reopening clears completedAt
    expect(ui.taskSetStatus(s, "t1", "todo", NOW + 200)).toBe(true);
    expect(ui.taskGet(s, "t1")!.completedAt).toBe(0);
    expect(ui.taskGet(s, "t1")!.status).toBe("todo");
    // bad input
    expect(ui.taskSetStatus(s, "t1", "shipped", NOW)).toBe(false);
    expect(ui.taskSetStatus(s, "missing", "done", NOW)).toBe(false);
    // same status is a no-op success
    expect(ui.taskSetStatus(s, "t1", "todo", NOW)).toBe(true);
  });

  it("deletes tasks", () => {
    const s = mkStore();
    ui.taskCreate(s, "t1", NOW);
    expect(ui.taskDelete(s, "t1")).toBe(true);
    expect(ui.taskGet(s, "t1")).toBeNull();
    expect(ui.taskDelete(s, "t1")).toBe(false);
  });

  it("lists newest-first with status/project/text filters", () => {
    const s = mkStore();
    const a = ui.taskCreate(s, "a", NOW)!;
    ui.taskUpdate(s, "a", { title: "Fix login bug", projectId: "p1" }, NOW + 10);
    const b = ui.taskCreate(s, "b", NOW + 20)!;
    ui.taskUpdate(s, "b", { title: "Write docs", projectId: "p2" }, NOW + 30);
    ui.taskSetStatus(s, "b", "done", NOW + 40);
    void a; void b;
    expect(ui.taskList(s).map((t: any) => t.id)).toEqual(["b", "a"]);
    expect(ui.taskList(s, { status: "done" }).map((t: any) => t.id)).toEqual(["b"]);
    expect(ui.taskList(s, { projectId: "p1" }).map((t: any) => t.id)).toEqual(["a"]);
    expect(ui.taskList(s, { q: "LOGIN" }).map((t: any) => t.id)).toEqual(["a"]);
    expect(ui.taskList(s, { q: "nothing matches" })).toEqual([]);
    expect(ui.taskList(null).map((t: any) => t.id)).toEqual([]);
  });

  it("counts per status", () => {
    const s = mkStore();
    ui.taskCreate(s, "a", NOW);
    ui.taskCreate(s, "b", NOW);
    ui.taskSetStatus(s, "b", "done", NOW + 1);
    const c = ui.taskCounts(s);
    expect(c.todo).toBe(1);
    expect(c.done).toBe(1);
    expect(c.backlog).toBe(0);
  });

  it("sanitizes tasks and repairs bad status", () => {
    expect(ui.sanitizeTask(null)).toBeNull();
    expect(ui.sanitizeTask({})).toBeNull();
    const t = ui.sanitizeTask({ id: "x", status: "weird", priority: "weird" })!;
    expect(t.status).toBe("todo");
    expect(t.priority).toBe("medium");
    const d = ui.sanitizeTask({ id: "y", status: "done", updatedAt: 123 })!;
    expect(d.completedAt).toBe(123);
    const d2 = ui.sanitizeTask({ id: "z", status: "todo", completedAt: 999 })!;
    expect(d2.completedAt).toBe(0);
  });

  it("generates unique-ish ids", () => {
    const a = ui.newTaskId();
    const b = ui.newTaskId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(3);
  });
});

describe("notification bus", () => {
  it("adds newest-first and caps at NOTIF_CAP", () => {
    let list: any[] = [];
    for (let i = 0; i < ui.NOTIF_CAP + 10; i++) {
      list = ui.notifAdd(list, ui.newNotification("n" + i, "tasks", "t" + i, "", "", NOW + i));
    }
    expect(list.length).toBe(ui.NOTIF_CAP);
    expect(list[0].id).toBe("n" + (ui.NOTIF_CAP + 9));
  });

  it("tracks read state", () => {
    const list = [
      ui.newNotification("a", "agent", "A", "", "", NOW),
      ui.newNotification("b", "tests", "B", "", "", NOW),
    ];
    expect(ui.notifUnreadCount(list)).toBe(2);
    expect(ui.notifMarkRead(list, "a")).toBe(true);
    expect(ui.notifUnreadCount(list)).toBe(1);
    expect(ui.notifMarkRead(list, "missing")).toBe(false);
    ui.notifMarkAllRead(list);
    expect(ui.notifUnreadCount(list)).toBe(0);
    expect(ui.notifUnreadCount(null)).toBe(0);
  });

  it("falls back to system for unknown types and sanitizes", () => {
    const n = ui.newNotification("x", "bogus" as any, "T", "B", "#/x", NOW);
    expect(n.type).toBe("system");
    expect(ui.sanitizeNotification(null)).toBeNull();
    expect(ui.sanitizeNotification({ id: "y", type: "rooms" })!.read).toBe(false);
  });

  it("respects per-type preferences", () => {
    const prefs = ui.defaultNotifPrefs();
    expect(ui.notifShouldShow(prefs, "agent")).toBe(true);
    prefs.agent = false;
    expect(ui.notifShouldShow(prefs, "agent")).toBe(false);
    expect(ui.notifShouldShow(prefs, "tasks")).toBe(true);
    const s = ui.sanitizeNotifPrefs({ agent: false, bogus: false });
    expect(s.agent).toBe(false);
    expect(s.tasks).toBe(true);
    expect(ui.sanitizeNotifPrefs(null).rooms).toBe(true);
    expect(ui.notifShouldShow(null, "agent")).toBe(true);
  });
});

describe("activity timeline", () => {
  it("merges multiple sources newest-first and drops invalid entries", () => {
    const merged = ui.timelineMerge([
      [ui.timelineEvent("tasks", "a", "Old", "", NOW - DAY, "")],
      null,
      [
        ui.timelineEvent("git", "b", "New", "", NOW, ""),
        { source: "x", kind: "y", title: "bad", detail: "", ts: 0, link: "" },
        { source: "x", kind: "y", title: "bad2", detail: "", ts: NaN, link: "" },
      ],
    ]);
    expect(merged.map((e: any) => e.title)).toEqual(["New", "Old"]);
  });

  it("labels days correctly", () => {
    const noon = new Date(2026, 8, 29, 12, 0, 0).getTime();
    const startOf = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    expect(ui.timelineDayLabel(startOf(noon), noon)).toBe("Today");
    expect(ui.timelineDayLabel(startOf(noon) - DAY, noon)).toBe("Yesterday");
    expect(ui.timelineDayLabel(startOf(noon) - 5 * DAY, noon)).toBe("Sep 24");
  });

  it("groups events by calendar day, newest day first", () => {
    const noon = new Date(2026, 8, 29, 12, 0, 0).getTime();
    const evs = [
      ui.timelineEvent("tasks", "a", "Today 1", "", noon - HOUR, ""),
      ui.timelineEvent("git", "b", "Yesterday 1", "", noon - DAY - HOUR, ""),
      ui.timelineEvent("tasks", "c", "Today 2", "", noon - 2 * HOUR, ""),
    ];
    const groups = ui.timelineGroupByDay(evs, noon);
    expect(groups.length).toBe(2);
    expect(groups[0]!.label).toBe("Today");
    expect(groups[0]!.events.map((e: any) => e.title)).toEqual(["Today 1", "Today 2"]);
    expect(groups[1]!.label).toBe("Yesterday");
    expect(ui.timelineGroupByDay([], noon)).toEqual([]);
  });
});
