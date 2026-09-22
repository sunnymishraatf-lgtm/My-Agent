import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listThemes, loadTheme, paint, resolveTheme, setTheme } from "../src/cli/theme";

let root: string;
let prevConfigDir: string | undefined;
let prevTheme: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-theme-"));
  prevConfigDir = process.env.NEUTRON_CONFIG_DIR;
  prevTheme = process.env.NEUTRON_THEME;
  process.env.NEUTRON_CONFIG_DIR = join(root, "config");
  delete process.env.NEUTRON_THEME;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.NEUTRON_CONFIG_DIR;
  else process.env.NEUTRON_CONFIG_DIR = prevConfigDir;
  if (prevTheme === undefined) delete process.env.NEUTRON_THEME;
  else process.env.NEUTRON_THEME = prevTheme;
  rmSync(root, { recursive: true, force: true });
});

describe("theme", () => {
  it("lists built-in themes", () => {
    const names = listThemes().map((t) => t.name);
    expect(names).toContain("default");
    expect(names).toContain("mono");
  });

  it("falls back to default for unknown themes", () => {
    expect(resolveTheme("does-not-exist").name).toBe("default");
    expect(resolveTheme(undefined).name).toBe("default");
  });

  it("leaves text unchanged for the mono theme", () => {
    const theme = resolveTheme("mono");
    expect(paint(theme, "error", "boom")).toBe("boom");
  });

  it("persists and reloads a selected theme", () => {
    expect(setTheme("ocean")).toBe(true);
    expect(loadTheme().name).toBe("ocean");
    expect(setTheme("nope")).toBe(false);
  });

  it("honors the NEUTRON_THEME environment variable", () => {
    process.env.NEUTRON_THEME = "forest";
    expect(loadTheme().name).toBe("forest");
  });
});
