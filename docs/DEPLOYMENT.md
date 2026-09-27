# NEUTRON Web Demo — Deployment Guide

The web demo is the existing NEUTRON server (`neutron web`): dashboard at `/`,
the hackathon demo at `/demo`. The demo calls the **real** NEUTRON workflow
(`analyzeRepository`, `analyzeImpact`, `buildPlan`, `createNeutronWorkflow`)
server-side; the browser never sees API keys.

Two deployment targets are supported — pick based on what you need to show:

| | Vercel (serverless) | Persistent Node host (Render / Docker) |
|---|---|---|
| Repository analysis | ✅ Real, live | ✅ Real, live |
| Impact analysis | ✅ Real, live | ✅ Real, live |
| Implementation plan | ✅ Real, live | ✅ Real, live |
| Human approval | ✅ Real (signed token gate) | ✅ Real (server-side gate) |
| Agent execution | ⚠️ Honestly unavailable — the UI says full execution needs the persistent host | ✅ Real (`createNeutronWorkflow`) |
| Testing / Security / Review / Release | ⚠️ Not reached (no execution) | ✅ Real |
| Setup effort | Lowest — push + import | Medium — service + disk + secrets |

## Deploy on Vercel

Serverless functions are stateless with short timeouts and only `/tmp` is
writable, so the Vercel target runs the fast, key-less stages for real
(prepare → analyze → impact → plan → approval, measured at ~25 ms on the
TaskFlow demo) and refuses to fake the long-running execution stage: the
execute endpoint validates the approval token and then returns an honest
`executionUnsupported` state that the UI displays plainly.

1. Push this repository to GitHub (public or private).
2. In Vercel: **Add New → Project → Import** your repo. Vercel reads
   `vercel.json` automatically:
   - Build command: `npm run build:vercel` (normal build, then copies the demo
     UI into `public/` as static files)
   - Serverless functions: `api/*.ts` (each calls the real NEUTRON code)
   - Rewrite: `/demo` → the static demo UI
3. **Environment variables** (Project → Settings → Environment Variables):
   - `SERVER_SECRET` — **required**. Signs the stateless plan-approval tokens.
     Generate one: `openssl rand -hex 32`. Never expose it to the browser
     (Vercel keeps env vars server-side by default — do not prefix it with
     `NEXT_PUBLIC_` or add it to frontend code).
   - `NEUTRON_DEMO_WORKSPACE` — set to `/tmp/neutron-demo` (the only writable
     directory on serverless; the code defaults to this if unset).
   - `AGENTROUTER_API_KEY` — optional. Has no effect on Vercel today: execution
     is unsupported on serverless regardless of key. Do not set it unless a
     future update uses it.
   - Do **not** set `NEUTRON_DEMO_ALLOW_CLONE=1` on Vercel (git clones can
     exceed function timeouts; cloning stays disabled).
4. Deploy. Vercel gives you a public URL like
   `https://neutron-demo-xxxx.vercel.app` — **that URL + `/demo` is what goes
   into LabLab → Step 3 → Demo Application URL**
   (e.g. `https://neutron-demo-xxxx.vercel.app/demo`).
5. Smoke-test: `curl https://<your-url>/api/health` → `{"ok":true,...}` and
   open `/demo` in a browser.

If you later need the execution stage, deploy the same repo to Render/Docker
below — the UI and API shapes are identical, so nothing else changes.

## Why the full workflow needs the Node host

A `maintain` run lasts minutes (longer than serverless function timeouts),
needs a writable filesystem (demo workspace, git checkpoints,
`.agent/neutron/runs/` audit trails), and keeps in-memory job/approval state.
The steps below use **Render** (simplest for a student project); the included
`Dockerfile` also works on Railway, Fly.io, or any VPS.

## Required environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No (default `4096`) | Port the server listens on. Render/Railway set this automatically. |
| `AGENTROUTER_API_KEY` | **For full execution** | Server-side LLM key. Analysis / impact / planning work **without** it; the agent-execution stage honestly reports "no LLM provider configured" instead of faking results. Never put this in frontend code. |
| `NEUTRON_DEMO_WORKSPACE` | No (default `./neutron-demo-workspace`; `/tmp/neutron-demo` on Vercel) | Directory the demo may read/write. Point it at the persistent disk on hosted deploys. |
| `SERVER_PASSWORD` | Recommended on public deploys | Enables HTTP Basic auth (`neutron` / the password) in front of the whole server. |
| `SERVER_SECRET` | **Required on Vercel only** | Signs the stateless plan-approval tokens for the serverless API. Not needed for the Node server (it uses an in-memory gate). |
| `NEUTRON_DEMO_MAX_JOBS` | No (default `2`) | Max concurrent demo executions per server instance. |

