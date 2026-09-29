/**
 * Dark-theme contrast regression tests: every theme that declares
 * `color-scheme: dark` must override `--white` with a genuinely dark value,
 * because `.panel`, `.btn`, `.input` and `ul.list li` all use
 * `background: var(--white)`. A missing override renders pure-white
 * surfaces in dark mode (regression caught 2026-09-29).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web", "app", "styles.css"),
  "utf8"
);

/** Extract top-level [data-theme="x"] blocks (skip nested @supports/@media copies). */
function themeBlocks(): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /\[data-theme="([a-z-]+)"\]\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const lineStart = css.lastIndexOf("\n", m.index) + 1;
    if (css.slice(lineStart, m.index).trim() !== "") continue; // nested copy
    let i = m.index + m[0].length;
    let depth = 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    const themeName = m[1];
    if (themeName) out.push({ name: themeName, body: css.slice(m.index, i) });
  }
  return out;
}

/** Relative luminance of a #rrggbb hex (0 = black, 1 = white). */
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

/**
 * Is a theme's `--white` value safe on a dark background? Either a genuinely
 * dark hex, or a translucent white (glass themes) that only tints.
 */
function whiteIsDarkSafe(body: string): boolean {
  const m = body.match(/--white\s*:\s*([^;]+);/);
  const raw = m ? m[1] : undefined;
  if (!raw) return false;
  const v = raw.trim();
  const hex = v.match(/^#([0-9a-fA-F]{6})$/);
  const hexVal = hex ? hex[1] : undefined;
  if (hexVal) return luminance("#" + hexVal) < 0.08;
  const rgba = v.match(/^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)$/);
  const alpha = rgba ? rgba[1] : undefined;
  if (alpha !== undefined) return parseFloat(alpha) < 0.5;
  return false;
}

describe("dark theme --white overrides", () => {
  const darkThemes = themeBlocks().filter((b) => /color-scheme:\s*dark/.test(b.body));
  it("finds the dark themes under test", () => {
    const names = darkThemes.map((b) => b.name);
    expect(names).toContain("dark");
    expect(names).toContain("deep-ocean");
  });

  for (const t of darkThemes) {
    it(`${t.name}: overrides --white with a dark-safe value`, () => {
      expect(whiteIsDarkSafe(t.body), `${t.name} --white must be dark or translucent`).toBe(true);
    });
  }

  it("light themes keep the bright --white default", () => {
    const light = themeBlocks().filter((b) => /color-scheme:\s*light/.test(b.body));
    expect(light.length).toBeGreaterThan(0);
    for (const t of light) {
      // Light themes inherit --white: #FFFFFF from :root; none may set a dark one.
      const mm = t.body.match(/--white\s*:\s*(#[0-9a-fA-F]{6})/);
      if (mm && mm[1]) expect(luminance(mm[1])).toBeGreaterThan(0.7);
    }
  });
});
