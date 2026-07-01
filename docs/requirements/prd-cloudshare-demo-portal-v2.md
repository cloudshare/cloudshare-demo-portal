# PRD: CloudShare Demo Portal — Certification Exam Delivery (v2)

**Date:** 2026-06-13
**Status:** Ready for agent (pending publish to issue tracker)
**Supersedes:** `prd-proctoring-demo-portal-mvp.md` (the 2026-06-07 self-service/simulator design).
**Sources:** `docs/discovery/2026-06-13-grill-with-docs-synthesis.md`, `CONTEXT.md`,
`docs/decisions/ADR-001` (per-Customer credentials), `ADR-002` (server-side sponsored-link
redirect), `ADR-003` (event correlation & polling-as-truth).

> Terminology follows `CONTEXT.md`. The old "Genesys/Kryterion simulator" model is retired:
> the portal **is** the certification Provider (**Certalis**); the **Customer** (**Helios CX**)
> owns its CloudShare subscription; **Candidates** are Helios end-users. CloudShare is the only
> live integration.

---

## Problem Statement

A CloudShare customer wants to show stakeholders a believable, **working** portal in which their
own end-users log in, schedule, and sit a certification exam that runs in a **real CloudShare
environment** — and in which the organisation can monitor those sessions. The first build only
*simulated* this journey (an operator click-through, simulator-minted candidate tokens, no real
login or scheduling), so it never demonstrated the CloudShare capabilities that are the entire
point: real experience provisioning, sponsored-link login, suspend/resume, and scoring.

## Solution

An interactive certification-provider portal with **first-class admin and candidate experiences**,
backed by **real, per-Customer CloudShare calls**:

- A **Helios admin** connects their CloudShare subscription (their own API ID/key + webhook
  secret), curates **Exams** from live CloudShare blueprints, and monitors sessions.
- A **Candidate** self-registers or is admin-provisioned, logs in, browses published exams,
  **schedules** one, and at the scheduled time is redirected — through a **hidden** sponsored
  link — into a real CloudShare environment.
- The portal **owns the exam clock**, **auto-suspends** on lost liveness, and optionally retrieves
  **Guided Journey** scores.
- **Polling is the source of truth**; webhooks are an optional, tunnel-only enhancement.

The demo must run interactively against the live CloudShare tenant, with a seeded/fixture path for
deterministic, tunnel-free presentation. A living **CloudShare API gap report** remains a
first-class deliverable.

## User Stories

### CloudShare connection (Helios admin)
1. As a Helios admin, I want to enter my CloudShare API ID and key into the portal, so that the portal can act on my CloudShare subscription on my behalf.
2. As a Helios admin, I want my CloudShare credentials stored encrypted and never shown back to me or logged, so that my subscription stays secure.
3. As a Helios admin, I want a "Test connection" action (a real CloudShare `ping`), so that I know my credentials work before I build exams.
4. As a Helios admin, I want the portal to register its own webhook against my exam project (or clear instructions to do it manually), so that environment events can reach the portal.
5. As a Certalis operator, I want a Helios connection pre-seeded for demos, so that a presentation starts already connected without pasting live secrets.

### Exam catalog (Helios admin)
6. As a Helios admin, I want to list the projects in my subscription, so that I can pick where exams are provisioned.
7. As a Helios admin, I want to list the Blueprints for a chosen Project, then inspect Blueprint detail including Snapshots and the default Snapshot, so that I can see which environment version an Experience-based Exam will use.
8. As a Helios admin, I want the portal to reflect the blueprint's current default Snapshot for Experience-based Exam launches, so that the portal does not imply it can override CloudShare's launch behavior.
9. As a Helios admin, I want to choose a Project-scoped Policy, one or more allowed Regions, and a manually authored Exam open period from the selected Blueprint default Snapshot deployment set, so that environment lifetime and CloudShare placement stay valid.
10. As a Helios admin, I want candidate-facing exam metadata (title, description, time limit, open period) to be prepared from the selected CloudShare resources, so that candidates understand what they are scheduling without the portal inventing conflicting launch settings.
11. As a Helios admin, I want to mark whether an exam retrieves Guided Journey scores, so that the portal only requests progress when a journey exists.
12. As a Helios admin, I want to publish or unpublish an exam (draft vs published), so that candidates only see exams that are ready.

