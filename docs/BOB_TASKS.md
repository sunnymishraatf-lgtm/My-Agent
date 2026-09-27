# IBM Bob 2.0 Tasks for NEUTRON — Manual Task Guide

> **Status: RECOMMENDED, not completed.** Every task below is labeled
> **MANUAL IBM BOB TASK**. These are real tasks to perform inside IBM Bob IDE
> on the NEUTRON repository (`~/workspace/neutron-agent/agent`, package
> `neutron-agent`). Do not claim any task was completed unless a real Bob IDE
> session happened and its screenshot was saved to `bob_sessions/`.

For each task: open the NEUTRON repo in IBM Bob IDE, give Bob the prompt,
review its output, capture the session-summary screenshot per
`bob_sessions/README.md`, and save it as
`bob_sessions/team_taskNN_<description>.png`.

---

## Task 1 — Repository architecture analysis

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Get an independent read of NEUTRON's architecture and confirm
  the component map is accurate.
- **Prompt to give Bob:**
  > Analyze the architecture of this TypeScript CLI project (neutron-agent).
  > Map the relationships between src/neutron/workflow.ts, src/neutron/agents.ts,
  > src/orchestrator/, src/agents/, src/approval/, src/git/, src/providers/
  > and src/server/. Identify the two agent-execution systems and explain how
  > they differ. Flag any architectural smell you find.
- **Expected result:** Component map, the two orchestration systems
  (`neutron maintain` vs legacy `plan`/`run`), dependency notes.
- **Files Bob should inspect:** `src/neutron/workflow.ts`, `src/neutron/agents.ts`,
  `src/orchestrator/orchestrator.ts`, `src/agents/registry.ts`,
  `src/cli/neutron-command.ts`, `src/cli/index.ts`.
- **Screenshot to capture:** `team_task01_repository_analysis.png` — Bob's
  architecture summary in the task panel.

## Task 2 — Maintenance workflow analysis

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Validate the hero `maintain` pipeline end to end (logic, not execution).
- **Prompt to give Bob:**
  > Trace the full `neutron maintain "<request>"` workflow in
  > src/neutron/workflow.ts runFullWorkflow(). List every stage in order,
  > what each stage reads and writes, and where a failure at each stage
  > leaves the repository. Is there any stage whose failure is silent?
- **Expected result:** Ordered stage list
  (analyze → impact → plan → approval → checkpoint → agents → tests →
  security → review → release → report), failure-handling notes.
- **Files Bob should inspect:** `src/neutron/workflow.ts`, `src/neutron/record.ts`,
  `src/approval/approver.ts`.
- **Screenshot to capture:** `team_task02_workflow_analysis.png` — the traced
  stage list and failure notes.

## Task 3 — Impact-analysis review

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Review the deterministic impact engine for correctness gaps.
- **Prompt to give Bob:**
  > Review src/neutron/impact.ts analyzeImpact(). Explain how it scores files
  > against a maintenance request, how the transitive dependency walk works,
  > and where the scoring could produce false positives or false negatives.
  > Suggest one concrete, minimal improvement.
- **Expected result:** Scoring/walk explanation, precision/recall risks,
  one concrete suggestion.
- **Files Bob should inspect:** `src/neutron/impact.ts`, `src/neutron/analyzer.ts`.
- **Screenshot to capture:** `team_task03_impact_analysis.png` — Bob's
  assessment and suggested improvement.

## Task 4 — Agent orchestration review

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Review parallel execution safety (bounded parallelism, timeouts).
- **Prompt to give Bob:**
  > Review src/neutron/agents.ts implementPlan() and
  > src/orchestrator/orchestrator.ts runBatch(). How is parallelism bounded
  > (NEUTRON_MAX_PARALLEL, NEUTRON_TASK_TIMEOUT_MS)? Can two agents write
  > the same file concurrently? What happens to a timed-out agent's late result?
- **Expected result:** Concurrency model description, race-condition
  assessment, timeout semantics.
- **Files Bob should inspect:** `src/neutron/agents.ts`,
  `src/orchestrator/orchestrator.ts`.
- **Screenshot to capture:** `team_task04_agent_workflow.png` — the
  concurrency and timeout assessment.

## Task 5 — Human approval / security review

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Confirm consequential operations cannot bypass approval.
- **Prompt to give Bob:**
  > Review src/approval/approver.ts, src/agents/apply.ts and the approval
  > wiring in src/neutron/workflow.ts and src/cli/neutron-command.ts.
  > Is the non-TTY auto-deny fail-closed? Can a client flag or config value
  > silently force approval of destructive operations? List the approval
  > bypass surface, if any.
