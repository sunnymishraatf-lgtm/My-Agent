import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CustomCommand {
  name: string;
  description: string;
  body: string;
  file: string;
}

const COMMAND_DIRS = [".sunny/commands", ".agent/commands", ".opencode/command"];

export function loadCommands(root: string): CustomCommand[] {
  const out = new Map<string, CustomCommand>();
  for (const rel of COMMAND_DIRS) {
    const dir = join(root, rel);
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      let body: string;
      try {
        body = readFileSync(join(dir, file), "utf8");
      } catch {
        continue;
      }
      const name = file.slice(0, -3);
      const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
      out.set(name, {
        name,
        description: firstLine.replace(/^#\s*/, "").slice(0, 80),
        body,
        file: join(dir, file),
      });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function expandCommand(command: CustomCommand, args: string): string {
  const trimmed = args.trim();
  const argv = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
  return command.body
    .replaceAll("$ARGUMENTS", trimmed)
    .replace(/\$([1-9])/g, (_, n: string) => argv[Number(n) - 1] ?? "");
}