### Identity & access
13. As a Candidate, I want to self-register with first name, last name, email, and password, so that I can access the portal and later be registered as a CloudShare training participant.
14. As a Helios admin, I want to provision candidate accounts with first name, last name, email, and a temporary password, so that I can onboard users directly and preserve the identity fields CloudShare requires.
15. As any user, I want to log in with email and password and stay logged in across reloads, so that my session is durable.
16. As a Candidate, I want to see only the exams published by my organisation, so that my choices are relevant.
17. As the portal, I want to recompute entitlement server-side from persisted state, so that no client-supplied state can grant lab access.

### Scheduling & provisioning
18. As a Candidate, I want to pick a date/time to sit an exam, so that I can plan around my own schedule.
19. As a Candidate, I want to be warned if I schedule within the ~5h standby window, so that I understand my environment may cold-start and take a few minutes.
20. As the portal, I want scheduling to immediately create the CloudShare training experience (`instructorLed`, start = the scheduled time) and assign the candidate as participant, so that CloudShare can prepare a standby ahead of time.
21. As the portal, I want to create the sponsored link at scheduling time and store it server-side, so that the candidate can be redirected later without the link being exposed.
22. As a Candidate, I want my scheduled exam to show its state (scheduled, ready, in progress, suspended, completed), so that I know what to do next.

### Launch & redirect
23. As a Candidate, I want an "Enter exam" action that only works at/after my scheduled time, so that I cannot start early.
24. As a Candidate, I want the exam to open in a dedicated window, so that the portal can keep monitoring while I work.
25. As the portal, I want to redirect the candidate to the sponsored link via a server-side 302 from a portal endpoint, so that the URL never enters the portal UI or client code.
26. As a Candidate, I want the environment to be provisioned (warm standby or cold) on login, so that I land in my own environment.

### Suspend / resume, clock & heartbeat
27. As a Candidate, I want the exam timer to pause when I suspend my lab, so that a deliberate break does not cost me time.
28. As a Candidate, I want to resume and have the timer continue from where it paused, so that my remaining time is preserved.
29. As the portal, I want to own a persisted exam clock per attempt that survives reload/restart, so that timing is authoritative and reliable.
30. As a Candidate, I want to be warned that closing the window without suspending keeps the environment running, so that I do not lose time unintentionally.
31. As the portal, I want to auto-suspend the environment and pause the clock if heartbeats stop (tab closed, crash, network loss), so that the environment does not run unattended.
32. As the portal, I want environment state driven by polling CloudShare (not the webhook payload), so that duplicate, replayed, or out-of-order events are safe.

### Scoring (optional)
33. As a Candidate, I want to see my Guided Journey progress after the lab, where the exam supports it, so that I get feedback.
34. As a Candidate, I want scoring limitations surfaced inline, so that I understand what the score does and does not reflect.

### Monitoring (Helios admin)
35. As a Helios admin, I want a live view of who is scheduled, in progress, suspended, and completed, so that I can oversee active sessions.
36. As a Helios admin, I want a history of past attempts with their results, so that I can support and audit candidates.
37. As a Helios admin, I want to see suspend/resume and external-API-failure events per attempt, so that I can diagnose issues without accessing CloudShare directly.

### Config & security
38. As a Certalis operator, I want the portal to fail fast at boot if required config is missing/invalid, so that misconfiguration is caught before a demo.
39. As a Certalis operator, I want a single portal master key that encrypts stored CloudShare credentials, so that secrets are protected at rest.
40. As an operator, I want a demo reset/seed and a clock-control shim, so that I can re-run a live demo cleanly without waiting for scheduled times.

## Implementation Decisions

### Architecture & modules
- Single TypeScript **Next.js** app (App Router). `domain`, `integrations/cloudshare`,
  `persistence`, `auth`, `observability`, `config` are framework-agnostic; the `domain` layer
  imports nothing from Next. Build as a reusable framework (an eye on a future real portal).
- Development is **API-first**. Every portal capability that changes or exposes domain state must
  have a typed HTTP API route and framework-agnostic handler before or alongside the UI. React
  screens are clients of those APIs, not privileged backdoors into domain services. This keeps the
  portal scriptable for demos, future sales-demo variants, automated E2E flows, and non-browser
  integrations.
- Slice 1 already follows this shape for the CloudShare Connection:
  `POST /api/auth/login` accepts JSON credentials and sets the portal session cookie,
  `GET /api/admin/cloudshare` reads redacted connection status,
  `PUT /api/admin/cloudshare` saves/replaces CloudShare Connection credentials, and
  `POST /api/admin/cloudshare/test` verifies the saved connection with a real v3 `ping`.
  Future slices should preserve this pattern: `src/api/*` owns the policy and typed request/response
  contract; `app/api/*/route.ts` is a thin Next.js adapter; `src/web/*` calls the API.
