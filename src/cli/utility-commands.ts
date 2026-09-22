import { existsSync, readdirSync, watch } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, globalConfigPath, readGlobalProviders } from "../config";
import { SessionStore } from "../chat/session";
import { estimateTokens, formatTranscript, sessionToMarkdown } from "../chat/transcript";
import { ToolRegistry, createDefaultTools } from "../tools";
import type { ToolContext } from "../tools";
import { formatFile, detectFormatters } from "../format/formatter";
import { Terminal } from "../terminal/terminal";
import { getVersion } from "../version";
import { envVar } from "../compat";

export function envCommand(root: string): void {
  const config = loadConfig();
  const providers = readGlobalProviders();
  const sessions = new SessionStore(root).list().length;
  const lines = [
    "NEUTRON ENV",
    "",
    `Version:   ${getVersion()}`,
    `Platform:  ${process.platform} ${process.arch}`,
    `Node:      ${process.version}`,
    `CWD:       ${root}`,
    `Config:    ${existsSync(globalConfigPath()) ? globalConfigPath() : `${globalConfigPath()} (missing)`}`,
    `Providers: ${providers.length} configured, ${config.providers.length} resolved`,
    `Sessions:  ${sessions}`,
    `Theme:     ${envVar("THEME") ?? "(config default)"}`,
  ];
  console.log(lines.join("\n"));
}

export function tokensCommand(root: string, sessionId?: string, json = false): void {
  const store = new SessionStore(root);
  const session = sessionId ? store.load(sessionId) : store.latest();
  if (!session) {
    console.log("Session not found.");
    process.exitCode = 1;
    return;
  }
  const estimate = estimateTokens(session);
  if (json) {
    console.log(JSON.stringify({ sessionId: session.id, ...estimate }, null, 2));
    return;
  }
  console.log(`Session ${session.id} — ${session.title}`);
  console.log(`  messages:   ${estimate.messages}`);
  console.log(`  characters: ${estimate.characters}`);
  console.log(`  ~tokens:    ${estimate.tokens}`);
}

export function replayCommand(root: string, sessionId?: string, opts?: { json?: boolean; tools?: boolean }): void {
  const store = new SessionStore(root);
  const session = sessionId ? store.load(sessionId) : store.latest();
  if (!session) {
    console.log("Session not found.");
    process.exitCode = 1;
    return;
  }
  if (opts?.json) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }
  console.log(sessionToMarkdown(session));
}

function makeCtx(root: string): ToolContext {
  const terminal = new Terminal({ cwd: root });
  return { root, run: (cmd, o) => terminal.run(cmd, o), log: () => {} };
}

export async function grepCommand(
  root: string,
  pattern: string,
  opts: { path?: string; include?: string; ignoreCase?: boolean; json?: boolean },
): Promise<void> {
  const registry = new ToolRegistry(createDefaultTools());
  const args: Record<string, unknown> = { pattern };
  if (opts.path) args.path = opts.path;
  if (opts.include) args.include = opts.include;
  const result = await registry.execute("grep", args, makeCtx(root));
  const lines = result.output.split("\n").filter(Boolean);
  if (opts.json) {
    console.log(JSON.stringify({ pattern, matches: lines }, null, 2));
    return;
  }
  console.log(result.output.trimEnd());
}

export async function findCommand(root: string, pattern: string, opts: { path?: string; json?: boolean }): Promise<void> {
  const registry = new ToolRegistry(createDefaultTools());
  const args: Record<string, unknown> = { pattern };
  if (opts.path) args.path = opts.path;
  const result = await registry.execute("glob", args, makeCtx(root));
  const files = result.output.split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean);
  if (opts.json) {
    console.log(JSON.stringify(files, null, 2));
    return;
  }
  console.log(files.join("\n"));
}

export async function fmtCommand(root: string, paths: string[], all = false): Promise<void> {
  const formatters = detectFormatters(root);
  if (formatters.length === 0) {
    console.log("No formatters detected (Prettier/gofmt/rustfmt/black).");
    return;
  }
  let targets = paths;
  if (targets.length === 0 && all) {
    targets = walk(root).map((p) => relative(root, p));
  }
  if (targets.length === 0) {
    console.log("Provide file paths, or pass --all to format the whole project.");
    return;
  }
  const terminal = new Terminal({ cwd: root });
  let formatted = 0;
  for (const target of targets) {
    const result = await formatFile(root, target, (cmd, o) => terminal.run(cmd, o), formatters);
    if (result.ok) {
      formatted++;
      console.log(`formatted ${target} (${result.formatter})`);
    } else if (result.message && result.message !== "no formatter") {
      console.log(`skipped ${target}: ${result.message}`);
    }
  }
  console.log(`Formatted ${formatted} file(s).`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export async function benchCommand(root: string): Promise<void> {
  const { ApiSystem } = await import("../api/api-manager");
  const config = loadConfig();
  const api = new ApiSystem({
    config,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  const start = Date.now();
  try {
    const result = await api.chat("general", [{ role: "user", content: "Reply with the word ok." }]);
    const ms = Date.now() - start;
    console.log(`Provider responded in ${ms}ms (${result.provider}/${result.model}): ${result.text.slice(0, 40)}`);
  } catch (err) {
    console.log(`Benchmark failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

export function watchCommand(root: string, command: string[]): void {
  if (command.length === 0) {
    console.log("Usage: neutron watch -- <command>");
    process.exitCode = 1;
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const runOnce = () => {
    console.log(`\n> ${command.join(" ")}`);
    spawnSync(command[0]!, command.slice(1), { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  };
  console.log(`Watching ${root} — re-running on changes. Press Ctrl+C to stop.`);
  runOnce();
  try {
    watch(root, { recursive: true }, (_event, filename) => {
      if (filename && /(node_modules|\.git|dist)[\\/]/.test(String(filename))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(runOnce, 200);
    });
  } catch {
    console.log("File watching is not supported on this platform.");
  }
}

export function completionScript(shell: string): string {
  const commands = [
    "init",
    "design",
    "run",
    "chat",
    "models",
    "sessions",
    "agent",
    "mcp",
    "plugin",
    "stats",
    "export",
    "serve",
    "web",
    "acp",
    "theme",
    "lsp",
    "github",
    "fmt",
    "grep",
    "find",
    "tokens",
    "replay",
    "env",
    "diff",
  ];
  if (shell === "bash") {
    return `_neutron_complete() {\n  local cur="\${COMP_WORDS[COMP_CWORD]}"\n  COMPREPLY=( $(compgen -W "${commands.join(" ")}" -- "$cur") )\n}\ncomplete -F _neutron_complete neutron`;
  }
  if (shell === "zsh") {
    return `#compdef neutron\n_neutron() { compadd ${commands.join(" ")} }\ncompdef _neutron neutron`;
  }
  if (shell === "powershell") {
    return `Register-ArgumentCompleter -Native -CommandName neutron -ScriptBlock {\n  param($wordToComplete)\n  "${commands.join(" ")}".Split(" ") | Where-Object { $_ -like "$wordToComplete*" }\n}`;
  }
  return "";
}

export function selfUpdateCommand(): void {
  const current = getVersion();
  console.log(`Current version: ${current}`);
  const res = spawnSync("npm", ["view", "neutron-agent", "version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.log("Could not reach the npm registry. Run `npm install -g neutron-agent@latest` to update.");
    return;
  }
  const latest = res.stdout.trim();
  if (latest && latest !== current) {
    console.log(`Latest version:  ${latest}`);
    console.log(`Update with: npm install -g neutron-agent@latest`);
  } else {
    console.log("You are on the latest version.");
  }
}
