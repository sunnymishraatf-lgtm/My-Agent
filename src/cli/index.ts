import { Command } from "commander";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initCommand, designCommand } from "./init-design-commands";
import { runDoctor, formatDoctor } from "./doctor";
import { configCommand } from "./config-command";
import { stateCommand, printReview } from "./state-command";
import { runCommand } from "./run-command";
import { reviewCommand, testCommand, logsCommand } from "./review-test-commands";
import { chatCommand } from "./chat-command";
import { modelsCommand } from "./models-command";
import { sessionsCommand } from "./sessions-command";
import { authLogin, authList, authLogout, ensureProviderInteractive } from "./auth-command";
import { StateStore } from "../store";
import { SessionStore, type ChatSession } from "../chat/session";
import { SnapshotStore, captureCurrent, restoreTurn } from "../chat/snapshots";
import { diffTurn, formatDiff } from "../chat/diff";
import {
  deleteAgentFile,
  findAgent,
  findAgentFile,
  loadAgents,
  primaryAgents,
  subagents,
} from "../chat/agent-config";
import { shareSession } from "../chat/share";
import { startServer } from "../server/server";
import { AcpServer } from "../acp/server";
import { registerNeutronCommand } from "./neutron-command";
import { installGitHubWorkflow, readEventFromEnv, runGitHubAction } from "../github/actions";
import { readLspConfig } from "../lsp/client";
import { listThemes, loadTheme, paint, setTheme } from "./theme";
import {
  benchCommand,
  completionScript,
  envCommand,
  findCommand,
  fmtCommand,
  grepCommand,
  replayCommand,
  selfUpdateCommand,
  tokensCommand,
  watchCommand,
} from "./utility-commands";
import { sessionToMarkdown } from "../chat/transcript";
import { expandAlias, loadAliases, removeAlias, setAlias } from "./aliases";
import { createAgentRegistry } from "../agents/registry";
import { ApiSystem } from "../api/api-manager";
import {
  configDir,
  loadConfig,
  readGlobalProviders,
  readRawConfig,
  registerSecrets,
  writeGlobalConfig,
} from "../config";
import { connectMcpServers, readMcpConfig } from "../mcp/client";
import { loadPlugins } from "../plugins/plugins";
import { Orchestrator } from "../orchestrator/orchestrator";
import { parseDesignSystem } from "../design/parser";
import { getVersion } from "../version";
import { envVar } from "../compat";
import { loadDotEnvFiles } from "../env";

