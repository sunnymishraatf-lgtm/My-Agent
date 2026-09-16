import { readProjectFile } from "../files/project-files";

export interface ParsedInput {
  kind: "send" | "shell";
  text: string;
  attached: string[];
}

const MAX_ATTACH = 20_000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

export function parseInput(root: string, input: string): ParsedInput {
  const trimmed = input.trim();
  if (trimmed.startsWith("!")) {
    return { kind: "shell", text: trimmed.slice(1).trim(), attached: [] };
  }

  const attached: string[] = [];
  const referenced = trimmed.replace(/(^|\s)@([^\s@]+)/g, (match, prefix: string, path: string) => {
    if (readProjectFile(root, path) === undefined) return match;
    if (!attached.includes(path)) attached.push(path);
    return `${prefix}[attached: ${path}]`;
  });

  if (attached.length === 0) return { kind: "send", text: trimmed, attached };

  const blocks = attached
    .map((path) => `--- ${path} ---\n${truncate(readProjectFile(root, path) ?? "", MAX_ATTACH)}`)
    .join("\n\n");
  return { kind: "send", text: `${referenced}\n\n${blocks}`, attached };
}
