import { createInterface } from "node:readline";
import { join } from "node:path";
import { loadConfig, registerSecrets } from "../config";
import { ApiSystem } from "../api/api-manager";
import { ChatAgent, type ChatEvent } from "../chat/agent";
import { SessionStore, type ChatSession } from "../chat/session";
import { SnapshotStore } from "../chat/snapshots";
import { diffTurn, formatDiff } from "../chat/diff";
import { estimateTokens, sessionToMarkdown } from "../chat/transcript";
import { loadCommands, expandCommand } from "../chat/commands";
import { parseInput } from "../chat/input";
import {
  findAgent,
  loadAgents,
  primaryAgents,
  type AgentConfig,
  type PermissionAction,
} from "../chat/agent-config";
import { loadSkills } from "../chat/skills";
import { initAgentsFile } from "../chat/project-init";
import { shareSession } from "../chat/share";
import { connectMcpServers } from "../mcp/client";
import { Terminal } from "../terminal/terminal";
import { confirm } from "../approval/approver";
import { redact } from "../config";
import { formatCliError } from "../providers/errors";
import { ensureProviderInteractive } from "./auth-command";
import { loadTheme, paint, type Theme } from "./theme";
import { loadPlugins } from "../plugins/plugins";
import type { PluginRunner } from "../plugins/plugins";
import { envVar } from "../compat";

