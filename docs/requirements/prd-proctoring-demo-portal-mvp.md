# PRD: Genesys/Kryterion/CloudShare Proctoring Demo Portal — MVP

**Date:** 2026-06-07
**Status:** Superseded by `docs/requirements/prd-cloudshare-demo-portal-v2.md`; retained as
historical discovery context only.
**Source:** pre-v1.1 grill-me session (`docs/discovery/2026-06-07-grill-me-decisions.md`)

---

## Problem Statement

Genesys and Kryterion want to demonstrate to stakeholders how CloudShare lab environments can integrate with Genesys certification exams and Kryterion proctoring — showing a Candidate self-servicing their way through booking, identity verification, lab launch, exam timer synchronisation, and score retrieval. Today no integration exists; the three platforms are disconnected, so the full candidate journey cannot be shown end-to-end without a portal that wires them together.

---

## Solution

Build a self-contained TypeScript/Next.js demo portal — the **CloudShare Demo Portal** — that enacts the full candidate journey on-screen. CloudShare is the only live integration; Genesys and Kryterion are thin, realistic simulators. The demo must be deterministic and presentable without a live tunnel, using recorded fixtures in demo mode and real API calls in live mode via the same code paths.

A running **API gap report** is a first-class deliverable alongside the portal, documenting where CloudShare's current API falls short for certification-grade use.

---

## User Stories

### Candidate stories

1. As a Candidate, I want to see a list of exams I am eligible to sit, so that I can choose the right certification for my current training progress.
2. As a Candidate, I want to self-schedule and book an exam slot without admin involvement, so that I can plan around my own calendar.
3. As a Candidate, I want to receive a single-click link to launch my CloudShare lab, so that I do not need a CloudShare account or password.
4. As a Candidate, I want the lab to open in a dedicated window, so that I can work in the lab while the portal continues tracking my session.
5. As a Candidate, I want the exam timer to pause when I explicitly suspend my lab, so that I am not penalised for a deliberate break.
6. As a Candidate, I want to resume my suspended lab and have the exam timer restart from where it paused, so that my remaining time is preserved.
7. As a Candidate, I want to be warned that closing the lab window without suspending will keep the environment running, so that I do not lose exam time unintentionally.
8. As a Candidate, I want my lab session to be automatically suspended if my connection is lost or my browser is closed, so that the exam timer is paused rather than draining silently.
9. As a Candidate, I want to see my Guided Journey progress and score after completing the lab section of the exam, so that I have immediate feedback on my performance.
10. As a Candidate, I want the portal to clearly surface any limitations in the current scoring model, so that I understand what the score does and does not reflect.
11. As a Candidate, I want to be identified by a short-lived, single-use token — not a password — so that I do not need to create a portal account.
12. As a Candidate, I want the portal to remember my ExamAttempt across page reloads, so that a refresh does not lose my progress.

### Proctor / operator stories

13. As a Proctor, I want a Demo Control panel that walks me through each step of the happy path in order, so that I can present a clean demo without scripting errors.
14. As a Proctor, I want a one-click auto-play mode that runs the happy path automatically, so that I can focus on narrating rather than clicking.
15. As a Proctor, I want a reset/seed action that returns the demo to a clean known state, so that I can re-run the demo without manual cleanup.
16. As a Proctor, I want each demo step to be gated — unavailable until the previous step completes — so that the demo cannot be run out of order.

### Admin stories

17. As an Admin, I want to view the full audit trail for any ExamAttempt, so that I can reconstruct what happened during a session for support purposes.
18. As an Admin, I want to see all IntegrationEvents logged against a session, so that I can diagnose external API failures without accessing external systems.
19. As an Admin, I want a "Sync Resources" action that refreshes the mapping of friendly CloudShare names (blueprint, policy, project, region) to their live IDs, so that demo resources can be updated without touching environment variables.
20. As an Admin, I want the portal to start only if all required config is present and valid, so that misconfiguration is caught at boot rather than mid-demo.
21. As an Admin, I want secrets to be redacted in all logs, so that API keys and tokens are never exposed in the support trail.

### Simulator stories (Genesys & Kryterion)

22. As the Genesys Simulator, I want to present a list of candidate entitlements (training completed → exam eligible), so that the Candidate can see realistic exam choices.
23. As the Genesys Simulator, I want to emit an ExamAttempt created event when the candidate books, so that the portal can begin the LabLaunch flow.
24. As the Kryterion Simulator, I want to mint a short-lived signed token for the Candidate at exam start, so that the portal can admit the candidate without a password.
25. As the Kryterion Simulator, I want to own and display the authoritative exam clock, so that the portal's timer pause/resume is reflected here.
26. As the Kryterion Simulator, I want to receive a timer-pause signal when the lab is suspended and a timer-resume signal when it is resumed, so that the authoritative clock stays in sync with environment state.

---

## Implementation Decisions

### Stack

