# CloudShare Demo Portal

Certalis demo portal for Helios CX to connect its own CloudShare subscription, build exams, and deliver real CloudShare environments to Candidates.

## Quick start

No CloudShare credentials are needed. `fixture` mode (the default) runs entirely on in-memory simulators.

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file — defaults are fine for fixture mode
cp .env.example .env

# 3. Run the database migration (creates dev.db)
npm run prisma:migrate

# 4. Start the dev server
npm run dev
```

Open **http://localhost:3000/login** for Slice 1, or **http://localhost:3000/demo** for the older walking-skeleton demo surface.

### Key URLs

| URL | What |
|---|---|
| `/login` | **Helios admin login** — seeded email/password entrypoint |
| `/admin` | **Connect CloudShare** + admin console |
| `/demo` | **Demo Control Panel** — five-step happy path, start here |
| `/candidate/lab?examAttemptId=<id>` | Candidate lab page (launch, heartbeat, suspend) |
| `/candidate/score?examAttemptId=<id>` | Candidate score page |
| `/api/health` | Health check — `{ ok: true }` |

### Running the demo

1. Open `/demo`.
2. Click **▶ Auto-play** to run all five steps automatically, or click **Run** on each step manually.
3. The Domain State table at the bottom shows live IDs, environment status, timer, and login URL.
4. Click **↺ Reset** to wipe all in-memory state for a clean repeat run — no server restart needed.

### Environment variables

All variables are Zod-validated at boot; missing required values cause a fast-fail with a clear error.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORTAL_MASTER_KEY` | yes | — | Base64 32-byte key used to encrypt stored CloudShare credentials |
| `PORTAL_MODE` | yes | `fixture` | `fixture` (simulators) or `live` (real CloudShare API) |
| `DATABASE_URL` | yes | `file:./dev.db` | SQLite path |
| `KRYTERION_TOKEN_SECRET` | yes | — | HMAC-SHA256 secret shared by the token simulator and auth layer |
| `HELIOS_ADMIN_EMAIL` | no | `admin@helioscx.demo` | Seeded Helios admin login email |
| `HELIOS_ADMIN_PASSWORD` | no | `HeliosDemo123!` | Seeded Helios admin login password |
| `HELIOS_SEED_CLOUDSHARE_API_ID` | no | — | Optional seeded CloudShare API ID stored through the normal encrypted path |
| `HELIOS_SEED_CLOUDSHARE_API_KEY` | no | — | Optional seeded CloudShare API key |
| `HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET` | no | — | Optional seeded CloudShare webhook secret |
| `CLOUDSHARE_V4_CLIENT_ID` | legacy | — | Transitional global credential for unfinished older slices |
| `CLOUDSHARE_V4_CLIENT_SECRET` | legacy | — | Transitional global credential for unfinished older slices |
| `CLOUDSHARE_V3_API_ID` | legacy | — | Transitional global credential for unfinished older slices |
| `CLOUDSHARE_V3_API_KEY` | legacy | — | Transitional global credential for unfinished older slices |
| `CLOUDSHARE_WEBHOOK_SECRET` | legacy | — | Transitional global credential for unfinished older slices |
| `PORTAL_TUNNEL_URL` | live only | — | Public URL for CloudShare webhooks (e.g. ngrok) |
| `HEARTBEAT_TIMEOUT_MS` | no | `60000` | Auto-suspend timeout in ms |
| `DEMO_BLUEPRINT_NAME` | optional legacy | `""` | Legacy global blueprint name from the pre-Exam flow; not required for Slice 2 project-first authoring |
| `DEMO_POLICY_NAME` | optional legacy | `""` | Legacy global policy name from the pre-Exam flow; not required for Slice 2 project-first authoring |
| `DEMO_PROJECT_NAME` | optional legacy | `""` | Legacy global project name from the pre-Exam flow; not required for Slice 2 project-first authoring |
| `DEMO_REGION_NAME` | optional legacy | `""` | Legacy global region name from the pre-Exam flow; not required for Slice 2 project-first authoring |

### Slice 1 flow

1. Start the app and open `/login`.
2. Sign in as the seeded Helios admin.
3. Open **Connect CloudShare** in `/admin`.
4. Save `API ID + API key + webhook secret`.
5. Click **Test connection** to run the signed v3 `ping` and expect `pong`.

### Live mode

