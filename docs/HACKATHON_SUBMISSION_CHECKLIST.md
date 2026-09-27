# NEUTRON — Hackathon Submission Checklist

> Grounded in the codebase at `~/workspace/neutron-agent/agent`.
> Real numbers: **42 test files / 345 tests** (last full verified run
> 2026-09-26). Do NOT check a manual item until it is actually done.

## REPOSITORY

- [ ] Public GitHub repository verified
- [ ] Repository URL confirmed
- [x] README complete — judge-focused, 24 areas, commands verified against `src/cli/index.ts`
- [x] No secrets committed — scanned 2026-09-26: no keys/tokens/private keys in `src/`; `.env.example` placeholder-only

## IBM BOB

- [ ] IBM Bob IDE used on actual project — MANUAL ACTION REQUIRED: perform the tasks in `docs/BOB_TASKS.md`
- [ ] Bob task-session screenshots captured — MANUAL ACTION REQUIRED: real Bob IDE sessions only, never fabricated
- [ ] Screenshots added to `bob_sessions/` — currently intentionally empty; PNG, `team_taskNN_description.png`
- [ ] Each team member's required evidence added — MANUAL ACTION REQUIRED

## APPLICATION

- [x] Working prototype — `neutron maintain "<request>"` pipeline is real: analyze → impact → plan → approval → checkpoint → parallel agents → tests → security → review → release gate → report (`src/neutron/workflow.ts`)
- [x] Maintenance workflow — hero loop verified end to end
- [x] Repository analysis — deterministic static analyzer (`src/neutron/analyzer.ts`): import graph, test links, entry points, frameworks
- [x] Impact analysis — deterministic engine (`src/neutron/impact.ts`): transitive walk, per-file reasons, risk levels
- [x] Planning — engineering plan generation (`src/neutron/planner.ts`)
- [x] Human approval — fail-closed gate (`src/approval/approver.ts`): interactive y/N, auto-deny on non-TTY, decisions persisted
- [x] Agent execution — 10 real specialized agents, bounded parallelism (default 4), per-task timeout (default 10 min)
- [x] Testing — real build/test execution with honest BLOCKED states (`src/neutron/test-runner.ts`)
- [x] Security — static scanner (`src/neutron/security-scanner.ts`); 2 real vulnerabilities fixed 2026-09-26 with regression tests
- [x] Code review — review pass with actionable findings
- [x] Release readiness — release gate + per-run audit trail (`.agent/neutron/runs/<runId>.json`)

## VERIFICATION

All re-run in this session on 2026-09-26 (working copy
`~/workspace/neutron-agent/agent`):

- [x] Final `npm ci` verified — `node_modules/` already installed and
  consistent with `package-lock.json`; full `npm test` below exercises it
- [x] Final typecheck verified — `npm run typecheck` (`tsc --noEmit`):
  clean, exit 0
- [x] Final tests verified — `npm test`: **42 files / 345 tests, all passed**,
  exit 0
- [x] Final build verified — `npm run build` (`tsup` + web asset copy):
  success, exit 0
- [x] Main CLI workflow verified — `neutron --help` renders NEUTRON banner;
  `neutron doctor` reports platform/Node/NPM/Git status correctly with no key
- [x] Demo workflow verified — `maintain demo taskflow` scaffolds 23 files;
  `maintain "Add Google OAuth while preserving email/password login"
  --execution plan-only` runs analysis → impact (13 files affected) → plan →
  fail-closed approval (`[non-interactive] plan-approval: auto-denying`)

## MEDIA

- [ ] Cover image — MANUAL ACTION REQUIRED: spec at `docs/COVER_IMAGE.md`
- [ ] Demo video <= 3 minutes — MANUAL ACTION REQUIRED: script at `docs/DEMO_VIDEO_SCRIPT.md`
- [ ] At least 90 seconds of working demo — the script allocates 0:50–2:30 to the live demo
- [ ] Slide presentation — MANUAL ACTION REQUIRED: content at `docs/PRESENTATION.md`

## SUBMISSION

- [x] Problem & Solution Statement — draft ready in `docs/SUBMISSION.md` (≈360 words, under 500)
- [x] IBM Bob Usage Statement — draft ready in `docs/SUBMISSION.md` (≈230 words, under 500; honest: Bob is a development partner, not the runtime backend)
- [x] Technology tags — in `docs/SUBMISSION.md`
- [ ] Category — MANUAL ACTION REQUIRED: `[INSERT HACKATHON CATEGORY]`
- [ ] Application URL — not applicable (CLI; `neutron web` runs locally)
- [ ] Public repository URL — MANUAL ACTION REQUIRED: `[INSERT FINAL PUBLIC GITHUB URL]`
- [ ] Video — MANUAL ACTION REQUIRED
- [ ] Cover image — MANUAL ACTION REQUIRED
- [ ] Slides — MANUAL ACTION REQUIRED
