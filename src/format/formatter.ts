import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { ActionResult } from "../types";

export interface FormatterConfig {
  name: string;
  extensions: string[];
  command: (file: string) => string;
}

function hasPrettier(root: string): boolean {
  for (const name of [".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.js", "prettier.config.js", "prettier.config.cjs"]) {
    if (existsSync(join(root, name))) return true;
  }
  const pkg = join(root, "package.json");
  if (!existsSync(pkg)) return false;
  try {
    const raw = JSON.parse(readFileSync(pkg, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(raw.dependencies?.prettier || raw.devDependencies?.prettier);
  } catch {
    return false;
  }
}

export function detectFormatters(root: string): FormatterConfig[] {
  const formatters: FormatterConfig[] = [];
  if (hasPrettier(root)) {
    formatters.push({
      name: "prettier",
      extensions: [".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".css", ".scss", ".html", ".yaml", ".yml"],
      command: (file) => `npx --no-install prettier --write "${file}"`,
    });
  }
  formatters.push(
    { name: "gofmt", extensions: [".go"], command: (file) => `gofmt -w "${file}"` },
    { name: "rustfmt", extensions: [".rs"], command: (file) => `rustfmt "${file}"` },
    {
      name: "black",
      extensions: [".py"],
      command: (file) => `black "${file}"`,
    },
  );
  return formatters;
}

/**
 * Run the first detected formatter that handles the file's extension.
 * Returns the formatter name on success, or a failure message (best-effort, never throws).
 */
export async function formatFile(
  root: string,
  relPath: string,
  run: (cmd: string, opts?: { timeoutMs?: number }) => Promise<ActionResult>,
  formatters = detectFormatters(root),
): Promise<{ ok: boolean; formatter?: string; message?: string }> {
  const ext = extname(relPath).toLowerCase();
  const formatter = formatters.find((f) => f.extensions.includes(ext));
  if (!formatter) return { ok: false, message: "no formatter" };
  try {
    const res = await run(formatter.command(relPath), { timeoutMs: 60_000 });
    return res.status === "ok" ? { ok: true, formatter: formatter.name } : { ok: false, formatter: formatter.name, message: res.stderr || res.stdout };
  } catch (err) {
    return { ok: false, formatter: formatter.name, message: err instanceof Error ? err.message : String(err) };
  }
}
