import { Box, Text } from "ink";
import type { TuiCommand } from "./commands";
import { displayWidth, padEnd, panelFooter, panelHeader, truncate } from "./utils";

export interface CommandMenuProps {
  commands: TuiCommand[];
  selected: number;
  width: number;
  title?: string;
}

/**
 * Sliding ten-row window over the command list. The selection is always
 * visible and indexes align with the Enter/Tab handler, which indexes into
 * `commands` directly (no modulo wrap-around).
 */
export function menuWindow<T>(items: T[], selected: number, windowSize = 10): { shown: T[]; start: number; selected: number } {
  const clamped = Math.max(0, Math.min(selected, Math.max(0, items.length - 1)));
  const start = Math.min(Math.max(0, clamped - windowSize + 1), Math.max(0, items.length - windowSize));
  return { shown: items.slice(start, start + windowSize), start, selected: clamped };
}

export function CommandMenu({ commands, selected, width, title = "Commands" }: CommandMenuProps) {
  const inner = Math.max(20, width - 2);
  const nameWidth = Math.min(14, Math.max(8, ...commands.map((c) => c.name.length + 1), 1) + 1);
  const { shown, start, selected: clamped } = menuWindow(commands, selected, 10);

  return (
    <Box flexDirection="column" width={width}>
      <Text color="gray">{panelHeader(title, inner + 2)}</Text>
      {shown.length === 0 ? (
        <Text dimColor>
          {" "}
          No matching commands
        </Text>
      ) : (
        shown.map((cmd, index) => {
          const isSelected = start + index === clamped;
          const label = padEnd(`/${cmd.name}`, nameWidth + 2);
          const descWidth = Math.max(0, inner - displayWidth(label) - 2);
          const row = `${label} ${truncate(cmd.description, descWidth)}`;
          return (
            <Text key={cmd.name} color={isSelected ? "white" : "cyan"} backgroundColor={isSelected ? "blue" : undefined}>
              {" "}
              {padEnd(row, inner)}
            </Text>
          );
        })
      )}
      <Text color="gray">{panelFooter(inner + 2)}</Text>
    </Box>
  );
}
