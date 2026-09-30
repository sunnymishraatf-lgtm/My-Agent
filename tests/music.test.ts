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
