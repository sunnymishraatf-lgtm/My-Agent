/**
 * Universal search + command palette (Phases 14+15).
 * Pure helpers in ui-utils.js + command/result dispatch in palette.js.
 * No DOM: palette.js is required in node — its top level touches no DOM.
 */
import { describe, it, expect } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";
import palette from "../src/web/app/palette.js";

const {
  PALETTE_GROUPS,
  PALETTE_COMMAND_DEFS,
  paletteBuildIndex,
  paletteScore,
  paletteSnippet,
  paletteSearch,
  paletteFilterCommands,
  paletteMoveSelection,
  looksLikeFileQuery,
} = uiUtils;

function sampleSources() {
  return {
    conversations: [
      { id: "c1", title: "OAuth implementation", updatedAt: 1000, archived: false, excerpt: "build google oauth for the app" },
      { id: "c2", title: "Old archived", updatedAt: 2000, archived: true, excerpt: "oauth stuff" },
      { id: "c3", title: "Shopping list", updatedAt: 3000, archived: false, excerpt: "buy milk and eggs" },
    ],
    projects: [
      { id: "p1", name: "Neutron Website", updatedAt: 500, memoryText: "Next.js marketing site" },
    ],
    rooms: [{ code: "NEUTRON-AB12", name: "Sprint planning" }],
    runs: [{ id: "r1", goal: "Add OAuth login flow", repo: "demo", status: "completed", createdAt: "2026-09-29T10:00:00Z" }],
    checkpoints: [{ id: "cp1", label: "Before OAuth", repo: "demo", createdAt: "2026-09-29T09:00:00Z" }],
    files: [{ repo: "demo", path: "src/auth/oauth.ts" }],
    githubRepos: [{ fullName: "octo/oauth-lib", description: "OAuth helpers", htmlUrl: "https://github.com/octo/oauth-lib" }],
  };
}

describe("paletteBuildIndex", () => {
  it("builds one entry per source item across all groups", () => {
    const entries = paletteBuildIndex(sampleSources());
    const groups = [...new Set(entries.map((e) => e.group))].sort();
    expect(groups).toEqual(["chats", "checkpoints", "files", "github", "projects", "rooms", "runs"]);
    expect(entries.filter((e) => e.group === "chats").length).toBe(2); // c2 archived is skipped
  });

  it("skips archived conversations", () => {
    const entries = paletteBuildIndex(sampleSources());
    expect(entries.some((e) => e.key.includes("c2"))).toBe(false);
  });

  it("lowercases the haystack and caps the body", () => {
    const entries = paletteBuildIndex({
      conversations: [{ id: "c9", title: "MiXeD", excerpt: "A".repeat(2000) }],
    });
    expect(entries[0]!.text).toBe("mixed " + "a".repeat(400));
    expect(entries[0]!.body.length).toBeLessThanOrEqual(400);
  });

  it("tolerates missing/empty sources", () => {
    expect(paletteBuildIndex(null as any)).toEqual([]);
    expect(paletteBuildIndex({})).toEqual([]);
  });
});

describe("paletteScore", () => {
  it("ranks exact > prefix > word-boundary > substring > body", () => {
    const q = "oauth";
    const exact = paletteScore("oauth", "oauth", q);
    const prefix = paletteScore("oauth flow", "x", q);
    const word = paletteScore("my oauth flow", "x", q);
    const sub = paletteScore("myoauth", "x", q);
    const body = paletteScore("unrelated", "mentions oauth here", q);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(body);
    expect(body).toBeGreaterThan(0);
  });

  it("returns 0 for no match and empty query", () => {
    expect(paletteScore("hello", "world", "zzz")).toBe(0);
    expect(paletteScore("hello", "world", "")).toBe(0);
    expect(paletteScore("hello", "world", null)).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(paletteScore("OAuth Flow", "", "oauth")).toBeGreaterThan(0);
  });
});

