# Architecture

neutron is a single TypeScript/ESM package. The CLI (`dist/cli-entry.js`) and the library entry (`dist/index.js`) are both built by tsup from `src/`.

```
src/
  cli-entry.ts          # bin entry: calls main()
  index.ts              # library entry: re-exports the public API
  cli/                  # commander command wiring
  orchestrator/         # plan/execute loop
  agents/               # the 10 specialized agents
  api/                  # ApiSystem: pool, failover, cooldowns
  providers/            # OpenAI-compatible HTTP provider + registry
  scheduler/            # task model + DAG scheduler
  design/               # design.md parser -> DesignSystem
  completion/           # CompletionEngine (readiness criteria)
  context/              # per-task context bundles
  terminal/             # sandboxed command execution + security
  approval/             # interactive/auto approval
  tools/                # built-in coding tools (read/write/edit/glob/grep/list/bash)
  chat/                 # interactive coding agent + session store + tool protocol
  mcp/                  # Model Context Protocol stdio client
  lsp/                  # Language Server Protocol client + diagnostics
  sdk/                  # JS/TS client for the headless server
  plugins/              # plugin hook runner (chat.message, tool.before/after)
  acp/                  # Agent Client Protocol stdio server
  github/               # GitHub Actions workflow + event handling
  format/               # formatter detection/execution
  server/               # headless HTTP API + web UI
  git/                  # git integration
  platform/             # platform detection
  files/                # workspace file helpers
  tui/                  # ink TUI (optional; plain fallback)
```

## Run loop

`neutron run`:

1. **Plan** — `Orchestrator.plan()` parses `design.md` (`design/parser.ts`) into a `DesignSystem`, then the Manager agent builds a task DAG (`agents/manager.ts` → `buildTaskGraph`). Each feature/page becomes REQ → DSN → DB → BE → FE → SEC/DEV/QA → REV tasks with dependencies.
2. **Execute** — `Orchestrator.execute()` iterates: `Scheduler.nextBatch()` returns all tasks whose dependencies are satisfied, up to the concurrency limit. Each task is dispatched to its agent.
3. **Agent execution** — an agent builds a prompt (`prompts.ts` + context bundle from `context/context.ts`), calls `ApiSystem.chat()`, and parses the LLM's `FILE:` / `TYPE:` / `RUN:` blocks (`agents/apply.ts`) into file writes and (approved) shell commands.
4. **Verify** — QA runs tests; Reviewer reviews the diff. Rejected tasks are re-queued with feedback as issues. Blocked dependents are detected and fail fast.
5. **Repeat** until `CompletionEngine` says the project is ready (tasks complete, no high/critical issues, tests passing) or `maxIterations` is hit.

## Interactive coding agent

`neutron chat` (`cli/chat-command.ts`) is a standalone coding assistant that does not use the task DAG:

