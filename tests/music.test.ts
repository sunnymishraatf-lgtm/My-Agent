import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadMusic() {
  const src = readFileSync(join(root, "src", "web", "app", "music.js"), "utf8");
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  // music.js attaches to `window` when present, else `this`.
  sandbox.window = {};
  vm.runInContext(src, sandbox, { filename: "music.js" });
  const M = (sandbox.window as Record<string, unknown>).NeutronMusic as {
    parseVideoId: (s: string) => string | null;
    STATIONS: { id: string; title: string; sub: string }[];
    renderSection: (view: unknown) => void;
  };
  expect(M, "window.NeutronMusic should be exported").toBeTruthy();
  return M;
}

describe("music section", () => {
  it("parses video IDs from raw IDs and common URL forms", () => {
    const M = loadMusic();
    expect(M.parseVideoId("jfKfPfyJRdk")).toBe("jfKfPfyJRdk");
    expect(M.parseVideoId("https://www.youtube.com/watch?v=jfKfPfyJRdk&t=10s")).toBe("jfKfPfyJRdk");
    expect(M.parseVideoId("https://youtu.be/jfKfPfyJRdk")).toBe("jfKfPfyJRdk");
    expect(M.parseVideoId("https://www.youtube.com/shorts/jfKfPfyJRdk")).toBe("jfKfPfyJRdk");
    expect(M.parseVideoId("https://www.youtube.com/embed/jfKfPfyJRdk")).toBe("jfKfPfyJRdk");
    expect(M.parseVideoId("https://www.youtube.com/live/jfKfPfyJRdk")).toBe("jfKfPfyJRdk");
    expect(M.parseVideoId("hello world")).toBeNull();
    expect(M.parseVideoId("")).toBeNull();
    expect(M.parseVideoId("short")).toBeNull();
  });

  it("ships a non-empty station catalog with valid YouTube IDs", () => {
    const M = loadMusic();
    expect(M.STATIONS.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const st of M.STATIONS) {
      expect(st.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(st.title.trim().length).toBeGreaterThan(0);
      expect(seen.has(st.id)).toBe(false);
      seen.add(st.id);
    }
  });

  it("exposes a renderSection function for the app route", () => {
    const M = loadMusic();
    expect(typeof M.renderSection).toBe("function");
  });
});

describe("music server-first search", () => {
  function loadMusicWithFetch(
    fetchImpl: (url: string, opts?: unknown) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
  ) {
    const src = readFileSync(join(root, "src", "web", "app", "music.js"), "utf8");
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    sandbox.window = {};
    sandbox.fetch = fetchImpl;
    // music.js uses timers in fetchTimeout; the vm context has none.
    sandbox.setTimeout = setTimeout;
    sandbox.clearTimeout = clearTimeout;
    vm.runInContext(src, sandbox, { filename: "music.js" });
    return (sandbox.window as Record<string, unknown>).NeutronMusic as {
      searchMusic: (q: string, cb: (err: Error | null, items: { id: string; title: string; artist?: string }[]) => void) => void;
    };
  }

  function search(M: { searchMusic: (q: string, cb: (e: Error | null, i: unknown[]) => void) => void }, q: string) {
    return new Promise<{ err: Error | null; items: unknown[] }>((resolve) => {
      M.searchMusic(q, (err, items) => resolve({ err, items }));
    });
  }

  const okJson = (data: unknown) => ({ ok: true, json: async () => data });

  it("queries the app backend first and keeps artists", async () => {
    const calls: { url: string; opts?: unknown }[] = [];
    const M = loadMusicWithFetch(async (url: string, opts?: unknown) => {
      calls.push({ url: String(url), opts });
      return okJson({ ok: true, results: [{ id: "rFZHOHl-L8A", title: "lofi radio", artist: "Lofi Girl" }] });
    });
    const { err, items } = await search(M, "lofi");
    expect(err).toBeNull();
    expect(items).toEqual([{ id: "rFZHOHl-L8A", title: "lofi radio", artist: "Lofi Girl" }]);
    expect(calls.length).toBe(1);
    const call = calls[0] as { url: string; opts?: unknown };
    expect(call.url).toMatch(/\/api\/chat$/);
    expect(JSON.stringify(call.opts)).toContain("music-search");
  });

  it("falls back to public instances when the backend is unreachable", async () => {
    const calls: string[] = [];
    const M = loadMusicWithFetch(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/chat")) throw new Error("backend down");
      return okJson({ items: [{ url: "/watch?v=sF80I-TQiW0", title: "chill lofi" }] });
    });
    const { err, items } = await search(M, "lofi");
    expect(err).toBeNull();
    expect(items).toEqual([{ id: "sF80I-TQiW0", title: "chill lofi" }]);
    expect(calls[0]).toMatch(/\/api\/chat$/);
    expect(calls[1]).toContain("piped");
  });

  it("reports an honest error when every search path fails", async () => {
    const M = loadMusicWithFetch(async () => {
      throw new Error("all down");
    });
    const { err, items } = await search(M, "lofi");
    // NOTE: err is created inside the vm realm, so assert on its message,
    // not instanceof.
    expect(err && (err as Error).message).toMatch(/unreachable/);
    expect(items).toEqual([]);
  });
});

