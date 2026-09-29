/**
 * History workspace tests: pure conversation-store helpers in
 * src/web/app/ui-utils.js. No DOM — only the testable logic:
 * create/rename/pin/archive/delete/duplicate, grouping buckets, search,
 * migration from single-chat storage, quota-safe attachment handling.
 */
import { describe, it, expect } from "vitest";
import ui from "../src/web/app/ui-utils.js";

/* Fixed local noon — avoids midnight/DST boundary flakiness. */
const NOW = new Date(2026, 8, 29, 12, 0, 0).getTime();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function mkConv(id: string, overrides: Record<string, unknown> = {}): any {
  return {
    id,
    title: "",
    renamed: false,
    createdAt: NOW,
    updatedAt: NOW,
    pinned: false,
    archived: false,
    provider: "",
    model: "",
    messages: [],
    ...overrides,
  };
}

function mkStore(items: any[], activeId: string | null = null): any {
  const store: any = { version: 1, activeId, items: {} };
  for (const it of items) store.items[it.id] = it;
  return store;
}

describe("newConversation", () => {
  it("creates a blank conversation with sane defaults", () => {
    const c: any = ui.newConversation("c1", NOW);
    expect(c.id).toBe("c1");
    expect(c.title).toBe("");
    expect(c.renamed).toBe(false);
    expect(c.createdAt).toBe(NOW);
    expect(c.updatedAt).toBe(NOW);
    expect(c.pinned).toBe(false);
    expect(c.archived).toBe(false);
    expect(c.provider).toBe("");
    expect(c.model).toBe("");
    expect(c.messages).toEqual([]);
  });
});

describe("autoTitle", () => {
  it("strips markdown from the first message", () => {
    expect(ui.autoTitle("Build **OAuth** for my `React` app", null)).toBe(
      "Build OAuth for my React app"
    );
  });
  it("drops code blocks and headings", () => {
    expect(ui.autoTitle("# Fix bug\n```js\nconst x = 1;\n```\nnow please", null)).toBe(
      "Fix bug now please"
    );
  });
  it("truncates long titles at a word boundary", () => {
    const t: string = ui.autoTitle(
      "Please build a complete google oauth authentication flow for my react application",
      null
    );
    expect(t.length).toBeLessThanOrEqual(43);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toContain("  ");
  });
  it("falls back to attachment names for textless first messages", () => {
    expect(ui.autoTitle("", [{ name: "report.pdf" }, { name: "data.csv" }])).toBe(
      "Files: report.pdf, data.csv"
    );
  });
  it("returns empty string (never Untitled/New Chat) when there is nothing to use", () => {
    expect(ui.autoTitle("", null)).toBe("");
    expect(ui.autoTitle("   ", [])).toBe("");
  });
  it("collapses whitespace", () => {
    expect(ui.autoTitle("  fix   the\n\nlogin   bug  ", null)).toBe("fix the login bug");
  });
});

describe("convDisplayTitle", () => {
  it("shows a New task placeholder for untitled conversations", () => {
    expect(ui.convDisplayTitle(mkConv("a"))).toBe("New task");
    expect(ui.convDisplayTitle(mkConv("a", { title: "   " }))).toBe("New task");
    expect(ui.convDisplayTitle(null)).toBe("New task");
  });
  it("shows the stored title otherwise", () => {
    expect(ui.convDisplayTitle(mkConv("a", { title: "OAuth work" }))).toBe("OAuth work");
  });
});

describe("relativeTime", () => {
  it("formats recent times", () => {
    expect(ui.relativeTime(NOW - 30 * 1000, NOW)).toBe("just now");
    expect(ui.relativeTime(NOW - 5 * 60 * 1000, NOW)).toBe("5 min ago");
    expect(ui.relativeTime(NOW - 3 * HOUR, NOW)).toBe("3 hr ago");
  });
  it("formats days", () => {
    expect(ui.relativeTime(NOW - 26 * HOUR, NOW)).toBe("Yesterday");
    expect(ui.relativeTime(NOW - 3 * DAY, NOW)).toBe("3 days ago");
  });
  it("falls back to a date for old timestamps", () => {
    expect(ui.relativeTime(NOW - 40 * DAY, NOW)).toBe("Aug 20");
  });
  it("returns empty string for invalid input", () => {
    expect(ui.relativeTime(NaN, NOW)).toBe("");
  });
});