- Single TypeScript Next.js application using the App Router.
- Next.js route handlers serve both the `web` layer (candidate/proctor/admin screens) and the `api` layer (REST endpoints and webhook receiver).
- The `domain`, `integrations/*`, `persistence`, `auth`, `observability`, and `config` layers are plain framework-agnostic TypeScript modules. The domain layer has no Next.js imports.
- Zod validates all external payloads at integration boundaries.
- SQLite via Prisma, behind repository interfaces, with the provider swappable to Postgres for future cloud deployment.

### Module boundaries

- `web` — Next.js pages and React components for candidate, proctor/demo-control, and admin screens.
- `api` — Next.js route handlers: REST actions, webhook receiver, timer-sync endpoints.
- `domain` — core business logic: `Candidate`, `ExamAttempt`, `ProctoringSession`, `Entitlement`, `LabLaunch`, `IntegrationEvent`, `ScoreResult` state transitions.
- `integrations/cloudshare` — CloudShare v4 (Accelerate) and v3 adapter; token caching for v4 Bearer JWT (5-min TTL); OAuth1-style `cs_sha1` request signing for v3; typed request/response models; live-vs-fixture mode toggle.
- `integrations/genesys` — Genesys simulator: entitlement list, ExamAttempt creation event.
- `integrations/kryterion` — Kryterion simulator: candidate token minting, exam clock API (pause/resume).
- `persistence` — Prisma repositories for all domain entities and audit records.
- `auth` — server-side seeded sessions for proctor/admin; single-use signed token validation for candidates.
- `observability` — structured logging with secret redaction, audit event writing.
- `config` — Zod-validated environment config loaded at boot; three categories: secrets, runtime flags (live/fixture mode, tunnel URL), demo resource selection (blueprint/policy/project/region friendly-name → ID mapping).

### CloudShare lab-launch flow (strict creation order)

Security-driven ordering; deviation causes silent denial at login.

1. Create Training Experience (type: "Registered Students Only").
2. Add Training Student — register the Candidate by name and email. This is the real Entitlement gate; skipping it means the sponsored link succeeds but login is denied.
3. Create Sponsored Link — returns a `loginUrl` on the Classic domain (`use.cloudshare.com`).
4. Candidate opens the `loginUrl` in a child window via `window.open`.

The "Any Students" mode is insecure (URL/passphrase shareable) and is explicitly rejected for a certification demo.

### Webhook ingestion and event correlation

- One webhook endpoint in the `api` layer.
- Inbound requests verified via HMAC-SHA256 over the body, using the account-level webhook secret from config.
- Payload validated with Zod; requests that fail signature verification or schema validation are rejected and logged.
- Idempotency key synthesised from `(environmentExternalId, Event, CreatedAt)` — CloudShare payloads carry no unique event ID and no custom headers can be added.
- Webhooks are treated as a hint; `GET environment` polling is the source of truth for state transitions.
- Environment events to handle: `environment.created`, `environment.suspended`, `environment.resumed`, `environment.deleted`, `environment.extended`, `environment.archived`.
- Environments are correlated to domain state via `environmentExternalId` set on creation (the only reliable correlation mechanism CloudShare provides).

### Heartbeat auto-suspend

- While a LabLaunch is active, the portal page sends a heartbeat to the server every few seconds (interval configurable).
- `navigator.sendBeacon` on `pagehide`/`visibilitychange` provides a best-effort fast signal on tab close or navigation away.
- The server suspends the CloudShare environment and signals a timer pause to the Kryterion simulator if heartbeats stop for ~30–60 seconds (configurable via config layer).
- The portal also polls `childWindow.closed` on the retained `window.open` handle as an additional liveness check.
- This mitigates the confirmed CloudShare gap: closing the browser does not suspend the environment — it keeps running and billing.

### Lab window strategy

- CloudShare pages set `frame-ancestors 'self' *.ci.cloudshare.com accelerate.cloudshare.com` — third-party iframe embed is browser-blocked.
- The lab is opened in a child window (`window.open`). The portal retains the window handle for closed-detection.
- No DOM access into the lab page is possible or required; liveness comes only from the portal heartbeat and CloudShare environment state polling.

### Identity and entitlement

- No real IdP/SSO. Proctor/admin use seeded server-side sessions behind an `auth` interface (OIDC/SSO can slot in later without changing the domain layer).
- Candidate identity is established by a short-lived, single-use signed token minted by the Kryterion simulator and validated by the `auth` layer.
- Entitlement is always recomputed server-side in the domain layer from persisted state. No client-supplied state, cookie, or role claim is trusted.

### Resource ID management

- Blueprint, policy, project, and region IDs are dynamic CloudShare identifiers — never hard-coded.
- A local reference table maps friendly names to live IDs, populated by an admin "Sync Resources" action that calls CloudShare list endpoints.
- The reference table is persisted in the database and refreshed on demand.

### Live-vs-fixture mode

