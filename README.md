# CloudShare Demo Portal

Certalis demo portal for Helios CX to connect its own CloudShare subscription, build exams, and deliver real CloudShare environments to Candidates.

## Delivery status (source baseline 2026-10-30)

**SHIPPED MAIN:** Certification MVP issues #39 through #47 are closed. The isolated Sales workspace
supports Opportunities, Items and Sales Enablement Sessions. Sales Trials include registration
(#408), Offering publication (#409), enrollment/launch (#410), admin history (#415), participant extension
(#418), and observability (#416). These delivery lifecycles remain distinct.

**SHIPPED MAIN:** Infrastructure deepening #453 landed as environment observations/commands
(#454, [PR456](https://github.com/cloudshare/cloudshare-demo-portal/pull/456)) and shared resource
discovery (#455, [PR457](https://github.com/cloudshare/cloudshare-demo-portal/pull/457)). Both preserve
existing provider and portal contracts. Subsequent changes now use Infrastructure v4 for Project/Policy discovery and environment state, suspend/resume and default extension; archive remains v3.
See [architecture boundaries](docs/architecture/README.md).

**PENDING:** Optional automatic webhook registration remains unverified; polling remains the
fallback and source of truth. Post-provisioning Trial RDP download and explicit guest-credential
controls are implemented in the current source; downloaded connection availability is not verified.
Published API contracts and live verification are
separate evidence; shipped source alone does not prove a new tenant capability.


## How the portal works

Start with the [customer flow guide](docs/flows/README.md): a fully worked Sales Trial example,
linked persona/action diagrams, exact Portal and CloudShare call traces, diagnostics walkthroughs,
and [endpoint/coverage indexes](docs/flows/endpoints.md). The guide records its source baseline and
separates implemented behavior from live verification.

## Quick start

For Windows or Linux VM installation, see the
[two OS installation rehearsal](docs/implementation/two-os-installation.md) for
completed build steps and the remaining runtime verification work.

Use Node.js 24. No CloudShare credentials are needed for `fixture` mode, which
simulates provider calls while retaining portal data in local SQLite.

```bash
# 1. Install dependencies
npm ci

# 2. Generate the Prisma client
npm run prisma:generate

# 3. Initialize this new instance with private credentials and a fresh database
npm run setup:instance

# 4. Start the dev server
npm run dev
```

Each new instance owner must run setup before its first portal sign-in. Read the
generated admin credentials privately in `config/portal-seed.local.json`; the
master key is in `.env`. Do not copy initialized runtime files into a reusable
image. Setup refuses existing instance data unless `--reset` is explicitly
requested, and always refuses saved CloudShare connections. Reset deletes portal
accounts/history and regenerates the key and both admin passwords: stop the app
and take an external private backup first. See the
[manual setup and sign-in guide](docs/quick-start.md).

On prepared VMs, the owner can instead right-click `Initialize-Portal.cmd` on
the Windows shared desktop and choose **Run as administrator**, or run `/home/sysadmin/initialize-portal.sh` on Ubuntu
after image capture. These wrappers run normal setup and start the existing
portal task/service only on success. The guide includes exact copy instructions;
the canonical scripts are retained in `scripts/`.

Open **http://localhost:3000/login** for the shared portal login. Anonymous visitors can choose
the **Certification demo** or **Sales Trial demo** registration path there.

### Start the portal with the existing Cloudflare tunnel

From the intended checkout, run `npm run dev:tunnel`. This starts its local Next.js
development server on port **3000**, checks `/api/health` (including persistence), then
runs the existing **cloudshare-webhooks-dev** connector. `npm run dev` and `npm start`
remain available separately. The launcher inherits your runtime environment and the
checkout's normal Next.js `.env` loading; it does not change demo lifecycle defaults.

Prerequisites: complete the usual dependency/database setup above, install `cloudflared`,
and retain the existing user-local `~/.cloudflared/config.yml` (or `config.yaml`), tunnel
credentials and named-tunnel lookup permissions. The existing ingress must target
`http://localhost:3000`. Keep these private files outside Git. The launcher uses
`cloudflared` from PATH, with a Windows fallback to the standard Program Files (x86)
installation. For another installation, set `CLOUDFLARED_PATH` to the executable path.
It does not log in, create a tunnel, change DNS/ingress, install a service or register webhooks.

The manual command `cloudflared tunnel run cloudshare-webhooks-dev` connects that existing
tunnel to Cloudflare and forwards requests according to its existing configuration.
The combined command adds `--no-autoupdate` to keep process ownership stable and
`--metrics 127.0.0.1:20246` for a local `/ready` check. Startup waits up to about 90 seconds
per service, with bounded HTTP requests. **Connector readiness proves a Cloudflare
connection only**; public application reachability and signed webhook delivery require
separate verification. See [Cloudflare's local tunnel guide](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/),
[run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
and [readiness implementation](https://github.com/cloudflare/cloudflared/blob/master/metrics/readiness.go).

Leave the command in the foreground. Ctrl+C stops the children it started (including the
Next.js child process tree); an early exit or startup failure also stops the other child
and returns a failure status. It refuses occupied ports 3000/20246 and conservatively
refuses any existing local `cloudflared` process, because the same tunnel may be started
by name, UUID or config. Stop separately owned services yourself before running it.
It cannot detect replicas on other machines; avoid starting another connector during startup.
Force-killing the launcher or closing its terminal bypasses orderly shutdown: inspect
your local processes before restarting.

Child output is suppressed because tunnel/configuration logs can contain private values.
Errors identify the failing stage and exit code where available. For an executable error,
check PATH/`CLOUDFLARED_PATH`; for portal readiness, verify dependencies, Prisma generation,
migrations and runtime config using ordinary `npm run dev` in a private terminal. For a
tunnel exit/timeout, check the existing config and credentials locally and Cloudflare
connectivity; keep any diagnostic output private. No raw config or credentials are printed.

For isolated QA, use `PORTAL_BACKGROUND_JOBS=disabled` **and** `PORTAL_SEED_SOURCE=off`,
fixture mode and a disposable database as described below. These settings are **not a
global provider-write firewall**: explicit routes, browser polling, reconciliation and
webhooks can still perform work. A real public tunnel can receive requests; coordinate
its use separately from isolated tests. The launcher does not set these QA values for you.

Polling remains authoritative (ADR-003). The existing receiver verifies the signature
using the Customer selected by its opaque `webhookPath`; register that path manually in
CloudShare as described under Live mode. This launcher adds no registration or webhook logic.
`npm run test:launcher` uses fake children and isolated loopback HTTP, with an owned-process
shutdown check. Those tests do not establish real tunnel or end-to-end webhook delivery.

### Key URLs

| URL | What |
|---|---|
| `/login` | Shared portal login plus separate Certification and Sales Trial registration choices |
| `/register` | Helios Candidate self-registration for the Certification demo |
| `/sales-trial/register` | Certalis Sales Trial Participant self-registration |
| `/sales-trial/login` | Certalis Sales Trial Participant sign-in |
| `/sales-trial` | Customer-scoped published Trial Offerings, enrollment/launch and continuing active enrollments |
| `/admin` | **Connect CloudShare** + admin console |
| `/sales` | Isolated Certalis Sales workspace; no Helios certification data. URL-backed Account → Opportunity → Contact grids support local archive-only commercial records. |
| `/candidate` | Candidate home — published Exams for the signed-in Customer |
| `/candidate/lab?examAttemptId=<id>` | Candidate lab page (launch, heartbeat, suspend) |
| `/candidate/score?examAttemptId=<id>` | Candidate score page |
| `/api/health` | Health check — `{ ok: true }` |

### Environment variables

All variables are Zod-validated at boot; missing required values cause a fast-fail with a clear error.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORTAL_MASTER_KEY` | yes | — | Base64 32-byte key used to encrypt stored CloudShare credentials |
| `PORTAL_MODE` | yes | `fixture` | `fixture` (simulators) or `live` (real CloudShare API) |
| `PORTAL_BACKGROUND_JOBS` | no | `enabled` | `enabled` or `disabled`; automatic composition jobs only, requires restart |
| `DATABASE_URL` | yes | `file:./dev.db` | SQLite path |
| `PORTAL_SEED_SOURCE` | no | `env` | `off`, `env`, or `file` for the seeded Helios and Certalis demo Customers |
| `PORTAL_SEED_CONFIG_PATH` | no | `./config/portal-seed.local.json` | Local JSON seed file path when `PORTAL_SEED_SOURCE=file` |
| `HELIOS_ADMIN_EMAIL` | `env` seed only | — | Seeded Helios admin login email |
| `HELIOS_ADMIN_PASSWORD` | `env` seed only | — | Seeded Helios admin login password |
| `CERTALIS_SALES_ADMIN_EMAIL` | `env` seed only | `sales-admin@certalis.demo` | Seeded Certalis Sales Admin login email |
| `CERTALIS_SALES_ADMIN_PASSWORD` | `env` seed only | — | Required seeded Certalis Sales Admin login password; choose it locally |
| `HELIOS_SEED_CLOUDSHARE_API_ID` | `env` seed only | — | Optional seeded CloudShare API ID stored through the normal encrypted path |
| `HELIOS_SEED_CLOUDSHARE_API_KEY` | `env` seed only | — | Optional seeded CloudShare API key |
| `HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET` | `env` seed only | — | Optional seeded CloudShare webhook secret |
| `HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID` | `env` seed only | — | Seeded CloudShare instructor/member id |
| `HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME` | `env` seed only | — | Seeded CloudShare instructor/member name |
| `CLOUDSHARE_V4_CLIENT_ID` | legacy | — | Transitional global credential for unfinished older slices |
| `CLOUDSHARE_V4_CLIENT_SECRET` | legacy | — | Transitional global credential for unfinished older slices |
| `CLOUDSHARE_V3_API_ID` | legacy | — | Transitional global credential for unfinished older slices |
| `CLOUDSHARE_V3_API_KEY` | legacy | — | Transitional global credential for unfinished older slices |
| `CLOUDSHARE_WEBHOOK_SECRET` | legacy | — | Transitional global credential; new webhook handling uses the per-Customer CloudShare Connection secret |
| `PORTAL_TUNNEL_URL` | live QA only | — | Optional public URL used when manually registering CloudShare webhooks during local QA |
| `HEARTBEAT_TIMEOUT_MS` | no | `60000` | Auto-suspend timeout in ms |

### Local QA without automatic background jobs

Set `PORTAL_BACKGROUND_JOBS=disabled` **before starting a fresh server process**.
This prevents registration of both automatic jobs in service composition: heartbeat
expiry checks (every 10 seconds, normally suspending after `HEARTBEAT_TIMEOUT_MS`)
and Trial Offering ending reconciliation (every five minutes). Neither job runs
immediately at startup today; disabled mode registers neither initial nor delayed
work. A health GET may initialize services, but cannot start these jobs in this mode.
Only the exact values `enabled` and `disabled` are accepted; omitted means `enabled`.

For disposable QA, run this from an isolated checkout with its own installed dependencies
and generated Prisma client. The database below must be new/disposable; do not substitute
the primary database or copy live credentials. This PowerShell child process confines the
settings to this run and leaves existing `.env` files and the primary SQLite/key pair intact:

```powershell
pwsh -NoProfile -Command {
  $env:PORTAL_MODE = "fixture"
  $env:PORTAL_BACKGROUND_JOBS = "disabled"
  $env:PORTAL_SEED_SOURCE = "off"
  $env:PORTAL_MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  $env:DATABASE_URL = "file:./background-jobs-qa.db"
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  npm run dev -- -p 3025
}
```

Use `http://localhost:3025/api/health` and `/login` for startup smoke. Health still writes
its local persistence-check record; this setting is **not a global read-only mode or a
provider-write firewall**. Deliberate actions (connect/resource sync, publication, launch,
enter, suspend/resume, ending, extension, cancellation, refresh and webhooks) remain active.
Browser polling and request-triggered reconciliation also remain active and can contact
CloudShare, including from nominal GET routes. Use fixture mode and disposable data for
isolated smoke; disabling jobs alone does not make arbitrary live UI/API navigation safe.

To restore ordinary background behavior, stop the QA process and start a fresh process with
`PORTAL_BACKGROUND_JOBS=enabled` (or omit it everywhere, including `.env`). Changing an env
value while a process is running does not dispose existing timers or change cached services.
Do not start enabled/live services against retained assets without the applicable QA approval.

The regression command is `npx vitest run src/config/config.test.ts src/composition-background-jobs.test.ts`.
It uses the real health handler/composition, disposable SQLite records, fake scheduler time
past ten minutes, and a recording CloudShare integration replacement that blocks network
calls. Default/enabled cases prove both jobs dispatch; disabled cases prove neither starts.
This is offline fixture evidence, not live CloudShare E2E verification. No provider endpoint,
lifecycle, schema, authentication, or diagnostics-body contract changes in this control.

### Seeded admin config

The manual initializer above generates the file-mode seed configuration. Its
two private passwords are instance-specific; keep that file private and do not
rerun setup during ordinary sign-in. The existing seed configuration contract
also supports installations configured manually:

1. Copy `config/portal-seed.example.json` to `config/portal-seed.local.json`.
2. Fill in the Helios admin login, instructor, optional CloudShare Connection values, and the Certalis Sales Admin login there. To author live Sales Items, set `certalisSalesShareConnection` to the same `{ apiId, apiKey, webhookSecret }` shape; it is encrypted and stored against Certalis, never shared with Helios. Choose non-empty passwords (at least eight characters); the committed template deliberately contains only unmistakable placeholder values. Candidates register through the portal and are not configured in this seed file.
3. Set `PORTAL_SEED_SOURCE=file` in `.env`.

If you prefer env-only seeding, set `PORTAL_SEED_SOURCE=env` and fill the `HELIOS_*` and `CERTALIS_SALES_ADMIN_*` variables instead. The Sales Admin password is required and has no fallback.

Set `PORTAL_SEED_SOURCE=off` to disable demo seeding entirely.

### Slice 1 flow

1. Start the app and open `/login`.
2. Sign in as the configured Helios admin.
3. Open **Connect CloudShare** in `/admin`.
4. Save `API ID + API key + webhook secret`.
5. Click **Test connection** to run the signed v3 `ping` and expect `pong`.

### Live mode

1. Set `PORTAL_MODE=live` and fill in all `live only` variables.
2. Expose the server publicly (for example, with Cloudflare Tunnel or `ngrok http 3000`).
3. Read the saved Customer-specific `webhookPath` from `GET /api/admin/cloudshare`, then configure
   CloudShare to POST environment lifecycle webhooks to `<public-base-url><webhookPath>`.
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

### Local Cohort Monitoring 429 QA fixture

To verify the rate-limit presentation without contacting CloudShare, start `next dev` with
`PORTAL_LOCAL_QA_SCENARIO=cohort-participant-429`, then run the seed command with the same explicit acknowledgement:

```bash
$env:PORTAL_LOCAL_QA_SCENARIO = "cohort-participant-429" # PowerShell
npm run qa:seed-cohort-rate-limit
```

The command refuses any non-relative SQLite `DATABASE_URL` before Prisma starts. It prints the exact
admin URL, and the reserved fixture Cohort Session participant read always throws deterministic,
redacted 429 (`0x42901`) evidence before any CloudShare request is made — including after a server
restart without the scenario flag.

### Local Sales reservation persistence QA fixture

To exercise the real Sales Admin HTTP/browser error path without breaking the database or contacting
CloudShare, add these non-secret values to `.env.local` for a disposable Sales Opportunity, then
restart `next dev`:

```text
PORTAL_LOCAL_QA_SCENARIO=sales-reservation-persistence-failure
PORTAL_LOCAL_QA_SALES_CUSTOMER_ID=<exact disposable Customer ID>
PORTAL_LOCAL_QA_SALES_OPPORTUNITY_ID=<exact disposable Opportunity ID>
```

The first matching Session creation returns the normal correlated 503, Support diagnostic, and audit
evidence before any CloudShare client/read/mutation and leaves no reservation row. It fires once per
server process and has no effect on any other Customer or Opportunity. A retry follows the ordinary
provisioning path, so use only an approved disposable target when live CloudShare credentials are
configured. Remove all three values and restart the server to disable it. Production builds ignore
the scenario even if all values are present.

`npm test` uses a dedicated SQLite database at `prisma/test.db`. It does not run against the
local development `DATABASE_URL` from `.env`, so running the suite should not delete QA data from
the dev portal database.

Repo-local agent helpers such as `.agents/`, `create-issues.sh`, and `update-issue-rules.sh` are
treated as personal workflow artifacts and are intentionally kept out of the tracked toolchain.

### Agent workflow

This repo follows Matt Pocock skills v1.1 for planning and implementation:

```text
Grilling/Wayfinder -> Spec -> Tickets -> Implement -> Code Review
```

- Use `/grilling` for ordinary ambiguous scope and `/wayfinder` for work that is too large for one
  agent session or needs substantial research/prototyping before the destination is clear.
- Use `/to-spec` for new specs. Older files may still be named `prd-*` for continuity, but "spec" is
  the current workflow term.
- Use `/to-tickets` to break a spec, plan, or conversation into vertical tracer-bullet tickets with
  blocking edges. This replaces the old `/to-plan` and `/to-issues` split.
- Use `/implement` for one ticket at a time, with `/tdd` at pre-agreed seams and `/code-review`
  before completion.
- Use `/diagnosing-bugs` for bugs or unclear runtime behavior.

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

For local Codex worktrees, the user's seed credential file is:

```text
D:\Code_projects\cloudshare-demo-portal\config\portal-seed.local.json
```

When `.env.e2e.local` is missing, generate a temporary ignored `.env.e2e.local`
from that JSON without printing secret values, run `npm run test:e2e:live`, then
delete the generated env file.

The current live E2E test performs a real signed v3 `ping` and expects `pong`.
Normal `npm test` excludes `*.e2e.test.ts`, so fixture/unit tests never call the
live tenant accidentally.

### Integration slice protocol

For any slice that touches CloudShare, follow
[`docs/architecture/integration-slice-protocol.md`](docs/architecture/integration-slice-protocol.md).
The short version: verify CloudShare protocol assumptions early, keep offline tests deterministic,
use `.env.e2e.local` for safe live E2E checks, build support diagnostics with the feature, and update
the gap report as soon as live behavior confirms or contradicts an assumption.

For all QA that logs into CloudShare or relies on a CloudShare persona, follow the
[browser persona isolation rule](docs/architecture/integration-slice-protocol.md#browser-persona-isolation-for-cloudshare-qa):
use a dedicated Chrome profile/session per persona; separate tabs or windows do not isolate logins.
Purely local UI checks do not require a vendor login.

---

## Project structure and architecture

Working repository for the CloudShare demo portal discovery, specs/requirements, architecture notes and implementation artefacts.

## Project structure

- docs/discovery/ - meeting transcripts, follow-up emails and source discovery material
- docs/requirements/ - functional and non-functional specs/requirements
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
- `src/web` — browser-side helpers and client components (e.g. lab child-window)
- `src/composition.ts` — composition root wiring the modules together

## API-first portal design

Portal capabilities should be API-first: the HTTP route and framework-agnostic `src/api/*` handler
define the behavior, and the React UI calls that same API. This keeps the portal scriptable for
sales-demo variants, local E2E automation, and future non-browser integrations.

Current slices follow this model:

- `POST /api/auth/login` — accepts JSON `{ email, password }`, authenticates the user, and sets the
  httpOnly portal session cookie.
- `POST /api/candidate/register` — self-registers a Candidate for the seeded Helios CX Customer.
- `POST /api/admin/candidates` — lets a signed-in Helios admin provision a Candidate account.
- `GET /api/candidate/exams` — returns only the published Exams for the signed-in Candidate's
  Customer.
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
import {
  createCloudShareIntegration,
  createCloudShareNoopObservationPort,
} from "@/integrations/cloudshare";

const cloudshare = createCloudShareIntegration({
  mode: config.runtime.mode, // "live" | "fixture"
  v4: { clientId, clientSecret },
  v3: { apiId, apiKey },
  // This isolated example intentionally does not persist diagnostics.
  observer: createCloudShareNoopObservationPort(),
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

Slice 3 moves Candidate identity onto the same portal user/session model as the Helios admin:

- Candidates can **self-register** with email and password at `/register`; self-registration defaults
  to the seeded `Helios CX` Customer.
- Helios admins can also provision Candidate accounts from `/admin`.
- `POST /api/auth/login` issues the same httpOnly `portal_session` cookie for both roles, and role
  drives home routing (`/admin` vs `/candidate`).
- Candidate exam discovery is server-side: `GET /api/candidate/exams` filters to the signed-in
  Candidate's Customer and returns **published Exams only**.

## Candidate exam catalog & scheduling

The active Certalis/Helios candidate flow is portal-authenticated:

- `GET /api/candidate/exams` returns published Exams for the signed-in Candidate's
  Customer and the Candidate's current ExamAttempts.
- `POST /api/candidate/exams` schedules an ExamAttempt and provisions the
  CloudShare LabLaunch through the active per-Customer CloudShare flow.
- `GET /api/auth/session` is the active session-resume endpoint for Candidates
  and admins.

## Lab launch (entitlement-gated)

Sponsored-link `loginUrl` values are bearer credentials and must never be returned in JSON or
shown in the UI. The time-gated `/enter` endpoint recomputes entitlement server-side
and issues a 302 redirect to the server-held sponsored link.

## Webhooks & environment state (polling is the source of truth)

`POST /api/webhooks/cloudshare/<opaque-token>` ingests CloudShare environment lifecycle events
(`environment.created | suspended | resumed | deleted | extended | archived`). The
same endpoint is fed by real CloudShare in live mode (via a public tunnel) and by
the environment simulator in demo mode — **identical signed payloads, one code
path**. The opaque token resolves the Customer before the payload is trusted. The
pipeline (`src/api/cloudshare-webhook.ts` → `webhook-receiver.ts`):

1. **Verify** the HMAC-SHA256 (base64) signature over the *raw* body using
   the resolved Customer's stored webhook secret (constant-time compare). Missing
   `x-cloudshare-signature` is a deliberate **401** `missing_signature`; a present-but-bad
   signature is **401** `invalid_signature`. Missing-signature requests do not parse the
   payload, touch idempotency, or trigger reconcile.
2. **Validate** the payload with Zod. Live v3 deliveries may send `Payload` as a JSON
   string with PascalCase keys, so the adapter normalises `EnvironmentExternalId` /
   `EnvironmentId` before the domain sees it. Malformed → **400** (logged with issues).
3. **Record a diagnostic fingerprint** from `(Customer, environment identifier, Event, CreatedAt)`.
   CloudShare sends no unique event id and no custom headers, and live QA showed `CreatedAt` is
   the webhook definition creation time rather than the event time. The fingerprint is support
   evidence only; verified lifecycle events are not suppressed by it.
4. **Accepted** events → **202**, and trigger an idempotent reconcile.

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

The admin `Support Workbench` tab now includes a minimal recent-webhook diagnostics view
for this trust gate. Known Customer diagnostics can show raw webhook/signature material;
unknown webhook targets expose only safe metadata (path token, byte count, raw-body hash,
and whether a signature header was present).

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
  which calls `GET /v4/guided-journey/progress/{experienceId}/{participantId}`.
  The required `participantId` comes from the correlated CloudShare training participant
  record, not from the candidate email address.
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
4. Final certification weighting is outside the portal's scope.

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
  pauses the portal-owned exam clock.
- **`childWindow.closed` polling** — `LabLauncher` polls the retained window handle
  every 3 seconds. If the lab window is detected as closed it proactively calls
  `POST /api/exam/suspend` rather than waiting for the server timeout.
- **Candidate warning** — while the lab is open the UI shows: *"Leaving or closing
  this page without suspending keeps your lab running and consuming time."*

`HEARTBEAT_TIMEOUT_MS` is documented in `.env.example`. The server-side timeout
logic in `HeartbeatAutoSuspend` is fully unit-tested with fake timers.

## Admin audit trail & support console

Audit is an append-only, Prisma-backed platform record surfaced to admins at
`/admin`. It answers who attempted to change what, when, and whether it was
allowed. It is separate from Support Diagnostics: diagnostics carry support
trace evidence and CloudShare request/response context, while audit rows stay
concise and secret-safe.

**Audit records** (`src/domain/audit-trail.ts`) are written on:
- `cloudshare_connection.created` / `cloudshare_connection.updated` /
  `cloudshare_connection.tested` — CloudShare Connection admin mutations and tests
- `exam.created` / `exam.updated` / `exam.published` / `exam.unpublished` — Exam catalog mutations
- `lab_launched` / `lab_launch_failed` — Candidate scheduling/provisioning
- `lab_suspended` / `lab_suspend_failed` — from `POST /api/exam/suspend`
- `lab_resumed` / `lab_resume_failed` — from `POST /api/exam/resume`
- `exam_completed_early` — Candidate early completion
- `score_retrieved` — Guided Journey score retrieval

Each record carries stable anchors where known: `customerId`, actor fields,
subject fields, `candidateId`/`candidateEmail`, `examId`, `examAttemptId`,
`correlationId`, `action`, `outcome` (`success`|`failure`|`denied`), redacted
`details`, `error`, and `occurredAt`.

**Admin API endpoints:**
- `GET /api/admin/audit` — Customer-scoped, newest-first audit records. Supported filters include
  `examAttemptId`, `examId`, `actorEmail`, `action`, `outcome`, `subjectType`, `subjectId`,
  `candidateEmail`, `correlationId`, and `limit`.
- `GET /api/admin/diagnostics` — typed Support Diagnostics (`DiagnosticLogEntry`) for support traces
- `POST /api/admin/sync-resources` — current stopgap sync surface for early integration evidence.
  Long-term Exam authoring should not globally sync every visible Project-scoped object; it should
  list Projects and global Regions, then fetch/cache Project-scoped Blueprints, Policies, later
  Project Members / Instructor choices, and Blueprint-detail Snapshots for the selected Project.

**Sales API endpoints** (Sales Admin session only):

- `GET` / `POST /api/sales/items` — list historical/active Items or save a live-resource-validated Item.
- `PUT /api/sales/items/{itemId}` and `POST /api/sales/items/{itemId}/archive` — edit or archive an Item. Archived Items stay in history and cannot begin an Enablement Session.
- `GET /api/sales/item-authoring` and `GET /api/sales/item-authoring/projects/{projectId}` — Customer-scoped live Project, Region, Blueprint, and Policy choices for the Sales workspace. Blueprint detail reads calculate the default-Snapshot Region intersection, so the portal does not submit unsafe multi-step Region selections (see CloudShare R&D bug SUP-4994).

**Admin UI** (`/admin`) includes Audit Trail and Support Diagnostics tabs. Audit Trail shows actor,
subject, ExamAttempt, action, outcome, and redacted details/error, with filters for both runtime and
platform-level entries.

**Persistence:** `AuditRepository` uses the durable `AuditTrailEntry` Prisma model. Resource and
Event Log stores retain their own repository implementations.

**Architecture separation:** `src/api/admin.ts` contains the three framework-agnostic handlers
(testable without Next.js); `app/api/admin/*/route.ts` are the thin Next.js wrappers.