export interface ChatCommandOptions {
  root: string;
  message?: string;
  sessionId?: string;
  continue?: boolean;
  model?: string;
  provider?: string;
  autoApprove?: boolean;
  json?: boolean;
  stream?: boolean;
  maxSteps?: number;
  agent?: string;
  mode?: "plan" | "build";
  allow?: string[];
  deny?: string[];
  pluginFiles?: string[];
  plugins?: PluginRunner;
  maxToolOutput?: number;
  streamJson?: boolean;
  tui?: boolean;
}

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export async function chatCommand(opts: ChatCommandOptions): Promise<void> {
  let config = loadConfig();

  // When we can launch the TUI, let it handle provider selection/connection
  // instead of blocking on a readline prompt before the UI appears.
  const canTui =
    opts.tui !== false &&
    opts.json !== true &&
    !opts.streamJson &&
    process.stdout.isTTY === true &&
    process.stdin.isTTY === true &&
    envVar("NO_TUI") !== "1";

  if (config.providers.filter((p) => p.enabled).length === 0 && !canTui) {
    const configured = await ensureProviderInteractive();
    if (!configured) {
      console.log("No LLM provider configured.");
      console.log("Run `neutron config` to add one, or set OPENAI_BASE_URL / OPENAI_API_KEY (or LLM_*).");
      process.exitCode = 1;
      return;
    }
    config = loadConfig();
  }
  registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));

  const api = new ApiSystem({ config, logger: silentLogger });
  const store = new SessionStore(opts.root);
  const theme = loadTheme();
  const plugins = opts.plugins ?? (await loadPlugins(opts.root, opts.pluginFiles ?? []));

  let session: ChatSession | undefined;
  if (opts.sessionId) {
    session = store.load(opts.sessionId);
    if (!session) {
      console.log(`Session not found: ${opts.sessionId}. Run \`neutron sessions\` to list them.`);
      process.exitCode = 1;
      return;
    }
  } else if (opts.continue) {
    session = store.latest();
    if (!session) {
      console.log("No previous session found; starting a new one.");
    }
  }
  if (!session) {
    session = store.create(undefined, {
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.provider ? { provider: opts.provider } : {}),
    });
  }

  const quiet = opts.json === true;
  const snapshots = new SnapshotStore(opts.root);
  const mcp = await connectMcpServers(opts.root);
  for (const error of mcp.errors) if (!quiet) console.error(`[mcp] ${error}`);
  if (mcp.clients.length > 0) process.on("exit", () => mcp.clients.forEach((c) => c.stop()));
  const agents = loadAgents(opts.root);
  const fallbackName = opts.mode === "plan" ? "plan" : "build";
  let activeAgent: AgentConfig =
    (opts.agent ? findAgent(agents, opts.agent) : undefined) ?? findAgent(agents, fallbackName) ?? agents[0]!;
  let streamedThisTurn = false;

  const permissionOverrides: Record<string, PermissionAction> = {};
  for (const tool of opts.allow ?? []) permissionOverrides[tool] = "allow";
  for (const tool of opts.deny ?? []) permissionOverrides[tool] = "deny";
  const applyOverrides = (agent: AgentConfig): AgentConfig =>
    Object.keys(permissionOverrides).length === 0
      ? agent
      : { ...agent, permissions: { ...agent.permissions, ...permissionOverrides } };

  const spinner = createSpinner(process.stdin.isTTY === true && !quiet);

  const approveTool = async (name: string, args: Record<string, unknown>): Promise<boolean> => {
    if (opts.autoApprove) return true;
    if (quiet || !process.stdin.isTTY) return false;
    const detail = typeof args.command === "string" ? args.command : JSON.stringify(args);
    return confirm(`Allow tool "${name}"? ${redact(detail).slice(0, 160)}`);
  };

  const createAgent = (): ChatAgent =>
    new ChatAgent({
      root: opts.root,
      api,
      model: opts.model ?? session!.model,
      provider: opts.provider ?? session!.provider,
      autoApprove: opts.autoApprove,
      stream: opts.stream !== false && !quiet,
      snapshots,
      mcpTools: mcp.tools,
      agent: applyOverrides(activeAgent),
      agents,
      approveTool,
      plugins,
      ...(opts.maxToolOutput ? { maxToolOutput: opts.maxToolOutput } : {}),
      ...(opts.maxSteps ? { maxSteps: opts.maxSteps } : {}),
      onEvent: (event) => {
        if (opts.streamJson) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
          return;
        }
        if (quiet) return;
        spinner.stop();
        if (event.type === "delta") {
          process.stdout.write(paint(theme, "assistant", redact(event.text)));
          streamedThisTurn = true;
          return;
        }
        if (event.type === "assistant") {
          if (streamedThisTurn) {
            process.stdout.write("\n");
            streamedThisTurn = false;
            return;
          }
          console.log(`\n${paint(theme, "assistant", redact(event.text))}`);
          return;
        }
        printEvent(event, theme);
      },
    });

  let agent = createAgent();

  const commands = loadCommands(opts.root);
  const term = new Terminal({ cwd: opts.root });

  const runShell = async (command: string): Promise<void> => {
    const res = await term.run(command);
    process.stdout.write(`(exit ${res.exitCode})\n${res.stdout}`);
    if (res.stderr.trim()) process.stdout.write(res.stderr.endsWith("\n") ? res.stderr : `${res.stderr}\n`);
  };

  const send = async (text: string): Promise<boolean> => {
    try {
      if (session!.messages.length === 0 && session!.title === "Untitled session") {
        session!.title = text.slice(0, 60) || "Untitled session";
      }
      spinner.start(`${activeAgent.name} is thinking…`);
      await agent.send(session!, text);
      store.save(session!);
      return true;
    } catch (err) {
      const message = redact(formatCliError(err, opts.provider, opts.model));
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: message }));
      } else {
        console.error(`\n${message}`);
      }
      process.exitCode = 1;
      return false;
    } finally {
      spinner.stop();
    }
  };

  const wantTui =
    opts.tui !== false &&
    !quiet &&
    !opts.streamJson &&
    process.stdout.isTTY === true &&
    process.stdin.isTTY === true &&
    envVar("NO_TUI") !== "1";

  let initialMessage: string | undefined;
  if (opts.message) {
    const parsed = parseInput(opts.root, opts.message);
    if (parsed.kind === "shell") {
      await runShell(parsed.text);
      return;
    }
    if (!wantTui) {
      const ok = await send(parsed.text);
      if (opts.json) {
        console.log(
          JSON.stringify({
            ok,
            sessionId: session.id,
            messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        );
      } else if (ok && !opts.streamJson) {
        console.log(`\nSession: ${session.id} (resume with \`neutron chat --session ${session.id}\`)`);
      }
      return;
    }
    initialMessage = parsed.text;
  }

  if (!process.stdin.isTTY) {
    console.log("No message provided and stdin is not interactive.");
    console.log('Use `neutron chat "your question"` or run in a terminal.');
    process.exitCode = 1;
    return;
  }

  if (wantTui) {
    const { createChatRuntime, startChatTui } = await import("../tui");
    const runtime = await createChatRuntime(opts.root, {
      autoApprove: opts.autoApprove,
      ...(opts.maxSteps ? { maxSteps: opts.maxSteps } : {}),
      plugins,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.allow ? { allow: opts.allow } : {}),
      ...(opts.deny ? { deny: opts.deny } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.continue ? { continue: opts.continue } : {}),
    });
    if (runtime) {
      const controller = await startChatTui({
        runtime,
        startOpts: {
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.provider ? { provider: opts.provider } : {}),
          ...(opts.autoApprove ? { autoApprove: opts.autoApprove } : {}),
          ...(initialMessage ? { message: initialMessage } : {}),
        },
      });
      if (controller) {
        await controller.waitUntilExit();
        return;
      }
      runtime.destroy();
    }
  }

  printBanner(session.id, activeAgent.name, theme);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () =>
    rl.setPrompt(
      paint(theme, "prompt", `\n${activeAgent.name}${session!.model ? `:${session!.model}` : ""}> `),
    );

  let busy = false;
  await new Promise<void>((resolve) => {
    prompt();
    rl.prompt();
    rl.on("line", async (line) => {
      const input = line.trim();
      if (!input) {
        prompt();
        rl.prompt();
        return;
      }
      if (busy) {
        console.log("Still working on the previous message; please wait.");
        rl.prompt();
        return;
      }
      if (input === "/exit" || input === "/quit") {
        rl.close();
        return;
      }
      if (input === "/help") {
        printHelp();
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/new" || input === "/clear") {
        session = store.create(undefined, {
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.provider ? { provider: opts.provider } : {}),
        });
        agent = createAgent();
        console.log(`Started new session ${session.id}`);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/tokens") {
        const estimate = estimateTokens(session!);
        console.log(`~${estimate.tokens} tokens across ${estimate.messages} messages (${estimate.characters} chars)`);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/export") {
        console.log(sessionToMarkdown(session!));
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/save" || input.startsWith("/save ")) {
        const target = input.slice(5).trim();
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const dir = join(opts.root, ".agent", "transcripts");
        mkdirSync(dir, { recursive: true });
        const file = target || join(dir, `${session!.id}.md`);
        writeFileSync(file, sessionToMarkdown(session!), "utf8");
        console.log(`Saved transcript to ${file}`);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/fork") {
        store.save(session!);
        const forked = store.fork(session!.id);
        if (!forked) {
          console.log("Could not fork the current session.");
        } else {
          session = forked;
          agent = createAgent();
          console.log(`Forked to session ${session.id}`);
        }
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/sessions") {
        for (const s of store.list().slice(0, 10)) {
          console.log(`  ${s.id}  ${s.title} (${s.messageCount} messages)`);
        }
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/undo") {
        const files = await agent.undo(session!);
        if (files.length === 0) console.log("Nothing to undo.");
        store.save(session!);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/redo") {
        const files = await agent.redo(session!);
        if (files.length === 0) console.log("Nothing to redo.");
        store.save(session!);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/diff") {
        const turns = snapshots.list(session!.id);
        const turn = turns[turns.length - 1];
        if (!turn) console.log("Nothing to diff.");
        else console.log(formatDiff(diffTurn(opts.root, turn)) || "No changes in the last turn.");
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/compact") {
        const compacted = await agent.compact(session!);
        if (!compacted) console.log("Nothing to compact yet.");
        store.save(session!);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/share") {
        store.save(session!);
        const { file } = shareSession(opts.root, session!);
        console.log(`Shared session to ${file}`);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/init") {
        const result = initAgentsFile(opts.root);
        console.log(result.created ? `Created ${result.path}` : `${result.path} already exists.`);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/agents") {
        for (const a of agents) {
          const marker = a.name === activeAgent.name ? "*" : " ";
          console.log(`  ${marker} ${a.name} [${a.mode}] ${a.description}`);
        }
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/plugins") {
        if (plugins.plugins.length === 0) console.log("No plugins loaded. Add .neutron/plugin/*.mjs files.");
        else for (const p of plugins.plugins) console.log(`  ${p.name}  [${Object.keys(p.hooks).join(", ")}]`);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/skills") {
        const skills = loadSkills(opts.root);
        if (skills.length === 0) console.log("No skills. Add SKILL.md files under .neutron/skills/.");
        else for (const s of skills) console.log(`  ${s.name}  ${s.description}`);
        prompt();
        rl.prompt();
        return;
      }
      if (input.startsWith("/agent ")) {
        const name = input.slice(7).trim();
        const next = findAgent(agents, name);
        if (!next) {
          console.log(`Unknown agent: ${name}. Try /agents.`);
        } else {
          activeAgent = next;
          agent = createAgent();
          console.log(`Switched to agent: ${activeAgent.name} [${activeAgent.mode}]`);
        }
        prompt();
        rl.prompt();
        return;
      }
      if (input.startsWith("/mode ")) {
        const mode = input.slice(6).trim();
        const next = findAgent(agents, mode);
        if (!next) console.log(`Unknown mode: ${mode}. Use /mode plan or /mode build.`);
        else {
          activeAgent = next;
          agent = createAgent();
          console.log(`Switched to agent: ${activeAgent.name}`);
        }
        prompt();
        rl.prompt();
        return;
      }
      if (input.startsWith("/model ")) {
        const model = input.slice(7).trim();
        session!.model = model;
        agent = createAgent();
        store.save(session!);
        console.log(`Model set to ${model}.`);
        prompt();
        rl.prompt();
        return;
      }
      if (input.startsWith("/provider ")) {
        const provider = input.slice(10).trim();
        session!.provider = provider;
        agent = createAgent();
        store.save(session!);
        console.log(`Provider set to ${provider}.`);
        prompt();
        rl.prompt();
        return;
      }
      if (input.startsWith("/rename")) {
        const title = input.slice(7).trim();
        if (title) {
          session!.title = title;
          store.save(session!);
          console.log(`Renamed session to "${title}".`);
        } else {
          console.log(`Current title: ${session!.title}`);
        }
        prompt();
        rl.prompt();
        return;
      }
      if (input.startsWith("/search ")) {
        const query = input.slice(8).trim();
        const results = store.search(query);
        if (results.length === 0) console.log(`No sessions matching "${query}".`);
        else for (const s of results.slice(0, 10)) console.log(`  ${s.id}  ${s.title} (${s.messageCount} messages)`);
        prompt();
        rl.prompt();
        return;
      }
      if (input === "/commands") {
        if (commands.length === 0) {
          console.log("No custom commands. Add markdown files under .neutron/commands/.");
        } else {
          for (const c of commands) console.log(`  /${c.name}  ${c.description}`);
        }
        prompt();
        rl.prompt();
        return;
      }
      if (input.startsWith("/")) {
        const [name, ...rest] = input.slice(1).split(/\s+/);
        const command = commands.find((c) => c.name === name);
        if (command) {
          busy = true;
          try {
            await send(expandCommand(command, rest.join(" ")));
          } finally {
            busy = false;
          }
          prompt();
          rl.prompt();
          return;
        }
        console.log(`Unknown command: /${name}. Type /help to see available commands.`);
        prompt();
        rl.prompt();
        return;
      }

      const parsed = parseInput(opts.root, input);
      busy = true;
      try {
        if (parsed.kind === "shell") await runShell(parsed.text);
        else await send(parsed.text);
      } finally {
        busy = false;
      }
      prompt();
      rl.prompt();
    });
    rl.on("close", () => resolve());
  });
}

