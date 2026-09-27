# NEUTRON — Autonomous Software Maintenance Intelligence

Give NEUTRON a natural-language maintenance request for an existing repository. It analyzes the repository, computes the impact, proposes an engineering plan — and only after **you approve the plan** does a team of specialized AI agents implement, test, security-review, and code-review the change. Nothing is modified or deployed without human approval.

```bash
neutron maintain "Add Google OAuth while preserving email/password login"
```

> **IBM Bob 2.0 Hackathon submission.** IBM Bob 2.0 was used to develop, analyze, review, and improve NEUTRON itself. Bob is **not** a runtime backend of NEUTRON — the runtime AI backend is any OpenAI-compatible provider you configure (e.g. AgentRouter). See [IBM Bob 2.0 Hackathon](#ibm-bob-20-hackathon).

## The problem

Software maintenance — bug fixes, dependency migrations, auth changes, security patches — is where developers spend most of their time, and it is the riskiest work: a "small" change can break checkout, webhooks, and tests three modules away. Existing AI coding tools act like autocomplete with a keyboard: they edit files immediately, with no understanding of blast radius, no plan you can review, and no verification you can trust.

## The solution

NEUTRON turns a maintenance request into a **controlled engineering workflow**: understand the repository first, measure the impact, propose a plan, get explicit human approval, then execute with specialized agents that implement, test, scan for security issues, and review — producing an auditable report. You stay in control at every consequential step.

Why it matters: unreviewed AI edits are a liability in production codebases. NEUTRON's differentiator is not "AI that writes code" but a **safe loop** — Understand → Analyze → Plan → Approve → Execute → Verify → Secure → Review → Report — that makes AI-assisted maintenance trustworthy enough to demo live and run on real repositories.

## The NEUTRON workflow

```
Natural-language request
        ↓
Repository analysis      (languages, dependencies, import graph, tests, entry points)
        ↓
Impact analysis          (affected files/functions/modules, blast radius, risk level)
        ↓
Implementation plan      (file-level changes, agents assigned, test strategy)
        ↓
Human approval           (approve / reject — fail-closed; auto-deny when non-interactive)
        ↓
Specialized agents       (Backend, Frontend, Database, Security, QA, DevOps, Reviewer — parallel where independent)
        ↓
Code changes             (git checkpoint created first)
        ↓
Testing                  (real build + test execution, honest blocked states)
        ↓
Security analysis        (secret/unsafe-code scanning)
        ↓
Code review              (actionable findings)
        ↓
Release readiness        (release gate + maintenance report)
```

## Architecture

```
neutron (commander CLI, src/cli/)
├── maintain                 src/neutron/workflow.ts   — the hero pipeline
│   ├── analyzer.ts          — real static repo analysis (import graph, test links)
│   ├── impact.ts            — deterministic impact engine (no LLM guessing)
│   ├── planner.ts           — engineering plan generation
│   ├── agents.ts            — parallel agent execution (max 4, configurable)
│   ├── test-runner.ts       — real build/test execution + result parsing
│   ├── security-scanner.ts  — secret & unsafe-code detection
│   ├── review.ts            — code-review findings
│   └── record.ts            — per-run audit trail → .agent/neutron/runs/<id>.json
├── approval/                — fail-closed human approval gate
├── agents/                  — 10 real specialized agents (LLM-backed, provider failover)
├── providers/ + api/        — OpenAI-compatible, Anthropic, Google; classified errors
├── chat/                    — interactive coding agent (separate from maintain)
├── web/ + server/           — dashboard (`neutron web`, http://127.0.0.1:4096)
└── git/ github/             — checkpoints, GitHub automation
```

Key design decisions: impact analysis is deterministic (keyword-alias scoring over the real dependency graph), never LLM-improvised; the no-LLM path fails loudly instead of fabricating results; tests are executed for real and reported as BLOCKED — never "passed" — when they cannot run.

## Main CLI commands

All verified present in `src/cli/index.ts`:

| Command | What it does |
|---|---|
| `neutron maintain "<request>"` | The full workflow: analyze → impact → plan → approve → agents → tests → security → review → release |
| `neutron maintain --execution plan-only` | Analyze + impact + plan without changing anything |
| `neutron maintain report [--json --audit --metrics --bob --history]` | Report on the workspace / latest runs |
| `neutron maintain demo [name]` | Scaffold a real sample project (TaskFlow) to practice on |
| `neutron maintain what-breaks` | "What could break?" from the cached impact graph |
| `neutron doctor` | Verify provider configuration and connectivity |
| `neutron models` | List models from configured providers |
| `neutron chat [message]` | Interactive coding agent (separate from the maintain workflow) |
| `neutron config` | Configure API providers |
| `neutron test` | Run the project's tests and build |
| `neutron review` | Run the reviewer agent |
| `neutron fix` | Re-run failed tasks |
| `neutron web` | Start the dashboard (default http://127.0.0.1:4096) |
| `neutron --help` | Full command list |

`neutron maintain` options: `-y/--yes` (auto-approve, use with care), `--execution plan-only|implement|implement-and-test`, `--risk safe|balanced|aggressive`, `--branch <name>`.

## Demo instructions

The recommended 3-minute demo, using only real functionality:

```bash
# 1. Create a realistic sample project (a real, functional TaskFlow app)
neutron maintain demo --dir ./taskflow-demo
cd taskflow-demo

# 2. Run the hero workflow — plan only first (changes nothing)
neutron maintain "Add Google OAuth while preserving email/password login" --execution plan-only

# 3. Review the impact analysis and plan, then run for real (approves each gate)
neutron maintain "Add Google OAuth while preserving email/password login"

# 4. Inspect the auditable result
neutron maintain report --audit --metrics
```

You will see: repository discovery → analysis → impact → plan → your approval → parallel agents → file changes → real test run → security scan → review → release gate → final report. If a gate denies, nothing changes — that is the point.

Example maintenance request used throughout this repo: **"Add Google OAuth while preserving the existing email/password login"** — it exercises frontend, backend, auth middleware, and tests, which is exactly what impact analysis is for.

## Human approval mechanism

- Before any implementation: the plan is displayed (files to modify/add, tests, database impact, risk, agents) and NEUTRON waits for **your** decision.
- A second **release gate** approves the finished change before it is considered done.
- Fail-closed: in non-interactive environments approval **auto-denies**; nothing proceeds silently.
- The only bypass is an explicit `-y/--yes` flag — clearly controlled, and every decision (approve/deny, gate, source) is persisted with a timestamp in the run's audit trail.
- Client input cannot inject approval: there is no flag or prompt trick that flips a denial.

## Testing

NEUTRON executes your project's real verification tooling and parses the results — it never claims "passed" without running:

- Build and test execution via the project's own scripts (`suggestedTestCommand()` detection; honest BLOCKED state when nothing can run)
- Type checking and lint where the project supports them
- Results feed the release gate: failing tests block release

Project's own test suite: `tests/` — 42 files, 345 tests, all passing (last verified 2026-09-26).

```bash
npm test           # vitest run — the project's full suite
npm run typecheck  # tsc --noEmit
npm run build      # tsup build + web asset copy
```

## Security

- Static security scan on every maintain run: hardcoded secrets, suspicious credentials, unsafe patterns — with severity-ranked, file-specific findings.
- Secrets are redacted in all output; API keys are never printed or logged.
- File operations are workspace-contained (path-traversal protected); deletes require approval; chained shell commands are skipped.
- `.env` is git-ignored; `.env.example` documents configuration without values.
- The repository was scanned for committed secrets: none found.

## Release gate

After implementation, tests, security scan, and review, the **release gate** summarizes: changes made, tests (passed/failed), security findings, review outcome — and requires human approval before the run is marked complete. The full audit trail (timestamps, agents, actions, files, approvals, verification results, errors) is stored per run in `.agent/neutron/runs/<runId>.json` and viewable via `neutron maintain report --audit` or the dashboard.

## IBM Bob 2.0 Hackathon

1. **Developer problem:** maintenance work is high-risk and time-consuming; AI tools that edit code without understanding blast radius, planning, or verification are unsafe for production repositories.
2. **How NEUTRON improves the workflow:** it replaces ad-hoc AI edits with a controlled loop — repository intelligence → impact analysis → human-approved plan → parallel specialized agents → real testing → security review → auditable report.
3. **How IBM Bob 2.0 was used:** Bob 2.0 was used during the development of NEUTRON itself — to analyze the repository architecture, review the maintenance workflow and agent orchestration, review testing/QA and the human-approval security boundaries, and to review code. Bob is a development assistant in NEUTRON's story, **not** NEUTRON's runtime AI backend.
4. **Parts developed/reviewed with Bob:** repository architecture analysis, maintenance workflow design, impact-analysis logic review, agent orchestration review, approval/security-boundary review, testing and QA review.
5. **Independent verification:** NEUTRON verifies every change itself — real test execution, static security scanning, code review, and a release gate — none of which depend on Bob.
6. **Evidence location:** real Bob task-session screenshots go in `bob_sessions/` (naming: `team_taskNN_description.png`; capture steps in `bob_sessions/README.md`). **TODO (manual):** capture real IBM Bob IDE session screenshots and add them there — no screenshots exist yet, and none are fabricated. Submission drafts (problem/solution and Bob-usage statements, checklist, demo script, slide content, judge-readiness notes) live in `docs/` (`SUBMISSION.md`, `HACKATHON_SUBMISSION_CHECKLIST.md`, `DEMO_VIDEO_SCRIPT.md`, `PRESENTATION.md`, `JUDGE_READINESS.md`, `FINAL_AUDIT.md`).

## Installation

Requires Node.js 20+.

```bash
# From the repository
npm install
npm run build

# Or via npm (if published)
npm install -g neutron-agent
```

One-line installers (macOS, Linux, Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/sunnymishraatf-lgtm/My-Agent/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/sunnymishraatf-lgtm/My-Agent/main/install.ps1 | iex
```

## Configuration

NEUTRON loads `.env` automatically on startup (project dir, then home dir) — no shell exports needed, works on Windows CMD too. Real environment variables override `.env` values. Copy `.env.example` to `.env` and fill in:

```bash
# Required — AgentRouter (recommended provider)
AGENTROUTER_API_KEY=<redacted>

# Optional
AGENTROUTER_BASE_URL=https://agentrouter.org/v1
AGENTROUTER_MODELS=claude-opus-5,claude-opus-4-8,deepseek-v4-flash,gpt-5.6-sol,gpt-6-astra
```

Other providers follow the same `<PREFIX>_API_KEY` / `<PREFIX>_BASE_URL` / `<PREFIX>_MODELS` convention (OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Google, Ollama, or any custom OpenAI-compatible endpoint). Verify with `neutron doctor`.

Parallelism/timeout tuning: `NEUTRON_MAX_PARALLEL` (default 4), `NEUTRON_TASK_TIMEOUT_MS` (default 10 min).

## Web Demo

A browser interface around the real NEUTRON workflow — no CLI required for judges.
Two deployment targets are supported:

**A. Vercel (serverless)** — repository analysis, impact analysis, planning and
the approval gate run live via serverless functions (`api/`); the UI is served
statically from `public/`. Full agent execution is honestly unavailable here
(the UI says so instead of faking it) — it needs the persistent host below.

**B. Persistent Node host (Render/Docker)** — the full demo including real
agent execution, testing, security scan and review via `neutron web`.

Run the Node server locally:

```bash
npm install
npm run build
node dist/cli-entry.js web --no-open
# Dashboard: http://127.0.0.1:4096/
# Web demo:  http://127.0.0.1:4096/demo
```

Click **Prepare demo repository** (scaffolds the TaskFlow sample app), enter a
maintenance request, and click **Analyze Repository**. The UI walks through
Repository Analysis → Impact Analysis → Implementation Plan → **Human Approval**
→ Agent Execution → Testing → Security → Code Review → Release Readiness, with
live stage statuses and the real engine output at each step. Approving the plan
runs the actual `createNeutronWorkflow` pipeline server-side; without an
approval, execution is refused (HTTP 409) — the gate is fail-closed.

The demo calls only server-side API routes (`/api/demo/*`); the browser never
receives API keys or secrets, and repository access is restricted to the
server's demo workspace.

## Environment Variables

| Variable | Purpose |
|---|---|
| `AGENTROUTER_API_KEY` | Server-side LLM key (enables agent execution; analysis/impact/planning work without it) |
| `PORT` | Web server port (default `4096`) |
| `NEUTRON_DEMO_WORKSPACE` | Directory the web demo may read/write (default `./neutron-demo-workspace`) |
| `SERVER_PASSWORD` | Optional HTTP Basic auth password for `neutron web` |
| `SERVER_SECRET` | **Required on Vercel** — signs the stateless plan-approval tokens (generate with `openssl rand -hex 32`); not needed for the Node server |
| `NEUTRON_DEMO_ALLOW_CLONE` | Set to `1` to allow GitHub URL cloning in the web demo (off by default; do not enable on Vercel) |
| `NEUTRON_DEMO_MAX_JOBS` | Max concurrent web-demo executions (default `2`) |
| `NEUTRON_MAX_PARALLEL` | Max parallel maintain tasks (default `4`) |
| `NEUTRON_TASK_TIMEOUT_MS` | Per-task orchestrator timeout (default 10 min) |

## Deployment

Two targets are supported — pick based on what you need to show:

- **Vercel (serverless):** repository analysis, impact analysis, planning and
  the approval gate run live; full agent execution honestly reports itself
  unavailable (it needs the persistent host). Easiest path to a public URL.
- **Persistent Node host (Render/Docker):** the complete demo, including real
  agent execution, testing, security scan and review.

```bash
docker build -t neutron-demo .
docker run -d -p 4096:4096 \
  -e AGENTROUTER_API_KEY="$AGENTROUTER_API_KEY" \
  -v neutron-data:/data \
  neutron-demo
# Demo at http://<host>:4096/demo
```

Full steps for both targets, Render walkthrough, and the LabLab Demo
Application URL guidance: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## CLI

The original NEUTRON CLI is fully intact — the web demo is an addition, not a
replacement. All commands work as before:

```bash
node dist/cli-entry.js maintain "Add Google OAuth while preserving email/password login"
node dist/cli-entry.js maintain --execution plan-only
node dist/cli-entry.js doctor
node dist/cli-entry.js --help
```

## Architecture

```
Browser
  → Web API (src/server/server.ts, /api/demo/* — server-side only)
  → NEUTRON workflow (src/neutron/: analyzer → impact → planner → agents → test-runner → security-scanner → review)
  → Agents (src/agents/: 10 specialized agents)
  → Tools (src/tools/: file/shell/search with safety hardening)
  → Validation (real test execution, security scan, code review, release gate)
```

IBM Bob 2.0 was used as a development partner during the creation of NEUTRON. NEUTRON does not use IBM Bob as its runtime backend.

## Project structure

```
src/
├── cli/            # command definitions (commander)
├── neutron/        # maintain workflow: analyzer, impact, planner, agents,
│                   # test-runner, security-scanner, review, record, demo, bob
├── agents/         # 10 specialized agents + registry
├── approval/       # human approval gate (fail-closed)
├── providers/      # LLM providers: OpenAI-compatible, Anthropic, Google
├── api/            # provider failover + request pooling
├── chat/           # interactive coding agent
├── web/            # dashboard UI (served by src/server/)
├── git/ github/    # checkpoints, GitHub automation
├── tools/          # file/shell/search tools with safety hardening
├── tui/            # terminal UI components
└── config.ts env.ts# configuration + .env loading
tests/              # 42 test files, 345 tests
docs/               # ARCHITECTURE.md + hackathon docs
examples/           # design.md example
bob_sessions/       # TODO (manual): real IBM Bob session screenshots
```

Legacy compatibility (kept intentionally, clearly marked): the `sunny` binary alias and the hidden `neutron sun` command still work (they print a deprecation note); `SUNNY_*` environment variables and the legacy `sunny` config directory are read as fallbacks. See `MIGRATION.md`.

## Test & build commands

```bash
npm ci                                # clean install from the lockfile
npm run typecheck                      # tsc --noEmit
npm test                               # vitest run (full suite: 42 files, 345 tests)
npm run build                          # tsup build + copy web assets to dist/
node dist/cli-entry.js --help          # CLI smoke test
```

## Limitations

- LLM-backed steps (agent implementation, chat) require a valid provider API key; without one, analysis/impact/planning still work but agents cannot implement.
- The maintain security step is static analysis; dependency-vulnerability auditing (`npm audit`) is not yet wired in.
- Test detection currently targets Node/npm projects; pytest/cargo/go test ecosystems are not auto-detected.
- `rollback` restores via git checkpoints only where a checkpoint branch was created; there is no standalone `neutron rollback` command yet.
- The approval gate offers approve/reject but no plan editing yet.
- No standalone `neutron analyze` / `impact` / `benchmark` commands yet (the engines exist inside `maintain`).
- Bob session evidence is pending manual capture (see above).

## Future improvements

- Standalone `analyze`, `impact`, `security`, and `benchmark` commands; Markdown/HTML report export.
- Bounded test-failure repair loop (analyze failure → repair agent → re-test, max N attempts).
- `neutron rollback` with real restore; PR summary/creation flow.
- Wire the LLM SecurityAgent and ReviewerAgent into the maintain pipeline (currently used on the legacy `run` path).
- Multi-ecosystem verification (pytest, cargo, go test) and `npm audit` integration.
- Approval v2: edit plan, reject with feedback, per-stage approval granularity.
- Dashboard agents/audit pages and server route tests.

## License

MIT — see `LICENSE`.
