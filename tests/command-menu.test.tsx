import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { render } from "ink";
import { CommandMenu, menuWindow } from "../src/tui/CommandMenu";
import type { TuiCommand } from "../src/tui/commands";

function commands(n: number): TuiCommand[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `cmd${String(i).padStart(2, "0")}`,
    description: `command ${i}`,
  }));
}

function renderMenu(cmds: TuiCommand[], selected: number): string {
  const chunks: string[] = [];
  const out = new Writable({
    write(chunk, _e, cb) {
      chunks.push(String(chunk));
      cb();
    },
  }) as unknown as NodeJS.WriteStream & { columns: number; rows: number; isTTY: boolean };
  out.columns = 100;
  out.rows = 30;
  out.isTTY = true;
  const inst = render(<CommandMenu commands={cmds} selected={selected} width={60} />, {
    stdout: out,
    patchConsole: false,
  });
  const text = chunks.join("");
  inst.unmount();
  return text;
}

describe("menuWindow (sliding ten-row window)", () => {
  it("keeps a selection past row ten visible", () => {
    const items = commands(15);
    const { shown, start, selected } = menuWindow(items, 12);
    expect(shown).toHaveLength(10);
    expect(shown.map((c) => c.name)).toContain("cmd12");
    expect(shown.map((c) => c.name)).not.toContain("cmd00");
    expect(start).toBe(3);
    expect(selected).toBe(12);
    // The highlighted row inside the window is the selected command itself
    // (start + rowIndex === selected), not a modulo-wrapped row.
    expect(shown[selected - start]?.name).toBe("cmd12");
  });

  it("shows the first window for an early selection", () => {
    const { shown, start } = menuWindow(commands(15), 2);
    expect(start).toBe(0);
    expect(shown.map((c) => c.name)).toContain("cmd00");
    expect(shown.map((c) => c.name)).toContain("cmd09");
    expect(shown.map((c) => c.name)).not.toContain("cmd10");
  });

  it("clamps an out-of-range selection to the last command", () => {
    const { shown, selected } = menuWindow(commands(5), 99);
    expect(shown).toHaveLength(5);
    expect(selected).toBe(4);
  });

  it("clamps a negative selection to the first command", () => {
    const { selected } = menuWindow(commands(5), -3);
    expect(selected).toBe(0);
  });
});

describe("CommandMenu rendering", () => {
  it("renders the selected command past row ten (old fixed window hid it)", () => {
    const out = renderMenu(commands(15), 12);
    expect(out).toContain("/cmd12");
    expect(out).not.toContain("/cmd00");
  });

  it("renders the first window for an early selection", () => {
    const out = renderMenu(commands(15), 2);
    expect(out).toContain("/cmd00");
    expect(out).toContain("/cmd09");
    expect(out).not.toContain("/cmd10");
  });

  it("renders the empty state", () => {
    const out = renderMenu([], 0);
    expect(out).toContain("No matching commands");
  });
});
