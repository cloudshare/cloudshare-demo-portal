# Grill-with-Docs Synthesis — CloudShare Demo Portal (re-scope)

**Date:** 2026-06-13
**Status:** Agreed in session. Input to `/to-prd`. **Supersedes** the 2026-06-07 grill-me
decisions and the existing PRD wherever they conflict.
**See also:** glossary in `CONTEXT.md`; `docs/decisions/ADR-001` (per-Customer credentials),
`ADR-002` (server-side sponsored-link redirect).

## North star

Demonstrate **CloudShare's capabilities** — real experience provisioning, sponsored-link login,
suspend/resume, scoring — through a believable, **interactive** certification-provider portal with
first-class **admin** and **candidate** experiences. The provider/customer/training framing is set
dressing; when a choice trades portal richness against showing real CloudShare behaviour,
CloudShare wins. Built as a reusable framework (an eye on a future real portal / sales-demo
vehicle), but not over-engineered for production.

---

## 1. Clarified domain model

### Actors
- **Certalis** — the certification *Provider*; **the portal itself**, not an external system. Runs
  the infrastructure, holds no CloudShare credentials. No provider-admin UI in the MVP.
- **Helios admin** — *Customer* admin. Connects CloudShare, curates the exam catalog, monitors
  sessions. First-class surface, equal billing with the candidate side.
- **Candidate** — Helios end-user. Self-registers or is admin-provisioned; logs in, schedules,
  consumes an exam, sees a score.

### Entities & relationships
- **Customer** (seeded: Helios) `1—1` **CloudShareConnection** (API ID + key + webhook secret;
  encrypted at rest; never returned to client).
- **Customer** `1—*` **User** (`role: admin | candidate`; email + password; httpOnly DB session).
- **Exam** (belongs to Customer) — provisioning tuple **(project, blueprint, snapshot[default-or-
  override], allowed Region set constrained by the default Snapshot deployment set, policy, instructor)** + metadata (title, description, per-Exam **time limit**,
  **published/draft**, **score-retrieval flag**).
- **ExamAttempt** (Candidate × Exam) — carries **`scheduledFor`** and a status lifecycle.
- **LabLaunch** (per ExamAttempt) — provisioning record: `trainingId`, `environmentExternalId`,
  `loginUrl` (**server-only secret**), status.
- **ExamClock** (per ExamAttempt) — **portal-owned, persisted**; pauses on suspend, resumes on
  resume, enforces the time limit.
- **EnvironmentRecord** — polled CloudShare state (polling is source of truth; webhooks are hints).
- **ScoreResult** (optional, per ExamAttempt) — Guided Journey progress + limitations.
- **AuditRecord / IntegrationEvent** — the support/monitoring trail.

### Key lifecycles
- **ExamAttempt:** `scheduled → provisioned(ready) → in_progress → suspended ⇄ in_progress →
  completed / expired`.
- **Provisioning (LabLaunch)** fires **at scheduling**: create Experience (`instructorLed`,
  `start = scheduledFor`) → add Participant → create Sponsored Link. No VMs run yet.
- **Environment** provisions **on login** (warm Standby if scheduled ≥5h ahead, else cold ~minutes).
- **Launch** is **time-gated** to `scheduledFor`: candidate clicks "Enter exam" → child window →
  portal `/enter` endpoint → entitlement + time-gate → **302 to the sponsored link**.
- **Liveness:** retained child-window handle → heartbeat + `childWindow.closed` → auto-suspend.

### CloudShare integration boundary
Per-Customer client built from the stored Connection. **v3** (`https://use.cloudshare.com/api/v3`,
`cs_sha1`) for infrastructure reads and ping: Projects, global Regions, Project-scoped Blueprints,
Project-scoped Policies, Blueprint-detail Snapshots, and Project Members / Instructor choices.
**v4** (`https://api.accelerate.cloudshare.com/v4`, Bearer) for trainings, add-participant,
sponsored-link, Guided Journey. Same API ID/key feeds both; only the per-request auth differs.

---

## 2. Key risks

1. **Service-account RBAC is unverifiable via API.** If the Customer's API key lacks the role to
   create trainings / add participants / read journeys, launches fail. No pre-flight permission
   check exists — mitigate with clear, actionable launch errors and a "Test connection" probe.
2. **Per-Customer secret storage.** Storing a third party's API key + webhook secret raises
   encryption-at-rest, decryption-only-at-call-time, and log-redaction requirements (master key in
   `.env`).
3. **Webhook secret is account-level and non-rotatable**, and the receiver must resolve *which
   Customer* an inbound webhook belongs to (via `environmentExternalId`) before it can pick a secret
   to verify. Account-Manager setup + valid TLS required for live mode.
4. **Sponsored link is a bearer credential** — anyone with it enters the user's environment.
   Server-only handling mitigates portal exposure but it remains visible in the child window's
   address bar (see ADR-002).
5. **Pre-provision SLA vs live demo.** Real warm standbys need ≥5h; demos schedule minutes out and
   accept a cold start. Demo clock-control + a warning mitigate the wait.