describe("convDayBucket", () => {
  it("buckets by local calendar day", () => {
    expect(ui.convDayBucket(NOW - HOUR, NOW)).toBe("today");
    expect(ui.convDayBucket(NOW - DAY, NOW)).toBe("yesterday");
    expect(ui.convDayBucket(NOW - 3 * DAY, NOW)).toBe("week");
    expect(ui.convDayBucket(NOW - 10 * DAY, NOW)).toBe("month");
    expect(ui.convDayBucket(NOW - 40 * DAY, NOW)).toBe("older");
  });
});

describe("groupConversations", () => {
  function groupedStore(): any {
    return mkStore([
      mkConv("pinned1", { title: "Pinned A", pinned: true, updatedAt: NOW - HOUR }),
      mkConv("pinned2", { title: "Pinned B", pinned: true, updatedAt: NOW - 2 * HOUR }),
      mkConv("t1", { title: "Today 1", updatedAt: NOW - 3 * HOUR }),
      mkConv("t2", { title: "Today 2", updatedAt: NOW - HOUR }),
      mkConv("y1", { title: "Yesterday", updatedAt: NOW - DAY }),
      mkConv("w1", { title: "Week", updatedAt: NOW - 3 * DAY }),
      mkConv("m1", { title: "Month", updatedAt: NOW - 10 * DAY }),
      mkConv("o1", { title: "Older", updatedAt: NOW - 40 * DAY }),
      mkConv("arch", { title: "Archived", archived: true, updatedAt: NOW - HOUR }),
    ]);
  }
  it("puts pinned first, sorted by recency", () => {
    const g: any = ui.groupConversations(groupedStore().items, NOW);
    expect(g.pinned.map((m: any) => m.id)).toEqual(["pinned1", "pinned2"]);
  });
  it("groups the rest by day bucket, each sorted by recency", () => {
    const g: any = ui.groupConversations(groupedStore().items, NOW);
    expect(g.groups.map((gr: any) => gr.id)).toEqual(["today", "yesterday", "week", "month", "older"]);
    const today = g.groups[0];
    expect(today.label).toBe("Today");
    expect(today.items.map((m: any) => m.id)).toEqual(["t2", "t1"]);
    expect(g.groups[1].items.map((m: any) => m.id)).toEqual(["y1"]);
  });
  it("excludes archived conversations and omits empty groups", () => {
    const g: any = ui.groupConversations(groupedStore().items, NOW);
    const all: string[] = g.groups.flatMap((gr: any) => gr.items.map((m: any) => m.id));
    expect(all).not.toContain("arch");
    expect(g.groups.every((gr: any) => gr.items.length > 0)).toBe(true);
  });
  it("handles an empty store", () => {
    const g: any = ui.groupConversations({}, NOW);
    expect(g.pinned).toEqual([]);
    expect(g.groups).toEqual([]);
  });
});

describe("archivedConversations", () => {
  it("returns only archived items, most recent first", () => {
    const store = mkStore([
      mkConv("a1", { archived: true, updatedAt: NOW - 2 * HOUR }),
      mkConv("a2", { archived: true, updatedAt: NOW - HOUR }),
      mkConv("live", { updatedAt: NOW }),
    ]);
    const out: any[] = ui.archivedConversations(store.items);
    expect(out.map((m) => m.id)).toEqual(["a2", "a1"]);
  });
});