export function main(): void {
  // Load `.env` (cwd, then home) before anything reads process.env, so
  // provider keys configured in a `.env` file actually take effect.
  // Real environment variables always win over file values.
  loadDotEnvFiles();

  const program = new Command();

  // `sunny` is kept as a deprecated alias of `neutron` (same entry point).
  const invokedAs = basename(process.argv[1] ?? "").replace(/\.(c|m)?js$/, "");
  if (invokedAs === "sunny") {
    console.error("Note: the `sunny` command is deprecated and now called `neutron`. Please switch to `neutron`.");
  }

  program
    .name("neutron")
    .description("NEUTRON — Autonomous Software Maintenance Intelligence. Impact-aware, multi-agent maintenance with human approval gates.")
    .version(getVersion());

  program.addHelpText("before", `${paint(loadTheme(), "banner", "NEUTRON")} — Autonomous Software Maintenance Intelligence\n`);
  program.addHelpText(
    "after",
    "\nCommon: `neutron chat` to code, `neutron run` to build from design.md, `neutron doctor` to check setup.\n",
  );

  program
    .command("init")
    .description("Initialize a NEUTRON project.")
    .option("-t, --template", "Also create design.md from template")
    .option("-f, --force", "Overwrite an existing design.md when using --template")
    .action((opts: { template?: boolean; force?: boolean }) => {
      initCommand(process.cwd(), opts);
    });

  program
    .command("design")
    .description("Create or check design.md.")
    .option("-t, --template", "Create from starter template")
    .option("--check", "Validate existing design.md")
    .action((opts: { template?: boolean; check?: boolean }) => {
      const cwd = process.cwd();
      if (opts.check) {
        const p = join(cwd, "design.md");
        if (!existsSync(p)) {
          console.log("design.md not found.");
          process.exitCode = 1;
          return;
        }
        const design = parseDesignSystem(readFileSync(p, "utf8"));
        console.log(`design.md parsed: ${design.features.length} features, ${design.pages.length} pages`);
        for (const w of design.warnings) console.log(`  ⚠ ${w}`);
        if (design.warnings.length > 0) process.exitCode = 1;
        return;
      }
      designCommand(cwd, opts);
    });

  program
    .command("plan")
    .description("Generate the engineering task plan from design.md.")
    .action(async () => {
      const cwd = process.cwd();
      if (!existsSync(join(cwd, "design.md"))) {
        console.log("design.md not found. Run `neutron design --template` first.");
        process.exitCode = 1;
        return;
      }
      const config = loadConfig();
      registerSecrets(config.providers.map((p) => p.apiKey).filter((k): k is string => !!k));
      const store = new StateStore(cwd);
      store.ensure();
      const api = new ApiSystem({ config, logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
      const agents = createAgentRegistry();
      const orchestrator = new Orchestrator({
        root: cwd,
        agents,
        config: {
          maxConcurrentRequests: config.api.maxConcurrentRequests,
          maxIterations: config.completion.maxIterations,
        },
        api,
        log: () => {},
        store,
      });
      const plan = await orchestrator.plan();
      if (!plan.ok) {
        console.log(`Cannot plan: ${plan.reasons.join("; ")}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Engineering plan: ${plan.tasks.length} tasks, using ${plan.design?.features.length ?? 0} features.\n`);
      for (const t of plan.tasks) {
        const deps = t.dependencies.length ? ` [after ${t.dependencies.join(",")}]` : "";
        console.log(`  ${t.id} (${t.agent}) ${t.description}${deps}`);
      }
      store.setTasks(plan.tasks);
      store.setMeta({ name: plan.design?.project ?? "", status: "planned" });
      console.log("\nPlan saved. Run `neutron run` to execute, or `neutron status` to inspect.");
    });

  program
    .command("run")
    .description("Start the agent team. Reads design.md, plans, and executes.")
    .option("--no-ui", "Plain console output (no TUI)")
    .option("--json", "Machine-readable JSON output")
    .option("-y, --yes", "Auto-approve prompts")
    .option("--resume", "Resume from saved state")
    .action(async (opts: { ui?: boolean; json?: boolean; yes?: boolean; resume?: boolean }) => {
      await runCommand({
        root: process.cwd(),
        autoApprove: opts.yes,
        resume: opts.resume,
        interactive: opts.ui !== false && process.stdout.isTTY === true,
        json: opts.json,
      });
    });

  program
    .command("status")
    .description("Show agent and task status.")
    .option("--json", "Machine-readable JSON output")
    .action((opts: { json?: boolean }) => {
      const store = new StateStore(process.cwd());
      if (opts.json) {
        console.log(JSON.stringify({ meta: store.getMeta(), tasks: store.getTasks() }, null, 2));
      } else {
        stateCommand(store);
      }
    });

  program
    .command("review")
    .description("Run the code reviewer agent.")
    .action(async () => {
      await reviewCommand(process.cwd());
    });

  program
    .command("test")
    .description("Run the project's tests and build.")
    .option("-w, --watch", "Watch mode")
    .action(async (opts) => {
      await testCommand(process.cwd(), { watch: opts.watch });
    });

  program
    .command("fix")
    .description("Re-run failed tasks to fix detected problems.")
    .action(async () => {
      const cwd = process.cwd();
      const store = new StateStore(cwd);
      const tasks = store.getTasks();
      const failed = tasks.filter((t) => t.status === "failed" || t.status === "blocked");
      if (failed.length === 0) {
        console.log("No failed tasks to fix.");
        return;
      }
      for (const t of failed) {
        t.status = "pending";
        if (t.retries === undefined) t.retries = 0;
        t.retries++;
      }
      store.setTasks(tasks);
      console.log(`Queued ${failed.length} task(s) for retry. Run \`neutron run --resume\`.`);
    });

  program
    .command("doctor")
    .description("Check configuration and dependencies.")
    .option("--chat", "Send a tiny chat request to verify the API key actually works")
    .action(async (opts: { chat?: boolean }) => {
      const report = await runDoctor({ chat: opts.chat });
      console.log(formatDoctor(report));
      const chatFailed = opts.chat && report.providers.some((p) => p.chat && !p.chat.ok);
      if (!report.node.ok || !report.npm.ok || chatFailed) process.exitCode = 1;
    });

  program
    .command("config")
    .description("Configure API providers.")
    .option("--list", "List configured providers")
    .option("--show", "Print the resolved configuration (API keys redacted)")
    .option("--get <key>", "Read a raw config value (dotted path)")
    .option("--set <key=value>", "Write a raw config value (dotted path)")
    .option("--add <id>", "Add or update a provider non-interactively")
    .option("--base-url <url>", "Base URL for --add")
    .option("--api-key <key>", "API key for --add")
    .option("--models <list>", "Comma-separated model ids for --add")
    .option("--remove <id>", "Remove a provider")
    .option("--enable <id>", "Enable a provider")
    .option("--disable <id>", "Disable a provider")
    .action(async (opts: Parameters<typeof configCommand>[0]) => {
      await configCommand(opts);
    });

  const auth = program
    .command("auth")
    .description("Manage provider credentials (alias for `neutron config`).")
    .action(() => {
      authList();
    });

  auth
    .command("login [provider]")
    .description("Store an API key for a provider.")
    .option("--key <key>", "API key (prompted if omitted)")
    .option("--base-url <url>", "Override the provider base URL")
    .option("--models <list>", "Comma-separated model ids")
    .action(async (provider: string | undefined, opts: { key?: string; baseUrl?: string; models?: string }) => {
      await authLogin(provider, opts);
    });

  auth
    .command("list")
    .description("List configured providers.")
    .action(() => {
      authList();
    });

  auth
    .command("logout <provider>")
    .description("Remove a provider's stored credentials.")
    .action((provider: string) => {
      authLogout(provider);
    });

  program
    .command("chat [message]")
    .description("Chat with an AI coding agent that can read, edit and run code.")
    .option("-c, --continue", "Continue the most recent session")
    .option("-s, --session <id>", "Resume a specific session id")
    .option("-m, --model <model>", "Model id to use")
    .option("-p, --provider <provider>", "Provider id to use")
    .option("-y, --yes", "Auto-approve tool commands")
    .option("--json", "Machine-readable output (one-shot mode)")
    .option("--no-stream", "Disable streaming responses")
    .option("-a, --agent <name>", "Agent to use (see `neutron agent list`)")
    .option("--mode <mode>", "Agent mode: plan or build")
    .option("--allow <list>", "Comma-separated tools to allow (overrides the agent)")
    .option("--deny <list>", "Comma-separated tools to deny (overrides the agent)")
    .option("--plugin <files...>", "Load plugin files (in addition to .neutron/plugin/)")
    .option("--max-tool-output <n>", "Cap tool output kept in context (characters)", (v) => Number(v))
    .option("--no-tui", "Use the plain REPL instead of the full-screen TUI")
    .option("--stream-json", "Emit NDJSON events for scripting")
    .action(
      async (
        message: string | undefined,
        opts: {
          continue?: boolean;
          session?: string;
          model?: string;
          provider?: string;
          yes?: boolean;
          json?: boolean;
          stream?: boolean;
          agent?: string;
          mode?: string;
          allow?: string;
          deny?: string;
          plugin?: string[];
          maxToolOutput?: number;
          streamJson?: boolean;
          tui?: boolean;
        },
      ) => {
        const splitList = (value?: string): string[] | undefined => {
          const list = value?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
          return list.length > 0 ? list : undefined;
        };
        await chatCommand({
          root: process.cwd(),
          message,
          continue: opts.continue,
          sessionId: opts.session,
          model: opts.model,
          provider: opts.provider,
          autoApprove: opts.yes,
          json: opts.json,
          stream: opts.stream,
          agent: opts.agent,
          mode: opts.mode === "plan" || opts.mode === "build" ? opts.mode : undefined,
          allow: splitList(opts.allow),
          deny: splitList(opts.deny),
          pluginFiles: opts.plugin,
          maxToolOutput: opts.maxToolOutput,
          streamJson: opts.streamJson,
          tui: opts.tui,
        });
      },
    );

  program
    .command("models")
    .description("List models available from configured providers.")
    .option("-p, --provider <id>", "Only list models for this provider")
    .option("--json", "Machine-readable JSON output")
    .action(async (opts: { provider?: string; json?: boolean }) => {
      await modelsCommand(opts);
    });

  program
    .command("sessions")
    .description("List, show or delete chat sessions.")
    .option("--show <id>", "Print the full transcript of a session")
    .option("--delete <id>", "Delete a session")
    .option("--rename <id>", "Rename a session (requires --title)")
    .option("--title <text>", "New title for --rename or --fork")
    .option("--search <query>", "Search session titles and messages")
    .option("--fork <id>", "Copy a session into a new one")
    .option("--at <n>", "Fork only the first N messages", (v) => Number(v))
    .option("--prune", "Delete old sessions")
    .option("--keep <n>", "How many recent sessions to keep when pruning", (v) => Number(v), 10)
    .option("--json", "Machine-readable JSON output")
    .action(
      (opts: {
        show?: string;
        delete?: string;
        rename?: string;
        title?: string;
        search?: string;
        fork?: string;
        at?: number;
        prune?: boolean;
        keep?: number;
        json?: boolean;
      }) => {
        sessionsCommand({ root: process.cwd(), ...opts });
      },
    );

  program
    .command("undo")
    .description("Restore files changed by the last chat turn.")
    .option("-s, --session <id>", "Undo the last turn of a specific session")
    .action((opts: { session?: string }) => {
      const cwd = process.cwd();
      const sessions = new SessionStore(cwd);
      const id = opts.session ?? sessions.latest()?.id;
      if (!id) {
        console.log("No chat sessions found.");
        process.exitCode = 1;
        return;
      }
      const snapshots = new SnapshotStore(cwd);
      const turn = snapshots.pop(id);
      if (!turn) {
        console.log("Nothing to undo.");
        return;
      }
      // Capture the current on-disk state BEFORE restoring so redo can re-apply it.
      const before = captureCurrent(cwd, Object.keys(turn.files));
      const files = restoreTurn(cwd, turn);
      snapshots.pushRedo(id, before);
      console.log(files.length > 0 ? `Restored ${files.length} file(s): ${files.join(", ")}` : "Nothing to undo.");
    });

  program
    .command("redo")
    .description("Re-apply files changed by the last undone chat turn.")
    .option("-s, --session <id>", "Redo the last undone turn of a specific session")
    .action((opts: { session?: string }) => {
      const cwd = process.cwd();
      const sessions = new SessionStore(cwd);
      const id = opts.session ?? sessions.latest()?.id;
      if (!id) {
        console.log("No chat sessions found.");
        process.exitCode = 1;
        return;
      }
      const snapshots = new SnapshotStore(cwd);
      const turn = snapshots.popRedo(id);
      if (!turn) {
        console.log("Nothing to redo.");
        return;
      }
      const files = restoreTurn(cwd, turn);
      console.log(files.length > 0 ? `Re-applied ${files.length} file(s): ${files.join(", ")}` : "Nothing to redo.");
    });

  program
    .command("diff")
    .description("Show changes made by the last chat turn as a unified diff.")
    .option("-s, --session <id>", "Use a specific session")
    .option("--json", "Machine-readable JSON output")
    .action((opts: { session?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const sessions = new SessionStore(cwd);
      const id = opts.session ?? sessions.latest()?.id;
      if (!id) {
        console.log("No chat sessions found.");
        process.exitCode = 1;
        return;
      }
      const turns = new SnapshotStore(cwd).list(id);
      const turn = turns[turns.length - 1];
      if (!turn) {
        console.log("Nothing to diff.");
        return;
      }
      const diffs = diffTurn(cwd, turn);
      if (opts.json) {
        console.log(JSON.stringify(diffs.map((d) => ({ ...d })), null, 2));
        return;
      }
      const patch = formatDiff(diffs);
      console.log(patch || "No changes in the last turn.");
    });

  const agentCmd = program.command("agent").description("Manage agents (primary agents and subagents).");
  agentCmd
    .command("list")
    .description("List all available agents.")
    .option("--json", "Machine-readable JSON output")
    .action((opts: { json?: boolean }) => {
      const agents = loadAgents(process.cwd());
      if (opts.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }
      const builtin = (a: { builtin?: boolean }) => (a.builtin ? "" : " (custom)");
      console.log("Primary agents:");
      for (const a of primaryAgents(agents)) console.log(`  ${a.name}${builtin(a)} — ${a.description}`);
      console.log("Subagents:");
      for (const a of subagents(agents)) console.log(`  ${a.name}${builtin(a)} — ${a.description}`);
    });
  agentCmd
    .command("create")
    .description("Create a new markdown agent.")
    .requiredOption("--name <name>", "Agent name (file name)")
    .requiredOption("--description <text>", "What the agent does")
    .option("--mode <mode>", "primary, subagent or all", "subagent")
    .option("--prompt <text>", "System prompt body")
    .option("--permissions <list>", "Comma-separated allowed tools (default: all)")
    .option("--global", "Write to the global config directory instead of the project")
    .action(
      (opts: {
        name: string;
        description: string;
        mode: string;
        prompt?: string;
        permissions?: string;
        global?: boolean;
      }) => {
        const mode = opts.mode === "primary" || opts.mode === "subagent" || opts.mode === "all" ? opts.mode : "subagent";
        const lines = ["---", `description: ${opts.description}`, `mode: ${mode}`];
        if (opts.permissions) {
          lines.push("permission:");
          const allowed = opts.permissions.split(",").map((s) => s.trim()).filter(Boolean);
          if (allowed.length > 0) {
            lines.push("  edit: deny");
            lines.push("  bash: deny");
            for (const tool of allowed) lines.push(`  ${tool}: allow`);
          }
        }
        lines.push("---", "");
        lines.push(opts.prompt ?? `You are the ${opts.name} agent. ${opts.description}`);
        lines.push("");
        const dir = opts.global ? join(configDir(), "agent") : join(process.cwd(), ".neutron", "agent");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${opts.name}.md`);
        writeFileSync(file, lines.join("\n"), "utf8");
        console.log(`Created agent ${opts.name} at ${file}`);
      },
    );
  agentCmd
    .command("show <name>")
    .description("Show an agent's configuration and source file.")
    .option("--json", "Machine-readable JSON output")
    .action((name: string, opts: { json?: boolean }) => {
      const agents = loadAgents(process.cwd());
      const agent = findAgent(agents, name);
      if (!agent) {
        console.error(`Unknown agent: ${name}. Run \`neutron agent list\`.`);
        process.exitCode = 1;
        return;
      }
      const file = findAgentFile(process.cwd(), name);
      if (opts.json) {
        console.log(JSON.stringify({ ...agent, file }, null, 2));
        return;
      }
      console.log(`${agent.name} [${agent.mode}]${agent.builtin ? " (built-in)" : ""}`);
      console.log(`  ${agent.description}`);
      console.log(`  source: ${file ?? "built-in"}`);
      console.log(`  permissions: ${JSON.stringify(agent.permissions)}`);
      if (agent.model) console.log(`  model: ${agent.model}`);
      if (agent.prompt) console.log(`  prompt:\n${agent.prompt.split("\n").map((l) => `    ${l}`).join("\n")}`);
    });
  agentCmd
    .command("delete <name>")
    .description("Delete a custom agent markdown file.")
    .action((name: string) => {
      const file = findAgentFile(process.cwd(), name);
      if (!file) {
        console.error(`No custom agent file for "${name}" (built-in agents cannot be deleted).`);
        process.exitCode = 1;
        return;
      }
      const ok = deleteAgentFile(process.cwd(), name);
      console.log(ok ? `Deleted ${file}` : `Failed to delete ${file}`);
      if (!ok) process.exitCode = 1;
    });

  const pluginCmd = program.command("plugin").description("Manage agent plugins.");
  pluginCmd
    .command("list")
    .description("List loaded plugins and their hooks.")
    .option("--json", "Machine-readable JSON output")
    .action(async (opts: { json?: boolean }) => {
      const runner = await loadPlugins(process.cwd());
      if (opts.json) {
        console.log(JSON.stringify(runner.plugins.map((p) => ({ name: p.name, hooks: Object.keys(p.hooks) })), null, 2));
        return;
      }
      if (runner.plugins.length === 0) {
        console.log("No plugins loaded. Add files under .neutron/plugin/ or `neutron plugin add <file>`.");
        return;
      }
      for (const plugin of runner.plugins) console.log(`  ${plugin.name}  [${Object.keys(plugin.hooks).join(", ")}]`);
    });
  pluginCmd
    .command("add <file>")
    .description("Register a plugin file in the global config.")
    .action((file: string) => {
      const raw = readRawConfig();
      const list = Array.isArray(raw.plugin) ? (raw.plugin as string[]) : [];
      if (list.includes(file)) {
        console.log(`${file} is already registered.`);
        return;
      }
      list.push(file);
      const saved = writeGlobalConfig({ version: 1, ...raw, plugin: list });
      console.log(saved ? `Registered plugin ${file}.` : "Failed to write config.");
    });
  pluginCmd
    .command("remove <file>")
    .description("Unregister a plugin from the global config.")
    .action((file: string) => {
      const raw = readRawConfig();
      const list = Array.isArray(raw.plugin) ? (raw.plugin as string[]) : [];
      const next = list.filter((p) => p !== file);
      const saved = writeGlobalConfig({ version: 1, ...raw, plugin: next });
      console.log(saved ? `Removed plugin ${file}.` : "Failed to write config.");
    });

  const mcpCmd = program.command("mcp").description("Manage Model Context Protocol servers.");
  mcpCmd
    .command("list")
    .description("List configured MCP servers and their tools.")
    .option("--json", "Machine-readable JSON output")
    .action(async (opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const configs = readMcpConfig(cwd);
      const names = Object.keys(configs);
      if (names.length === 0) {
        console.log("No MCP servers configured. Add one with `neutron mcp add`.");
        return;
      }
      const connection = await connectMcpServers(cwd);
      const byServer = new Map<string, string[]>();
      for (const tool of connection.tools) {
        const server = tool.name.split("_")[0] ?? "?";
        const list = byServer.get(server) ?? [];
        list.push(tool.name);
        byServer.set(server, list);
      }
      if (opts.json) {
        console.log(
          JSON.stringify(
            names.map((name) => ({ name, tools: byServer.get(name) ?? [], error: connection.errors.find((e) => e.startsWith(`${name}:`)) })),
            null,
            2,
          ),
        );
        connection.clients.forEach((c) => c.stop());
        return;
      }
      for (const name of names) {
        const error = connection.errors.find((e) => e.startsWith(`${name}:`));
        const tools = byServer.get(name) ?? [];
        console.log(`  ${name}: ${error ? `error (${error})` : `${tools.length} tool(s)`}`);
        for (const tool of tools) console.log(`      - ${tool}`);
      }
      connection.clients.forEach((c) => c.stop());
    });
  mcpCmd
    .command("add")
    .description("Add an MCP server to your configuration.")
    .requiredOption("--name <name>", "Server name")
    .requiredOption("--command <command>", "Executable to launch (e.g. npx)")
    .option("--args <args>", "Comma-separated arguments")
    .option("--env <pairs>", "Comma-separated KEY=VALUE environment variables")
    .option("--project", "Write to .neutron/mcp.json instead of the global config")
    .action((opts: { name: string; command: string; args?: string; env?: string; project?: boolean }) => {
      const config: { command: string; args?: string[]; env?: Record<string, string> } = { command: opts.command };
      if (opts.args) config.args = opts.args.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.env) {
        config.env = {};
        for (const pair of opts.env.split(",")) {
          const eq = pair.indexOf("=");
          if (eq > 0) config.env[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
        }
      }
      if (opts.project) {
        const dir = join(process.cwd(), ".neutron");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "mcp.json");
        const existing = existsSync(file)
          ? (JSON.parse(readFileSync(file, "utf8")) as { mcp?: Record<string, unknown> })
          : {};
        writeFileSync(file, JSON.stringify({ ...existing, mcp: { ...(existing.mcp ?? {}), [opts.name]: config } }, null, 2), "utf8");
        console.log(`Added MCP server ${opts.name} to ${file}`);
        return;
      }
      const raw = readRawConfig();
      const mcp = raw.mcp && typeof raw.mcp === "object" ? (raw.mcp as Record<string, unknown>) : {};
      mcp[opts.name] = config;
      writeGlobalConfig({ version: 1, ...raw, mcp });
      console.log(`Added MCP server ${opts.name} to ${configDir()}`);
    });

  program
    .command("stats")
    .description("Show session and usage statistics.")
    .option("--json", "Machine-readable JSON output")
    .action((opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const sessions = new SessionStore(cwd);
      const list = sessions.list();
      let messages = 0;
      let chars = 0;
      for (const meta of list) {
        const session = sessions.load(meta.id);
        if (!session) continue;
        messages += session.messages.length;
        for (const m of session.messages) chars += m.content.length;
      }
      const stats = {
        sessions: list.length,
        messages,
        approxTokens: Math.round(chars / 4),
      };
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(`Sessions:       ${stats.sessions}`);
      console.log(`Messages:       ${stats.messages}`);
      console.log(`Approx. tokens: ${stats.approxTokens}`);
    });

  program
    .command("export [session]")
    .description("Export a chat session as JSON or Markdown (defaults to the latest).")
    .option("--sanitize", "Redact message content")
    .option("--md", "Export as a Markdown transcript")
    .action((sessionId: string | undefined, opts: { sanitize?: boolean; md?: boolean }) => {
      const cwd = process.cwd();
      const sessions = new SessionStore(cwd);
      const session = sessionId ? sessions.load(sessionId) : sessions.latest();
      if (!session) {
        console.log("Session not found. Run `neutron sessions` to list them.");
        process.exitCode = 1;
        return;
      }
      if (opts.md) {
        console.log(opts.sanitize ? sessionToMarkdown({ ...session, messages: [] }) : sessionToMarkdown(session));
        return;
      }
      const out = opts.sanitize
        ? { ...session, messages: session.messages.map((m) => ({ role: m.role, content: "[redacted]" })) }
        : session;
      console.log(JSON.stringify(out, null, 2));
    });

  program
    .command("share [session]")
    .description("Write a chat session to .agent/shares as JSON.")
    .action((sessionId: string | undefined) => {
      const cwd = process.cwd();
      const sessions = new SessionStore(cwd);
      const session = sessionId ? sessions.load(sessionId) : sessions.latest();
      if (!session) {
        console.log("Session not found. Run `neutron sessions` to list them.");
        process.exitCode = 1;
        return;
      }
      const { file } = shareSession(cwd, session);
      console.log(`Shared session ${session.id} to ${file}`);
    });

  const aliasCmd = program.command("alias").description("Manage command shortcuts.");
  aliasCmd
    .command("list")
    .description("List command aliases.")
    .option("--json", "Machine-readable JSON output")
    .action((opts: { json?: boolean }) => {
      const aliases = loadAliases();
      if (opts.json) {
        console.log(JSON.stringify(aliases, null, 2));
        return;
      }
      const names = Object.keys(aliases);
      if (names.length === 0) {
        console.log("No aliases. Add one with `neutron alias set <name> <command>`.");
        return;
      }
      for (const name of names) console.log(`  ${name} -> ${aliases[name]}`);
    });
  aliasCmd
    .command("set <name> <command...>")
    .description("Create a shortcut, e.g. `neutron alias set s chat`.")
    .action((name: string, command: string[]) => {
      const saved = setAlias(name, command.join(" "));
      console.log(saved ? `Alias ${name} -> ${command.join(" ")}` : "Failed to write config.");
    });
  aliasCmd
    .command("remove <name>")
    .description("Delete a shortcut.")
    .action((name: string) => {
      const saved = removeAlias(name);
      console.log(saved ? `Removed alias ${name}.` : "Failed to write config.");
    });

  program
    .command("env")
    .description("Show environment and configuration summary.")
    .action(() => envCommand(process.cwd()));

  program
    .command("tokens [session]")
    .description("Estimate token usage for a session.")
    .option("--json", "Machine-readable JSON output")
    .action((sessionId: string | undefined, opts: { json?: boolean }) => {
      tokensCommand(process.cwd(), sessionId, opts.json);
    });

  program
    .command("replay [session]")
    .description("Re-print a chat session transcript (defaults to the latest).")
    .option("--json", "Machine-readable JSON output")
    .action((sessionId: string | undefined, opts: { json?: boolean }) => {
      replayCommand(process.cwd(), sessionId, opts);
    });

  program
    .command("grep <pattern>")
    .description("Search file contents from the command line.")
    .option("--path <dir>", "Directory or file to search")
    .option("--include <glob>", "Only search matching files")
    .option("-i, --ignore-case", "Case-insensitive search")
    .option("--json", "Machine-readable JSON output")
    .action(
      async (pattern: string, opts: { path?: string; include?: string; ignoreCase?: boolean; json?: boolean }) => {
        await grepCommand(process.cwd(), pattern, opts);
      },
    );

  program
    .command("find <pattern>")
    .description("Find files by glob pattern.")
    .option("--path <dir>", "Directory to search")
    .option("--json", "Machine-readable JSON output")
    .action(async (pattern: string, opts: { path?: string; json?: boolean }) => {
      await findCommand(process.cwd(), pattern, opts);
    });

  program
    .command("fmt [paths...]")
    .description("Run the detected formatter on files.")
    .option("--all", "Format every supported file in the project")
    .action(async (paths: string[], opts: { all?: boolean }) => {
      await fmtCommand(process.cwd(), paths, opts.all);
    });

  program
    .command("bench")
    .description("Benchmark provider latency with a tiny request.")
    .action(async () => {
      await benchCommand(process.cwd());
    });

  program
    .command("watch <command...>")
    .description("Re-run a command whenever project files change.")
    .action((command: string[]) => {
      watchCommand(process.cwd(), command);
    });

  program
    .command("completion [shell]")
    .description("Print a shell completion script (bash, zsh, powershell).")
    .action((shell?: string) => {
      const detected =
        shell ??
        (process.platform === "win32" ? "powershell" : process.env.SHELL?.includes("zsh") ? "zsh" : "bash");
      const script = completionScript(detected);
      if (!script) {
        console.error(`Unsupported shell: ${detected}. Use bash, zsh or powershell.`);
        process.exitCode = 1;
        return;
      }
      console.log(script);
    });

  program
    .command("self-update")
    .description("Check whether a newer version is published.")
    .action(() => selfUpdateCommand());

  program
    .command("serve")
    .description("Start a headless HTTP server for API access.")
    .option("-p, --port <port>", "Port to listen on", (v) => Number.parseInt(v, 10), 4096)
    .option("--hostname <host>", "Hostname to listen on", "127.0.0.1")
    .action(async (opts: { port: number; hostname: string }) => {
      const password = envVar("SERVER_PASSWORD");
      const running = await startServer({
        root: process.cwd(),
        port: opts.port,
        host: opts.hostname,
        ...(password ? { password } : {}),
      });
      console.log(`NEUTRON server listening on http://${opts.hostname}:${running.port}`);
      console.log("Endpoints: GET /health, GET /v1/agents, GET /v1/sessions, POST /v1/chat");
      if (password) console.log("Basic auth enabled (username defaults to 'neutron').");
    });

  const themeCmd = program.command("theme").description("Manage the CLI color theme.");
  themeCmd
    .command("list")
    .description("List available themes.")
    .action(() => {
      const current = loadTheme().name;
      for (const theme of listThemes()) {
        const marker = theme.name === current ? "*" : " ";
        console.log(`  ${marker} ${theme.name}  ${theme.description}`);
      }
    });
  themeCmd
    .command("set <name>")
    .description("Set the active theme.")
    .action((name: string) => {
      if (!setTheme(name)) {
        console.error(`Unknown theme: ${name}. Run \`neutron theme list\` to see options.`);
        process.exitCode = 1;
        return;
      }
      console.log(`Theme set to ${name}.`);
    });

  const lspCmd = program.command("lsp").description("Inspect configured language servers.");
  lspCmd
    .command("list")
    .description("List configured LSP servers.")
    .option("--json", "Machine-readable JSON output")
    .action((opts: { json?: boolean }) => {
      const configs = readLspConfig(process.cwd());
      const names = Object.keys(configs);
      if (names.length === 0) {
        console.log('No LSP servers configured. Add one under "lsp" in the global config or .neutron/lsp.json.');
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(configs, null, 2));
        return;
      }
      for (const name of names) {
        const cfg = configs[name]!;
        console.log(`  ${name}: ${cfg.command} ${(cfg.args ?? []).join(" ")} [${cfg.extensions.join(", ")}]`);
      }
    });

  const githubCmd = program.command("github").description("Manage the GitHub agent for repository automation.");
  githubCmd
    .command("install")
    .description("Install a GitHub Actions workflow for this repository.")
    .action(() => {
      const result = installGitHubWorkflow(process.cwd());
      console.log(result.created ? `Created ${result.path}` : `${result.path} already exists.`);
    });
  githubCmd
    .command("run")
    .description("Run the agent for a GitHub event (used in CI).")
    .option("--event <name>", "Event name (issues, issue_comment, pull_request)")
    .option("--event-path <file>", "Path to a JSON event payload")
    .option("--token <token>", "GitHub token for posting a comment")
    .option("--prompt <text>", "Override the prompt instead of reading an event")
    .action(
      async (opts: { event?: string; eventPath?: string; token?: string; prompt?: string }) => {
        const cwd = process.cwd();
        let eventName = opts.event;
        let event: Record<string, unknown> | undefined;
        if (opts.eventPath) {
          try {
            event = JSON.parse(readFileSync(opts.eventPath, "utf8")) as Record<string, unknown>;
          } catch (err) {
            console.error(`Cannot read event: ${err instanceof Error ? err.message : String(err)}`);
            process.exitCode = 1;
            return;
          }
        } else if (!opts.prompt) {
          const fromEnv = readEventFromEnv();
          if (fromEnv) {
            eventName = eventName ?? fromEnv.eventName;
            event = fromEnv.event;
          }
        }
        if (!event) {
          if (!opts.prompt) {
            console.error("No event found. Provide --event-path, set GITHUB_EVENT_PATH, or pass --prompt.");
            process.exitCode = 1;
            return;
          }
          event = {};
        }
        const token = opts.token ?? process.env.GITHUB_TOKEN;
        const result = await runGitHubAction(cwd, {
          eventName: eventName ?? "issues",
          event,
          ...(opts.prompt ? { prompt: opts.prompt } : {}),
          ...(token ? { token } : {}),
        });
        console.log(result.text);
      },
    );

  program
    .command("acp")
    .description("Start an Agent Client Protocol server over stdio.")
    .option("--cwd <dir>", "Working directory", process.cwd())
    .action((opts: { cwd: string }) => {
      const server = new AcpServer({ root: opts.cwd });
      server.start();
    });

  program
    .command("web")
    .description("Start the server with a browser UI.")
    .option("-p, --port <port>", "Port to listen on", (v) => Number.parseInt(v, 10), 4096)
    .option("--hostname <host>", "Hostname to listen on", "127.0.0.1")
    .option("--no-open", "Do not open a browser")
    .action(async (opts: { port: number; hostname: string; open?: boolean }) => {
      const password = envVar("SERVER_PASSWORD");
      const running = await startServer({
        root: process.cwd(),
        port: opts.port,
        host: opts.hostname,
        web: true,
        ...(password ? { password } : {}),
      });
      const url = `http://${opts.hostname}:${running.port}`;
      console.log(`NEUTRON web UI at ${url}`);
      if (opts.open !== false) openBrowser(url);
    });

  program
    .command("import <file>")
    .description("Import a chat session from a JSON file or exported session.")
    .action((file: string) => {
      const cwd = process.cwd();
      let data: ChatSession;
      try {
        data = JSON.parse(readFileSync(file, "utf8")) as ChatSession;
      } catch (err) {
        console.error(`Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }
      if (!data || !Array.isArray(data.messages)) {
        console.error("Invalid session file: expected a JSON object with a messages array.");
        process.exitCode = 1;
        return;
      }
      const sessions = new SessionStore(cwd);
      const now = new Date().toISOString();
      const imported: ChatSession = {
        ...data,
        id: data.id ?? `imported-${Date.now().toString(36)}`,
        createdAt: data.createdAt ?? now,
        updatedAt: now,
      };
      if (sessions.load(imported.id)) imported.id = `imported-${Date.now().toString(36)}`;
      sessions.save(imported);
      console.log(`Imported session ${imported.id} (${imported.messages.length} messages).`);
    });

  program
    .command("upgrade")
    .description("Update neutron to the latest published version.")
    .action(() => {
      console.log("Updating neutron-agent to the latest version...");
      const result = spawnSync("npm", ["install", "-g", "neutron-agent@latest"], {
        stdio: "inherit",
        shell: true,
      });
      if (result.status !== 0) {
        console.error("Upgrade failed. Try manually: npm install -g neutron-agent@latest");
        process.exitCode = 1;
      }
    });

  program
    .command("logs")
    .description("Show agent logs.")
    .option("-a, --agent <agent>", "Filter by agent")
    .option("-l, --live", "Tail live logs")
    .action((opts: { agent?: string; live?: boolean }) => {
      logsCommand(process.cwd(), opts.agent, opts.live);
    });

  program
    .command("stop")
    .description("Stop running agents.")
    .action(() => {
      const cwd = process.cwd();
      const store = new StateStore(cwd);
      store.ensure();
      writeFileSync(join(cwd, ".agent", "stop.flag"), new Date().toISOString(), "utf8");
      console.log("Stop requested. The orchestrator will pause at the next task boundary.");
    });

  program
    .command("resume")
    .description("Resume interrupted work.")
    .action(async () => {
      await runCommand({ root: process.cwd(), resume: true });
    });

  registerNeutronCommand(program);

  if (process.argv.length <= 2) {
    const interactive =
      process.stdin.isTTY === true &&
      process.stdout.isTTY === true &&
      envVar("NO_TUI") !== "1";
    const hasProvider = readGlobalProviders().some((p) => p.enabled && p.baseUrl);
    if (interactive && hasProvider) {
      void chatCommand({ root: process.cwd(), tui: true }).catch((e) => {
        console.error(e);
        process.exitCode = 1;
      });
      return;
    }
    printBanner();
    const store = new StateStore(process.cwd());
    stateCommand(store);
    console.log("\nRun `neutron --help` to see all commands.");
    console.log("Chat with the coding agent: neutron chat");
    console.log("Quickstart: neutron init --template && neutron run\n");
    if (!hasProvider) {
      void ensureProviderInteractive();
    }
    return;
  }

  const argv = [process.argv[0]!, process.argv[1]!, ...expandAlias(process.argv.slice(2))];
  program.parseAsync(argv).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* best-effort */
  }
}

function printBanner(): void {
  console.log(`
+------------------------------------------------------+
|                       NEUTRON                         |
|   Autonomous Software Maintenance Intelligence       |
+------------------------------------------------------+
`);
}