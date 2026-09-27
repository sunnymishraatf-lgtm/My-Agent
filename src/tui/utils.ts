import { homedir } from "node:os";
import { sep } from "node:path";
import { envVar } from "../compat";

/**
 * On legacy Windows consoles (CMD / old conhost) the default code page does not
 * render box-drawing or many symbols. Windows Terminal, VS Code's terminal and
 * Linux/macOS terminals all handle Unicode fine. `NEUTRON_ASCII=1` forces the
 * ASCII-safe fallback everywhere.
 */
function detectUnicode(): boolean {
  if (envVar("ASCII") === "1" || envVar("ASCII") === "true") return false;
  if (process.env.TERM === "dumb") return false;
  if (process.platform !== "win32") return true;
  if (process.env.WT_SESSION) return true;
  if (process.env.TERM_PROGRAM) return true;
  if (process.env.TERM && process.env.TERM.includes("256color")) return true;
  return false;
}

export const UNICODE = detectUnicode();

/** ASCII-safe fallbacks when Unicode output is not reliable. */
export const glyphs = {
  bullet: UNICODE ? "●" : "*",
  check: UNICODE ? "✓" : "v",
  cross: UNICODE ? "✗" : "x",
  dot: UNICODE ? "·" : "-",
  arrow: UNICODE ? "›" : ">",
  caret: UNICODE ? "▌" : "|",
  ellipsis: UNICODE ? "…" : "...",
  prompt: UNICODE ? "> " : "> ",
  branch: UNICODE ? "" : "",
  spinner: UNICODE
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["-", "\\", "|", "/"],
};

export const borderStyle: "round" | "classic" = UNICODE ? "round" : "classic";

export const boxChars = UNICODE
  ? { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" }
  : { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" };

/** Build the top border line for a titled panel of a given inner width. */
export function panelHeader(title: string, width: number): string {
  const label = ` ${title} `;
  const used = displayWidth(label);
  const fill = Math.max(0, width - used - 2);
  return `${boxChars.tl}${label}${boxChars.h.repeat(fill)}${boxChars.tr}`;
}

export function panelFooter(width: number): string {
  return `${boxChars.bl}${boxChars.h.repeat(Math.max(0, width - 2))}${boxChars.br}`;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Visible width of a string, counting wide (CJK) characters as 2. */
export function displayWidth(text: string): number {
  const clean = text.replace(ANSI_RE, "");
  let width = 0;
  for (const ch of clean) {
    const code = ch.codePointAt(0) ?? 0;
    width += code >= 0x1100 && isWide(code) ? 2 : 1;
  }
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  );
}

/** Truncate to a visible width, adding an ellipsis when shortened. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  if (width <= 1) return glyphs.ellipsis === "…" ? "…" : ".";
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + glyphs.ellipsis;
}

/** Pad to a visible width with trailing spaces. */
export function padEnd(text: string, width: number): string {
  const w = displayWidth(text);
  return w >= width ? text : text + " ".repeat(width - w);
}

/** Wrap plain text to a maximum visible width. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 1) return [text];
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (displayWidth(raw) <= width) {
      out.push(raw);
      continue;
    }
    let line = "";
    let w = 0;
    for (const ch of raw) {
      const cw = displayWidth(ch);
      if (w + cw > width) {
        out.push(line);
        line = "";
        w = 0;
      }
      line += ch;
      w += cw;
    }
    out.push(line);
  }
  return out;
}

/** Number of terminal rows a block of text occupies at a given width. */
export function lineCount(text: string, width: number): number {
  return wrapText(text, width).length;
}

/** Collapse the home directory to `~` and normalise separators for display. */
export function compactPath(path: string): string {
  const home = homedir();
  const normalised = path.split(sep).join("/");
  const homeNorm = home.split(sep).join("/");
  if (normalised === homeNorm) return "~";
  if (normalised.startsWith(`${homeNorm}/`)) return `~${normalised.slice(homeNorm.length)}`;
  return normalised;
}

/** Turn provider ids like `free-llm` / `tokenHarbor` into readable names. */
const PROVIDER_NAMES: Record<string, string> = {
  "free-llm": "Free LLM",
  tokenharbor: "Token Harbor",
  "token-harbor": "Token Harbor",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  groq: "Groq",
  ollama: "Ollama",
  anthropic: "Anthropic",
  google: "Google",
  gemini: "Google Gemini",
  agentrouter: "AgentRouter",
  "agent-router": "AgentRouter",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  xai: "xAI",
  cohere: "Cohere",
  qwen: "Alibaba Qwen",
  custom: "Any Custom",
};

/** Terminal-safe status indicator for a provider row. */
export function providerStatusGlyph(status: string): string {
  switch (status) {
    case "connected":
      return UNICODE ? "●" : "*";
    case "unconfigured":
      return UNICODE ? "○" : "o";
    case "checking":
      return UNICODE ? "◐" : "~";
    case "error":
      return UNICODE ? "✕" : "x";
    case "local":
      return UNICODE ? "◆" : "#";
    default:
      return "-";
  }
}

export function providerStatusColor(status: string): string {
  switch (status) {
    case "connected":
      return "green";
    case "unconfigured":
      return "gray";
    case "checking":
      return "yellow";
    case "error":
      return "red";
    case "local":
      return "cyan";
    default:
      return "white";
  }
}

/** "FREE" | "PAID" | "UNKNOWN" from optional model metadata. */
export function priceTag(model: { free?: boolean; pricing?: { prompt?: number; completion?: number } }): "FREE" | "PAID" | "UNKNOWN" {
  if (model.free === true) return "FREE";
  if (model.pricing && (model.pricing.prompt || model.pricing.completion)) return "PAID";
  if (model.free === false) return "PAID";
  return "UNKNOWN";
}

export function formatContextLength(tokens: number | undefined): string {
  if (!tokens) return "unknown";
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}

export function prettyProvider(id: string | undefined): string {
  if (!id) return "Auto";
  const key = id.toLowerCase();
  if (PROVIDER_NAMES[key]) return PROVIDER_NAMES[key]!;
  return id
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function isFreeModel(model: string | undefined, provider?: string): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  const p = (provider ?? "").toLowerCase();
  return m.includes("free") || p.includes("free");
}

/** Single-line summary of a tool call for the transcript. */
export function toolSummary(name: string, args: Record<string, unknown>): string {
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  if (typeof args.pattern === "string") return args.pattern;
  if (typeof args.url === "string") return args.url;
  const text = JSON.stringify(args ?? {});
  return text === "{}" ? "" : text.slice(0, 80);
}

export function agentLabel(name: string | undefined): string {
  if (!name) return "Build";
  return name.charAt(0).toUpperCase() + name.slice(1);
}