describe("searchConversations", () => {
  function searchStore(): any {
    return mkStore([
      mkConv("s1", {
        title: "OAuth implementation",
        updatedAt: NOW - HOUR,
        messages: [{ role: "user", text: "hello" }],
      }),
      mkConv("s2", {
        title: "Portfolio",
        updatedAt: NOW - 2 * HOUR,
        messages: [{ role: "assistant", text: "the OAUTH token expired" }],
      }),
      mkConv("s3", {
        title: "OAuth debugging",
        archived: true,
        updatedAt: NOW - 30 * 60 * 1000,
        messages: [],
      }),
    ]);
  }
  it("matches titles case-insensitively, most recent first", () => {
    const out: any[] = ui.searchConversations(searchStore().items, "oauth");
    expect(out.map((m) => m.id)).toEqual(["s1", "s2"]);
  });
  it("matches message text", () => {
    const out: any[] = ui.searchConversations(searchStore().items, "token expired");
    expect(out.map((m) => m.id)).toEqual(["s2"]);
  });
  it("excludes archived conversations", () => {
    const out: any[] = ui.searchConversations(searchStore().items, "debugging");
    expect(out).toEqual([]);
  });
  it("returns [] for empty queries", () => {
    expect(ui.searchConversations(searchStore().items, "")).toEqual([]);
    expect(ui.searchConversations(searchStore().items, "   ")).toEqual([]);
  });
});

describe("sanitizeConversation", () => {
  it("returns null for invalid input", () => {
    expect(ui.sanitizeConversation(null)).toBe(null);
    expect(ui.sanitizeConversation("x")).toBe(null);
  });
  it("caps messages at 200 and text at 20000 chars", () => {
    const msgs = [];
    for (let i = 0; i < 250; i++) msgs.push({ role: "user", text: "x".repeat(25000), ts: NOW });
    const out: any = ui.sanitizeConversation(mkConv("c", { messages: msgs }));
    expect(out.messages.length).toBe(200);
    expect(out.messages[0].text.length).toBe(20000);
  });
  it("keeps data only for small text attachments (10KB total budget)", () => {
    const small = "x".repeat(100);
    const big1 = "y".repeat(8192);
    const big2 = "z".repeat(8192);
    const out: any = ui.sanitizeConversation(
      mkConv("c", {
        messages: [
          {
            role: "user",
            text: "",
            attachments: [
              { name: "a.txt", mime: "text/plain", kind: "text", size: 100, data: small },
              { name: "b.txt", mime: "text/plain", kind: "text", size: 8192, data: big1 },
              { name: "c.txt", mime: "text/plain", kind: "text", size: 8192, data: big2 },
              { name: "img.png", mime: "image/png", kind: "image", size: 5000, data: "IMAGEDATA" },
            ],
          },
        ],
      })
    );
    const atts = out.messages[0].attachments;
    expect(atts[0].data).toBe(small);
    expect(atts[0].unavailable).toBe(undefined);
    expect(atts[1].data).toBe(big1);
    /* 100 + 8192 = 8292 used; the next 8192 would exceed 10240. */
    expect(atts[2].data).toBe(undefined);
    expect(atts[2].unavailable).toBe(true);
    /* Images never keep bytes — honest unavailable flag. */
    expect(atts[3].data).toBe(undefined);
    expect(atts[3].unavailable).toBe(true);
    expect(atts[3].kind).toBe("image");
    expect(atts[3].mime).toBe("image/png");
  });
  it("converts legacy files[] to unavailable attachments", () => {
    const out: any = ui.sanitizeConversation(
      mkConv("c", {
        messages: [{ role: "user", text: "", files: [{ name: "old.png", size: 42 }] }],
      })
    );
    const atts = out.messages[0].attachments;
    expect(atts.length).toBe(1);
    expect(atts[0].name).toBe("old.png");
    expect(atts[0].size).toBe(42);
    expect(atts[0].unavailable).toBe(true);
    expect(out.messages[0].files).toBe(undefined);
  });
  it("caps artifacts at 10 items / 100KB content", () => {
    const arts = [];
    for (let i = 0; i < 12; i++) arts.push({ path: "f" + i, content: "c".repeat(120000) });
    const out: any = ui.sanitizeConversation(
      mkConv("c", { messages: [{ role: "assistant", text: "done", artifacts: arts }] })
    );
    expect(out.messages[0].artifacts.length).toBe(10);
    expect(out.messages[0].artifacts[0].content.length).toBe(100000);
  });
  it("preserves failed/local flags and roles", () => {
    const out: any = ui.sanitizeConversation(
      mkConv("c", {
        messages: [
          { role: "assistant", text: "Error: x", failed: true, ts: NOW },
          { role: "assistant", text: "hint", local: true, ts: NOW },
        ],
      })
    );
    expect(out.messages[0].failed).toBe(true);
    expect(out.messages[1].local).toBe(true);
  });
});