1. **Tools** — `tools/builtin.ts` defines `read`, `write`, `edit`, `list`, `glob`, `grep`, `bash`. File tools resolve paths through `files/workspace.ts` and refuse anything outside the workspace root. `bash` runs through the same `Terminal` classifier as the agent team.
2. **Protocol** — the model is asked to emit fenced ```tool blocks containing JSON (`chat/protocol.ts`). `parseToolCalls()` accepts `{tool,args}`, `{name,arguments}`, flat `{tool,...}`, single-key, and array forms, and strips the blocks from the prose.
3. **Loop** — `chat/agent.ts` sends the conversation to `ApiSystem.stream("general", ...)` (falling back to `ApiSystem.chat()` when streaming is disabled or fails before the first delta), executes any tool calls, appends the results, and repeats (default 25 steps) until the model answers without a tool call. Streaming deltas are surfaced as `delta` events; the CLI writes them straight to stdout.
4. **Sessions** — `chat/session.ts` persists conversations as JSON in `.agent/sessions/`; `neutron chat --continue` / `--session <id>` resume them and `neutron sessions` lists them.
5. **Context** — `AGENTS.md`/`CLAUDE.md` and `design.md` (when present) are injected into the system prompt.
6. **Undo / redo** — before `write`/`edit` run, `chat/snapshots.ts` records the original bytes (or a null marker for new files) under `.agent/snapshots/<session>.json`. `ChatAgent.undo()` restores the previous content or deletes files that did not exist and pushes the pre-undo state onto a redo stack; `ChatAgent.redo()` re-applies it. The CLI exposes this as `/undo`/`/redo` and `neutron undo`/`neutron redo`.
7. **Custom commands & input** — `chat/commands.ts` loads markdown commands from `.neutron/commands/`, `.agent/commands/` and `.opencode/command/` and substitutes `$ARGUMENTS`/`$1..$9`; `chat/input.ts` expands `@file` references into attached content and routes `!command` to a local `Terminal` run.
8. **Agents & permissions** — `chat/agent-config.ts` defines built-in `build`/`plan`/`general`/`explore` agents plus markdown agents from `.neutron/agent/`/`.opencode/agent/`. Each agent has a permission map (`allow`/`ask`/`deny`, with glob patterns for `bash`). `ChatAgent` filters its tool set by permissions and calls the approval handler for `ask` tools. Subagents are invoked through the `task` tool (depth-limited to one level).
9. **Skills & rules** — `chat/skills.ts` loads `SKILL.md` files from `.neutron/skills`, `.claude/skills` and `.opencode/skills` exposed via the `skill` tool; `.neutron/rules/*.md` are injected into the system prompt. `chat/project-init.ts` generates `AGENTS.md` for `/init`.
10. **MCP** — `mcp/client.ts` speaks newline-delimited JSON-RPC over stdio: it spawns each configured server, performs `initialize`/`tools/list`, and adapts every remote tool into a local `Tool` named `<server>_<tool>`. Servers come from the global config `mcp` map and `.neutron/mcp.json` (project overrides global); `neutron mcp add/list` manage them.
11. **Custom tools & formatters** — `tools/custom.ts` turns JSON command definitions (`.neutron/tool/*.json` or config `tool`) into tools with `{{param}}` substitution. `format/formatter.ts` detects Prettier/gofmt/rustfmt/black and formats files after `write`/`edit`.
12. **Compaction & sharing** — `ChatAgent.compact()` summarizes older messages once the transcript exceeds a size threshold (auto or `/compact`). `chat/share.ts` writes a session to `.agent/shares/`.
13. **Headless server & SDK** — `server/server.ts` exposes `/health`, `/v1/agents`, `/v1/sessions` and `POST /v1/chat` over `node:http`, with optional HTTP basic auth via `NEUTRON_SERVER_PASSWORD`; `neutron web` serves a small browser UI from `/`. `sdk/client.ts` (`NeutronClient`/`createClient`) is a typed wrapper over those endpoints.
14. **Agent Client Protocol** — `acp/server.ts` implements an ACP server over stdio (newline-delimited JSON-RPC): `initialize`, `session/new`, `session/prompt`, `session/cancel`, emitting `session/update` notifications (`agent_message_chunk`, `tool_call`) while streaming the agent's reply. `neutron acp` starts it.
15. **Language servers** — `lsp/client.ts` spawns a configured language server, frames LSP messages with `Content-Length` headers, opens the document, collects `textDocument/publishDiagnostics`, and returns normalized diagnostics. `tools/extras.ts` exposes an `lsp` tool; `neutron lsp list` shows configured servers.
16. **GitHub automation** — `github/actions.ts` installs a workflow (`.github/workflows/neutron.yml`) and maps `issues`/`issue_comment`/`pull_request` payloads to prompts, running the agent and (with a token) posting a reply comment. `neutron github install|run` drive it.
17. **Themes** — `cli/theme.ts` provides built-in color themes resolved from the global config `theme` key or `NEUTRON_THEME`; `paint()` colorizes the banner, prompt and event output.
18. **Plugins** — `plugins/plugins.ts` dynamically imports `.neutron/plugin/*.mjs` (plus `--plugin` files) and exposes a `PluginRunner`. `ChatAgent` calls `chat.message` before pushing the user turn, `tool.before` (which may rewrite args or cancel), and `tool.after` (which may rewrite the result).
19. **Session forking** — `SessionStore.fork()` copies a session (optionally truncated to N messages) into a new id; `neutron sessions --fork` and the in-chat `/fork` expose it.

## API layer

`ApiSystem` (`api/api-manager.ts`) owns all LLM traffic:

- **Concurrency**: a semaphore (`api/pool.ts`) caps in-flight requests (`api.maxConcurrentRequests`)
- **Retry**: per-provider retries with exponential backoff (`maxRetries`, `backoffBaseMs`) for 408/429/5xx
- **Failover**: on exhaustion, the next healthy provider is tried; the last error is included in the final failure message
- **Cooldown**: a provider returning 429 (including from `/models` discovery) is skipped for `providerCooldownMs`
- **Model resolution**: request hint → `routing[kind]` → provider's configured models → lazy discovery via `GET /models` (cached 5 min). Ids containing "free" are preferred so costless models are used first. No blind hardcoded model names.
- **Streaming**: `ApiSystem.stream()` is an async generator over `provider.stream()`; it fails over to the next provider only if nothing has been emitted yet, so partial output is never duplicated.

Usage (requests, tokens, failures, failovers, latency) is tracked per provider and totals, surfaced in `neutron doctor` and the run's PROJECT HEALTH report.

## Providers

`OpenAICompatibleProvider` (`providers/openai.ts`) speaks the OpenAI chat-completions protocol. The registry is configured from env vars (`LLM_`, `GROQ_`, `OPENROUTER_`, `OPENAI_`, `OLLAMA_`, `ANY_`) plus the global config file. Errors from the gateway are parsed and surfaced verbatim (truncated) so users see the real reason (auth, balance, unknown model, ...).

## Security model

Every shell command goes through `terminal/terminal.ts`:

1. **Deny rules** — blocked outright
2. **Allowlist** — safe commands run without prompting
3. **`classify()`** — pattern-matches dangerous operations (`rm -rf`, `sudo`, `git push`, `git reset --hard`, package installs, ...). These require approval

`approval/approver.ts` decides: `--yes` auto-approves; TTY prompts; non-interactive denies dangerous commands. All output is redacted (`config.ts` `redact()`) with registered API keys.

## State

`.agent/` in the project root: `tasks.json` (task states), `project.json` (meta), `review.md`, `test-results.md`, `logs/<agent>.log`. `StateStore` is the only writer. `neutron run --resume` reloads tasks and re-queues failed/blocked ones; `neutron fix` re-queues without running.

## Testing

Vitest, 109 tests across 21 files: design parser, scheduler, pool, api-manager (real local HTTP servers for failover/cooldown/discovery), security, apply, agents, orchestrator, built-in tools/path safety, the chat agent/tool protocol (fake provider), streaming/undo/custom-commands/input parsing (`tests/chat-extras.test.ts`), agent configs/permissions/subagents/skills/todo tools (`tests/agents.test.ts`), MCP stdio connection + custom tools (`tests/mcp.test.ts`), compaction/sharing/HTTP server/web UI/SDK (`tests/features.test.ts`), ACP stdio server (`tests/acp.test.ts`), GitHub workflow/event handling (`tests/github.test.ts`), LSP diagnostics against a fake language server (`tests/lsp.test.ts`), themes (`tests/theme.test.ts`), unified diffs (`tests/diff.test.ts`), plugin hooks (`tests/plugins.test.ts`), session search/rename/fork + agent file management (`tests/agents.test.ts`), transcripts/config keys/aliases/completion/global plugins (`tests/batch-g.test.ts`), and provider config/auth helpers. `npm test`.

## Feature tracking

`FEATURES.md` enumerates the 100 shipped features and is the source of truth for scope. Notable interface surface added late: the browser UI (`neutron web`), NDJSON streaming (`--stream-json`, `POST /v1/chat/stream`), the OpenAI-compatible inbound shim (`POST /v1/chat/completions`), and the `sdk/client.ts` wrapper over the same HTTP API.
