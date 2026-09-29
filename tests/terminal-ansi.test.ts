/**
 * Terminal ANSI → HTML rendering helper (pure, in ui-utils.js).
 */
import { describe, it, expect } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";

const { ansiToHtml } = uiUtils;

describe("ansiToHtml", () => {
  it("passes plain text through", () => {
    expect(ansiToHtml("hello world")).toBe("hello world");
  });

  it("escapes HTML before styling (XSS-safe)", () => {
    const out = ansiToHtml("\x1b[31m<script>alert(1)</script>\x1b[0m");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("<span");
  });

  it("renders red foreground and resets", () => {
    const out = ansiToHtml("\x1b[31mred\x1b[0m plain");
    expect(out).toContain('color:#f87171');
    expect(out).toContain("</span> plain");
  });

  it("handles bold and combined codes", () => {
    const out = ansiToHtml("\x1b[1;32mok\x1b[0m");
    expect(out).toContain("font-weight:700");
    expect(out).toContain("color:#4ade80");
  });

  it("handles bright colors and background", () => {
    const out = ansiToHtml("\x1b[91mX\x1b[0m\x1b[44mY\x1b[0m");
    expect(out).toContain("#fca5a5");
    expect(out).toContain("background:#1e3a8a");
  });

  it("drops cursor-movement and clear sequences", () => {
    const out = ansiToHtml("a\x1b[2K\x1b[1Ab");
    expect(out).not.toContain("\x1b");
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("strips carriage returns (progress bars)", () => {
    expect(ansiToHtml("50%\r100%")).toBe("50%100%");
  });

  it("ignores unknown SGR codes without breaking text", () => {
    expect(ansiToHtml("\x1b[38;5;200mpink?\x1b[0m")).toContain("pink?");
  });

  it("handles null/undefined input", () => {
    expect(ansiToHtml(null)).toBe("");
    expect(ansiToHtml(undefined)).toBe("");
  });
});
