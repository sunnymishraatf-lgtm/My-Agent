# NEUTRON — Slide Deck Content (10 slides)

> Final content — MANUAL ACTION REQUIRED: build the actual deck from this.
> Keep bullets as written; they are sized to fit on slides.

## Slide 1 — Title

**NEUTRON**
Autonomous Software Maintenance Intelligence

*An AI engineering workflow that safely takes software maintenance tasks
from understanding to verified implementation.*

IBM Bob 2.0 Hackathon · Team [name] · [date]

## Slide 2 — Developer Problem

- Maintenance (bugs, upgrades, small features) dominates developer time.
- AI coding tools edit first and ask never: no repo understanding, no
  impact analysis, no approval.
- They report "tests pass" without running tests.
- Result: fast output nobody trusts, rework nobody planned.

## Slide 3 — Why Existing Maintenance Is Difficult

- Impact analysis today = grep-and-hope.
- AI diffs land unreviewed; review burden shifts to humans.
- No audit trail: who changed what, why, and was it verified?
- The cost: regressions, security holes, eroded codebase trust.

## Slide 4 — NEUTRON Solution

One command: `neutron maintain "<request>"`

A verifiable pipeline, not a black box:

**Analysis → Impact → Plan → Approval → Agents → Test → Security →
Review → Release**

- Understands the repo before touching it.
- Human approves the plan before any change.
- Every change is tested, scanned, reviewed, and auditable.

## Slide 5 — Architecture

- `src/neutron/` — analyzer, impact engine, planner, parallel agents,
  test-runner, security-scanner, audit record (deterministic where it
  matters; no LLM guessing in impact analysis).
- `src/agents/` — 10 real specialized agents (Backend, Frontend,
  Database, Security, QA, DevOps, Reviewer…).
- `src/approval/` — fail-closed human approval gate.
- `src/git/` — checkpoint branches before changes.
- `neutron web` — local dashboard, same workflow state.

## Slide 6 — End-to-End Workflow

Live flow on the TaskFlow demo app:

1. Request: *"Add Google OAuth while preserving email/password login"*
2. Analysis: repo stats, frameworks, entry points.
3. Impact: 13 files, per-file reasons, risk level.
4. Plan: tasks with assigned agents.
5. **Approval gate** — human decides.
6. Agents implement → tests run → security scan → review → release gate.
7. Auditable report.

## Slide 7 — Live Demo / Results

- Run it: `maintain demo taskflow`, then `maintain "<request>"`.
- Real tests executed — honest BLOCKED when they can't run, never
  fake "passed".
- Git checkpoint created before any change.
- Full audit record: `.agent/neutron/runs/<runId>.json`.
- 42 test files / 345 tests passing in NEUTRON's own suite.

## Slide 8 — Safety, Human Approval & Security

- Approval gate: interactive y/N; auto-deny on non-TTY — nothing silent.
- `--yes` is explicit; client input cannot inject approval.
- Deletes need approval; dangerous shell commands are gated.
- Secrets redacted everywhere; no keys in logs or records.
- 2 real vulnerabilities found and fixed during hardening (regression-tested).

## Slide 9 — IBM Bob 2.0 Usage

- Bob 2.0 is our **development partner, not the runtime backend**.
- Used for: architecture analysis, workflow tracing, impact/orchestration
  reviews, approval & security-boundary reviews, testing/QA and code
  reviews of NEUTRON itself.
- Real session screenshots in `bob_sessions/` — only sessions that
  actually happened; nothing fabricated.
- NEUTRON's own pipeline (tests, scans, gates) verifies output
  independently.

## Slide 10 — Future / Closing

- Standalone `analyze` / `impact` / `security` / `benchmark` commands.
- Bounded test-failure repair loop; `npm audit` wiring.
- Multi-ecosystem verification (pytest, cargo, go test).
- Vision: **maintenance as an auditable engineering discipline —
  not a gamble.**

*NEUTRON: maintenance you can audit.*
