import { Box, Text } from "ink";
import type { TuiCommand } from "./commands";
import { displayWidth, padEnd, panelFooter, panelHeader, truncate } from "./utils";

export interface CommandMenuProps {
  commands: TuiCommand[];
  selected: number;
  width: number;
  title?: string;
}

export function CommandMenu({ commands, selected, width, title = "Commands" }: CommandMenuProps) {
  const inner = Math.max(20, width - 2);
  const nameWidth = Math.min(14, Math.max(8, ...commands.map((c) => c.name.length + 1), 1) + 1);
  const shown = commands.slice(0, 10);
  const rows = shown.length || 1;

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
          const isSelected = index === selected % rows;
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