1. Set `PORTAL_MODE=live` and fill in all `live only` variables.
2. Expose the server publicly (e.g. `ngrok http 3000`) and set `PORTAL_TUNNEL_URL`.
3. Configure CloudShare to POST webhooks to `$PORTAL_TUNNEL_URL/api/webhooks/cloudshare`.
4. Open `/admin` and use **Sync Resources** only as the current stopgap evidence surface. The
   intended Exam-authoring model is Project-first: Projects and global Regions are reference lists;
   Blueprints, Policies, Project Members / Instructor choices, and Blueprint-detail Snapshots are
   fetched or cached for the selected Project.

### Development commands

```bash
npm run dev          # Next.js dev server with hot reload
npm test             # Vitest unit tests
npm run test:e2e:live # Live CloudShare E2E checks; requires .env.e2e.local
npm run test:watch   # Watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run build        # Production build
```

### Live E2E credentials

Live CloudShare E2E tests read credentials from `.env.e2e.local`, which is ignored
by git via `.env*.local`.

```bash
cp .env.e2e.example .env.e2e.local
```

Fill `CLOUDSHARE_E2E_API_ID` and `CLOUDSHARE_E2E_API_KEY`, then run:

```bash
npm run test:e2e:live
```

The current live E2E test performs a real signed v3 `ping` and expects `pong`.
Normal `npm test` excludes `*.e2e.test.ts`, so fixture/unit tests never call the
live tenant accidentally.

### Integration slice protocol

For any slice that touches CloudShare, follow
[`docs/architecture/integration-slice-protocol.md`](docs/architecture/integration-slice-protocol.md).
The short version: verify CloudShare protocol assumptions early, keep offline tests deterministic,
use `.env.e2e.local` for safe live E2E checks, build support diagnostics with the feature, and update
the gap report as soon as live behavior confirms or contradicts an assumption.

---

## Project structure and architecture

Working repository for the CloudShare demo portal discovery, requirements, architecture notes and implementation artefacts.

## Project structure

- docs/discovery/ - meeting transcripts, follow-up emails and source discovery material
- docs/requirements/ - functional and non-functional requirements
- docs/architecture/ - system design and integration notes
- docs/decisions/ - architecture decision records
- docs/api/ - API notes, payloads and integration contracts
- docs/meeting-notes/ - ongoing meeting notes

## Source layout

- `src/config` — typed, Zod-validated runtime configuration (fails fast at boot)
- `src/observability` — structured logging with secret redaction
- `src/persistence` — repository interfaces over Prisma
- `src/domain` — framework-agnostic business logic
- `src/api` — framework-agnostic request handlers (policy), wired to Next.js routes in `app/api`
- `src/auth` — candidate authentication seam (see below)
- `src/integrations/cloudshare` — CloudShare adapter (see below)
- `src/integrations/kryterion` — Kryterion simulator (mints candidate exam tokens)
- `src/integrations/genesys` — Genesys simulator (exam eligibility)
- `src/web` — browser-side helpers and client components (e.g. lab child-window)
- `src/composition.ts` — composition root wiring the modules together

## API-first portal design

Portal capabilities should be API-first: the HTTP route and framework-agnostic `src/api/*` handler
define the behavior, and the React UI calls that same API. This keeps the portal scriptable for
sales-demo variants, local E2E automation, and future non-browser integrations.

Slice 1 follows this model:

- `POST /api/auth/login` — accepts JSON `{ email, password }`, authenticates the user, and sets the
  httpOnly portal session cookie.
- `GET /api/admin/cloudshare` — returns redacted CloudShare Connection status for the signed-in
  Helios admin.
- `PUT /api/admin/cloudshare` — saves or replaces the Customer's CloudShare Connection credentials.
- `POST /api/admin/cloudshare/test` — verifies the saved CloudShare Connection with a real v3
  `ping`, returning success or supportable redacted diagnostics.

Future slices should add handler-level API tests before relying on UI-only verification.

## CloudShare integration

All CloudShare access goes through the typed adapter seam in
`src/integrations/cloudshare`; no other layer touches CloudShare HTTP, auth, or
wire formats directly. Build a client with `createCloudShareIntegration`:

```ts
import { createCloudShareIntegration } from "@/integrations/cloudshare";

const cloudshare = createCloudShareIntegration({
  mode: config.runtime.mode, // "live" | "fixture"
  v4: { clientId, clientSecret },
  v3: { apiId, apiKey },
});

const regions = await cloudshare.requestV3({
  method: "GET",
  path: "/regions",
  schema: regionsSchema, // Zod schema validated at the boundary
});
```