- **Remove** `integrations/genesys` and `integrations/kryterion`. Eligibility is replaced by the
  admin-curated catalog; the candidate token mechanism is replaced by real auth; the exam clock
  moves into a `domain` timer service.

### CloudShare integration (ADR-001)
- The CloudShare client is built **per-Customer** from a stored `CloudShareConnection`
  (`createCloudShareIntegration(connection)`), never from global config. The Connection holds a
  single **API ID + API key** (used for both v3 `cs_sha1` signing and the v4 `client_id`/
  `client_secret` OAuth exchange) plus the **webhook secret**, stored encrypted at rest via a
  portal master key; decrypted only at call time; redacted in logs.
- **Hosts/paths:** v4 = `https://api.accelerate.cloudshare.com/v4` (Bearer, `expires_in: 300`,
  cached/refreshed); v3 = `https://use.cloudshare.com/api/v3` (`cs_sha1`). Sponsored-link
  `loginUrl` host = `use.cloudshare.com`. The v4 training resource is `/v4/trainings/{id}` (not
  `/experiences`). Validate via v3 `ping`. These correct current placeholders and are verified
  against the live tenant during build.
- **Infrastructure reads are v3, experience writes are v4.** Project list and Region list are v3
  reads; Region is effectively platform-global (`GET /api/v3/regions`) and should be cached as a
  refreshable reference list. Project-scoped infrastructure must be read through the selected
  Project: Blueprints via `GET /api/v3/projects/{projectId}/blueprints`, Policies via
  `GET /api/v3/projects/{projectId}/policies`, later Project Members / Instructor choices through
  the corresponding Project-scoped surface, and Snapshots via Blueprint detail for the selected
  Project + Blueprint path. Training creation, add-participant, sponsored-link, list-students, and
  Guided Journey are v4.
- Some v3 endpoints expose broader visible data, e.g. `GET /api/v3/policies`, but those are treated
  as undocumented convenience surfaces, not the portal's primary contract. Endpoint/path/shape
  assumptions for Projects, Regions, Policies, Blueprints, Snapshots, and Project Members must stay
  isolated inside `integrations/cloudshare`.
- CloudShare intends to move more environment-management and infrastructure endpoints to v4 over
  time. The resource-read surface must remain adapter-based so a future v3-to-v4 migration is
  localized to `integrations/cloudshare`.

### Exam catalog
- An **Exam** belongs to a Customer and binds a provisioning tuple — **project, blueprint, snapshot
  (the Blueprint's current default for Experience-based launches), allowed Region set (a non-empty subset of that default Snapshot's deployed Regions), policy, instructor (a seeded service-account project
  member)** — plus metadata (title, description, per-Exam **time limit** sourced from the selected Policy runtime lease, manually authored
  **open period**, **published/draft**, and a **score-retrieval flag**). The blueprint/policy/project/allowed-Region selection replaces the global
  `DEMO_*` env vars.
- Exam authoring is **Project-first**, not global-resource-first. The intended admin workflow is:
  sync/list Projects, sync/list global Regions, select a Project, then fetch or read cached
  Project-scoped resources for that Project only: Blueprints, Policies, and Blueprint detail
  including Snapshots and the default Snapshot. Instructor remains a configured seeded service
  account for Slice 2 until a real Project-member read endpoint is verified.
  Snapshot detail is informative for Experience-based launches: the portal records the current
  default Snapshot, constrains allowed Regions to that Snapshot's deployed Region set, and does not
  directly select a non-default Blueprint version.
- Policy detail lease evidence is read through the undocumented but live-observed v3 endpoint
  `GET /api/v3/projects/{projectId}/policies/{policyId}`. `runtimeLeaseMinutes` remains the
  Certalis ExamAttempt timer (`Exam.timeLimitMinutes`). `storageLeaseMinutes` is retained as
  continuous CloudShare retention/TTL evidence and bounds authoring when present; it does not
  directly define the v4 training End. The manually authored `openPeriodMinutes` defines the
  CloudShare training/Experience End and must satisfy `openPeriodMinutes >= timeLimitMinutes` and,
  when storage evidence is available, `openPeriodMinutes <= storageLeaseMinutes`.
- The current admin **Resources** tab is a stopgap sync surface for early integration evidence. It
  should not be treated as the long-term Exam-authoring model, and the portal should not assume that
  syncing every visible project-scoped object across every Project is the default design.
