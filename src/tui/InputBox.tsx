import { Box, Text } from "ink";
import { glyphs } from "./utils";

export interface InputBoxProps {
  value: string;
  cursor: number;
  placeholder?: string;
  busy?: boolean;
  /** Optional prefix shown before the first line (e.g. ">"). */
  prefix?: string;
  /** When true, no border is drawn (used inside an already-bordered frame). */
  bare?: boolean;
}

function cursorPosition(value: string, cursor: number): { line: number; col: number } {
  let line = 0;
  let col = 0;
  for (let i = 0; i < cursor && i < value.length; i++) {
    if (value[i] === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, col };
}

export function InputBox({ value, cursor, placeholder = "Ask anything...", busy = false, prefix, bare = false }: InputBoxProps) {
  const lines = value.split("\n");
  const pos = cursorPosition(value, cursor);
  const showPlaceholder = value.length === 0;

  const content = (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        const isActive = index === pos.line;
        if (showPlaceholder && index === 0) {
          return (
            <Box key={index}>
              <Text dimColor>{placeholder}</Text>
              <Text color="cyan">{glyphs.caret}</Text>
            </Box>
          );
        }
        if (!isActive) {
          return (
            <Box key={index}>
              <Text>{line.length > 0 ? line : " "}</Text>
            </Box>
          );
        }
        const before = line.slice(0, pos.col);
        const at = line.slice(pos.col, pos.col + 1);
        const after = line.slice(pos.col + 1);
        return (
          <Box key={index}>
            {index === 0 && prefix ? <Text color="gray">{prefix}</Text> : null}
            <Text>{before}</Text>
            <Text color="cyan">{glyphs.caret}</Text>
            <Text>{at + after || " "}</Text>
          </Box>
        );
      })}
      {busy ? (
        <Box>
          <Text color="yellow">{glyphs.bullet} working...</Text>
        </Box>
      ) : null}
    </Box>
  );

  if (bare) return content;

  return (
    <Box flexDirection="column" width="100%">
      {content}
    </Box>
  );
}