interface Spinner {
  start(label: string): void;
  stop(): void;
}

function createSpinner(enabled: boolean): Spinner {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let timer: NodeJS.Timeout | undefined;
  let frame = 0;
  return {
    start(label: string) {
      if (!enabled || timer) return;
      timer = setInterval(() => {
        process.stderr.write(`\r${frames[frame++ % frames.length]} ${label}`);
      }, 80);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
      process.stderr.write("\r\x1b[K");
    },
  };
}

function printBanner(sessionId: string, agentName: string, theme: Theme): void {
  console.log(paint(theme, "banner", "NEUTRON CHAT"));
  console.log(`Session: ${sessionId}  Agent: ${agentName}`);
  console.log("Type your request. `/help` for commands, `/exit` to quit.\n");
}

function printHelp(): void {
  console.log("Commands:");
  console.log("  /help        show this help");
  console.log("  /new         start a new session (/clear is an alias)");
  console.log("  /fork        copy this session and switch to the copy");
  console.log("  /tokens      estimate context token usage");
  console.log("  /export      print this session as Markdown");
  console.log("  /save [file] write this session to .agent/transcripts/");
  console.log("  /sessions    list recent sessions");
  console.log("  /undo        restore files changed in the last turn");
  console.log("  /redo        re-apply the last undone turn");
  console.log("  /agents      list available agents");
  console.log("  /agent <n>   switch agent (e.g. /agent plan)");
  console.log("  /mode <n>    switch mode (plan or build)");
  console.log("  /model <id>  switch model");
  console.log("  /provider <id>  switch provider");
  console.log("  /rename <t>  rename the current session");
  console.log("  /search <q>  search past sessions");
  console.log("  /skills      list skills (.neutron/skills/*/SKILL.md)");
  console.log("  /plugins     list loaded plugins (.neutron/plugin/*.mjs)");
  console.log("  /init        create AGENTS.md for this project");
  console.log("  /diff        show changes from the last turn as a unified diff");
  console.log("  /compact     summarize older messages to shrink context");
  console.log("  /share       write this session to .agent/shares/");
  console.log("  /commands    list custom commands (.neutron/commands/*.md)");
  console.log("  /exit        quit (or /quit)");
  console.log("");
  console.log("Input helpers:");
  console.log("  @path/to/file   attach a file's contents to your message");
  console.log("  !command        run a shell command locally without asking the model");
}