- The `CloudShareResourceLister` port grows toward project-first reads: Projects and global Regions
  as reference lists, plus on-demand Project-scoped Blueprints, Policies, Project Members, and
  Blueprint-detail Snapshots for the selected Project.

### Identity & access
- Candidate identity stores first name, last name, email, and password (hashed), with httpOnly
  DB-backed sessions. Roles: **admin** and **candidate**; role drives home routing. Candidates may
  **self-register** or be **admin-provisioned**. No SSO. No Certalis provider-admin UI (the Customer
  is seeded).
- Candidate first name and last name are required portal data because CloudShare participant
  registration requires first name, last name, and email. The password is portal-only and is not sent
  to CloudShare.
- **Entitlement** is recomputed server-side in `domain` from the persisted `ExamAttempt`.

### Scheduling, provisioning & launch (ADR-002)
- `ExamAttempt` carries `scheduledFor` and a lifecycle: `scheduled → provisioned(ready) →
  in_progress → suspended ⇄ in_progress → completed / expired`.
- **At scheduling**, the `LabLaunch` flow runs immediately: create training (`instructorLed`,
  `start = scheduledFor`, `End = scheduledFor + Exam.openPeriodMinutes`) → add participant → create sponsored link. No background scheduler; the
  environment is provisioned by CloudShare **on login** (warm standby ≥5h ahead, else cold). A
  warning is shown when scheduling within ~5h.
- Training creation uses CloudShare's Team ID, not Project ID. Because v4 training creation requires
  `TeamId` in practice, the portal resolves the Team through the CloudShare adapter using the
  v3 project-filtered Teams read documented as a gap.
- **Launch** is **time-gated**: a portal `/enter` endpoint, opened in a **child window**,
  recomputes entitlement, enforces the time gate, then **302-redirects** to the `loginUrl`. The
  `loginUrl` is **server-only** — stored on the `LabLaunch`, never returned to the client or shown
  in the UI. The opener retains the child-window handle for liveness.

### Suspend/resume, clock & heartbeat
- The portal owns a **persisted exam clock** per attempt (pauses on suspend, resumes on resume,
  enforces the time limit). Heartbeat auto-suspend is retained: periodic heartbeat + `sendBeacon`
  on `pagehide`/`visibilitychange` + `childWindow.closed` polling; a server timeout suspends the
  environment and pauses the clock.

### Event correlation (ADR-003)
- The portal owns the `trainingId ↔ Candidate (email/studentId) ↔ environmentId` mapping. The
  `environmentId` is unknown until login and is discovered via the v4 **list-students-in-a-training**
  endpoint (`ParticipantLister` port). The v3 environment webhook payload carries no
  experience/training reference, and live payloads may send `Payload` as a JSON string with
  PascalCase `EnvironmentId` / nullable `EnvironmentExternalId`. **Polling `GET environment` /
  list-students is the source of truth; webhooks are an optional tunnel-only hint.** Idempotency key
  = `(customerId, normalisedEnvironmentId, event, createdAt)`.
- Webhook routing is **per-Customer via an opaque URL path** so the receiver can select the right
  secret before verifying (no custom headers possible). Automatic webhook registration via the v3
  POST endpoint is planned but not shipped in the current slice; manual CloudShare webhook
  registration remains the supported path until the v3 create request/response is live-verified.
  Subscribe
  only to environment lifecycle events: `environment.created`, `environment.suspended`,
  `environment.resumed`, `environment.deleted`, `environment.extended`, and `environment.archived`.

### Monitoring & audit
- Reuse the audit trail + integration-event log; add a **live session view** (scheduled / in
  progress / suspended / completed attempts + suspend-resume + failure events). Exporting this to an
  external platform is out of scope.

## Testing Decisions

A good test exercises **observable behaviour** — state transitions, entitlement decisions, audit
records, external request/response shapes — through the **highest seam possible**, and stays valid
when internal wiring changes. Do not test implementation details or React internals.

- **Domain** (unit, no framework): entitlement, the scheduling/provisioning lifecycle, the persisted
  clock pause/resume maths, heartbeat auto-suspend (fake timers), idempotency, and the
  environment-correlation reconcile (out-of-order safe).
- **`integrations/cloudshare`** (unit, HTTP stubbed): verify v4 Bearer caching and v3 `cs_sha1`
  signing against known vectors; verify each adapter produces the right request shape and maps
  responses to domain types. **Fixtures double as test stubs and demo replay.** New: the
  per-Customer client factory builds a client from a `CloudShareConnection`, and credentials are
  never persisted or logged in plaintext (encryption seam).
