import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const app = join(root, "src", "web", "app");

describe("PWA manifest", () => {
  it("manifest is valid and installable", () => {
    const p = join(app, "manifest.webmanifest");
    expect(existsSync(p)).toBe(true);
    const m = JSON.parse(readFileSync(p, "utf8"));
    expect(typeof m.name).toBe("string");
    expect(typeof m.start_url).toBe("string");
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(m.display);
    expect(Array.isArray(m.icons) && m.icons.length).toBeGreaterThan(0);
    for (const ic of m.icons) {
      expect(typeof ic.src).toBe("string");
      expect(existsSync(join(app, ic.src))).toBe(true);
    }
    // 192px and 512px icons are the installability minimums.
    const sizes = m.icons.map((ic: { sizes: string }) => ic.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("index.html links the manifest and icons", () => {
    const html = readFileSync(join(app, "index.html"), "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain("icon-192.png");
  });
});