- **v4 (Accelerate):** Bearer JWT via `client_credentials`, cached and refreshed
  before the ~5-minute expiry.
- **v3 (Production):** per-call `cs_sha1` request signing (single-use 10-character alphanumeric
  token) and infrastructure reads. Regions are a global reference list; Policies and Blueprints are
  Project-scoped for portal behavior; Snapshots are discovered through selected Blueprint detail.
- **Live vs fixture:** chosen by `mode`. Fixture mode replays recorded JSON from
  `src/integrations/cloudshare/fixtures/` through the identical code path, so
  contract tests and demos run with no live calls.
- Every response is Zod-validated; every failure is a typed `CloudShareError`.

## Candidate identity

Candidates authenticate without a password. The Kryterion simulator mints a
short-lived, single-use signed token (`KRYTERION_TOKEN_SECRET`, HMAC-SHA256)
pinned to exactly one `ExamAttempt` when an exam starts. The `auth` layer
validates it and admits the candidate to that attempt only:

- `verifyExamToken` checks signature, schema, and expiry.
- The `CandidateAuthenticator` seam enforces **single-use** (a consumed-token
  store denies replay) and mints a session bound to the token's `ExamAttempt`.
- The session is stored and resumable by id, so it survives a page reload
  (`POST /api/candidate/admit` sets an httpOnly cookie; `GET /api/candidate/session` resumes).
- Token verification lives behind the `auth` interface so a real IdP/OIDC can
  replace the token scheme without touching callers.

Stores are in-memory for the demo (swappable for Prisma-backed adapters).

## Eligibility & exam booking

A candidate self-schedules with no admin in the loop:

- The **Genesys simulator** decides which exams a candidate is eligible for from
  invented-but-believable criteria (prerequisite training completed), behind the
  `ExamEligibilityProvider` port. `GET /api/exams/eligible?candidateId=…`.
- `bookExam` (domain) re-checks eligibility, persists a booked `ExamAttempt` via
  the repository, and emits an `exam_attempt.created` **IntegrationEvent**.
  `POST /api/exams/book` (403 if not eligible).
- The in-process **event bus** carries IntegrationEvents; the downstream
  lab-launch flow (later slice) subscribes to `exam_attempt.created`. A failing
  subscriber is logged, never allowed to break publishing.

## Lab launch (entitlement-gated)

`POST /api/lab/launch` performs the controlled CloudShare `LabLaunch`:

1. **Entitlement** is recomputed server-side from the persisted `ExamAttempt`
   (`computeEntitlement`) — never trusted from the client; the request carries
   only `examAttemptId`.
2. The lab is provisioned in strict order via the `LabProvisioner` port:
   **Create Experience (Registered Students Only) → Add Student → Sponsored Link**.
   `environmentExternalId` is set at creation and persisted for correlation.
3. **Add Student is the real entitlement gate** — if it fails, the launch aborts
   with an actionable `LabLaunchError` (HTTP 502) rather than handing out a link
   that would log in to a silently-denied environment.

The candidate opens the returned Classic-domain `loginUrl` in a child window via
`openLabWindow` (`src/web/lab-window.ts`), which retains the window handle for
later liveness checks. Works in both live and fixture modes (chosen by `PORTAL_MODE`).

## Webhooks & environment state (polling is the source of truth)

`POST /api/webhooks/cloudshare` ingests CloudShare environment lifecycle events
(`environment.created | suspended | resumed | deleted | extended | archived`). The
same endpoint is fed by real CloudShare in live mode (via `PORTAL_TUNNEL_URL`) and
by the environment simulator in demo mode — **identical signed payloads, one code
path**. The pipeline (`src/api/cloudshare-webhook.ts` → `webhook-receiver.ts`):

1. **Verify** the HMAC-SHA256 (base64) signature over the *raw* body using
   `CLOUDSHARE_WEBHOOK_SECRET` (constant-time compare). Bad/missing signature → **401**.
   The signature is read from the `x-cloudshare-signature` header.
2. **Validate** the payload with Zod. Malformed → **400** (logged with issues).
3. **Dedupe** via an idempotency key synthesised from
   `(environmentExternalId, Event, CreatedAt)` — CloudShare sends no unique event id
   and no custom headers. A replay → **200** (acknowledged, not reprocessed).