- A runtime flag toggles between live CloudShare API calls (development and evidence mode) and replaying recorded fixture responses (demo mode).
- Fixtures are derived from real API responses captured against the live tenant.
- Both modes run the same code path through the integration adapter.

### API gap report

A living document at `docs/api/cloudshare-gap-report.md`, updated during implementation. Gaps confirmed so far:

1. Dual, inconsistent auth: v4 Bearer (5-min TTL) vs v3 OAuth1 `cs_sha1` with SHA1 HMAC and single-use 60s tokens — two models, two doc sites, mid-migration.
2. Webhook secret cannot be rotated/regenerated; it is account-level and shared across all webhooks.
3. Webhooks are unreliable, carry no custom headers and no unique event ID — consumers must poll for truth and synthesise idempotency keys.
4. Closing a browser tab or logging out does not suspend the environment — it keeps running and billing. Long-standing and unresolved; the portal-side heartbeat is the mitigation.
5. Suspended state is preserved for ~2 hours only; a full re-provision is required after that.
6. Lab cannot be iframed by third-party portals — `frame-ancestors` allow-lists only CloudShare's own domains.
7. Certification scoring is weak: bitmap-based checkpoints, end-state only, deterministic verification not GA until Q3 2026.
8. Doc fragmentation / timing ambiguity: the discovery email states 5-hour pre-provision SLA; the meeting notes say 1 hour. Must be verified against the live API.
9. Secure use requires "Registered Students Only" + Add-Student before the sponsored link, or login is denied with no error surfaced to the candidate.

---

## Testing Decisions

A good test exercises observable domain behaviour (state transitions, entitlement decisions, audit records written, external call shapes) through the highest seam possible. Tests must remain valid if internal wiring changes. Do not test implementation details.

### What makes a good test

- Test the domain layer directly (no HTTP or framework) for business rules: entitlement checks, LabLaunch state transitions, timer sync logic, idempotency of event ingestion.
- Test integration adapters against Zod schemas and typed stubs — verify the adapter produces the right CloudShare request shape and maps the response to the correct domain type, without calling the real API.
- Test the webhook endpoint via HTTP: verify HMAC-valid payloads are accepted, HMAC-invalid payloads are rejected, and duplicate events are deduped.
- Test config loading in isolation: valid env produces typed config; missing or invalid env throws at boot.
- Test persistence repositories against a real SQLite test database (no mocked DB).
- Do not test React component internals. Test observable page behaviour (renders, form submits, redirects) only where it encodes business logic.

### Modules with required test coverage

| Module | Level | Notes |
|---|---|---|
| `domain` | Unit | All state machines and business rules; no external dependencies |
| `integrations/cloudshare` | Unit | Mocked HTTP; verify v4 token cache and v3 HMAC signing against known vectors |
| `integrations/genesys` | Unit | Simulator logic |
| `integrations/kryterion` | Unit | Token minting and clock signal logic |
| `api` (webhook route) | Integration | HMAC verification, Zod parsing, idempotency |
| `config` | Unit | Boot-time validation |
| `persistence` | Integration | Real SQLite test database |
| `auth` | Unit | Token expiry and single-use enforcement |

### Preferred seams

- The `integrations/*` boundary is the preferred seam for mocking external providers — no mocking inside the domain layer.
- Fixture JSON files in `integrations/cloudshare/fixtures/` will serve as both test stubs and the demo-mode replay corpus, keeping them in sync.

---

## Out of Scope

- Real Genesys API integration (learning management, entitlement lookup, score weighting).
- Real Kryterion API integration (identity verification, secure browser enforcement, official exam scheduling).
- Cloud deployment (Azure, AWS) or production hardening.
- Multi-customer or multi-tenant support.
- Alternative CloudShare provisioning modalities beyond "single-user experience, pre-provisioned ahead of time."
- Workato/embedded iPaaS integration.
- Other CloudShare environment types: ad-hoc spin-up, direct environment, shared multi-participant experiences.
- Any feature depending on CloudShare's deterministic verification capability (not GA until Q3 2026).
- Environment extension (v3 Extend endpoint).
- SSO/OIDC for proctor/admin authentication.
- Score weighting (lab result + theory component → final certification outcome) — this is Genesys's responsibility.

---

## Further Notes

- The v4 client_secret exposed during the grill-me session must be rotated before any code is committed.
- The discovery email states the experience must be created 5 hours before login; grill-me session notes say 1 hour. This pre-provision SLA must be verified against the live API and the correct value documented in the gap report and `.env.example`.
- The Kryterion "embed in secure browser" goal is directly blocked by CloudShare's `frame-ancestors` CSP. Resolving this would require CloudShare to add the customer domain to the allow-list — a product decision, not a portal decision. Document as a gap.
- The portal heartbeat timeout (30–60 seconds) is configurable and must be documented in `.env.example`.
- Commit a `.env.example` documenting every required variable (placeholders only, no real values) as part of initial scaffold.
