# NEUTRON — Judge Readiness

> No scores, no win claims — only evidence, gaps, and demo actions.
> Grounded in the codebase at `~/workspace/neutron-agent/agent`.
> Real numbers: **42 test files / 345 tests passing**, `typecheck` and
> `build` clean (last full verified run 2026-09-26).

## 1. Application of Technology

**CURRENT EVIDENCE:** A real multi-stage AI engineering pipeline:
deterministic static repo analysis (import graph, test linking, entry
points), deterministic impact scoring with transitive dependency walk,
LLM-driven specialized agents (10 real agents in `src/agents/`) with
bounded parallelism (`NEUTRON_MAX_PARALLEL=4`) and per-task timeouts
(`NEUTRON_TASK_TIMEOUT_MS`), real test execution, static security
scanning, git checkpointing, and a persisted per-run audit trail.

**MISSING EVIDENCE:** Standalone `analyze`/`impact`/`security`/`benchmark`
commands (the logic exists, exposed only inside `maintain`); no automated
test-repair loop; verification auto-detection is npm-only.

**DEMO ACTION:** Run the plan-only demo (analysis + impact + plan in
seconds), then show the full run's test/security/release output and the
audit JSON at `.agent/neutron/runs/<runId>.json`.

## 2. Presentation

**CURRENT EVIDENCE:** Clean staged CLI output (`maintain`, `maintain
report`, `maintain demo`, `maintain what-breaks`), honest status reporting
(BLOCKED vs PASSED, never fake "passed"), structured approval prompt, and
a working local dashboard (`neutron web`, port 4096, 14 views). Real demo
scaffold: `maintain demo taskflow` produces a functional Express/JWT/React
app (23 files). Demo script (`docs/DEMO_VIDEO_SCRIPT.md`) and slide
content (`docs/PRESENTATION.md`) are written.

**MISSING EVIDENCE:** The actual slide deck, cover image, and recorded
video are not made yet — MANUAL ACTION REQUIRED.

**DEMO ACTION:** Run the TaskFlow hero request end to end; let the approval
gate visibly interrupt the flow; narrate the audit trail.

## 3. Business Value

**CURRENT EVIDENCE:** Maintenance is the dominant cost center of software
ownership; NEUTRON attacks it with a trust-first loop (approve → verify →
audit) rather than raw code generation. Auditability is the business
argument: approval decisions, per-file change lists, metrics, and security
findings are persisted per run, so every AI change is attributable,
reviewable, and reversible via git checkpoints.

**MISSING EVIDENCE:** Real productivity measurements — no benchmark
baselines have been run, and no numbers are invented to fill the gap.

**DEMO ACTION:** Show the final maintenance report and audit record; frame
the value as "verified maintenance, not just generated code"; be explicit
that measurements are future work.

## 4. Originality

**CURRENT EVIDENCE:** The differentiator is the safety loop, not the model:
deterministic analysis + human approval + honest verification is rare among
AI coding tools, which typically go straight from prompt to diff.
Fail-closed approval (auto-deny on non-TTY) and "never claim a pass without
execution" are deliberate, unusual design choices (`src/approval/approver.ts`,
`src/neutron/test-runner.ts`).

**MISSING EVIDENCE:** Nothing structural — originality rests on execution
quality and honest handling of failure paths.

**DEMO ACTION:** Show the contrast moment: trigger or narrate the auto-deny
/ BLOCKED path so judges see the system refusing to pretend.

## Cross-cutting: IBM Bob 2.0 usage (judge-visible)

**CURRENT EVIDENCE:** Bob is presented accurately as the **development
partner** (task guide in `docs/BOB_TASKS.md`), never as the runtime backend;
`bob_sessions/` exists with a README defining valid evidence.

**MISSING EVIDENCE:** `bob_sessions/` is empty — real Bob IDE sessions are
the single highest-leverage manual action before submission.

**DEMO ACTION:** Mention Bob's role in the closing 15 seconds; show the
evidence folder honestly (empty until real sessions are captured).