4. **Accepted** events → **202**, and trigger a reconcile.

**Webhooks are only a hint.** `reconcileEnvironment` (domain) polls `GET environment`
— the authoritative `EnvironmentStateSource` — and the *polled* status, never the
event payload, drives the persisted `EnvironmentRecord`. This is what makes duplicate,
replayed, and **out-of-order** events safe: a poll always reflects current truth
(idempotent to apply), and an `observedAt` monotonic guard stops an earlier-triggered
poll that completes late from clobbering a fresher observation. A failed reconcile is
logged but still returns 202 — the next event or poll recovers.

In demo mode the simulator (`environment-simulator.ts`) is *both* the webhook emitter
and the `GET environment` target, from one in-memory truth, so emitted events and
polled state always agree. Swapping in the live integration changes nothing upstream:
both implement `EnvironmentStateSource` and produce the identical wire payload.

> **Assumptions to verify against a live tenant** (isolated behind
> `src/integrations/cloudshare/webhooks.ts` and `environment.ts`, tracked for the
> Slice 12 gap report): the exact webhook field names and the signature header name,
> and the v3 endpoint that resolves an environment by the `externalId` we set at
> experience creation.

## Guided Journey scoring

`GET /api/exam/score?examAttemptId=<id>` retrieves per-participant Guided Journey
progress from CloudShare and returns a typed `ScoreResult`:

- **`percentComplete`** — overall lab progress (0–100).
- **`stepsCompleted` / `stepsTotal`** — checkpoint counts.
- **`steps[]`** — per-task breakdown with `stepId`, `title`, `completed`.
- **`limitations[]`** — CloudShare scoring limitation disclaimers, returned alongside
  the score so any UI can surface them.

**Architecture:**
- `ScoreRetrievalProvider` (`src/domain/score-result.ts`) — domain port; implemented
  by `createCloudShareGuidedJourneyProvider` (`src/integrations/cloudshare/guided-journey.ts`)
  which calls `GET /experiences/{id}/journey/participants` (v4 API assumption, isolated).
- `retrieveScore` use case — looks up the `LabLaunch`, calls the port, enriches
  with exam context and timestamp. Returns an empty progress record if CloudShare
  has no data yet (lab not yet completed).
- `ScoreDisplay` component (`src/web/score-display.tsx`) — fetches and renders the
  score with an inline "About this score" section surfacing the four known limitations.
- Candidate score page at `/candidate/score?examAttemptId=<id>`.

**CloudShare scoring limitations** (surfaced in every `ScoreResult` response):
1. Bitmap checkpoints: visual-state comparison only, not process-level capture.
2. End-state only — approach and intermediate steps are not assessed.
3. Deterministic script-based verification is not GA until Q3 2026.
4. Final certification weighting is Genesys's responsibility, not the portal's.

Works in both `fixture` and `live` modes. The bundled fixture
(`v4-get-participant-progress.json`) returns 75 % / 3 of 4 tasks for the demo
experience `exp-demo-1`. Assumptions about the Guided Journey API paths and
response shape are isolated in `guided-journey.ts` for the Slice 12 gap report.

## Heartbeat auto-suspend

Closing the browser tab does not suspend a CloudShare environment — it keeps
running and billing. To mitigate this, `LabLauncher` maintains a server-side
heartbeat while the lab window is open:

- **Periodic heartbeat** — `POST /api/heartbeat` (body: `{ examAttemptId }`) is
  sent every 15 seconds while the candidate page is open and the lab is active.
- **Fast-path beacon** — `navigator.sendBeacon` fires immediately on
  `pagehide` and `visibilitychange` (hidden) so the server clock resets on any
  page-visibility event rather than waiting for the next poll.
- **Timeout auto-suspend** — `HeartbeatAutoSuspend` (`src/domain/heartbeat-auto-suspend.ts`)
  checks every `checkIntervalMs` (10 s). If any tracked attempt has not received
  a heartbeat within `HEARTBEAT_TIMEOUT_MS` (default 60 000 ms; overridable via
  `.env`), it calls `suspendExam` — which suspends the CloudShare environment and
  pauses the Kryterion timer.
- **`childWindow.closed` polling** — `LabLauncher` polls the retained window handle
  every 3 seconds. If the lab window is detected as closed it proactively calls
  `POST /api/exam/suspend` rather than waiting for the server timeout.
