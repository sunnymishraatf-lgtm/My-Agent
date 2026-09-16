# sunny

A multi-agent AI software engineering platform and interactive coding agent for your terminal. Give it a `design.md`, and a team of specialized AI agents — requirements, design, frontend, backend, database, security, devops, QA and review — plans the work, builds it, tests it, reviews it, and loops until the project is done. Or use `sunny chat` to pair with a coding agent that can read, edit and run your code.

```
+------------------------------------------------------+
|                       SUNNY                          |
|        multi-agent software engineering team         |
+------------------------------------------------------+
```

## Install

```bash
npm install -g sunny-agent      # installs the `sunny` command
npx sunny-agent --help          # or run without installing
```

One-line installers (macOS, Linux, Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/sunny-ai/sunny-agent/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/sunny-ai/sunny-agent/main/install.ps1 | iex
```

Requires Node 20+. Optional: `ink`/`react` for the interactive TUI (sunny falls back to plain CLI output automatically).

## Quickstart

Fastest path — chat with the coding agent in any directory:

```bash
sunny config               # point sunny at an OpenAI-compatible provider
sunny chat                 # interactive coding agent (read/edit/run tools)
```

Full multi-agent workflow:

```bash
mkdir my-app && cd my-app
sunny init --template      # creates design.md from a template
$EDITOR design.md          # describe what you want to build
sunny doctor               # verify your provider is configured
sunny run                  # plan + execute with the agent team
```

When the run finishes you get a **PROJECT HEALTH** report: readiness, per-agent status, task completion, API usage, token counts, and any blocking issues. Failed tasks can be retried with `sunny fix` followed by `sunny run --resume`.

## Commands

| Command | Description |
| --- | --- |
| `sunny init [--template] [--force]` | Initialize a sunny project (`.agent/` state dir); `--template` writes a starter `design.md`, `--force` overwrites it |
| `sunny design [--template] [--check]` | Create or validate `design.md`; `--check` parses and reports features/pages |
| `sunny plan` | Generate the engineering task plan from `design.md` without executing |
| `sunny run [--resume] [--no-ui] [--json] [--yes]` | Plan and execute with the full agent team; TUI by default, plain output with `--no-ui`, machine-readable summary with `--json`; `--yes` auto-approves commands |
| `sunny status [--json]` | Show agent and task status |
| `sunny chat [message] [--continue] [--session id] [--model m] [--provider p] [--yes] [--no-stream]` | Interactive coding agent with read/write/edit/glob/grep/bash tools, streaming responses and saved sessions |
| `sunny models [--provider id] [--json]` | List models available from configured providers |
| `sunny sessions [--show id] [--delete id] [--rename id --title t] [--search q] [--fork id [--at n]] [--json]` | List, view, search, rename, fork or delete chat sessions |
| `sunny undo [--session id]` | Restore files changed by the last chat turn |
| `sunny redo [--session id]` | Re-apply the last undone chat turn |
| `sunny diff [--session id] [--json]` | Show the last turn's file changes as a unified diff |
| `sunny replay [session] [--json]` | Re-print a session transcript |
| `sunny tokens [session] [--json]` | Estimate token usage for a session |
| `sunny fmt [paths...] [--all]` | Run the detected formatter on files |
| `sunny grep <pattern> [--path d] [--include g] [--json]` | Search file contents |
| `sunny find <glob> [--path d] [--json]` | Find files by glob |
| `sunny watch <command...>` | Re-run a command when project files change |
| `sunny bench` | Benchmark provider latency |
| `sunny env` | Show environment/config summary |
| `sunny alias list\|set\|remove` | Manage command shortcuts |
| `sunny completion [shell]` | Print a shell completion script |
| `sunny self-update` | Check for a newer published version |
| `sunny agent list` / `sunny agent create --name n --description d [--mode m] [--permissions a,b]` | List built-in + custom agents / create a markdown agent |
| `sunny agent show <name>` / `sunny agent delete <name>` | Inspect an agent / delete a custom agent file |
| `sunny stats [--json]` | Show session and usage statistics |
| `sunny export [session] [--sanitize]` / `sunny import <file>` | Export a session to JSON / import one |
| `sunny mcp list [--json]` | List configured MCP servers and their tools |
| `sunny mcp add --name n --command c [--args a,b] [--env K=V] [--project]` | Add an MCP server (global config or `.sunny/mcp.json`) |
| `sunny share [session]` | Write a session to `.agent/shares/` as JSON |
| `sunny serve [--port 4096] [--hostname 127.0.0.1]` | Start a headless HTTP API (`/health`, `/v1/agents`, `/v1/sessions`, `/v1/chat`) |
| `sunny web [--port 4096] [--hostname 127.0.0.1] [--no-open]` | Start the server with a browser UI |
| `sunny acp [--cwd dir]` | Start an Agent Client Protocol server over stdio |
| `sunny theme [list]` / `sunny theme set <name>` | List / choose the CLI color theme |
| `sunny lsp list [--json]` | List configured language servers |
| `sunny github install` / `sunny github run [--event-path f] [--prompt p]` | Install a CI workflow / run the agent for a GitHub event |
| `sunny upgrade` | Update sunny to the latest published version |
| `sunny review` | Run only the code reviewer agent |
| `sunny test` | Run the project's tests and build |
| `sunny fix` | Re-queue failed/blocked tasks for retry |
| `sunny doctor [--chat]` | Check Node/npm/git, config, and live provider health + model list; `--chat` sends a tiny request to prove the key works |
| `sunny config [--list] [--show]` | Interactive provider configuration; `--show` prints the resolved config with keys redacted |
| `sunny config --add <id> --base-url <url> --api-key <key> [--models a,b]` | Add/update a provider non-interactively; also `--remove/--enable/--disable <id>` |
| `sunny auth login [provider] [--key k] [--base-url url] [--models a,b]` | Store provider credentials (alias for `sunny config`); prompts for the key if omitted |
| `sunny auth list` / `sunny auth logout <provider>` | List providers / remove stored credentials |
| `sunny logs [agent]` | Show per-agent logs from `.agent/logs/` |
| `sunny stop` | Stop running agents (sets the stop flag) |
| `sunny resume` | Resume interrupted work |

## Interactive coding agent

`sunny chat` is a general-purpose coding assistant, separate from the project-building agent team. It runs a tool loop against your configured provider:

| Tool | What it does |
| --- | --- |
| `read` | Read a text file (numbered lines, paged) |
| `write` | Create or overwrite a file |
| `edit` | Replace an exact string (fails on ambiguous matches unless `replaceAll`) |
| `list` | List a directory |
| `glob` | Find files by `*` / `?` / `**` pattern |
| `grep` | Regex-search file contents |
| `bash` | Run a shell command (goes through the security classifier) |
| `webfetch` | Fetch a URL and return it as plain text |
| `task` | Delegate a task to a subagent (`general`, `explore`, or custom) |
| `todowrite` / `todoread` | Maintain a task list for the session |
| `skill` | Load instructions from `.sunny/skills/*/SKILL.md` |
| `lsp` | Run the configured language server on a file and return diagnostics |

### MCP servers, custom tools, formatters

Connect [Model Context Protocol](https://modelcontextprotocol.io) servers and their tools become available to the agent (`<server>_<tool>`):

```bash
sunny mcp add --name fetch --command npx --args -y,@modelcontextprotocol/server-fetch
sunny mcp list
```

Define command-based custom tools in `.sunny/tool/<name>.json` or the global config `tool` map:

```json
{ "description": "Deploy to an environment", "command": "deploy {{target}}", "parameters": { "target": { "type": "string", "required": true } } }
```

After the agent writes or edits a file, sunny runs a detected formatter (Prettier, gofmt, rustfmt, black) when one is available.

Long sessions are compacted automatically: when the transcript grows past a threshold, older messages are summarized into a single note before the next turn (`/compact` forces it).

**Plugins** hook into the agent loop. Drop an ESM/CJS module in `.sunny/plugin/` (or load one with `--plugin`); any exported `hooks` object participates:

```js
export const hooks = {
  "chat.message": (text) => text,                                  // rewrite the user message
  "tool.before": ({ name, args }) => ({ args }),                   // rewrite or cancel tool calls
  "tool.after": ({ name, args, ok, output }) => ({ ok, output }),  // rewrite tool results
};
```

`tool.before` may also return `{ cancel: "reason" }` to block a call. `/plugins` lists what's loaded.

### Headless server

Run sunny as an HTTP API (useful for scripting, editors and SDK-style integrations):

```bash
sunny serve --port 4096
curl http://127.0.0.1:4096/health
curl -X POST http://127.0.0.1:4096/v1/chat -H "content-type: application/json" -d '{"message":"explain this repo"}'
```

Set `SUNNY_SERVER_PASSWORD` to enable HTTP basic auth (username `sunny`).

Additional endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/sessions/:id` | Full transcript for a session |
| `POST /v1/chat/stream` | NDJSON event stream (`delta`, `tool-call`, `assistant`, `done`) |
| `POST /v1/chat/completions` | OpenAI-compatible shim (point any OpenAI client at sunny) |

For scripting, `sunny chat "..." --stream-json` emits the same NDJSON events on stdout. `sunny web` starts the server with a full browser UI (session sidebar, agent picker, streaming responses).

The JS/TS client is exported from the package:

```ts
import { createClient } from "sunny-agent";

const client = createClient({ baseUrl: "http://127.0.0.1:4096" });
console.log(await client.health());
console.log(await client.chat({ message: "explain this repo" }));
```

`sunny acp` speaks the [Agent Client Protocol](https://agentclientprotocol.com) over stdio (JSON-RPC), so ACP-compatible editors can drive sunny as their coding agent.

### Language server diagnostics

Configure LSP servers in `.sunny/lsp.json` (or the global config under `"lsp"`); the agent can then use the `lsp` tool to check a file, and `sunny lsp list` shows what's configured:

```json
{
  "lsp": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    }
  }
}
```

### GitHub automation

```bash
sunny github install                       # writes .github/workflows/sunny.yml
sunny github run --event-path event.json   # run the agent for an event payload
```

In CI, set `SUNNY_API_KEY` (or the provider env vars) and sunny reads `GITHUB_EVENT_PATH`, handles `issues`, `issue_comment` and `pull_request` events, and replies on the issue/PR when `GITHUB_TOKEN` is present.

### Themes

```bash
sunny theme list          # default, ocean, forest, sunset, mono
sunny theme set ocean
SUNNY_THEME=mono sunny chat   # per-invocation override
```

### Agents, modes and permissions

Sunny ships with two primary agents (`build`, `plan`) and two subagents (`general`, `explore`). `plan` is read-only: edits are denied and shell commands ask for approval. Define your own agents as markdown files in `.sunny/agent/` (or `.opencode/agent/`):

```markdown
---
description: Reviews code without making edits
mode: subagent
permission:
  edit: deny
  bash:
    "*": ask
    "git *": allow
---
You are a code reviewer. Focus on correctness and security.
```

Switch at runtime with `/agents`, `/agent <name>`, or `/mode plan`; from the CLI use `sunny chat --agent review` or `sunny chat --mode plan`. The model can delegate work to subagents through the `task` tool.

```bash
sunny chat                              # interactive REPL (streams by default)
sunny chat "add a healthcheck endpoint" # one-shot
sunny chat --continue                   # resume the latest session
sunny chat --session <id>               # resume a specific session
sunny chat --model gpt-5.5 -y           # pick a model, auto-approve commands
sunny chat --no-stream                  # disable streaming
sunny chat --deny bash,write            # override the agent's permissions
sunny chat --plugin ./plugin.mjs        # load a plugin for this session
sunny chat --stream-json "summarize"    # emit NDJSON events for scripting
sunny chat --max-tool-output 8000       # cap tool output kept in context
```

- Sessions are stored in `.agent/sessions/` and can be listed with `sunny sessions`.
- All file tools are sandboxed to the workspace root; paths that escape it are refused.
- Drop an `AGENTS.md` (or `CLAUDE.md`) in the project to give the agent persistent instructions; `design.md` is included as context when present.
- The `bash` tool reuses the same destructive-command classifier as the agent team, so dangerous commands require approval unless `--yes` is passed.
- Responses stream token-by-token. Free models are preferred automatically when a provider exposes them.

**In-session commands and input helpers:**

| Input | Effect |
| --- | --- |
| `/help`, `/new`, `/sessions`, `/fork`, `/exit` | Built-in session controls |
| `/undo` / `/redo` | Restore / re-apply files touched in the previous turn |
| `/diff` | Show the previous turn's changes as a unified diff |
| `/agents`, `/agent <name>`, `/mode plan|build` | Inspect or switch agents |
| `/model <id>`, `/provider <id>` | Switch model / provider for this session |
| `/rename <title>` | Rename the current session |
| `/search <query>` | Search past sessions by title or message |
| `/skills` | List skills from `.sunny/skills/` |
| `/plugins` | List loaded plugins from `.sunny/plugin/` |
| `/init` | Generate an `AGENTS.md` project summary |
| `/compact` | Summarize older messages to shrink context (also automatic) |
| `/share` | Write this session to `.agent/shares/` |
| `/commands` | List custom commands from `.sunny/commands/*.md` |
| `/yourcommand args` | Run a custom command (`$ARGUMENTS`, `$1`, `$2`, ... are substituted) |
| `@path/to/file` | Attach a file's contents to your message |
| `!command` | Run a shell command locally, outside the model loop |

Custom commands are markdown files — the first non-empty line becomes the description:

```markdown
# Review code
Review $ARGUMENTS. Focus on correctness and tests first.
```

Undo history is stored per session under `.agent/snapshots/`; `sunny undo` restores the most recent turn from the latest session, and deleted files are recreated while newly created files are removed.

## Configuration

Providers are OpenAI-compatible endpoints. Configure via environment variables or the config file (`~/.sunny/config.json`, or `%APPDATA%\sunny\config.json` on Windows; override with `SUNNY_CONFIG_DIR`).

Quick non-interactive setup (great for scripts and for letting users add their own key):

```bash
sunny config --add groq --base-url https://api.groq.com/openai/v1 --api-key "$GROQ_KEY" --models llama-3.3-70b-versatile
sunny doctor --chat     # sends one tiny request to confirm the key works
```

Or run `sunny config` with no flags for an interactive wizard. `--list`, `--remove <id>`, `--enable <id>` and `--disable <id>` manage existing entries.

`sunny auth` is a friendlier alias:

```bash
sunny auth login groq            # prompts for the key, uses the known base URL
sunny auth login openai --key "$OPENAI_API_KEY"
sunny auth list
sunny auth logout groq
```

On first run — `sunny` with no arguments, or `sunny chat` before any provider exists — sunny offers to launch the setup wizard automatically when you're in a terminal.

**Environment variables** (checked in this order for each id):

| id | env prefix | example |
| --- | --- | --- |
| free-llm | `LLM_` | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODELS` |
| groq | `GROQ_` | `GROQ_BASE_URL`, `GROQ_API_KEY`, `GROQ_MODELS` |
| openrouter | `OPENROUTER_` | `OPENROUTER_BASE_URL`, ... |
| openai | `OPENAI_` | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODELS` |
| ollama | `OLLAMA_` | `OLLAMA_BASE_URL`, ... |
| any | `ANY_` | any OpenAI-compatible endpoint |

`*_MODELS` is a comma-separated list; if omitted, sunny discovers models automatically from the provider's `/models` endpoint on first use.

**Config file** (`sunny config` writes this):

```json
{
  "providers": [
    {
      "id": "my-gateway",
      "baseUrl": "https://gateway.example.com/v1",
      "apiKey": "sk-...",
      "models": [],
      "enabled": true
    }
  ],
  "api": {
    "maxConcurrentRequests": 8,
    "maxRetries": 3,
    "timeoutMs": 120000,
    "backoffBaseMs": 1000,
    "providerCooldownMs": 30000
  },
  "routing": {
    "frontend": "claude-sonnet-5",
    "backend": "gpt-5.5"
  },
  "completion": { "maxIterations": 5 }
}
```

`routing` maps task kinds (`requirements`, `design`, `frontend`, `backend`, `database`, `security`, `devops`, `qa`, `review`, `general`) to model ids. Multiple providers get automatic failover; a provider that returns 429 is put on cooldown and skipped.

## The design.md workflow

`design.md` is the single source of truth. Describe:

- **Project** — name and one-line description
- **Core Features** and **Pages** — what gets built (each feature/page becomes tasks)
- **Theme / Colors / Typography / Layout / Components** — the design system (parsed into tokens, exported as CSS variables by the frontend agent)
- **Frontend / Backend / Database / Authentication** — the stack
- **Acceptance Criteria** — how completion is judged
- **Do Not** — hard constraints agents must respect

Run `sunny design --check` to validate the file, and see [examples/design.md](examples/design.md) for a full example.

## Agent team

| Agent | Prefix | Responsibility |
| --- | --- | --- |
| Manager | MGR | Builds the task DAG from design.md |
| Requirements | REQ | Turns features into requirements.md with acceptance criteria |
| Design | DSN | Design system tokens, layout specs |
| Frontend | FE | UI components and pages |
| Backend | BE | APIs and server logic |
| Database | DB | Schema and migrations |
| Security | SEC | Auth, input validation, threat review |
| DevOps | DEV | Build setup, configs |
| QA | QA | Runs the test suite, parses results |
| Reviewer | REV | Code review; can reject work and re-queue tasks |

Tasks run concurrently where the dependency graph allows (up to `maxConcurrentRequests` in-flight LLM calls).

## Safety

- All shell commands pass through a security classifier: destructive patterns (`rm -rf`, `sudo`, `git push`, package installs, ...) require approval; deny-listed commands are blocked outright
- In a TTY you get an interactive prompt; with `--yes` everything is auto-approved; non-interactive runs deny dangerous commands
- API keys are redacted from all logs and output
- Project state lives in `.agent/` (tasks, review, test results, logs) — safe to commit or ignore

## Development

```bash
npm install
npm test        # 109 tests
npm run build   # tsup -> dist/ (ESM + types)
npx tsc --noEmit
```

Library API is exported from `dist/index.js` — `Orchestrator`, `ApiSystem`, `StateStore`, `parseDesignSystem`, `ChatAgent`, `SunnyClient`, `AcpServer`, MCP/LSP clients and more; see `docs/ARCHITECTURE.md`.

## License

MIT
