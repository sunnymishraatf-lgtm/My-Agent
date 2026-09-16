import { loadTheme as _loadTheme, paint as _paint, type Theme, type ThemeKey } from "../cli/theme";

export type { Theme, ThemeKey };

export const theme = (): Theme => _loadTheme();

export const paint = (key: string, text: string): string => _paint(theme(), key as ThemeKey, text);

export const c = {
  banner: "\x1b[1;35m",
  prompt: "\x1b[36m",
  assistant: "\x1b[36m",
  tool: "\x1b[33m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

export function wrap(color: string, text: string): string {
  if (!text) return text;
  return `${color}${text}${c.reset}`;
}

export function bold(text: string): string {
  return `${c.bold}${text}${c.reset}`;
}

export function dim(text: string): string {
  return `${c.dim}${text}${c.reset}`;
}

export function truncate(text: string, width: number): string {
  if (width <= 3) return text.length > width ? "..." : text;
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

export function pad(text: string, width: number): string {
  const visible = strip(text);
  const padLen = Math.max(0, width - visible);
  return text + " ".repeat(padLen);
}

export function strip(text: string): number {
  // crude visible-length estimate: ignore ANSI escape sequences
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function center(text: string, width: number): string {
  const len = strip(text);
  const left = Math.max(0, Math.floor((width - len) / 2));
  return " ".repeat(left) + text;
}

export function box(width: number, title?: string): string[] {
  const inner = Math.max(10, width - 2);
  const top = title
    ? `┌─ ${bold(title)} ${"─".repeat(Math.max(0, inner - strip(title) - 3))}┐`
    : `┌${"─".repeat(inner)}┐`;
  const bottom = `└${"─".repeat(inner)}┘`;
  return [top, bottom];
}