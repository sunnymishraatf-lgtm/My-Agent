import { readRawConfig, writeGlobalConfig } from "../config";
import { envVar } from "../compat";

export interface Theme {
  name: string;
  description: string;
  banner: string;
  prompt: string;
  assistant: string;
  tool: string;
  success: string;
  error: string;
  dim: string;
}

export type ThemeKey = Exclude<keyof Theme, "name" | "description">;

const RESET = "\x1b[0m";

export const THEMES: Record<string, Theme> = {
  default: {
    name: "default",
    description: "Purple banner with cyan prompt",
    banner: "\x1b[1;35m",
    prompt: "\x1b[36m",
    assistant: "",
    tool: "\x1b[33m",
    success: "\x1b[32m",
    error: "\x1b[31m",
    dim: "\x1b[2m",
  },
  ocean: {
    name: "ocean",
    description: "Cool blues and teals",
    banner: "\x1b[1;34m",
    prompt: "\x1b[36m",
    assistant: "\x1b[36m",
    tool: "\x1b[34m",
    success: "\x1b[1;36m",
    error: "\x1b[1;31m",
    dim: "\x1b[2;36m",
  },
  forest: {
    name: "forest",
    description: "Earthy greens",
    banner: "\x1b[1;32m",
    prompt: "\x1b[32m",
    assistant: "",
    tool: "\x1b[33m",
    success: "\x1b[32m",
    error: "\x1b[31m",
    dim: "\x1b[2;32m",
  },
  sunset: {
    name: "sunset",
    description: "Warm oranges and pinks",
    banner: "\x1b[1;33m",
    prompt: "\x1b[35m",
    assistant: "\x1b[33m",
    tool: "\x1b[35m",
    success: "\x1b[32m",
    error: "\x1b[1;31m",
    dim: "\x1b[2m",
  },
  mono: {
    name: "mono",
    description: "No colors",
    banner: "",
    prompt: "",
    assistant: "",
    tool: "",
    success: "",
    error: "",
    dim: "",
  },
};

export function listThemes(): Theme[] {
  return Object.values(THEMES);
}

export function resolveTheme(name: string | undefined): Theme {
  if (!name) return THEMES.default!;
  return THEMES[name] ?? THEMES.default!;
}

export function loadTheme(): Theme {
  const envName = envVar("THEME");
  if (envName) return resolveTheme(envName);
  const raw = readRawConfig();
  return resolveTheme(typeof raw.theme === "string" ? raw.theme : undefined);
}

export function setTheme(name: string): boolean {
  if (!THEMES[name]) return false;
  return writeGlobalConfig({ version: 1, ...readRawConfig(), theme: name });
}

export function paint(theme: Theme, key: ThemeKey, text: string): string {
  const prefix = theme[key];
  if (!prefix) return text;
  return `${prefix}${text}${RESET}`;
}