- **Candidate warning** — while the lab is open the UI shows: *"Leaving or closing
  this page without suspending keeps your lab running and consuming time."*

`HEARTBEAT_TIMEOUT_MS` is documented in `.env.example`. The server-side timeout
logic in `HeartbeatAutoSuspend` is fully unit-tested with fake timers.

## Admin audit trail & support console

Every significant portal action is written to an in-memory `AuditRepository` and
surfaced to support teams via the admin API and UI at `/admin`:

**Audit records** (`src/domain/audit-trail.ts`) are written on:
- `lab_launched` / `lab_launch_failed` — from `POST /api/lab/launch`
- `lab_suspended` / `lab_suspend_failed` — from `POST /api/exam/suspend`
- `lab_resumed` / `lab_resume_failed` — from `POST /api/exam/resume`
- `score_retrieved` — reserved for the score endpoint (Slice 9+)

Each record carries: `id`, `examAttemptId`, `candidateId?`, `action`,
`outcome` (`success`|`failure`), `details?`, `error?`, and `occurredAt`.

**Admin API endpoints:**
- `GET /api/admin/audit` — all records, newest-first; `?examAttemptId=<id>` filters to one attempt
- `GET /api/admin/events` — integration event log (all published `IntegrationEvent`s); `?limit=<n>`
- `POST /api/admin/sync-resources` — current stopgap sync surface for early integration evidence.
  Long-term Exam authoring should not globally sync every visible Project-scoped object; it should
  list Projects and global Regions, then fetch/cache Project-scoped Blueprints, Policies, later
  Project Members / Instructor choices, and Blueprint-detail Snapshots for the selected Project.

**Admin UI** (`/admin`) — React client component with three tabs:
- **Audit Trail** — per-attempt timeline with filter input; shows action, outcome, error/details
- **Event Log** — most recent 100 integration events with type, eventId, and payload
- **Resources** — stopgap sync tab for viewing early name↔ID mappings; not the intended long-term
  Exam-authoring workflow.

**Persistence:** all three stores (`AuditRepository`, `ResourceRepository`, `EventLogRepository`)
are in-memory for the demo. They implement the same typed repository interfaces as every other
store — swappable for Prisma-backed adapters for deployments that must survive restarts.

**Architecture separation:** `src/api/admin.ts` contains the three framework-agnostic handlers
(testable without Next.js); `app/api/admin/*/route.ts` are the thin Next.js wrappers.

## Demo Control Panel

Operator-facing panel at `/demo` that walks the proctoring happy path as ordered,
state-gated steps. Each step unlocks only when its predecessor is done.

**Steps (in order):**
1. **Book Exam** — registers `cand-001` for `GCP-ASSOC` → creates `ExamAttempt`
2. **Launch Lab** — provisions a CloudShare lab for the attempt → creates `LabLaunch`; seeds the demo simulator so the environment appears `running` immediately
3. **Suspend Exam** — suspends the environment and pauses the Kryterion timer
4. **Resume Exam** — resumes the environment and restarts the timer
5. **Retrieve Score** — fetches Guided Journey progress from CloudShare

**Controls:**
- **Run** button on each step — execute one step manually
- **▶ Auto-play** — runs all available steps sequentially from the current position
- **↺ Reset** — clears all in-memory state (exam attempts, lab launches, environment
  simulator, Kryterion timers) for a clean repeat run without restarting the server
- **⟳ Refresh** — re-reads current domain state

**State display:** the bottom panel shows live domain state (ExamAttempt ID, LabLaunch
ID, environment status, timer status and elapsed time, login URL).

**Architecture:**
- `src/domain/demo-control.ts` — `DemoStep`, `StepStatus`, `DemoGates`, `DEMO_SEED`,
  `STEP_META`, and the pure `computeStepStatuses` gating function
- `src/api/demo-control.ts` — framework-agnostic `handleGetDemoState`, `handleExecuteStep`,
  `handleResetDemo` handlers; composes existing use cases (`bookExam`, `launchLab`,
  `suspendExam`, `resumeExam`, `retrieveScore`) in one place
- `app/api/demo/{state,step,reset}/route.ts` — thin Next.js route wrappers
- `app/demo/page.tsx` — React client component (step list, auto-play, domain state table)
- Each in-memory repository exposes a `reset()` method; the composition root's `resetDemo()`
  calls them all, plus the environment simulator and Kryterion simulator, so a reset
  is a clean slate without a server restart
