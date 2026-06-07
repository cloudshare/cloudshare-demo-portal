# Grill-me Decisions — Genesys/Kryterion/CloudShare Demo Portal

**Date:** 2026-06-07
**Session:** Alignment ("grill-me") between Chris Swinney and Claude, prior to PRD.
**Source material:** `discovery/2026-06-07-follow-up-email.txt`, `discovery/2026-06-07-genesys-kryterion-discovery.docx`, plus a live v4 sponsored-link capture and a `use.cloudshare.com` HAR.
**Status:** Agreed. Intended as the input to `/to-prd`. Individual decisions can be distilled into ADRs under `docs/decisions/`.

> Note: secrets (API client_secret, tokens) used during the session are deliberately omitted here. The v4 client_secret exposed during testing should be rotated.

---

## 1. Scope & goals

This is a **demo, but based in reality** — not throwaway, not a full production system.

- **CloudShare is the only live integration.** The CloudShare adapter makes real v4/v3 API calls. Live tenant access and tokens are available (Chris is at CloudShare; resource cost is negligible).
- **Genesys and Kryterion are thin simulators** — they emit the correct events/payloads and provide minimal UI; they are not real integrations.
- **A running "API gap report" is a first-class deliverable** (Section 7) — documenting where CloudShare's API falls short for certification use.
- **Live for truth, fixtures for the show:** live calls are the development and evidence path; recorded responses make the demo deterministic and tunnel-free in front of an audience.
- **Today's capabilities only.** Future certification-grade features are noted as gaps, not built or mocked.

