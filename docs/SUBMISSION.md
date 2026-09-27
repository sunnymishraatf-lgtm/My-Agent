# NEUTRON — lablab.ai Submission Draft

> DRAFT — fields marked **[INSERT …]** are MANUAL ACTION REQUIRED before
> submitting. Do not submit with placeholders unfilled.

## PROJECT TITLE

NEUTRON — Autonomous Software Maintenance Intelligence

## SHORT DESCRIPTION

NEUTRON turns a natural-language maintenance request into a controlled AI
engineering workflow: it analyzes the repository, computes change impact,
drafts an implementation plan, requires human approval, coordinates
specialized agents, runs tests and security checks, and produces an
auditable report.

## LONG DESCRIPTION / PROBLEM & SOLUTION STATEMENT

**Problem.** Software maintenance — bug fixes, dependency migrations, auth
changes, security patches — is where developers spend most of their time,
and it is the riskiest work: a "small" change can break checkout, webhooks,
and tests three modules away. Existing AI coding tools act like autocomplete
with a keyboard: they edit files immediately, with no understanding of blast
radius, no plan a human can review, no verification worth trusting, and they
report success without running tests. The result is fast-looking output that
erodes trust in the codebase and creates rework.

**Solution.** NEUTRON (`neutron-agent`, a TypeScript CLI) makes maintenance a
verifiable pipeline instead of a black box. Given a request such as
`neutron maintain "Add Google OAuth while preserving email/password login"`,
NEUTRON: (1) statically analyzes the repository — languages, frameworks,
import graph, test-to-code links, entry points; (2) computes deterministic
impact analysis — affected files, transitive dependents, risk level with
per-file reasons; (3) generates an engineering plan; (4) stops at a human
approval gate (interactive y/N; auto-deny outside a TTY, so nothing happens
silently); (5) creates a git checkpoint branch; (6) dispatches specialized
agents (Backend, Frontend, Database, Security, QA, DevOps, Reviewer) with
bounded parallelism and per-task timeouts; (7) executes real builds and
tests, reporting BLOCKED honestly when the environment can't run them —
never "passed" without execution; (8) runs a static security scan; (9)
applies a review pass; (10) enforces a release gate and writes a full audit
trail (`.agent/neutron/runs/<runId>.json`) plus `maintain report` output.

**Why it matters.** Maintenance is where software lives or dies, and rework
is its tax. NEUTRON's differentiator is not code generation — it is the
safety loop around it: Understand → Analyze → Plan → Approve → Execute →
Verify → Secure → Review → Report. Approval decisions, per-file change
lists, metrics, and security findings are all persisted, so every AI-driven
change is attributable, reviewable, and reversible via git checkpoints. A
local web dashboard (`neutron web`) visualizes the same workflow state.

**Limitations (stated plainly).** Verification currently targets npm-based
projects; there is no automated test-repair loop yet; the `maintain` review
step uses deterministic heuristics (the LLM reviewer serves the standalone
`review` path). No benchmark numbers are claimed — measurement tooling
exists in the run records but no baseline comparison has been run.

(≈360 words — under the 500-word limit)

## IBM BOB USAGE STATEMENT

IBM Bob 2.0 is **not** NEUTRON's runtime AI backend. NEUTRON executes its
agents against the developer's own configured LLM provider (via AgentRouter,
with classified errors and failover); Bob never sees user code at runtime,
and no submission claim depends on it doing so.

IBM Bob 2.0 was used as a **development partner** while building and
hardening NEUTRON for this hackathon — the way a team uses an IDE assistant
for analysis and review: repository architecture analysis, maintenance
workflow tracing, impact-analysis review, agent orchestration review,
human-approval and security-boundary review, testing/QA review, security
review, code review, release-gate review, and final integration review. The
recommended tasks are documented in `docs/BOB_TASKS.md`, each with an exact
prompt, the NEUTRON files Bob inspects, and the screenshot evidence to
capture.

**Honest status:** no Bob IDE task sessions have been recorded yet.
`bob_sessions/` exists with a README specifying what counts as valid
evidence (real Bob IDE screenshots, PNG preferred, `team_taskNN_*` naming)
and is intentionally empty until the team completes real sessions.
NEUTRON independently verifies every change it makes — real test execution,
static security scanning, code review, and a release gate — none of which
depend on Bob. We claim only Bob usage that actually happened, with
screenshots to prove it.

(≈230 words — under the 500-word limit)

MANUAL ACTION REQUIRED: complete the tasks in `docs/BOB_TASKS.md` inside
IBM Bob IDE and add the screenshots to `bob_sessions/` before submission.

## TECHNOLOGY

TypeScript, Node.js, commander.js CLI, multi-agent orchestration,
deterministic static analysis (import graph, impact scoring), Vitest,
git checkpointing, local web dashboard (plain Node HTTP + vanilla JS).
AI providers: any OpenAI-compatible endpoint via AgentRouter
(claude-opus-5, claude-opus-4-8, deepseek-v4-flash, gpt-5.6-sol,
gpt-6-astra), Anthropic, Google.

Technology tags: typescript, nodejs, cli, ai-agents,
multi-agent-orchestration, static-analysis, developer-tools,
software-maintenance, git, code-review, security-scanning

## CATEGORY

[INSERT HACKATHON CATEGORY — e.g. Developer Tools / AI Productivity]
(MANUAL ACTION REQUIRED)

## PUBLIC REPOSITORY

[INSERT FINAL PUBLIC GITHUB URL]
(MANUAL ACTION REQUIRED — push the repo publicly, then paste the URL here
and into lablab.ai. Do not invent the URL.)

## APPLICATION URL

Not applicable — NEUTRON is a CLI. `neutron web` runs locally on
http://127.0.0.1:4096. No hosted deployment exists.

## DEMO VIDEO

[INSERT DEMO VIDEO URL — ≤3 minutes, ≥90 seconds of live working demo]
(MANUAL ACTION REQUIRED — record per `docs/DEMO_VIDEO_SCRIPT.md`.)

## COVER IMAGE

[INSERT COVER IMAGE FILE]
(MANUAL ACTION REQUIRED — create per `docs/COVER_IMAGE.md`.)

## SLIDE PRESENTATION

[INSERT SLIDE DECK FILE/LINK]
(MANUAL ACTION REQUIRED — build the deck from `docs/PRESENTATION.md`.)

## BOB SESSION EVIDENCE

`bob_sessions/` — currently empty. Real IBM Bob IDE task-session
screenshots go here before submission (PNG, `team_taskNN_description.png`).
(MANUAL ACTION REQUIRED — see `bob_sessions/README.md` and
`docs/BOB_TASKS.md`. No fake screenshots.)
