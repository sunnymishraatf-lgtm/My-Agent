import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { redact } from "../config";
import type { TuiFileChange, TuiItem } from "./types";
import {
  boxChars,
  displayWidth,
  glyphs,
  lineCount,
  panelFooter,
  panelHeader,
  padEnd,
  toolSummary,
  truncate,
} from "./utils";

export interface ChatTranscriptProps {
  items: TuiItem[];
  streamingText: string;
  streaming: boolean;
  fileChanges: TuiFileChange[];
  agentLabel: string;
  width: number;
  maxRows: number;
  scrollBack?: number;
}

const VERBS: Record<string, { past: string; noun: string }> = {
  read: { past: "Read", noun: "file" },
  write: { past: "Wrote", noun: "file" },
  edit: { past: "Updated", noun: "file" },
  bash: { past: "Ran", noun: "command" },
  shell: { past: "Ran", noun: "command" },
  grep: { past: "Searched", noun: "code" },
  glob: { past: "Found", noun: "files" },
  list: { past: "Listed", noun: "directory" },
  webfetch: { past: "Fetched", noun: "URL" },
  task: { past: "Spawned", noun: "subagent" },
};

function verbFor(name: string): string {
  return VERBS[name]?.past ?? `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function ToolPanel({ name, detail, width }: { name: string; detail: string; width: number }) {
  const title = `${name}`;
  const header = panelHeader(title, width);
  const footer = panelFooter(width);
  const innerWidth = Math.max(0, width - 4);
  return (
    <Box flexDirection="column" width={width}>
      <Text color="gray">{header}</Text>
      <Text>
        {" "}
        {boxChars.v} {truncate(detail, innerWidth)}
      </Text>
      <Text color="gray">{footer}</Text>
    </Box>
  );
}

export function ChatTranscript({ items, streamingText, streaming, fileChanges, agentLabel, width, maxRows, scrollBack = 0 }: ChatTranscriptProps) {
  const panelWidth = Math.max(24, Math.min(width - 2, 72));
  const nodes: { node: ReactNode; height: number }[] = [];

  items.forEach((item, index) => {
    if ("role" in item) {
      const text = redact(item.text);
      if (item.role === "user") {
        nodes.push({
          node: (
            <Box key={item.id} flexDirection="column" marginBottom={1}>
              <Text color="gray" bold>
                USER
              </Text>
              <Text color="white">
                <Text color="gray">{"> "}</Text>
                {text}
              </Text>
            </Box>
          ),
          height: 2 + lineCount(text, Math.max(10, width - 2)),
        });
        return;
      }
      if (item.role === "system") {
        nodes.push({
          node: (
            <Box key={item.id} marginBottom={1}>
              <Text dimColor>{text}</Text>
            </Box>
          ),
          height: 1 + lineCount(text, width),
        });
        return;
      }
      nodes.push({
        node: (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            <Text color="cyan" bold>
              {`NEUTRON / ${agentLabel.toUpperCase()}`}
            </Text>
            <Text>{text}</Text>
          </Box>
        ),
        height: 2 + lineCount(text, Math.max(10, width - 2)),
      });
      return;
    }

    if (item.kind === "tool") {
      const detail = toolSummary(item.name, item.args);
      const status = item.status;
      const icon = status === "ok" ? glyphs.check : status === "error" || status === "denied" ? glyphs.cross : glyphs.bullet;
      const color = status === "ok" ? "green" : status === "error" || status === "denied" ? "red" : "yellow";
      const resultLabel = `${verbFor(item.name)} ${detail || item.name}`;
      const errorPreview = status === "error" && item.output ? truncate(item.output.split("\n")[0] ?? "", Math.max(10, width - 4)) : "";
      nodes.push({
        node: (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            <ToolPanel name={item.name} detail={detail} width={panelWidth} />
            <Text color={color}>
              {icon} {resultLabel}
            </Text>
            {errorPreview ? <Text dimColor> {errorPreview}</Text> : null}
          </Box>
        ),
        height: 4 + (errorPreview ? 1 : 0),
      });
      return;
    }

    const status = item.status;
    const icon = status === "ok" ? glyphs.check : status === "error" ? glyphs.cross : glyphs.bullet;
    const color = status === "ok" ? "green" : status === "error" ? "red" : "yellow";
    const outputLines = (item.output ?? "").split("\n").filter(Boolean).slice(0, 4);
    nodes.push({
      node: (
        <Box key={item.id} flexDirection="column" marginBottom={1}>
          <Text color="yellow">$ {item.command}</Text>
          {status === "running" ? <Text color="yellow">{glyphs.bullet} Running...</Text> : null}
          {outputLines.map((line, i) => (
            <Text key={i} dimColor>
              {"  "}
              {truncate(line, Math.max(10, width - 4))}
            </Text>
          ))}
          {status !== "running" ? (
            <Text color={color}>
              {icon} {status === "ok" ? "Command finished" : "Command failed"}
            </Text>
          ) : null}
        </Box>
      ),
      height: 2 + outputLines.length + 1,
    });
  });

  if (streaming || streamingText) {
    const text = redact(streamingText);
    nodes.push({
      node: (
        <Box key="streaming" flexDirection="column" marginBottom={1}>
          <Text color="cyan" bold>
            {`NEUTRON / ${agentLabel.toUpperCase()}`}
          </Text>
          <Text>{text || (streaming ? `${glyphs.bullet} thinking...` : "")}</Text>
        </Box>
      ),
      height: 2 + Math.max(1, lineCount(text || " ", Math.max(10, width - 2))),
    });
  }

  if (fileChanges.length > 0) {
    const lines = summarizeChanges(fileChanges);
    nodes.push({
      node: (
        <Box key="changes" flexDirection="column" marginBottom={1}>
          <Text bold>Changed files</Text>
          {lines.map((line) => (
            <Text key={line.path}>
              <Text color={line.color}> {line.flag} </Text>
              <Text>{line.path}</Text>
              <Text dimColor>
                {" "}
                +{line.added} -{line.removed}
              </Text>
            </Text>
          ))}
        </Box>
      ),
      height: 1 + lines.length,
    });
  }

  // Window the transcript so the newest content stays visible, honoring scrollBack.
  let end = nodes.length;
  let skip = scrollBack;
  while (skip > 0 && end > 0) {
    end--;
    skip -= nodes[end]!.height;
  }
  let used = 0;
  let start = end;
  for (let i = end - 1; i >= 0; i--) {
    const entry = nodes[i]!;
    if (used + entry.height > maxRows && start < end) break;
    used += entry.height;
    start = i;
  }

  return (
    <Box flexDirection="column" width={width}>
      {start > 0 || end < nodes.length ? (
        <Text dimColor>
          {glyphs.arrow} {end < nodes.length ? `${scrollBack} rows above` : "more above"} · page up / page down to scroll
        </Text>
      ) : null}
      {nodes.slice(start, end).map((entry, i) => (
        <Box key={i}>{entry.node}</Box>
      ))}
    </Box>
  );
}

interface ChangeLine {
  path: string;
  flag: string;
  color: "green" | "yellow" | "red";
  added: number;
  removed: number;
}

function summarizeChanges(changes: TuiFileChange[]): ChangeLine[] {
  const byPath = new Map<string, TuiFileChange>();
  for (const change of changes) byPath.set(change.path, change);
  return [...byPath.values()].map((change) => ({
    path: change.path,
    flag: change.kind === "added" ? "A" : change.kind === "deleted" ? "D" : "M",
    color: change.kind === "added" ? "green" : change.kind === "deleted" ? "red" : "yellow",
    added: change.added,
    removed: change.removed,
  }));
}

export function pad(text: string, width: number): string {
  return padEnd(text, width);
}

export function width(text: string): number {
  return displayWidth(text);
}