`.env` files are git-ignored; copy `.env.example` to `.env` for local runs.

## Deploy on Render (recommended path)

1. Push this repository to GitHub (public).
2. In Render: **New → Web Service → Build and deploy from a Git repository**,
   select your repo.
3. Render detects the `Dockerfile` automatically. If you prefer native builds:
   - Build command: `npm ci && npm run build`
   - Start command: `node dist/cli-entry.js web --hostname 0.0.0.0 --no-open`
   - (The Dockerfile path is recommended — it pins Node 20 and prunes dev deps.)
4. Add a **persistent disk**: mount path `/data`, then set
   `NEUTRON_DEMO_WORKSPACE=/data/demo-workspace`.
5. Environment → add `AGENTROUTER_API_KEY` (secret) and `SERVER_PASSWORD`
   (secret, optional but recommended).
6. Deploy. Render gives you a public URL like
   `https://neutron-demo-xxxx.onrender.com` — **that URL + `/demo` is what
   goes into LabLab → Step 3 → Demo Application URL**
   (e.g. `https://neutron-demo-xxxx.onrender.com/demo`).
7. Smoke-test the deployment:
   `curl https://<your-url>/api/health` → `{"ok":true,...}`.

## Deploy with Docker anywhere

```bash
docker build -t neutron-demo .
docker run -d -p 4096:4096 \
  -e AGENTROUTER_API_KEY="$AGENTROUTER_API_KEY" \
  -e SERVER_PASSWORD="choose-a-strong-password" \
  -v neutron-data:/data \
  --name neutron-demo neutron-demo
```

## Run locally

```bash
npm install
npm run build
# optional: export AGENTROUTER_API_KEY=...  (enables the execution stage)
node dist/cli-entry.js web --no-open
# Dashboard: http://127.0.0.1:4096/
# Web demo:  http://127.0.0.1:4096/demo
```

Click **Prepare demo repository** (scaffolds the TaskFlow app via the real
`maintain demo` code), type a maintenance request such as
"Add a health-check endpoint to the application while preserving the existing
API behavior.", then **Analyze Repository**. Approve the plan to run the real
workflow; every stage streams live into the execution view.

## API surface (all server-side, all real)

| Method & path | Backed by |
|---|---|
| `GET /api/health` (alias of `/health`) | server version + agent list |
| `POST /api/demo/prepare` | real TaskFlow scaffold (`prepareDemoRepo`) |
| `POST /api/demo/analyze` | `analyzeRepository` → `analyzeImpact` → `buildPlan` |
| `POST /api/demo/approve` / `/api/demo/reject` | single-use, in-memory approval gate |
| `POST /api/demo/execute` | `createNeutronWorkflow` background job (409 + `requiresApproval` without approval) |
| `GET /api/demo/jobs/:id` | live stage statuses + event log |
| `GET /api/demo/jobs/:id/result` | sanitized real result (no absolute paths, no secrets) |
| `GET /api/demo/status` | capabilities (LLM configured? cloning allowed?) — no secrets |

Security: request bodies capped at 5 MB, demo API rate-limited (120 req/min/IP),
repository access restricted to the demo workspace (path traversal rejected),
no shell execution from client input, no stack traces or environment variables
in error responses, approvals are single-use and in-memory (a restart
invalidates them — fail-closed).

### Vercel route parity

The serverless API (`api/`) mirrors the same routes and response shapes, with
two deliberate differences:

| Route | Vercel behavior |
|---|---|
| `POST /api/demo/approve` | Returns `{ approved, analysisId, approvalToken }` — a signed HMAC token (stateless) instead of the in-memory gate. The UI sends it back with execute; the Node server ignores the extra field. |
| `POST /api/demo/execute` | Validates the approval token (403 + `requiresApproval` without one), then returns `{ executionUnsupported: true }` with a plain-English explanation instead of starting a job. Never faked. |
| `GET /api/demo/jobs/:id`(+`/result`) | 404 with an explanatory message — no jobs exist on serverless. |

The static UI is served from `public/` (`/demo` rewrites to the demo page);
`npm run build:vercel` produces it. The default `npm run build` is unchanged.