describe("migrateLegacyChat", () => {
  it("wraps legacy messages as the first conversation", () => {
    const store: any = ui.migrateLegacyChat(
      [
        { role: "user", text: "Build **OAuth** now", ts: NOW - 60000 },
        { role: "assistant", text: "ok", ts: NOW - 30000 },
      ],
      "nvidia",
      "m1",
      NOW,
      "c1"
    );
    expect(store.version).toBe(1);
    expect(store.activeId).toBe("c1");
    const item = store.items.c1;
    expect(item.title).toBe("Build OAuth now");
    expect(item.provider).toBe("nvidia");
    expect(item.model).toBe("m1");
    expect(item.createdAt).toBe(NOW - 60000);
    expect(item.updatedAt).toBe(NOW - 30000);
    expect(item.messages.length).toBe(2);
  });
  it("skips local-only hints when generating the title", () => {
    const store: any = ui.migrateLegacyChat(
      [
        { role: "user", text: "Please select a provider", ts: NOW - 1000, local: true },
        { role: "user", text: "real **task** here", ts: NOW },
      ],
      "",
      "",
      NOW,
      "c1"
    );
    expect(store.items.c1.title).toBe("real task here");
  });
  it("handles an empty legacy history without losing it", () => {
    const store: any = ui.migrateLegacyChat([], "", "", NOW, "c1");
    expect(store.items.c1.messages).toEqual([]);
    expect(store.items.c1.title).toBe("");
    expect(store.activeId).toBe("c1");
  });
});