**Out of scope now (design for portability, don't build):** other provisioning modalities, cloud deployment (Azure/AWS), multi-customer, and any eventual production hardening.

**Workflow (per repo `CLAUDE.md`):** grill-me (done) → `/to-prd` → `/to-issues` → `/tdd`.

---

## 2. The candidate journey (full happy path)

The demo enacts the entire path on screen, with the **candidate as the primary, self-service actor**:

1. Candidate logs into a **pretend Kryterion portal**.
2. They are shown exams they are **eligible** for, based on invented-but-believable criteria (e.g. completed prerequisite Genesys training, now purchasing the credential).
3. They **self-schedule and book** an exam with **no admin in the loop**.
4. They **launch the CloudShare lab directly** from the portal (sponsored-link redirect).
5. **Suspend/resume syncs the exam timer** (Section 6).
6. On completion, **per-participant score/progress** is retrieved and shown with limitations surfaced inline.

Proctor and admin are operator personas, not part of the candidate path. The pre-check becomes an automated gate rather than a human-proctor step.

Domain concepts (consistent with `CLAUDE.md` ubiquitous language): `Candidate`, `Exam`, `ExamAttempt`, `ProctoringSession`, `Entitlement`, `LabLaunch`, `IntegrationEvent`.

---

## 3. Stack & architecture

- **Single TypeScript Next.js app (App Router).** Python was considered and rejected: the demo is UI-driven and single-app, so Python would force a polyglot API + SPA split.
- Next route handlers form the `web` (candidate/proctor/admin screens) and `api` (REST + webhook receiver) layers. The `CLAUDE.md` layers — `domain`, `integrations/{cloudshare,genesys,kryterion}`, `persistence`, `auth`, `observability`, `config` — are plain framework-agnostic TS modules. **The domain layer imports nothing from Next.**
- **Zod** validates all external payloads at the integration boundaries.
- **Persistence: SQLite via Prisma**, behind repository interfaces, provider swappable to Postgres for the cloud future. A real DB is required — the audit trail, restart-survives-the-demo, and idempotency are explicit requirements (no in-memory store).

### Config & secrets

- One typed `config` module, loaded from env, **Zod-validated at boot (fail fast)**.
- Three categories: **secrets** (v4 token, v3 credentials, webhook secret) — env-only, redacted in logs; **runtime flags** (live-vs-fixture mode, tunnel URL); **demo resource selection** (which blueprint/policy/project/region the demo uses, by friendly name).
- Commit a `.env.example` documenting every required variable (placeholders only).
- **Blueprint / Policy / Project / Region IDs are dynamic CloudShare-side identifiers — never hard-coded.** Sync them from CloudShare list endpoints into a local reference table (friendly-name → ID), refreshed on demand via an admin "sync resources" action.

### Identity & actors

- No real IdP/SSO for the demo.
- **Proctor/admin:** simple seeded server-side sessions behind an `auth` interface (OIDC/SSO can slot in later).
- **Candidate:** no password login — the simulated Kryterion launch mints a short-lived, single-use token pinned to one `ExamAttempt`.
- **Entitlement is always recomputed server-side** in the domain layer from persisted state. Never trusted from a cookie, role claim, or any client-supplied state.

---

## 4. CloudShare lab-launch flow

**Provisioning model: single-user experience, pre-provisioned ahead of time** — one experience per candidate, giving a clean 1:1 `Candidate` ↔ `ExamAttempt` ↔ `LabLaunch` mapping. Other modalities (ad-hoc spin-up, direct environment) are alternate strategies behind a `LabLaunch` seam but **not built for the MVP**.

**Strict creation order (security-driven).** The experience must be registration type **"Registered Students Only"**:

1. Create Training Experience (Registered Students Only)
2. **Add Training Student** (register the candidate)
3. Create Sponsored Link
4. Candidate logs in via the returned `loginUrl`

If Add-Student is skipped, the sponsored-link POST still succeeds but the candidate is **denied at login**. The "Any Students" alternative lets the link work without registration but allows anyone with the URL/passphrase to log in — insecure, and rejected for a certification demo. **Registration is therefore the real entitlement gate.**

**Event ingestion.** Webhooks are an unreliable *hint*; **polling `GET environment` is the source of truth.** One real webhook endpoint in the `api` layer performs HMAC-SHA256 verification + Zod validation + idempotency dedupe. It is fed by real CloudShare webhooks in live mode (via a tunnel) and by the simulator posting identical payloads in demo mode — same code path either way. Inbound events are correlated to domain state via **`environmentExternalId`** (set by us on creation), because CloudShare does not allow custom webhook headers and the payload carries no unique event ID.

**Scoring.** Pull real per-participant Guided Journey progress, map to a domain `ScoreResult`, and surface CloudShare's limitations inline (bitmap checkpoints, end-state only, deterministic verification not GA until Q3 2026). Score weighting (lab + theory → final cert) is Genesys's responsibility and out of scope.

**Operator UX.** A "Demo Control" panel walks the happy path as ordered, state-gated steps, with an optional one-click auto-play. A reset/seed action returns to a known clean state.

---

## 5. Verified CloudShare API facts

(See also the gap list in Section 7. Do not commit live tokens/secrets.)

- **v4 (Accelerate) auth:** `POST https://api.accelerate.cloudshare.com/v4/oauth/token`, form body `client_id` + `client_secret` + `grant_type=client_credentials` → Bearer JWT with **`expires_in: 300` (5 minutes)**. Cache and refresh aggressively with a safety margin; do not fetch per call.
- **v3 (Production) auth:** OAuth1-style. Header `Authorization: cs_sha1 userapiid:<id>;timestamp:<unix-sec>;token:<10 random alnum>;hmac:<hex>`. HMAC = **SHA1** hex digest of `apiKey + full-request-URL + timestamp + token`. Token is single-use; request valid **60 seconds**; not replayable. Reference SDK: `cloudshare/js-sdk` (reimplement ~20 lines behind the adapter). Docs: <https://docs.cloudshare.com/rest-api/v3/overview/using-the-rest-api/>
- **Sponsored link (v4):** `POST /v4/trainings/{trainingId}/sponsored-link`, body `{firstName, lastName, email}` → `{id, loginUrl}`. The `loginUrl` is on the **Classic domain**: `https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/{id}` (cross-domain hop from the Accelerate API host).
- **Webhooks:** configured in the Integration Hub by an Account Manager (per project; endpoint requires a valid TLS cert). Signature header `x-cloudshare-signature` = **HMAC-SHA256, base64**, over the body using an **account-level secret that cannot be rotated/regenerated**. **No custom headers** can be added; payload has no unique event ID (only Event / CreatedAt / Attempt). Accelerate env events: `environment.created|suspended|resumed|deleted|extended|archived`. Docs: <https://support.accelerate.cloudshare.com/hc/en-us/articles/44003785338641-Webhooks>
- **Framing:** CloudShare pages set **no `X-Frame-Options`** but CSP **`frame-ancestors 'self' *.ci.cloudshare.com accelerate.cloudshare.com`** (confirmed across the sponsored-link 302, `SponsoredLogin` 302, and `CsClient.mvc` viewer in the HAR). Only CloudShare's own domains may iframe the lab.
- Other refs: v4 docs <https://cloudshare.stoplight.io/>; Postman public workspace `cloudshare-api/cloudshare-public-apis` holds v3 + v4 auth pre-request scripts (the share pages are client-rendered).

---

## 6. Suspend / resume ↔ exam-timer synchronization

The Kryterion simulator owns the **authoritative exam clock**; **CloudShare environment state drives pause/resume.**

- **Explicit suspend (clean path):** candidate clicks suspend → call suspend → confirmed `Suspended` → pause timer. Resume is the same control → resume → poll until `Resumed` → reopen the lab to the preserved session. State changes detected via webhook hint + polling as source of truth.
- **Confirmed gap — leaving without suspending:** closing the tab/browser or logging out **does not** suspend the environment; it keeps running (and billing). Long-standing, raised with R&D, unresolved. Must be documented to users ("stepping away? suspend first").
- **Agreed mitigation — heartbeat auto-suspend (build it):** while an exam is active, the portal page sends a heartbeat to our server every few seconds. If heartbeats stop for ~30–60s (tab closed, crash, network loss, logout), the **server proactively suspends the environment and pauses the timer.** `navigator.sendBeacon` on `pagehide`/`visibilitychange` is a best-effort fast path; the heartbeat timeout is the reliable backstop.
- **Embedding — DECIDED: child-window/popup is mandatory.** The `frame-ancestors` CSP (Section 5) excludes our portal, so an iframe embed is browser-blocked. The lab is also cross-origin (`use.cloudshare.com`), so even if framed we could not read its DOM/events. Liveness therefore comes only from the **portal heartbeat + polling CloudShare state**, never from inside the lab page. Implement via `window.open` + a retained handle, watching `childWindow.closed`.

---

## 7. CloudShare API gap report (deliverable — running list)

Verify and extend against the live tenant during implementation.

1. **Dual, inconsistent auth.** v4 bearer (5-min TTL) vs v3 OAuth1 `cs_sha1` with dated SHA1 HMAC and a single-use 60s token. Two models, two doc sites, mid-migration.
2. **Webhook secret cannot be rotated/regenerated** and is account-level (shared across all webhooks) — no per-integration secret, no rotation story.
3. **Webhooks unreliable, no custom headers, no unique event ID** — consumers must poll for truth, synthesize idempotency keys, and correlate via `environmentExternalId`.
4. **Close-tab / logout does not suspend the environment** — it keeps running and billing. Long-standing and unresolved; the portal-side heartbeat is our mitigation.
5. **Suspended state preserved only ~2 hours** — after that a full re-provision is required, so resume-to-exact-place isn't guaranteed after a long gap.
6. **Lab cannot be iframed by third-party portals** — `frame-ancestors` allow-lists only CloudShare's own domains. Relevant to Kryterion's "embed in secure browser" goal; a customer domain would need adding to the allow-list.
7. **Certification scoring is weak today** — bitmap-based checkpoints (visual-state comparison), end-state only (no process-level capture), deterministic script-based verification not GA until Q3 2026.
8. **Doc fragmentation / timing ambiguity** — the discovery email says the experience must be created 5 hours before login; the meeting notes say 1 hour. Verify the real pre-provision SLA against the API.
9. **Registration friction** — secure use requires "Registered Students Only" + Add-Student before the sponsored link, or login is denied; the convenient "Any Students" mode is insecure (URL/passphrase shareable).
