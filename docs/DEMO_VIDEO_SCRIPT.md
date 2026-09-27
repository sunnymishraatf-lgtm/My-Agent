# NEUTRON — Demo Video Script (3:00 maximum)

> Built ONLY on real capabilities. No mocked output, no invented results.
> Prereq: `npm install && npm run build` done. The full agent run needs a
> real `AGENTROUTER_API_KEY`; without it, record the plan-only path and say
> so on camera — the verified key-less demo below is complete in itself.

## 0:00–0:20 — Problem

VOICEOVER:
"Developers spend most of their time on maintenance — bug fixes, upgrades,
small features. AI coding tools blast out edits with no understanding of
your repository, no impact analysis, no approval — and they report tests
passed when nothing actually ran. Fast output. Zero trust."

SCREEN: Terminal with a repo; a generic AI diff flashing across files.
ACTION: Type a careless prompt into a generic tool; show an unreviewed diff
being applied with no test output.

## 0:20–0:35 — NEUTRON introduction

VOICEOVER:
"NEUTRON — Autonomous Software Maintenance Intelligence. It's not a
chatbot. You give it a maintenance request, and it runs a controlled
engineering workflow: understand, analyze, plan, approve, execute, verify,
secure, review, report."

SCREEN: `node dist/cli-entry.js --help` output showing the NEUTRON banner.
ACTION: Run the help command; highlight `maintain`.

## 0:35–0:50 — Architecture

VOICEOVER:
"Every stage is real code. Every decision is written to an audit trail.
And nothing changes without human approval."

SCREEN: The pipeline diagram:
```
request → repo analysis → impact analysis → plan → HUMAN APPROVAL
→ agents → tests → security → review → release gate → report
```
ACTION: Show the diagram; point at the approval gate.

## 0:50–2:30 — LIVE WORKING DEMO (100 seconds)

Setup (before recording): `node dist/cli-entry.js maintain demo taskflow
--dir C:\neutron-demo` — scaffolds the real TaskFlow app (Express + JWT +
React + tests, 23 files).

**0:50–1:10 — Repository discovery & analysis**

VOICEOVER:
"Here's a real sample app — 23 files. I ask NEUTRON to add Google OAuth
while keeping the existing email login. First, it discovers the repository."

SCREEN: `maintain "Add Google OAuth while preserving email/password login"
--execution plan-only` — `[neutron] Analyzing repository...` output with
file, language, framework, and entry-point stats.
ACTION: Run the command; scroll the analysis output.

**1:10–1:35 — Impact analysis**

VOICEOVER:
"Then impact analysis — computed from the real import graph, not guessed.
Thirteen files affected: backend auth routes, the token service, frontend
pages, three tests — each with a reason, like 'used by three modules'."

SCREEN: The affected-components output: backend / frontend / tests lists
with per-file reasons and the risk level.
ACTION: Highlight two or three impact lines and their reasons.

**1:35–1:55 — Plan & human approval**

VOICEOVER:
"NEUTRON drafts an engineering plan — and stops. Nothing is modified until
a human approves. Outside an interactive terminal it auto-denies: nothing
runs silently, ever."

SCREEN: `IMPLEMENTATION PLAN` with agents assigned per task, then the
approval prompt.
ACTION: Show the plan; approve it interactively on camera (or show the
`[non-interactive] plan-approval: auto-denying` fail-closed path).

**1:55–2:20 — Agents, tests, security, review**

VOICEOVER:
"Approved agents implement in parallel — bounded, so they can't stampede —
then the project's real tests execute, a security scan runs, and a review
pass produces findings before the release gate."

SCREEN: Parallel agent output, real test run results, security findings,
release gate, final report.
ACTION: With a valid key, run the full workflow; without a key, say so
plainly and show `maintain report --audit --metrics` on the plan-only run.

**2:20–2:30 — Audit trail**

VOICEOVER:
"Everything lands in a per-run audit record — timestamps, agents, files,
approvals, verification results."

SCREEN: `maintain report --audit` / the `.agent/neutron/runs/<runId>.json`.
ACTION: Show the audit trail.

## 2:30–2:45 — Verification / results

VOICEOVER:
"What actually ran: real static analysis, real tests — reported BLOCKED,
never 'passed', when the environment can't execute them — a real security
scan, a git checkpoint branch before any change, and a full audit record.
NEUTRON never claims success it didn't earn."

SCREEN: The final report: changes, tests, security findings, approval,
status COMPLETED (or the honest BLOCKED/failed state if that's what ran).
ACTION: Hold on the report; don't edit or cherry-pick.

## 2:45–3:00 — IBM Bob usage + closing

VOICEOVER:
"Built for the IBM Bob 2.0 Hackathon: Bob was our development partner —
architecture analysis, workflow and security-boundary reviews of NEUTRON
itself — while NEUTRON's own pipeline independently verifies every change.
Real session evidence lives in bob_sessions/. NEUTRON: maintenance you can
audit."

SCREEN: The `bob_sessions/` folder (with real screenshots once captured),
then the NEUTRON banner.
ACTION: Show the evidence folder; end on the banner.

---

### Recording notes

- Budget 180 seconds; plan-only is fast, the full keyed run varies with the
  model — edit honestly, never splice in fake success.
- If any step fails on camera, keep it: failure handling is part of the
  story, and the fail-closed approval path is a feature worth showing.