describe("conversation CRUD", () => {
  it("convCreate adds and activates; duplicate ids fail", () => {
    const store = mkStore([]);
    const c: any = ui.convCreate(store, "n1", NOW);
    expect(c).not.toBe(null);
    expect(store.activeId).toBe("n1");
    expect(ui.convCreate(store, "n1", NOW)).toBe(null);
  });
  it("convRename trims, collapses whitespace, rejects empty, locks title", () => {
    const store = mkStore([mkConv("r1")]);
    expect(ui.convRename(store, "r1", "  My   Task  ", NOW + 1000)).toBe(true);
    expect(store.items.r1.title).toBe("My Task");
    expect(store.items.r1.renamed).toBe(true);
    expect(store.items.r1.updatedAt).toBe(NOW + 1000);
    expect(ui.convRename(store, "r1", "   ", NOW)).toBe(false);
    expect(ui.convRename(store, "missing", "x", NOW)).toBe(false);
    expect(store.items.r1.title).toBe("My Task");
  });
  it("convSetPinned toggles the flag", () => {
    const store = mkStore([mkConv("p1")]);
    expect(ui.convSetPinned(store, "p1", true)).toBe(true);
    expect(store.items.p1.pinned).toBe(true);
    expect(ui.convSetPinned(store, "missing", true)).toBe(false);
  });
  it("convSetArchived hides and moves activeId to the most recent live task", () => {
    const store = mkStore(
      [
        mkConv("a1", { updatedAt: NOW - 2 * HOUR }),
        mkConv("a2", { updatedAt: NOW - HOUR }),
      ],
      "a1"
    );
    expect(ui.convSetArchived(store, "a1", true, NOW)).toBe(true);
    expect(store.items.a1.archived).toBe(true);
    expect(store.activeId).toBe("a2");
  });
  it("convDelete removes and falls back activeId; missing fails", () => {
    const store = mkStore(
      [
        mkConv("d1", { updatedAt: NOW - 2 * HOUR }),
        mkConv("d2", { updatedAt: NOW - HOUR }),
      ],
      "d1"
    );
    expect(ui.convDelete(store, "d1")).toBe(true);
    expect(store.items.d1).toBe(undefined);
    expect(store.activeId).toBe("d2");
    expect(ui.convDelete(store, "nope")).toBe(false);
  });
  it("convDelete of the last task leaves activeId null", () => {
    const store = mkStore([mkConv("only")], "only");
    expect(ui.convDelete(store, "only")).toBe(true);
    expect(store.activeId).toBe(null);
  });
  it("convDuplicate copies deeply with a new id and Copy title", () => {
    const store = mkStore([
      mkConv("src", {
        title: "OAuth work",
        pinned: true,
        messages: [{ role: "user", text: "hi" }],
      }),
    ]);
    const copy: any = ui.convDuplicate(store, "src", "copy1", NOW + 5000);
    expect(copy).not.toBe(null);
    expect(copy.id).toBe("copy1");
    expect(copy.title).toBe("OAuth work — Copy");
    expect(copy.pinned).toBe(false);
    expect(copy.archived).toBe(false);
    expect(copy.createdAt).toBe(NOW + 5000);
    /* Deep copy: mutating the copy must not touch the original. */
    copy.messages.push({ role: "user", text: "extra" });
    expect(store.items.src.messages.length).toBe(1);
    expect(store.items.src.pinned).toBe(true);
  });
  it("convDuplicate of an untitled task still gets a sane title", () => {
    const store = mkStore([mkConv("src")]);
    const copy: any = ui.convDuplicate(store, "src", "copy1", NOW);
    expect(copy.title).toBe("New task — Copy");
  });
  it("convDuplicate fails for missing source or colliding id", () => {
    const store = mkStore([mkConv("src")]);
    expect(ui.convDuplicate(store, "missing", "n", NOW)).toBe(null);
    expect(ui.convDuplicate(store, "src", "src", NOW)).toBe(null);
  });
  it("convTouch bumps updatedAt and auto-titles once", () => {
    const store = mkStore([mkConv("t1")]);
    expect(ui.convTouch(store, "t1", NOW + 1000, "Build **oauth** please", null)).toBe(true);
    expect(store.items.t1.updatedAt).toBe(NOW + 1000);
    expect(store.items.t1.title).toBe("Build oauth please");
    /* Second touch does not overwrite the title. */
    expect(ui.convTouch(store, "t1", NOW + 2000, "something else", null)).toBe(true);
    expect(store.items.t1.title).toBe("Build oauth please");
  });
  it("convTouch never overwrites a manual rename", () => {
    const store = mkStore([mkConv("t1")]);
    ui.convRename(store, "t1", "My name", NOW);
    ui.convTouch(store, "t1", NOW + 1000, "different text", null);
    expect(store.items.t1.title).toBe("My name");
  });
  it("convTouch without text just bumps the timestamp", () => {
    const store = mkStore([mkConv("t1", { title: "Kept" })]);
    expect(ui.convTouch(store, "t1", NOW + 1000)).toBe(true);
    expect(store.items.t1.title).toBe("Kept");
    expect(store.items.t1.updatedAt).toBe(NOW + 1000);
  });
});

describe("mostRecentConvId", () => {
  it("skips archived and excluded conversations", () => {
    const store = mkStore([
      mkConv("m1", { updatedAt: NOW - 3 * HOUR }),
      mkConv("m2", { updatedAt: NOW - HOUR }),
      mkConv("m3", { updatedAt: NOW, archived: true }),
    ]);
    expect(ui.mostRecentConvId(store, null)).toBe("m2");
    expect(ui.mostRecentConvId(store, "m2")).toBe("m1");
    expect(ui.mostRecentConvId(store, "m1")).toBe("m2");
  });
  it("returns null when nothing qualifies", () => {
    expect(ui.mostRecentConvId(mkStore([]), null)).toBe(null);
    expect(ui.mostRecentConvId(null, null)).toBe(null);
  });
});
