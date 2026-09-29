/**
 * Glassmorphism theme tests: the two glass themes must be registered in the
 * web app's theme list, have gradient previews, and carry the frosted-glass
 * CSS (blur + fallbacks) in the stylesheet.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web", "app");
const appJs = readFileSync(join(root, "app.js"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");

function blockFor(sel: string): string {
  const i = css.indexOf(sel);
  expect(i, `${sel} block exists`).toBeGreaterThan(-1);
  // Grab up to the next top-level theme/glass block start; generous slice is fine.
  return css.slice(i, i + 4000);
}

describe("glass theme registration", () => {
  it("lists Glass Dark and Glass Ocean in THEMES", () => {
    expect(appJs).toMatch(/id:\s*"glass-dark"/);
    expect(appJs).toMatch(/id:\s*"glass-ocean"/);
    expect(appJs).toMatch(/name:\s*"Glass Dark"/);
    expect(appJs).toMatch(/name:\s*"Glass Ocean"/);
  });

  it("gives both glass themes a representative gradient preview", () => {
    const dark = appJs.match(/id:\s*"glass-dark"[\s\S]{0,400}?preview:\s*"([^"]+)"/);
    const ocean = appJs.match(/id:\s*"glass-ocean"[\s\S]{0,400}?preview:\s*"([^"]+)"/);
    expect(dark && dark[1]).toMatch(/linear-gradient/);
    expect(ocean && ocean[1]).toMatch(/linear-gradient/);
    // Previews mirror the dark-gradient design of each theme.
    expect(dark![1]).toContain("#0A0D13");
    expect(ocean![1]).toContain("#062A44");
  });

  it("renders the gradient preview in the swatch strip", () => {
    expect(appJs).toMatch(/swatchBtn\(t\.id,\s*t\.name,\s*t\.swatch,\s*t\.preview\)/);
    expect(appJs).toMatch(/if\s*\(gradient\)/);
  });

  it("accepts both ids in the pre-paint inline theme script", () => {
    expect(html).toMatch(/"glass-dark"/);
    expect(html).toMatch(/"glass-ocean"/);
  });
});

describe("glass theme CSS variables", () => {
  it("defines dark color-scheme blocks for both themes", () => {
    for (const sel of ['[data-theme="glass-dark"]', '[data-theme="glass-ocean"]']) {
      const b = blockFor(sel);
      expect(b).toMatch(/color-scheme:\s*dark/);
    }
  });

  it("uses rich gradient page backgrounds", () => {
    const dark = blockFor('[data-theme="glass-dark"]');
    const ocean = blockFor('[data-theme="glass-ocean"]');
    expect(dark).toMatch(/--bg:\s*linear-gradient\(135deg,\s*#0A0D13/);
    expect(ocean).toMatch(/--bg:\s*linear-gradient\(135deg,\s*#03101D/);
  });

  it("keeps text light for contrast on the dark gradients", () => {
    const dark = blockFor('[data-theme="glass-dark"]');
    const ocean = blockFor('[data-theme="glass-ocean"]');
    expect(dark).toMatch(/--text:\s*#F5F7FA/);
    expect(ocean).toMatch(/--text:\s*#F2F8FD/);
    expect(dark).toMatch(/--text-2:\s*#C9D2DF/);
    expect(ocean).toMatch(/--text-2:\s*#C3D6E6/);
  });

  it("defines frosted-glass tokens (translucent surfaces, glass border, inset highlight)", () => {
    for (const sel of ['[data-theme="glass-dark"]', '[data-theme="glass-ocean"]']) {
      const b = blockFor(sel);
      expect(b).toMatch(/--glass-bg:\s*rgba\(255,\s*255,\s*255,\s*0\.07\)/);
      expect(b).toMatch(/--glass-border:\s*rgba\(255,\s*255,\s*255,\s*0\.18\)/);
      expect(b).toMatch(/--glass-inset:\s*inset 0 1px 0 rgba\(255,\s*255,\s*255,\s*0\.12\)/);
    }
  });
});

describe("frosted-glass surfaces", () => {
  it("applies blur(18px) saturate(140%) with the -webkit- prefix", () => {
    expect(css).toMatch(/-webkit-backdrop-filter:\s*blur\(18px\)\s*saturate\(140%\)/);
    expect(css).toMatch(/(?<!-webkit-)backdrop-filter:\s*blur\(18px\)\s*saturate\(140%\)/);
  });

  it("frosts the header, sidebar, cards, chat bubbles and swatches", () => {
    for (const sel of [
      '[data-theme^="glass-"] .topbar',
      '[data-theme^="glass-"] .sidebar',
      '[data-theme^="glass-"] .panel',
      '[data-theme^="glass-"] .msg:not(.user) .bubble',
      '[data-theme^="glass-"] .msg.user .bubble',
      '[data-theme^="glass-"] .theme-swatch',
    ]) {
      expect(css, sel).toContain(sel);
    }
  });

  it("keeps user bubbles on the primary fill (glass adds depth only)", () => {
    const i = css.indexOf('[data-theme^="glass-"] .msg.user .bubble');
    expect(i).toBeGreaterThan(-1);
    const rule = css.slice(i, i + 600);
    expect(rule).not.toMatch(/background:/);
  });

  it("never transitions the blur itself — only transforms animate", () => {
    // No transition declarations mention backdrop-filter.
    expect(css).not.toMatch(/transition:[^;]*backdrop-filter/);
  });

  it("falls back to solid backgrounds without backdrop-filter support", () => {
    const i = css.indexOf("@supports not");
    expect(i).toBeGreaterThan(-1);
    const fb = css.slice(i, i + 2500);
    expect(fb).toMatch(/backdrop-filter:\s*blur\(1px\)/);
    expect(fb).toMatch(/\[data-theme="glass-dark"\]/);
    expect(fb).toMatch(/\[data-theme="glass-ocean"\]/);
    // Solid (non-gradient, non-rgba) page backgrounds in the fallback.
    expect(fb).toMatch(/--bg:\s*#[0-9A-Fa-f]{6};/);
    expect(fb).not.toMatch(/--bg:\s*linear-gradient/);
  });

  it("drops the blur under prefers-reduced-motion", () => {
    const i = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    expect(i).toBeGreaterThan(-1);
    const rm = css.slice(i, i + 3000);
    expect(rm).toMatch(/\[data-theme\^="glass-"\]/);
    expect(rm).toMatch(/backdrop-filter:\s*none/);
    expect(rm).toMatch(/--glass-bg:\s*#[0-9A-Fa-f]{6}/);
  });
});