- **API handlers** (integration, no Next.js): the webhook endpoint (signature verify, Zod parse,
  dedupe, per-Customer secret selection) and the `/enter` redirect (entitlement, time-gate, and
  that `loginUrl` never appears in any client-facing response).
- **API-first acceptance:** every new user-facing capability must have handler-level tests that
  exercise the typed API request/response contract before UI-only verification. UI tests or manual
  UI runs prove the screen can drive the API; they do not replace API handler coverage.
- **Persistence** (integration): repositories against a real SQLite test database, including the
  encrypted `CloudShareConnection` and the correlation mapping.
- **config** (unit): boot validation; **auth** (unit): password/session and single-use enforcement.
- **Prior art:** the existing vitest suites (`*.test.ts`) for domain use cases, the webhook handler
  test, the v3 signing/v4 auth tests, and SQLite-backed repository tests are the patterns to extend.
- Mock external providers **only at the `integrations/*` boundary** — never inside `domain`.

## Slice Completion Rules (integration slices)

Added 2026-06-13 after the Slice 1 implementation fell short — no tests written up front, no working
server login, and a *saved* connection presented as if it were *verified*. Any slice that touches a
**live external integration** (CloudShare) must clear a higher bar than green automated tests:

1. **Automated tests are necessary but not sufficient**, and are written as part of the slice (TDD),
   not bolted on afterwards.
2. **Live end-to-end verification is required** — the slice is not complete until verified against the
   **live tenant**, with **real credentials** and real runtime behaviour, **through the real UI flow**
   — not only isolated handlers, mocked tests, fixture replay, or direct API calls.
3. **Acceptance criteria must distinguish automated verification from live verification.**
4. **Failures must be supportable.** Any integration failure in the live flow must produce
   admin-visible diagnostics: the attempted operation, the integration surface used, the returned
   status or transport failure mode, and structured, redacted server logs.

**Definition of done (integration slices):** lint + typecheck + automated tests + live end-to-end
verification + support diagnostics confirmed in the real flow.

### Slice 1 — corrected acceptance

- Not done unless the Helios admin can **log in**, **save** the Helios CloudShare Connection, run
  **Test connection**, and receive a **real v3 `ping` → `pong`**.
- **Saving credentials is not a verified connection.** The UI must clearly distinguish **saved
  credentials** from a **verified CloudShare Connection**.
- The admin experience must expose **support diagnostics** for connection testing — enough redacted
  detail to troubleshoot credential, transport, and response-shape failures without server access.

## Out of Scope

- Multi-tenant management (multiple Customers, per-Customer projects/RBAC partitioning) — modelled
  but seeded to one Customer.
- A Certalis provider-admin UI (customer onboarding is seeded).
- SSO/OIDC; prerequisite-training eligibility gating.
- Multi-step / multi-blueprint trainings; candidate-facing Region choice.
- Score weighting into a final certification outcome (the Customer's responsibility); the broader
  Certification journey beyond a single Exam.
- Exporting monitoring data to an external platform; cloud deployment; production hardening.

## Further Notes

- The v4 `client_secret` exposed during discovery must be **rotated** before any commit.
- The exact pre-provision SLA (5h vs 1h), remaining v3 infrastructure response shapes, the v4
  training-creation body, Guided-Journey-absent behaviour (likely 404), instructor selection, and
  environment-ready detection are **open questions to verify against the live tenant** and record in
  the gap report.
- New gap-report items from this session: per-project blueprints; v3/v4 split; service-account RBAC
  unverifiable via API; no v4 health probe; single credential pair (softens the "dual auth" item);
  no API to detect a Guided Journey; webhook payload omits the experience; v3 webhook
  auto-registration unverified.
- Resource-model update from live verification: Region is a global v3 reference list; Policy and
  Blueprint are Project-scoped for portal behavior; Snapshot selection comes from selected Blueprint
  detail, not a global top-level Snapshot sync.
- Keep the fixture/seeded path in parity with live for deterministic, tunnel-free demos; provide a
  demo reset/seed and a clock-control shim.
- **First vertical slice** (per synthesis): "Helios admin connects CloudShare" — login + encrypted
  per-Customer connection + a real v3 `ping`. It proves auth/sessions, the connection model, the
  per-Customer client, real v3 signing, and error handling/redaction in one thin end-to-end slice.