function printEvent(event: ChatEvent, theme: Theme): void {
  switch (event.type) {
    case "delta":
      process.stdout.write(paint(theme, "assistant", redact(event.text)));
      break;
    case "assistant":
      console.log(`\n${paint(theme, "assistant", redact(event.text))}`);
      break;
    case "tool-call":
      console.log(paint(theme, "tool", `\n⚙ ${event.name} ${redact(JSON.stringify(event.args))}`));
      break;
    case "tool-result": {
      const firstLine = event.output.split("\n").slice(0, 12).join("\n");
      const line = `${event.ok ? "✓" : "✗"} ${firstLine}${event.output.split("\n").length > 12 ? "\n  ..." : ""}`;
      console.log(paint(theme, event.ok ? "success" : "error", line));
      break;
    }
    case "undo":
      console.log(`\n↩ restored ${event.files.length} file(s): ${event.files.join(", ")}`);
      break;
    case "redo":
      console.log(`\n↪ re-applied ${event.files.length} file(s): ${event.files.join(", ")}`);
      break;
    case "compaction":
      console.log(`\n[compacted ${event.removed} earlier messages, kept ${event.kept}]`);
      break;
    case "step-limit":
      console.log(`\n[reached the ${event.limit}-step limit; send another message to continue]`);
      break;
  }
}
