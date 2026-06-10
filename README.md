# CloudShare Demo Portal

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

const projects = await cloudshare.requestV4({
  method: "GET",
  path: "/projects",
  schema: projectsSchema, // Zod schema validated at the boundary
});
```

- **v4 (Accelerate):** Bearer JWT via `client_credentials`, cached and refreshed
  before the ~5-minute expiry.
- **v3 (Production):** per-call `cs_sha1` request signing (single-use token).
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