6. **Live-CloudShare dependency for demos.** Network/tenant issues can derail a live run — keep a
   fixture path for deterministic, tunnel-free presentation.
7. **Unverified API shapes.** v4 host/path corrections, Project-scoped Blueprint/Policy response
   shapes, Blueprint-detail Snapshot/default-Snapshot response shape, Project Member response shape,
   and the training-creation body must be validated against the live tenant.
8. **No way to detect a Guided Journey** — handled by the per-Exam flag + defensive 404 handling.
9. **Suspended state preserved only ~2h** — long candidate gaps may require re-provision.

---

## 3. Open questions (verify against the live tenant)

1. Exact v3 shapes for `GET /projects/{id}/blueprints`, `GET /projects/{id}/policies`,
   Blueprint detail including Snapshots and the default Snapshot field, global Regions, and Project
   Members / Instructor choices.
2. v4 **create-training-experience** request body — required fields for blueprint/project/policy/
   region/instructor/participant, and `instructorLed` start/end semantics vs policy timeout.
3. Behaviour when requesting Guided Journey progress for an experience with **no** journey (404?).
4. **Instructor** selection — which project member / service account, and is it per-Exam or a
   Connection-level default?
5. How to detect an environment is **ready** after login (poll which v3 endpoint by
   `environmentExternalId`?), and the real pre-provision SLA (5h vs 1h).
6. Per-Customer **webhook** configuration flow (account-level secret, Account-Manager setup) in a
   multi-tenant future.
7. **Candidate ↔ Customer association** on self-registration — for the single-customer demo, default
   all self-registered candidates to Helios; revisit for multi-tenant (email domain? invite?).

---

## 4. Proposed PRD structure

1. **Problem & goal** — the CloudShare-demonstration north star; what the old build got wrong.
2. **Personas & roles** — Helios admin, Candidate (Certalis provider-admin noted as deferred).
3. **Domain model** — reference `CONTEXT.md`; entities, relationships, lifecycles (Section 1).
4. **CloudShare Connection** — per-Customer credentials, encryption, Test-connection, seeding (ADR-001).
5. **Exam catalog** — admin follows a Project-first workflow: select Project, then pull
   Project-scoped Blueprints/Policies, Blueprint-detail Snapshots, global Regions, and later Project
   Members / Instructor choices; builds/publishes Exams.
6. **Identity & access** — email/password, sessions, self-register + admin-provision, server-side entitlement.
7. **Scheduling & provisioning** — `scheduledFor`, immediate experience creation, standby/cold, warnings.
8. **Launch & redirect** — time gate, child window, server-side 302, sponsored link as secret (ADR-002).
9. **Suspend/resume, clock & heartbeat** — portal-owned persisted clock; auto-suspend; polling as truth.
10. **Scoring (optional)** — Guided Journey flag, progress, limitations.
11. **Admin monitoring** — live session view + audit/event trail.
12. **Security & compliance** — secrets, redaction, webhook verification, entitlement, audit.
13. **Out of scope** — multi-tenant management UI, SSO, multi-step trainings, multi-region per Exam,
    score weighting, passing the monitoring data to external platforms.
14. **CloudShare API gap report** — living deliverable (update with this session's new items).
15. **Testing strategy** — domain unit tests, integration adapter contract tests, fixture/live parity.

---

## 5. First vertical slice (tracer bullet)

**Slice 1 — "Helios admin connects CloudShare."** The thinnest end-to-end slice that proves the
riskiest seams: real login + a real CloudShare call + per-Customer encrypted credentials.

*Flow:* seed the Helios customer and one admin user → admin logs in (email/password, httpOnly
session) → "Connect CloudShare" screen → admin enters **API ID + API key** → portal stores them
**encrypted** on the Customer's CloudShareConnection → **"Test connection"** calls the real **v3
`ping` → `pong`** using `cs_sha1` signing built from those creds → result surfaced (success / typed,
actionable failure). Seeded-connection path uses the *same* code so demos start pre-connected.

*Proves:* email/password auth + sessions; the per-Customer Connection model and encryption (ADR-001);
the **per-Customer CloudShare client**; real v3 `cs_sha1` signing against the live tenant; the
corrected v3 host; typed error handling + redaction; a real admin screen.

*Acceptance:* valid creds → `pong` + "Connected"; invalid creds → actionable error, nothing stored
in plaintext, no secret in logs; seeded connection verifies without manual entry.

**Then, roughly in order:** Slice 2 — admin follows the Project-first resource-selection flow
(Projects + global Regions, then Project-scoped Blueprints/Policies and Blueprint-detail Snapshots)
and creates/publishes an **Exam** (v3 reads behind the CloudShare adapter). Slice 3 — candidate self-registers/logs in,
browses published exams, **schedules** one (creates ExamAttempt + provisions the training + sponsored
link). Slice 4 — time-gated **launch** via child-window 302, environment provisions on login. Slice 5
— suspend/resume + persisted clock + heartbeat auto-suspend. Slice 6 — optional Guided Journey score.
Slice 7 — admin **monitoring** view.