- **Expected result:** Approval-gate inventory, bypass analysis,
  confirmation of fail-closed defaults.
- **Files Bob should inspect:** `src/approval/approver.ts`,
  `src/agents/apply.ts`, `src/neutron/workflow.ts`,
  `src/cli/neutron-command.ts`.
- **Screenshot to capture:** `team_task05_security.png` — the approval
  boundary review summary.

## Task 6 — Testing and QA review

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Review the verification pipeline for honest reporting.
- **Prompt to give Bob:**
  > Review src/neutron/test-runner.ts and src/agents/qa.ts. How are build
  > and test commands detected and executed? Is there any code path that
  > could report tests as passed when they were not run? How are blocked
  > environments (missing node_modules) reported?
- **Expected result:** Detection/execution flow, honest-BLOCKED verification,
  any pass-without-run risk.
- **Files Bob should inspect:** `src/neutron/test-runner.ts`, `src/agents/qa.ts`.
- **Screenshot to capture:** `team_task06_testing.png` — the verification
  honesty review.

## Task 7 — Security review

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Review the static security scanner and secret handling.
- **Prompt to give Bob:**
  > Review src/neutron/security-scanner.ts and the secret-redaction handling
  > in src/providers/ and src/api/. What vulnerability classes does the
  > scanner detect? What does it miss (e.g. dependency CVEs)? Confirm no
  > API keys are logged or persisted in run records.
- **Expected result:** Scanner coverage list, known gaps
  (no `npm audit` wiring, npm-only detection), secret-handling confirmation.
- **Files Bob should inspect:** `src/neutron/security-scanner.ts`,
  `src/providers/errors.ts`, `src/api/api-manager.ts`, `.env.example`.
- **Screenshot to capture:** `team_task07_security_scanner.png` — the
  scanner coverage review.

## Task 8 — Code review

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** General code review of the most-changed recent modules.
- **Prompt to give Bob:**
  > Review the recent reliability changes in src/neutron/agents.ts
  > (boundedChunks, resolveMaxParallel), src/orchestrator/orchestrator.ts
  > (withTimeout), and src/neutron/record.ts (recordApproval, setChanges).
  > Focus on correctness, error handling, and edge cases (invalid env values,
  > zero/negative inputs).
- **Expected result:** Findings list with file/line references, or a clean
  bill with noted edge cases.
- **Files Bob should inspect:** `src/neutron/agents.ts`,
  `src/orchestrator/orchestrator.ts`, `src/neutron/record.ts`,
  `tests/neutron-phase2.test.ts`.
- **Screenshot to capture:** `team_task08_code_review.png` — findings or
  clean bill.

## Task 9 — Release-gate review

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Review the release readiness decision logic.
- **Prompt to give Bob:**
  > In src/neutron/workflow.ts, find the release gate that runs after
  > tests, security scan, and review. What conditions must hold for a
  > release to be approved? Can a failed test suite still reach "release
  > ready"? Trace the exact decision path.
- **Expected result:** Gate conditions, fail-path trace, any loophole.
- **Files Bob should inspect:** `src/neutron/workflow.ts`, `src/neutron/record.ts`.
- **Screenshot to capture:** `team_task09_release_gate_review.png` — the
  gate decision-path trace.

## Task 10 — Final integration review

> **MANUAL IBM BOB TASK** — not completed until a real Bob IDE session runs.

- **Objective:** Pre-submission sanity pass over CLI surface and docs.
- **Prompt to give Bob:**
  > Check that every command registered in src/cli/index.ts and
  > src/cli/neutron-command.ts is reachable and described, and that
  > README.md documents the real command set (maintain, maintain report,
  > maintain demo, web, doctor, models, chat, test, review, bench, fix,
  > config). Flag documented-but-missing or existing-but-undocumented
  > commands.
- **Expected result:** Command inventory vs docs, mismatch list.
- **Files Bob should inspect:** `src/cli/index.ts`,
  `src/cli/neutron-command.ts`, `README.md`.
- **Screenshot to capture:** `team_task10_final_review.png` — the
  command-inventory comparison.

---

## After the sessions

1. Save each PNG to `bob_sessions/` using the naming format above.
2. Update `bob_sessions/README.md` status line (remove "intentionally empty").
3. Do not edit code based on Bob's suggestions without human review —
   record the human decision for each accepted change.