describe("music history + playlists (device-local)", () => {
  type Hist = { id: string; title: string; ts: number };
  type Store = {
    readHistory: () => Hist[];
    saveHistory: (l: Hist[]) => void;
    pushHistory: (l: Hist[], item: Hist) => Hist[];
    readPlaylists: () => Record<string, Hist[]>;
    savePlaylists: (p: Record<string, Hist[]>) => void;
    addToPlaylist: (name: string, id: string, title: string) => void;
    removeFromPlaylist: (name: string, id: string) => void;
    deletePlaylist: (name: string) => void;
    HISTORY_CAP: number;
  };

  function loadWithStorage() {
    const src = readFileSync(join(root, "src", "web", "app", "music.js"), "utf8");
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    sandbox.window = {};
    // In-memory localStorage stand-in.
    const bag = new Map<string, string>();
    sandbox.localStorage = {
      getItem: (k: string) => (bag.has(k) ? bag.get(k)! : null),
      setItem: (k: string, v: string) => { bag.set(k, String(v)); },
      removeItem: (k: string) => { bag.delete(k); },
    };
    // note() targets #music-note; keep it a silent no-op.
    sandbox.document = { getElementById: () => null };
    vm.runInContext(src, sandbox, { filename: "music.js" });
    const M = (sandbox.window as Record<string, unknown>).NeutronMusic as {
      historyStore: Store;
    };
    expect(M.historyStore, "historyStore should be exported for tests").toBeTruthy();
    return M.historyStore;
  }

  it("pushHistory dedupes by id, puts newest first, and caps the list", () => {
    const S = loadWithStorage();
    const a = { id: "a", title: "A", ts: 1 };
    const b = { id: "b", title: "B", ts: 2 };
    let list = S.pushHistory([], a);
    list = S.pushHistory(list, b);
    expect(list.map((h) => h.id)).toEqual(["b", "a"]);
    // Re-playing "a" moves it to the front without duplicating.
    list = S.pushHistory(list, { id: "a", title: "A", ts: 3 });
    expect(list.map((h) => h.id)).toEqual(["a", "b"]);
    // Cap.
    let big: Hist[] = [];
    for (let i = 0; i < S.HISTORY_CAP + 10; i++) {
      big = S.pushHistory(big, { id: "id" + i, title: "T" + i, ts: i });
    }
    expect(big.length).toBe(S.HISTORY_CAP);
    expect(big[0]?.id).toBe("id" + (S.HISTORY_CAP + 9));
  });

  it("history round-trips through storage and drops invalid entries", () => {
    const S = loadWithStorage();
    S.saveHistory([
      { id: "x", title: "X", ts: 1 },
      { id: "", title: "bad", ts: 2 } as unknown as Hist,
      null as unknown as Hist,
    ]);
    expect(S.readHistory().map((h) => h.id)).toEqual(["x"]);
  });

  it("playlists: create via add, dedupe tracks, remove, delete", () => {
    const S = loadWithStorage();
    expect(S.readPlaylists()).toEqual({});
    S.addToPlaylist("Focus", "v1", "Song One");
    S.addToPlaylist("Focus", "v1", "Song One"); // duplicate ignored
    S.addToPlaylist("Focus", "v2", "Song Two");
    S.addToPlaylist("Gym", "v3", "Song Three");
    let pls = S.readPlaylists();
    expect(Object.keys(pls).sort()).toEqual(["Focus", "Gym"]);
    expect(pls["Focus"]?.map((t) => t.id)).toEqual(["v1", "v2"]);
    S.removeFromPlaylist("Focus", "v1");
    expect(S.readPlaylists()["Focus"]?.map((t) => t.id)).toEqual(["v2"]);
    S.deletePlaylist("Gym");
    expect(Object.keys(S.readPlaylists())).toEqual(["Focus"]);
  });

  it("corrupt storage degrades to empty state instead of throwing", () => {
    const src = readFileSync(join(root, "src", "web", "app", "music.js"), "utf8");
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    sandbox.window = {};
    sandbox.localStorage = {
      getItem: () => "{not json",
      setItem: () => {},
      removeItem: () => {},
    };
    sandbox.document = { getElementById: () => null };
    vm.runInContext(src, sandbox, { filename: "music.js" });
    const S = (sandbox.window as Record<string, unknown>).NeutronMusic as {
      historyStore: Store;
    };
    expect(S.historyStore.readHistory()).toEqual([]);
    expect(S.historyStore.readPlaylists()).toEqual({});
  });
});
