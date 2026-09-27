export interface TuiCommand {
  name: string;
  description: string;
  aliases?: string[];
}

/**
 * The commands surfaced by the `/` autocomplete menu. Every entry maps to a
 * real handler in the TUI (see App.tsx) or to a custom command loaded from
 * `.neutron/commands/`.
 */
export const COMMANDS: TuiCommand[] = [
  { name: "agents", description: "Switch agent" },
  { name: "connect", description: "Connect a provider" },
  { name: "providers", description: "Browse & manage providers", aliases: ["provider"] },
  { name: "models", description: "Switch model", aliases: ["model"] },
  { name: "settings", description: "Open settings" },
  { name: "themes", description: "Choose a theme" },
  { name: "debug", description: "View debug info" },
  { name: "diff", description: "Open diff viewer" },
  { name: "editor", description: "Open editor" },
  { name: "exit", description: "Exit the app" },
  { name: "help", description: "Help" },
  { name: "init", description: "guided AGENTS.md setup" },
  { name: "mcps", description: "Toggle MCPs" },
  { name: "new", description: "Start a new session" },
  { name: "sessions", description: "Session list, resume, rename, delete" },
  { name: "test", description: "Run project tests" },
  { name: "run", description: "Run the project" },
  { name: "review", description: "Ask the reviewer agent to review changes" },
  { name: "undo", description: "Undo the last turn" },
  { name: "redo", description: "Re-apply the last undone turn" },
  { name: "compact", description: "Compact older messages" },
  { name: "tokens", description: "Show token usage" },
  { name: "fork", description: "Fork this session" },
  { name: "share", description: "Share this session" },
  { name: "save", description: "Export the transcript" },
  { name: "plugins", description: "List loaded plugins" },
  { name: "skills", description: "List available skills" },
  { name: "clear", description: "Clear the conversation" },
];

export interface PaletteAction {
  id: string;
  label: string;
  keywords?: string;
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: "search", label: "Search commands", keywords: "find filter" },
  { id: "agent", label: "Switch agent", keywords: "agents build plan" },
  { id: "model", label: "Select model", keywords: "models search" },
  { id: "provider", label: "Manage providers", keywords: "providers connect auth" },
  { id: "new", label: "New session", keywords: "clear reset" },
  { id: "sessions", label: "Sessions", keywords: "history resume" },
  { id: "diff", label: "View diff", keywords: "changes" },
  { id: "undo", label: "Undo", keywords: "revert" },
  { id: "redo", label: "Redo", keywords: "reapply" },
  { id: "init", label: "Initialize project", keywords: "agents.md" },
  { id: "test", label: "Run tests", keywords: "npm test" },
  { id: "run", label: "Run project", keywords: "dev server" },
  { id: "review", label: "Review changes", keywords: "reviewer" },
  { id: "mcps", label: "MCPs", keywords: "servers tools" },
  { id: "settings", label: "Settings", keywords: "config theme" },
  { id: "themes", label: "Themes", keywords: "colors" },
  { id: "exit", label: "Exit", keywords: "quit" },
];

export function filterCommands(prefix: string): TuiCommand[] {
  const needle = prefix.replace(/^\//, "").toLowerCase();
  if (!needle) return COMMANDS;
  return COMMANDS.filter(
    (c) =>
      c.name.toLowerCase().startsWith(needle) ||
      c.aliases?.some((a) => a.startsWith(needle)) ||
      c.description.toLowerCase().includes(needle),
  );
}

export function filterPalette(prefix: string): PaletteAction[] {
  const needle = prefix.trim().toLowerCase();
  if (!needle) return PALETTE_ACTIONS;
  return PALETTE_ACTIONS.filter(
    (a) => a.label.toLowerCase().includes(needle) || a.keywords?.includes(needle),
  );
}