describe("paletteSnippet", () => {
  it("extracts a window around the match with ellipses", () => {
    const text = "lorem ipsum ".repeat(20) + "needle in a haystack " + "dolor sit ".repeat(20);
    const snip = paletteSnippet(text, "needle");
    expect(snip).toContain("needle");
    expect(snip.length).toBeLessThanOrEqual(95);
    expect(snip.startsWith("…")).toBe(true);
    expect(snip.endsWith("…")).toBe(true);
  });

  it("returns '' when there is no match", () => {
    expect(paletteSnippet("hello world", "zzz")).toBe("");
    expect(paletteSnippet("", "q")).toBe("");
  });
});

describe("paletteSearch", () => {
  it("groups results in PALETTE_GROUPS order", () => {
    const entries = paletteBuildIndex(sampleSources());
    const groups = paletteSearch(entries, "oauth");
    const ids = groups.map((g) => g.group.id);
    // every returned group id must appear in PALETTE_GROUPS, in order
    const order = PALETTE_GROUPS.map((g) => g.id);
    const positions = ids.map((id) => order.indexOf(id));
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(ids).toContain("chats");
  });

  it("caps items per group", () => {
    const convs = [];
    for (let i = 0; i < 20; i++) {
      convs.push({ id: "c" + i, title: "oauth " + i, excerpt: "oauth" });
    }
    const entries = paletteBuildIndex({ conversations: convs });
    const groups = paletteSearch(entries, "oauth", { perGroup: 3 });
    expect(groups[0]!.items.length).toBe(3);
  });

  it("ranks title matches above body matches", () => {
    const entries = paletteBuildIndex({
      conversations: [
        { id: "body-only", title: "Random chat", excerpt: "we discussed oauth tokens" },
        { id: "title-hit", title: "OAuth deep dive", excerpt: "unrelated text" },
      ],
    });
    const groups = paletteSearch(entries, "oauth");
    expect(groups[0]!.items[0]!.entry.ref.id).toBe("title-hit");
  });

  it("attaches snippets", () => {
    const entries = paletteBuildIndex(sampleSources());
    const groups = paletteSearch(entries, "milk");
    const chat = groups.find((g) => g.group.id === "chats");
    expect(chat!.items[0]!.snippet).toContain("milk");
  });

  it("returns [] for empty query", () => {
    expect(paletteSearch(paletteBuildIndex(sampleSources()), "  ")).toEqual([]);
  });
});

describe("paletteFilterCommands", () => {
  it("returns all defs for an empty query", () => {
    expect(paletteFilterCommands(PALETTE_COMMAND_DEFS, "").length).toBe(PALETTE_COMMAND_DEFS.length);
    expect(paletteFilterCommands(PALETTE_COMMAND_DEFS, ">").length).toBe(PALETTE_COMMAND_DEFS.length);
  });

  it("strips the > prefix and matches titles first", () => {
    const out = paletteFilterCommands(PALETTE_COMMAND_DEFS, ">room");
    expect(out[0]!.id).toMatch(/room/);
    expect(out.some((c) => c.id === "create-room")).toBe(true);
    expect(out.some((c) => c.id === "join-room")).toBe(true);
  });

  it("matches keywords", () => {
    const out = paletteFilterCommands(PALETTE_COMMAND_DEFS, "snapshot");
    expect(out.some((c) => c.id === "create-checkpoint")).toBe(true);
  });

  it("returns [] when nothing matches", () => {
    expect(paletteFilterCommands(PALETTE_COMMAND_DEFS, ">zzzznothing")).toEqual([]);
  });
});

describe("paletteMoveSelection", () => {
  it("clamps within bounds", () => {
    expect(paletteMoveSelection(0, -1, 5)).toBe(0);
    expect(paletteMoveSelection(4, 1, 5)).toBe(4);
    expect(paletteMoveSelection(-1, 1, 5)).toBe(0);
    expect(paletteMoveSelection(2, 1, 5)).toBe(3);
  });

  it("returns -1 for an empty list", () => {
    expect(paletteMoveSelection(-1, 1, 0)).toBe(-1);
  });
});

describe("looksLikeFileQuery", () => {
  it("detects filenames and paths", () => {
    expect(looksLikeFileQuery("app.tsx")).toBe(true);
    expect(looksLikeFileQuery("src/auth")).toBe(true);
    expect(looksLikeFileQuery(".gitignore")).toBe(true);
  });

  it("rejects plain words", () => {
    expect(looksLikeFileQuery("oauth")).toBe(false);
    expect(looksLikeFileQuery("")).toBe(false);
    expect(looksLikeFileQuery(null)).toBe(false);
  });
});

