/**
 * Web theme registration tests: every theme in the app's THEMES list must
 * have a matching stylesheet block (or be the :root-default "light") and be
 * accepted by the pre-paint inline theme script in index.html (no flash,
 * no fallback to the wrong theme on reload).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web", "app");
const appJs = readFileSync(join(root, "app.js"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");

function themeIds(): string[] {
  const m = appJs.match(/var THEMES = \[([\s\S]*?)\];/);
  expect(m, "THEMES array found").not.toBeNull();
  const body: string = (m as RegExpMatchArray)[1] as string;
  return [...body.matchAll(/id:\s*"([^"]+)"/g)].map((x) => x[1] as string);
}

describe("theme registration", () => {
  it("registers 18 named themes plus System", () => {
    const ids = themeIds();
    expect(ids.length).toBe(18);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });

  it("every theme has a stylesheet block (light is the :root default)", () => {
    for (const id of themeIds()) {
      if (id === "light") {
        expect(css).toMatch(/:root\s*\{/);
        continue;
      }
      expect(css.includes(`[data-theme="${id}"]`), `${id} has a CSS block`).toBe(true);
    }
  });

  it("every theme id is accepted by the pre-paint script", () => {
    const m = html.match(/if \(\[(.*?)\]\.indexOf\(name\)/s);
    expect(m, "pre-paint allowlist found").not.toBeNull();
    const allowlist: string = (m as RegExpMatchArray)[1] as string;
    for (const id of themeIds()) {
      expect(allowlist.includes(`"${id}"`), `${id} in pre-paint allowlist`).toBe(true);
    }
  });

  it("every theme block defines the core variables", () => {
    for (const id of themeIds()) {
      if (id === "light") continue;
      const start = css.indexOf(`[data-theme="${id}"]`);
      const block = css.slice(start, start + 3500);
      for (const v of ["--primary:", "--bg:", "--text:", "--border:", "--surface:"]) {
        expect(block.includes(v), `${id} defines ${v}`).toBe(true);
      }
    }
  });
});
