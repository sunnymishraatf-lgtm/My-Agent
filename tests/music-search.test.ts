/**
 * Server-side music search tests: the InnerTube + Piped parsers must turn
 * real upstream payloads into playable {id, title} results.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseYoutubeiSearch,
  parsePipedSearch,
} from "../src/server/music-search";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("parseYoutubeiSearch", () => {
  it("extracts video ids, titles and artists from a real search response", () => {
    const data = JSON.parse(
      readFileSync(join(root, "tests", "fixtures", "youtubei-search.json"), "utf8"),
    );
    const results = parseYoutubeiSearch(data);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(12);
    const seen = new Set<string>();
    for (const r of results) {
      expect(r.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(r.title.trim().length).toBeGreaterThan(0);
      expect(seen.has(r.id)).toBe(false);
      seen.add(r.id);
    }
    // Spot-check against the known fixture content.
    const lofi = results.find((r) => r.id === "witxKZ4mAgQ");
    expect(lofi?.title).toBe("Lo-Fi Chill Study Beats");
    expect(lofi?.artist).toContain("LO-FI BEATS");
  });

  it("returns [] for garbage input instead of throwing", () => {
    expect(parseYoutubeiSearch(null)).toEqual([]);
    expect(parseYoutubeiSearch({})).toEqual([]);
    expect(parseYoutubeiSearch("nope")).toEqual([]);
  });
});

describe("parsePipedSearch", () => {
  it("normalizes Piped {items:[{url,title}]} payloads", () => {
    const results = parsePipedSearch({
      items: [
        { url: "/watch?v=rFZHOHl-L8A", title: "lofi hip hop radio" },
        { url: "/watch?v=short", title: "bad id" },
        { url: "/watch?v=sF80I-TQiW0", title: "  " },
        { url: "/watch?v=sF80I-TQiW0", title: "90's Chill Lofi" },
      ],
    });
    expect(results).toEqual([
      { id: "rFZHOHl-L8A", title: "lofi hip hop radio" },
      { id: "sF80I-TQiW0", title: "90's Chill Lofi" },
    ]);
  });

  it("returns [] for garbage input instead of throwing", () => {
    expect(parsePipedSearch(null)).toEqual([]);
    expect(parsePipedSearch({ items: "nope" })).toEqual([]);
  });
});