describe("command registry", () => {
  it("every command def has a real runner", () => {
    const ids = palette.paletteCommandIds();
    const defIds = PALETTE_COMMAND_DEFS.map((d) => d.id).sort();
    expect(ids.sort()).toEqual(defIds);
  });

  it("runPaletteCommand returns false for unknown ids", () => {
    expect(palette.runPaletteCommand("nope", {})).toBe(false);
  });

  it("dispatches navigation commands", () => {
    const calls: string[] = [];
    const ctx = { go: (h: string) => calls.push(h), app: {} };
    expect(palette.runPaletteCommand("open-terminal", ctx)).toBe(true);
    expect(palette.runPaletteCommand("run-tests", ctx)).toBe(true);
    expect(calls).toEqual(["#/terminal", "#/testlab"]);
  });

  it("dispatches bridge commands", () => {
    const calls: string[] = [];
    const ctx = { go: () => {}, app: { newChat: () => calls.push("newChat"), cycleTheme: () => calls.push("cycle") } };
    expect(palette.runPaletteCommand("new-chat", ctx)).toBe(true);
    expect(palette.runPaletteCommand("toggle-theme", ctx)).toBe(true);
    expect(calls).toEqual(["newChat", "cycle"]);
  });
});

describe("openPaletteResult", () => {
  function ctx() {
    const calls: { go: string[]; toast: string[]; copy: string[]; openUrl: string[]; session: Record<string, string> } =
      { go: [], toast: [], copy: [], openUrl: [], session: {} };
    return {
      calls,
      go: (h: string) => calls.go.push(h),
      toast: (m: string) => calls.toast.push(m),
      copy: (t: string) => { calls.copy.push(t); return Promise.resolve(true); },
      openUrl: (u: string) => calls.openUrl.push(u),
      setSession: (k: string, v: string) => { calls.session[k] = v; },
      announce: () => {},
      app: {},
    };
  }

  it("opens chats via deep link", () => {
    const c = ctx();
    expect(palette.openPaletteResult({ group: "chats", ref: { id: "c1" } }, c)).toBe(true);
    expect(c.calls.go).toEqual(["#/chat/c1"]);
  });

  it("opens projects and rooms via deep links", () => {
    const c = ctx();
    palette.openPaletteResult({ group: "projects", ref: { id: "p1" } }, c);
    palette.openPaletteResult({ group: "rooms", ref: { code: "NEUTRON-X1" } }, c);
    expect(c.calls.go).toEqual(["#/repos/project/p1", "#room=NEUTRON-X1"]);
  });

  it("stashes the run id and goes to the agent view", () => {
    const c = ctx();
    expect(palette.openPaletteResult({ group: "runs", ref: { id: "r1" } }, c)).toBe(true);
    expect(c.calls.session["neutron_pending_run"]).toBe("r1");
    expect(c.calls.go).toEqual(["#/agent"]);
  });

  it("copies file paths (no fake viewer)", async () => {
    const c = ctx();
    expect(palette.openPaletteResult({ group: "files", ref: { repo: "demo", path: "src/a.ts" } }, c)).toBe(true);
    expect(c.calls.copy).toEqual(["demo/src/a.ts"]);
    await Promise.resolve();
    expect(c.calls.toast.length).toBe(1);
  });

  it("opens GitHub repos in a new tab", () => {
    const c = ctx();
    expect(
      palette.openPaletteResult({ group: "github", ref: { htmlUrl: "https://github.com/octo/x" } }, c)
    ).toBe(true);
    expect(c.calls.openUrl).toEqual(["https://github.com/octo/x"]);
  });

  it("returns false for unknown groups and missing refs", () => {
    const c = ctx();
    expect(palette.openPaletteResult({ group: "nope", ref: {} }, c)).toBe(false);
    expect(palette.openPaletteResult({ group: "chats", ref: {} }, c)).toBe(false);
    expect(palette.openPaletteResult(null, c)).toBe(false);
  });
});
