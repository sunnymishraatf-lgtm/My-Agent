# NEUTRON Hero Demo

**The demo:** `neutron maintain "Add Google OAuth while preserving email/password login"` against a small, realistic sample app (TaskFlow) that NEUTRON scaffolds itself.

This is the exact workflow judges should see:

```
Natural-language request
        ↓
Repository analysis (real static analysis)
        ↓
Impact analysis (deterministic, over the real dependency graph)
        ↓
Implementation plan (real, per-file, dependency-ordered)
        ↓
Human approval gate (fail-closed)
        ↓
Specialized agents implement in parallel (requires API key)
        ↓
Tests → Security scan → Code review (requires API key)
        ↓
Release gate + maintenance report
```

## Before: the starting point

Run this once to create the demo project. It scaffolds the **same 23 files every
time** (deterministic — covered by `tests/neutron-demo.test.ts`):

**Windows CMD**
```cmd
cd path\to\neutron-agent\agent
node dist\cli-entry.js maintain demo taskflow --dir C:\neutron-demo
cd C:\neutron-demo
```

**bash**
```bash
cd ~/workspace/neutron-agent/agent
node dist/cli-entry.js maintain demo taskflow --dir /tmp/neutron-demo
cd /tmp/neutron-demo
```

You get TaskFlow: an Express + JWT + bcrypt app with email/password login, user
profiles, a tasks REST API, React login/dashboard/profile pages, and three test
files. Secrets in the scaffold are placeholders only (`change-me`, empty
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`).

## Step 1 — Repository analysis (no API key needed)

```cmd
node dist\cli-entry.js maintain "Add Google OAuth while preserving email/password login" --execution plan-only
```

What you will see (all real, zero LLM cost):

1. `[neutron] Analyzing repository...` — walks the repo, extracts imports into a
   real dependency graph, detects frameworks, entry points, test files.
2. `[neutron] Computing impact...` — keyword + alias scoring over the actual
   graph: for this request it finds **13 affected files, 8 services, 3 tests**.
3. `IMPLEMENTATION PLAN` — per-file task list with dependency ordering
   (`(after …)`), assigned agents (Backend / Frontend / Database / DevOps /
   **QA Agent**), and risk levels.
4. Approval gate — **fail-closed**: on a non-interactive terminal it prints
   `[non-interactive] plan-approval: auto-denying Approve?` and changes nothing.
   On an interactive terminal it prompts `[y/N]`. `-y` auto-approves.

Inspect the cached results without re-running:

```cmd
node dist\cli-entry.js maintain report --metrics
node dist\cli-entry.js maintain what-breaks
```

## Step 2 — Human approval, then real implementation (API key required)

Set a valid key (never commit it):

**Windows CMD**
```cmd
set AGENTROUTER_API_KEY=your-key-here
```

**bash**
```bash
export AGENTROUTER_API_KEY=your-key-here
```

Then run the full workflow from inside the demo directory:

```cmd
node dist\cli-entry.js maintain "Add Google OAuth while preserving email/password login"
```

What happens (verified in code paths; live LLM implementation needs a real key,
which was not available during verification):

1. `doctor`-verified provider selection from your configured AgentRouter models
   (`claude-opus-4-8`, `claude-opus-5`, `deepseek-v4-flash`, `gpt-5.6-sol`,
   `gpt-6-astra`).
2. Interactive plan approval — implementation starts only after you approve.
3. Git checkpoint branch `neutron/maintenance/<timestamp>` created (when on
   `main`) so every AI change is recoverable.
4. Agents implement in parallel (bounded, max 4 concurrent), each task wrapped
   in a per-task timeout; failed tasks never silently pass.
5. Real test execution (`vitest run` detected from the repo), real static
   security scan, deterministic code review, release gate.
6. `neutron maintain report` shows the final state: changes, tests, security
   findings, agents used, approval record.

## After: what to check

- `git log` / `git diff` on the checkpoint branch — every change is auditable.
- `.agent/neutron/runs/<runId>.json` — the full run record: stages, events,
  approval decisions (timestamp + source), per-file change list, metrics.
- Run the app's own tests to confirm nothing regressed:
  ```cmd
  npm install
  npm test
  ```

## What was verified vs what needs a key

| Stage | Verified (no key) | Needs `AGENTROUTER_API_KEY` |
|---|---|---|
| Demo scaffolding (23 files, deterministic) | ✅ | |
| Repository discovery + analysis | ✅ | |
| Impact analysis + what-breaks | ✅ | |
| Implementation plan (13 files, risk, agents) | ✅ | |
| Approval gate (interactive prompt, non-TTY auto-deny, `-y`) | ✅ | |
| LLM implementation by agents | | ✅ |
| Test execution inside maintain | | ✅ |
| Security scan / review / release gate | | ✅ |
| `maintain report` rendering | ✅ | |

No stage fabricates results: without a key, implementation tasks fail loudly
instead of inventing code; blocked test runs are reported as blocked, never as
passed.
