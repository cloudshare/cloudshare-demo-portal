# CloudShare API Gap Report

Living document tracking observed gaps between the CloudShare API's behaviour and the
requirements of a high-integrity certification/proctoring integration. Seeded from
discovery sessions and implementation experience; later slices should append new gaps
in the format below.

**How to append a gap:** copy the [gap template](#gap-template) at the bottom, assign
the next `GAP-N` identifier, and fill in the five fields. Commit alongside the slice
PR that surfaced the gap.

---

## Current contract reconciliation (2026-10-28, #474)

The [closeout inventory](../discovery/2026-10-28-v4-migration-closeout.md) records fresh official
Infrastructure, Experience, Classic v3 and Introduction source URLs/hashes and all production
consumers after A–D merged. Infrastructure is byte-identical to the preserved 2026-10-26 export.
Projects/Policies, Environment list/detail, Suspend/Resume and default Extend are now v4.
Remaining v3 calls are Archive, Blueprint/default Snapshot, VMware Regions, Teams, active Project
members, timezones and ping. Current Classic documentation still omits Archive and the active
`/users` GUI query; published Teams GET omits the existing query parameters. These remain explicit
published-contract gaps supported only within their earlier verified tenant evidence. No fresh
tenant behavior or universal absence of other APIs is inferred from documentation retrieval.
Inbound webhooks are separate; no automatic outbound registration is shipped. Dated reports below
retain the transport and acceptance state at their own observation time.

## Dated observation: #472 suspend/resume QA (2026-10-27)

This is bounded verification evidence, not a new provider-contract discrepancy or closure of any
existing GAP. At unchanged runtime head `7756114f81f8276362cf547f6b07a356921eae72`, the original
real UI flow produced Suspend 3 / Resume 2 with 204 and authoritative readbacks. A separate
coordinator-authorized API preservation Suspend returned 204 then exact GET confirmed Suspended.
Reported human viewer interaction does not establish causation of the earlier provider Ready/local
Suspended discrepancy; no provider bug is inferred. No original timing was rewritten.

Two Chrome connection failures sent no additional commands during those attempts; original console
captures remained incomplete. A later authorized isolated replacement UI flow produced its own
Suspend 3 / Resume 2, all 204, with clock pauses 62728, 130782 and 185978 ms and Ready resume
readbacks retaining elapsed time. Explicit Suspend, post-timeout Home and logout settled consoles
each captured zero warnings/errors, independently completing the three missing gates. Initial
heartbeat 409 preceded settled admission and later 200. Stage 0's extra `fdprocessedid` attributes
were absent from HTTP/source and appeared on a neutral script-free form in the same browser;
only this demonstrated browser-side signature and the independently seen extension-source error
received environmental attribution. Injector/timing remain unknown; no all-zero-console claim.

Original real Support UI success and synthetic invalid-ID GET 400 diagnostics remain evidence;
foreign Customer attempt API access returned 404. The synthetic 400 is not valid-missing provider
404 behavior. Coordinator option 2 accepts unchanged Archive via independent exact-head audit and
58/58 automated checks; current-ticket live Archive count is zero. Historical B evidence and
unrelated GAP statuses remain unchanged.

The replacement used 65 migrations and copied existing identities into an isolated DB; the temporary
same-Candidate credential was restored, original DB/hash unchanged. Final exact provider/local
state was Suspended, clock paused 185978 ms, pending/session zero; server/jobs stopped and browser
cleanup recorded. See the [acceptance matrix and preservation record](../discovery/2026-10-26-suspend-resume-v4-migration.md)
for chronology, evidence hashes and distinct original/replacement expiry. Experience End does not
prove automatic suspension, nor do retained records guarantee extended retention. Final review and
lifecycle disposition remain required; no merge or unrelated gap closure is claimed.

---

## GAP-16 — Sales timezone catalogue and edit semantics require live confirmation

| Field | Detail |
|---|---|
| **Status** | Documented contract implemented; live validation pending #356 QA |
| **Verified live** | No |

**Observed behaviour**

The documented v3 timezone catalogue is `GET /api/v3/timezones` (implemented at the
CloudShare adapter seam as `GET /timezones` against the configured v3 base URL). The
v4 OpenAPI export dated 2026-07-10 documents `GET /sales/{id}` and `PUT /sales/{id}`.
Certalis limits its future edit surface to the provider-visible name and explicit
schedule/timezone values; it does not infer lifecycle operations or invoke any
undocumented Sales endpoint.

**Follow-up live evidence required**

Verify the exact returned timezone shape and the PUT validation/lifecycle matrix in
the Helios CX tenant before exposing live editing controls. The browser never receives
the CloudShare Sales Experience ID; support diagnostics retain the direction-aware exchange.

---

## GAP-1 — Dual, inconsistent authentication schemes

**Jira tracking:** [BAC-26387](https://cloudshare.atlassian.net/browse/BAC-26387)

| Field | Detail |
|---|---|
| **Status** | Confirmed — implemented in `src/integrations/cloudshare/` |
| **Verified live** | Yes |

**Observed behaviour**

The CloudShare platform exposes two distinct API surfaces with incompatible
authentication:

- **v4 (Accelerate)** uses OAuth 2.0 `client_credentials` and expects a short-lived
  Bearer JWT (`Authorization: Bearer <token>`, ~5-minute TTL).
- **v3 (Production/Classic)** uses a proprietary per-call HMAC signature scheme
  (`cs_sha1`): the request is signed into the `Authorization` header as
  `cs_sha1 userapiid:<id>;timestamp:<ts>;token:<nonce>;hmac:<sha1>`, where the
  `token` nonce is exactly **10 alphanumeric characters**, and the HMAC is the lowercase-hex SHA-1 of the concatenation
  `apiKey + fullUrl + timestamp + token`. The API key is folded into the hash and
  never sent on the wire.

Both surfaces are required for a full integration: v4 for lab provisioning
(`/experiences`, `/students`, `/sponsoredLinks`); v3 for environment state polling
(`/environments`) and resource sync (`/regions`).

**Impact on certification use**

- The portal must maintain two separate credential stores, token-refresh loops, and
  signing paths.
- The token cache for v4 must refresh aggressively (before 300 s) to avoid mid-session
  expiry during a proctored exam.
- Any future API migration that consolidates onto a single scheme requires changes
  isolated in `src/integrations/cloudshare/client.ts`, `v4-auth.ts`, and `signing.ts`.

**Code reference:** `src/integrations/cloudshare/client.ts:15-16`,
`src/integrations/cloudshare/v4-auth.ts`, `src/integrations/cloudshare/signing.ts`

**Update (2026-06-13, verified via Postman console):** the API ID + API key are a **single
credential pair** — the same values are the v4 `client_id`/`client_secret` *and* the v3
`UserApiId`/`apiKey`; only the per-request mechanism differs. This softens the "two credential
stores" impact to one stored pair (see ADR-001). Also corrected: the v4 base host is
`https://api.accelerate.cloudshare.com/v4` and the provisioning resource is `/v4/trainings/{id}`
(not `use.cloudshare.com/api/v4` or `/experiences`, as the current code has it). The live v3 ping
request uses the `Authorization: cs_sha1 ...` header, not signed query parameters.

**Update (2026-06-14, verified against live ping and Postman implementation):** the v3 `token`
must be exactly **10 alphanumeric characters**. A UUID-shaped nonce is rejected by CloudShare even
when the API ID/key and HMAC formula are otherwise correct.
---

## GAP-2 — Webhook secret is account-level and cannot be rotated

**Jira tracking:** [BAC-26399](https://cloudshare.atlassian.net/browse/BAC-26399)

| Field | Detail |
|---|---|
| **Status** | Confirmed — noted in discovery |
| **Verified live** | No |

**Observed behaviour**

CloudShare issues a single webhook signing secret at the account level. There is no
documented API endpoint or portal UI to rotate or regenerate the secret after initial
provisioning.

**Impact on certification use**

- Secret compromise requires a support ticket or account-level intervention, not a
  self-serve rotation — creating a window of exposure in a high-integrity exam context.
- Because all environments in the account share the same secret, a compromise affects
  every integration simultaneously.
- The portal stores the secret on the encrypted per-Customer `CloudShareConnection` and never logs
  it. The legacy global `CLOUDSHARE_WEBHOOK_SECRET` remains transitional config only; webhook
  verification now selects the resolved Customer's stored secret.

**Code reference:** `src/integrations/cloudshare/webhooks.ts:11`,
`src/domain/cloudshare-connection.ts`,
`src/persistence/cloudshare-connection-repository.ts`

---

## GAP-3 — Webhooks are unreliable: no custom headers, no unique event ID

**Jira tracking:** [BAC-26410](https://cloudshare.atlassian.net/browse/BAC-26410)

| Field | Detail |
|---|---|
| **Status** | Confirmed — design decision in Slice 6; `CreatedAt` and delayed archive delivery semantics corrected from live QA |
| **Verified live** | Partial — `CreatedAt` behaviour and delayed archive delivery observed live on 2026-06-24; delivery retry guarantees still unverified |

**Observed behaviour**

CloudShare webhook deliveries have four known reliability problems:

1. **No unique event ID or event timestamp per delivery.** There is no `eventId` or
   idempotency key in the payload or headers. Live QA also confirmed that the envelope
   `CreatedAt` value is the creation time of the CloudShare webhook definition, not the
   lifecycle event occurrence time. Different event types from the same webhook
   configuration can share the same `CreatedAt`, so it is not usable for ordering,
   freshness checks, or hard idempotency.
2. **No custom header support.** Callers cannot add custom metadata headers (e.g., a
   per-tenant routing key or a delivery ID). The only authentication signal is the
   HMAC signature in `x-cloudshare-signature` (header name unverified — assumption).
3. **Delivery is best-effort.** Missed events are not replayed; the portal must treat
   webhooks as "hints" and treat the result of polling `GET /environments` as the
   authoritative state. Any synthesized key that includes `CreatedAt` is support evidence
   only, not a processing gate.
4. **Lifecycle webhook delivery can lag portal state transitions.** Live QA on
   2026-06-24 showed an exam attempt completing at `2026-06-24T19:45:24.897Z` by portal
   runtime reconciliation, while the matching CloudShare `environment.archived` webhook
   for environment `ENN_FkNYEmuHdXixiVS-Kfcw2` arrived at `2026-06-24T19:59:22.674Z`
   — approximately 13m58s later. Completion workflows must not rely on archive webhook
   timing.

**Impact on certification use**

- A candidate exam session that misses a `suspended`, `resumed`, or `archived` event risks
  the portal timer or launch page going out of sync with the lab state.
- The portal mitigates this by making webhooks hints only: all state changes are
  confirmed by a follow-up poll of `GET /environments`, which is the source of truth.
- Duplicate/out-of-order events are safe because reconciliation is idempotent, and verified
  lifecycle webhooks are still accepted even when their diagnostic fingerprint repeats.
- Admin diagnostics should retain the event type, environment id, raw body hash, and
  synthesized fingerprint for support evidence, but must not present `CreatedAt` as the
  event creation time.
- When the portal completes an attempt by its own runtime clock, diagnostics must record an
  immediate authoritative CloudShare environment poll so support can distinguish "completed,
  CloudShare still running/suspended" from "completed, archive webhook arrived later".

**Code reference:** `src/integrations/cloudshare/webhook-receiver.ts`,
`src/domain/webhook.ts`, `src/domain/environment-reconcile.ts`

---

## GAP-4 — Close-tab or browser logout does not suspend the environment

| Field | Detail |
|---|---|
| **Status** | Confirmed — mitigated by heartbeat in Slice 8 |
| **Verified live** | Yes (observed during discovery) |

**Observed behaviour**

When a candidate closes the browser tab containing the CloudShare lab, or when the
sponsored-link session expires/logs out, the CloudShare environment continues running.
CloudShare does not expose a server-side callback or idle-detection mechanism that the
portal can rely on to trigger an automatic suspend.

**Impact on certification use**

- An unattended running environment during a proctored exam breaks the suspend/resume
  contract the Kryterion timer depends on: the timer would be paused but the lab would
  remain live.
- Resource leak: environments left running consume capacity and incur billing.
- The portal mitigates this with a client-side heartbeat (`POST /api/heartbeat` every
  15 s) and a `sendBeacon` call on `pagehide`/`visibilitychange`. A server-side
  `HeartbeatAutoSuspend` service triggers `suspendEnvironment` after 60 s without a
  heartbeat.

**Code reference:** `src/web/lab-launcher.tsx`,
`src/domain/heartbeat-auto-suspend.ts`, `src/api/heartbeat.ts`

---

## GAP-5 — Suspended environments are preserved for approximately 2 hours only

| Field | Detail |
|---|---|
| **Status** | Confirmed — noted in discovery |
| **Verified live** | No (figure from discovery session; exact value not confirmed via API) |

**Observed behaviour**

CloudShare preserves the state of a suspended environment for approximately 2 hours.
After that window, the environment is archived or deleted and resume is no longer
possible.

**Impact on certification use**

- A certification exam that requires a candidate to pause and return later (break,
  connection loss, proctor hold) risks environment loss if the gap exceeds ~2 hours.
- The portal must inform the candidate of this constraint at the point of suspend and
  must surface an appropriate error if resume is attempted against an archived
  environment.
- Exact retention policy (whether 2 hours is configurable per account/blueprint) should
  be verified with CloudShare before GA.

---

## GAP-6 — Labs cannot be embedded in a third-party portal via `<iframe>`

| Field | Detail |
|---|---|
| **Status** | Confirmed — observed via browser developer tools |
| **Verified live** | Yes (observed during discovery) |

**Observed behaviour**

CloudShare's lab UI sets `Content-Security-Policy: frame-ancestors 'none'` (or
equivalent `X-Frame-Options: DENY`), preventing the lab from being embedded in an
`<iframe>` hosted on a third-party origin such as this portal.

**Impact on certification use**

- The portal cannot render the lab inline alongside a proctoring UI element; the
  candidate must work in a separate browser window/tab.
- The `LabLauncher` component uses `window.open` to launch the sponsored link in a
  child window and polls `childWindow.closed` for close detection; `sendBeacon` is
  used on `pagehide`/`visibilitychange` as a fallback.
- Any design that assumes embedded lab rendering (e.g., side-by-side proctor + lab
  view) must be redesigned to work with a separate window model.

**Code reference:** `src/web/lab-launcher.tsx`, `src/web/lab-window.ts`

---

## GAP-7 — Certification scoring is weak: bitmap checkpoints, end-state only

**Jira tracking:** [BAC-26417](https://cloudshare.atlassian.net/browse/BAC-26417)

| Field | Detail |
|---|---|
| **Status** | Confirmed — implemented in `src/integrations/cloudshare/guided-journey.ts` |
| **Verified live** | Partially (feature exists; limitations from documentation and Q3 2026 roadmap) |

**Observed behaviour**

CloudShare Guided Journey scoring has three significant product limitations:

1. **Bitmap checkpoints only.** Scoring uses visual-state comparison (screenshot diff)
   rather than process-level or OS-level capture. A candidate can reach the correct
   visual state by an unintended method and still receive credit.
2. **End-state verification only.** Intermediate steps and the approach taken are not
   assessed. Only the final state of the environment matters for scoring.
3. **Deterministic script-based verification is not generally available until Q3 2026.**
   Per CloudShare roadmap, a more reliable script-driven verification mode is not GA
   until Q3 2026.

In addition, live QA on Slice 7 contradicted an earlier adapter assumption: the previously modelled
participant-list path `GET /v4/experiences/{id}/journey/participants` is not the correct v4
Guided Journey score endpoint for this tenant. The working v4 path is:

- `GET /v4/guided-journey/progress/{experienceId}/{participantId}`

The endpoint is participant-specific and requires the CloudShare participant id from the v4
training-students correlation flow, not the candidate email address. That participant id is now
persisted on `LabLaunch.participantId` when environment/participant correlation runs, with a
score-retrieval fallback that re-lists training participants for older launches that predate the
new field.

The response shape also appears to be a participant-progress document with fields such as
`progressRate` plus section/step statuses, not the earlier inferred `{ participants: [...] }`
envelope.

**Update (2026-06-19, live Guided Journey QA):** the live tenant returned a payload shaped like:

- `sectionStatuses[]` rather than `sections[]`
- section status strings such as `explored` and `inProgress`
- raw rate fields:
  - `exploredRate`
  - `inProgressRate`
  - `notStartedRate`
  - `passedRate`
  - `failedRate`
  - `notInitiatedRate`

The portal now renders these raw rates directly instead of inferring a synthetic certification
score. In particular, live QA suggests `passedRate` and `failedRate` may **not** sum to `1.0`
because CloudShare divides AI checks by sections and some sections may have no checks at all.
Treat these as Guided Journey progress signals, not a definitive certification pass/fail result.

**Update (2026-07-04, Candidate score review):** the participant Guided Journey
progress response still does not expose the scoring evidence a certification workflow
would need for per-question review. The portal can show aggregate pass/fail/progress
rates and the final state for listed Guided Journey sections, but the observed API
response does **not** indicate:

- which individual questions/checkpoints belong to a section;
- whether a checkpoint was enabled for scoring;
- whether each checkpoint passed, failed, or errored;
- enough chapter/section identity to disambiguate otherwise similar response entries.

Related CloudShare bug: [BAC-24813](https://cloudshare.atlassian.net/browse/BAC-24813)
tracks the v4 Guided Journey issue where both endpoints provide no chapter indication
in the response body and appear to return identical information across multiple
sections. Until CloudShare exposes checkpoint-level scoring evidence, the portal must
avoid presenting section rows as question-level pass/fail diagnostics.

**Impact on certification use**

- Score retrieval must be keyed by the correlated CloudShare participant id, so missing or stale
  participant correlation is now a supportable retrieval failure rather than a misleading "no score".
- The portal now maps the participant-progress payload to the candidate score UI by
  showing raw Guided Journey rates plus section progress, while avoiding any fake composite
  certification score.
- Candidate-facing score rows are not question-level diagnostics; they cannot prove which
  checkpoint passed, failed, errored, or was enabled.
- Final certification pass/fail weighting is determined outside this portal's Guided Journey view.
- These limitations must be disclosed to the exam author when configuring checkpoints.

**Code reference:** `src/integrations/cloudshare/guided-journey.ts`,
`src/domain/environment-correlation.ts`, `src/api/score.ts`

---

## GAP-8 — Documentation is fragmented; pre-provision SLA is ambiguous (UNVERIFIED)

**Jira tracking:** [BAC-26418](https://cloudshare.atlassian.net/browse/BAC-26418)

| Field | Detail |
|---|---|
| **Status** | Unverified — conflicting data from discovery |
| **Verified live** | No — requires live API/support confirmation |

**Observed behaviour**

Two conflicting figures for environment pre-provisioning lead time appear in
CloudShare discovery materials:

- **5 hours** — stated in a follow-up email during discovery (2026-06-07).
- **1 hour** — stated in handwritten notes from the same discovery session.

Beyond the SLA conflict, the CloudShare API documentation is fragmented across
multiple portals (Accelerate v4 API reference, Classic/Production v3 reference,
and an Experience Portal guide), with no single unified reference. Endpoint paths,
field names, and auth schemes are documented in different places and may be
inconsistent.

**Impact on certification use**

- If the portal pre-provisions labs in advance to reduce candidate wait time, it
  must schedule provisioning with the correct lead time to avoid either wasted
  resource-hours (provisioning too early) or candidate-facing delays (too late).
- Known documentation gaps tracked as code assumptions in this codebase:
  - `x-cloudshare-signature` header name (webhooks) — verified live on 2026-06-20.
    CloudShare signs the exact raw request body with HMAC-SHA256 and sends the
    base64 MAC in this header. Signature diagnostics must compare against the
    raw request body bytes as received, not a parsed or re-serialised JSON body.
  - Webhook payload field names were previously under-specified. Current docs indicate top-level
    `Event`, `CreatedAt`, `CreatedById`, `CreatedByEmail`, `Attempt`, and nested `Payload`.
  - `GET /environments?externalId=...` path for resolving environment by external ID — unverified.
  - `POST /environments/{id}/actions/suspend` and `…/resume` paths — unverified.
  - Guided Journey progress response field names beyond the currently tolerated
    `progressRate` / section-status shape — partially verified.

**Action required:** Confirm the pre-provision SLA directly with CloudShare support or
by timing a live provisioning call. Update this entry with the confirmed value.

**Code reference:** `docs/discovery/2026-06-07-follow-up-email.txt`,
`src/integrations/cloudshare/environment.ts:11-15`,
`src/integrations/cloudshare/webhooks.ts:14-26`,
`src/integrations/cloudshare/environment-controller.ts:9-15`,
`src/integrations/cloudshare/guided-journey.ts`

**Update (2026-06-13):** hosts now confirmed — v4 `https://api.accelerate.cloudshare.com/v4`
(Bearer, `expires_in: 300`); v3 `https://use.cloudshare.com/api/v3` (`cs_sha1` via
`Authorization` header); sponsored-link `loginUrl` host `use.cloudshare.com`
(`/Ent/Course.mvc/ClassSponsoredLink/{id}`). Live v3 ping response shape confirmed as JSON
`{"result":"Pong"}`. Still **unverified**: the pre-provision SLA value, broader v3
infrastructure response shapes, the v4 training-creation body, webhook payload field names, and
Guided-Journey-absent (404) behaviour.

---

## GAP-9 — Registration friction: "Registered Students Only" gate blocks direct login

**Jira tracking:** [BAC-26419](https://cloudshare.atlassian.net/browse/BAC-26419)

| Field | Detail |
|---|---|
| **Status** | Confirmed — implemented in `src/integrations/cloudshare/labs.ts` |
| **Verified live** | No (modelled from documentation) |

**Observed behaviour**

CloudShare experiences created with `RegisteredStudentsOnly` visibility require that
each candidate's email address is explicitly added to the experience's student roster
via `POST /experiences/{id}/students` before the sponsored login link is generated via
`POST /experiences/{id}/sponsoredLinks`. Without this step, accessing the sponsored
link results in a login-denied or access-denied error.

**Impact on certification use**

- The portal must perform two sequential API calls per lab launch: add-student then
  create-sponsored-link. If add-student fails, the launch must be aborted before the
  link is ever generated.
- The `createCloudShareLabProvisioner` adapter implements this two-step flow; the
  `createSponsoredLink` use case runs add-student first.
- `RegisteredStudentsOnly` is the assumed visibility value for exam-scoped experiences;
  this must be confirmed against the live API.
- The student-registration step is idempotent on re-launch (the API should handle a
  duplicate add gracefully), but this behaviour should be confirmed.

**Code reference:** `src/integrations/cloudshare/labs.ts:18-20`,
`src/domain/lab-launch.ts`

---

## GAP-10 — Resource reads are project-first, with global Regions and Blueprint-owned Snapshots

**Jira tracking:** [BAC-26388](https://cloudshare.atlassian.net/browse/BAC-26388)

| Field | Detail |
|---|---|
| **Status** | Confirmed / partially verified — from CloudShare admin and live v3 resource probing |
| **Verified live** | Partial (resource scoping verified; some response shapes still pending) |

**Current update (2026-10-26, #468 / PR #470):** Project and Policy discovery now use the published
v4 Infrastructure contract. Independent QA on `e11d67447d691b085165f38eb180f1c155c8c1e2` exercised
real Exam and Sales authoring controls: selected exact Project/Policy identities, saved disposable
local catalog records, reopened/refreshed and verified selected-resource validation. Exam runtime
20160, storage 43200 and manually authored open period 21000 minutes stayed distinct; Sales default
1440 minutes came from Policy storage. A disposable same-origin form submitted the shipped Sync
Resources handler (there is no current Resources tab), returning 2 Projects, 3 Regions, 4 Blueprints
and 4 Policies. Acceptance-tab console contained zero warnings/errors; relevant live checks passed
3/3. Full details: [migration evidence](../discovery/2026-10-26-project-policy-v4-migration.md).

Protected Support showed a real v4 Policy-detail GET/200 with verbatim timing evidence and masked
authorization. An authorized invalid-key UI save in the isolated QA Connection produced a real
OAuth-token prerequisite 403 with `failureMode: http_failure`; ordinary UI stayed generic. QA
restored valid credentials through UI and confirmed connection testing/Projects recovery. This is
OAuth failure evidence, not a live Projects-endpoint error-response test.

Exact v4 Project ids were accepted unchanged by retained v3 Blueprint browser reads, Sales
Project-member preflight and direct Team GET (200, one Team). No Experience was created: write
compatibility is static code/test mapping only. Live Policy results were consistent with active-only
listing, but exclusion of a known inactive Policy was not provable with available assets. Team
Member permission-empty responses remain contract/fixture evidence; no suitable credentials or
new authorization were used. No provider resource mutation occurred. Region, Blueprint/default-
Snapshot, Teams, members, timezones, ping and Environment operations retain their existing transports.

**Historical observations and actions (before the 2026-10-26 migration):** The original v3 findings
below explain the earlier implementation; they do not describe the current Project/Policy transport
or imply a current Resources tab.

**Observed behaviour**

CloudShare v3 resource endpoints are unevenly scoped:

- **Region** is effectively platform-global. `GET /api/v3/regions` currently returns the same shared
  Region set for the tenant regardless of Project. The portal should treat Regions as a global,
  refreshable reference list rather than hard-coding them.
- **Policy** is Project-scoped for portal behavior. The documented endpoint is
  `GET /api/v3/projects/{projectId}/policies`. `GET /api/v3/policies` may return visible Policies
  across Projects for the current CloudShare Connection, but this is treated as an undocumented
  convenience surface and not the primary contract.
- **Blueprint** is Project-scoped for portal behavior. The relevant endpoint is
  `GET /api/v3/projects/{projectId}/blueprints`.
- **Snapshot** should not be modelled as a global top-level resource list. Snapshot selection should
  come from Blueprint detail for the selected Project + Blueprint path, including default-Snapshot
  information. CloudShare v3 exposes Snapshot-specific endpoints, but the portal should model
  Snapshot discovery as part of Blueprint selection.
- **Project Members / Instructor choices** are expected to be Project-scoped, but the exact v3 read
  surface is still unconfirmed. Slice 2 therefore keeps Instructor fixed to an explicitly
  configured seeded service-account member instead of presenting an unverified Project-member picker.

Training/Experience creation, add-participant, sponsored-link, list-students, and Guided Journey are
v4 (`api.accelerate.cloudshare.com`). CloudShare intends to move more environment-management /
infrastructure endpoints to v4 over time.

**Impact on certification use**

- Provisioning is a chained **v3 (read infra) + v4 (write experience)** workflow.
- Exam authoring must be **Project-first**, not global-resource-first: sync/list Projects, sync/list
  global Regions, select a Project, then fetch or read cached Project-scoped Blueprints, Policies,
  later Project Members / Instructor choices, and selected Blueprint detail including Snapshots and
  the default Snapshot.
- The current admin Resources tab is a stopgap sync surface for early integration evidence. It should
  not become the long-term model of syncing all visible Project-scoped objects across all Projects by
  default.
- All endpoint/path/shape assumptions for Projects, Regions, Policies, Blueprints, Snapshots, and
  related infrastructure reads must remain isolated inside `integrations/cloudshare`, so a future
  v3-to-v4 migration is localized to the adapter.

**Action required:** confirm the exact v3 response shapes for Project-scoped Policies, Project-scoped
Blueprints, Blueprint detail including Snapshots and default-Snapshot fields, and any Project
Members / Instructor read surface. Update this entry immediately when live tenant behavior
contradicts the current model.

**Update (2026-06-14, live v3 probe against local E2E credentials):** `GET /api/v3/projects`,
`GET /api/v3/regions`, `GET /api/v3/projects/{projectId}/policies`,
`GET /api/v3/projects/{projectId}/blueprints`, and
`GET /api/v3/projects/{projectId}/blueprints/{blueprintId}` all returned `200`. The observed
shapes were broader than the current minimal adapter schema:

- Project items included at least `id`, `name`, `isActive`, and `message`.
- Region items included at least `id`, `name`, `friendlyName`, and `cloudName`.
- Project-policy list items included at least `id`, `name`, `projectId`, and `allowEnvironmentCreation`.
- `GET /api/v3/projects/{projectId}/policies/{policyId}` returned `200` and included
  `runtimeLeaseMinutes`, `storageLeaseMinutes`, `environmentInactivityHandling`,
  `allowSuspendLease`, and related lease/inactivity fields. Slice 2 should use
  `runtimeLeaseMinutes` as the exam time-limit source instead of a freeform admin override.
- Project-blueprint items included at least `id`, `name`, `description`, `resources`,
  `numberOfMachines`, `hasMultipleVersions`, `hasDefaultVersion`, and `regionId`.
- Blueprint detail did **not** expose a top-level `snapshots[]` field. Snapshot/version selection is
  carried in `createFromVersions[]`, where each version included at least `id`, `name`, `isDefault`,
  `isLatest`, `number`, `resources`, `createTime`, and `regions`.
- `createFromVersions[].regions` is not stable to a single shape. In the current tenant it may arrive
  either as region objects (with `id` / `name`) or as raw region-id strings. The adapter must accept
  both and normalize them to portal `regionIds`.
- `createFromVersions[].description` is not reliably non-empty. Live tenant Blueprint detail for
  `Windows Boxes` returned `description: ""` on every version row while the rest of the payload was
  valid. The adapter must allow blank version descriptions instead of treating the whole Blueprint
  detail response as malformed.
- For **experience-based** launches, CloudShare uses the Blueprint's **default** version/Snapshot.
  The portal should treat Blueprint detail as visibility into that default, not as proof that it can
  choose any arbitrary non-default version when launching an Experience. Selecting a non-default
  version applies to custom environment creation outside the Experience flow, not the Exam launch
  path this portal uses.

This confirms the Project-first authoring model and corrects the earlier placeholder fixture shape:
the adapter should derive portal Snapshot choices from Blueprint detail `createFromVersions[]`, not
from an invented top-level `snapshots[]` field.

**Update (2026-07-06, live v3 probe plus v4 diagnostics):** the current Helios seed tenant returned
one stable default Snapshot on two consecutive reads of
`GET /api/v3/projects/PRCU02uuokHPBfjMedkmradg2/blueprints/BPxssLIWyy1g34xD9fcBYxsA2`:
`SS0v3Q_3u5_DNPY536jXMKdg2`. Local v4 diagnostics for `POST /trainings` and
`GET /trainings/{id}` exposed `BlueprintIds` / `blueprintIds` only and did **not** expose any
Snapshot/version identifier. That means the public/API-observable contract gives Certalis no
Snapshot pin to trust at Candidate allocation time. The portal must therefore re-read the current
Blueprint default Snapshot at Candidate enter / Cohort join time and block if it differs from the
saved Exam Snapshot or if the lookup fails unsafely. A hidden server-side pin remains an open
caveat until CloudShare documents or disproves it, but the portal cannot assume one from current
evidence.

**Update (2026-06-14, live v3 probe for Project Members):** the following candidate Project-member
read endpoints all returned `404` against the current tenant:
`GET /api/v3/projects/{projectId}/members`,
`GET /api/v3/projects/{projectId}/projectmembers`,
`GET /api/v3/projects/{projectId}/instructors`, and
`GET /api/v3/projects/{projectId}/team-members`.
Do not build a Project-member picker around guessed paths. For Slice 2, keep Instructor fixed to an
explicitly configured seeded service-account member and fail authoring if that configuration is
still the placeholder default.

---

## GAP-11 — Project-member RBAC permissions are not retrievable via API

**Jira tracking:** [BAC-26389](https://cloudshare.atlassian.net/browse/BAC-26389)

| Field | Detail |
|---|---|
| **Status** | Confirmed — from CloudShare admin |
| **Verified live** | No |

**Observed behaviour**

The Connection's API ID/key belongs to a **project member** with a role (Project Manager / Team
Manager / Team Member) and per-project custom permissions. There is no reliable API to read those
permissions, and the same role can carry different permissions in different projects.

**Impact on certification use**

- An under-privileged service account fails operations (create training, add participant, read
  journey) at runtime with no pre-flight check. Mitigate with actionable errors, the v3
  Test-connection probe, and documenting the required role.

---

## GAP-12 — No v4 health/ping probe

**Jira tracking:** [BAC-26390](https://cloudshare.atlassian.net/browse/BAC-26390)

| Field | Detail |
|---|---|
| **Status** | Confirmed — from CloudShare admin |
| **Verified live** | Partial (v3 ping exists; v4 requested, not available) |

**Observed behaviour**

v3 exposes a simple `ping` → `pong`; v4 has no equivalent health endpoint (requested of CloudShare,
not yet shipped). Connection validation must therefore use the **v3 `ping`**.

---

## GAP-13 — No API to detect whether a Guided Journey exists for an experience

**Jira tracking:** [BAC-26391](https://cloudshare.atlassian.net/browse/BAC-26391)

| Field | Detail |
|---|---|
| **Status** | Confirmed — from CloudShare admin |
| **Verified live** | No (404 behaviour assumed) |

**Observed behaviour**

A Guided Journey is an **optional** experience component configured in CloudShare before the
experience is created. There is no API to discover whether one exists, or what it contains.
Requesting participant progress for an experience without a journey likely returns a 404.

**Impact on certification use**

- The portal gates score retrieval on a **per-Exam admin flag** and handles a 404 defensively as
  "no score available".

---

## GAP-14 — Environment webhook payload omits the experience/training reference

**Jira tracking:** [BAC-25011](https://cloudshare.atlassian.net/browse/BAC-25011) (authoritative); [BAC-26456](https://cloudshare.atlassian.net/browse/BAC-26456) (duplicate record)

| Field | Detail |
|---|---|
| **Status** | Confirmed — from CloudShare admin |
| **Verified live** | No |

**Observed behaviour**

CloudShare's current webhook docs describe a top-level envelope including `Event`, `CreatedAt`,
`CreatedById`, `CreatedByEmail`, `Attempt`, and nested `Payload`. For environment events, the
documented payload keys include `environmentExternalId`, `environmentName`, `blueprintId`,
`blueprintName`, `policyId`, `policyName`, `ownerEmail`, `cloud`, and `regionId` — but still **no
reference to the training/experience** the event belongs to.

**Update (2026-06-19, live webhook payload):** a real `environment.created` delivery used the same
top-level envelope, but sent `Payload` as a JSON string with PascalCase keys. It included
`EnvironmentId`, `EnvironmentExternalId:null`, `EnvironmentName`, `BlueprintId`, `BlueprintName`,
`PolicyId`, `PolicyName`, `OwnerEmail`, `Cloud`, and `RegionId`. The portal therefore parses both
the documented object-style payload and the live string/PascalCase payload, normalising to
`EnvironmentExternalId` when present and otherwise falling back to `EnvironmentId`.

**Update (2026-06-24, live QA correlation failure):** a real `environment.created` delivery for
attempt `398d2976-0e2e-44c1-992d-3b44723668bc` included `OwnerEmail` and `EnvironmentId`, but
`EnvironmentExternalId:null`. The payload `EnvironmentName` was the CloudShare environment/blueprint
display name (`Linux Environment with xRDP v2`), not the portal Exam title. Pending launch
correlation must therefore use the resolved Customer plus `OwnerEmail` plus the active uncorrelated
`LabLaunch`; it must not require `EnvironmentName` to match the portal Exam name.

**Impact on certification use**

- The documented environment webhook payload is still insufficient to correlate directly to a portal
  `ExamAttempt`; correlation still requires a **portal-owned `trainingId ↔ Candidate ↔ environmentId`
  mapping**, populated/reconciled via the v4 **list-students-in-a-training** endpoint.
- Webhooks become optional; **polling list-students / `GET environment` is the source of truth**.
  A synthesized key based on `(customerId, normalisedEnvironmentId, event, CreatedAt)` may
  be recorded as support evidence only. It must not suppress processing because live QA
  confirmed `CreatedAt` is the webhook definition creation time, not the event time.
- Slice 9 now parses the documented v3 webhook envelope plus the live JSON-string `Payload` variant.

**Update (2026-06-15, Slice 5 implementation assumption):** the exact response envelope for
`GET /v4/trainings/{trainingId}/students` is still unverified against the live tenant. The adapter
now isolates that uncertainty in `src/integrations/cloudshare/participants.ts` and accepts either a
top-level array or a wrapped `students`/`Students` array, with participant fields normalized from
either camelCase or PascalCase (`email`/`Email`, `environmentId`/`EnvironmentId`, `id`/`Id`).
`environmentId` is treated as nullable because it may remain absent until the candidate actually
logs in through the sponsored link. Live verification is still required to confirm the true
envelope and field casing.

**Update (2026-06-15, live QA failure):** a real candidate dashboard correlation run produced
`CloudShareResponseError` for `GET /v4/trainings/{trainingId}/students`, proving the earlier schema
was still too narrow. The adapter now also accepts wrapped `rows`/`Rows`/`items`/`Items`/`data`/`Data`
collections, nested participant identity fields such as `user.email`, `User.Email`,
`student.email`, `Student.Email`, and nested environment ids such as `environment.id` /
`Environment.Id`. Rows that still contain no usable participant email are now skipped instead of
failing the entire response, because they cannot be matched back to a portal Candidate anyway.
This is still an inference from live failure plus CloudShare naming conventions, not a fully
confirmed contract; verify the exact live envelope and participant field set on the tenant.

**Update (2026-06-15, live suspend/resume QA + v3 docs review):** the discovered participant
`environmentId` from `GET /v4/trainings/{trainingId}/students` is the actionable CloudShare
**envId** for suspend/resume and poll confirmation. Earlier code incorrectly treated the portal's
provisioning-time `environmentExternalId` as the runtime environment correlation key and polled a
guessed `GET /api/v3/environments?externalId=...` endpoint. The portal now persists the discovered
participant `environmentId` into the launch correlation record and uses documented v3 env
semantics:

- `PUT /api/v3/envs/actions/suspend?envId={envId}`
- `PUT /api/v3/envs/actions/resume?envId={envId}`
- `GET /api/v3/envs/{envId}` for authoritative state confirmation

This corrects the earlier endpoint assumption and explains why suspend/auto-suspend could fail
after a successful launch until the candidate's CloudShare `envId` had actually been discovered.

**Update (2026-06-19, docs correction):** current public CloudShare webhook docs point to the v3
Integration Hub / account-level contract, not a v4 experience-webhook surface. The portal should
not assume a v4 webhook tied directly to experience creation unless live evidence proves one.

**Update (2026-06-15, live suspend QA on fresh attempts):** `GET /v4/trainings/{trainingId}/students`
can expose a **pre-join placeholder** participant `envId` before the candidate has actually bound to
their runnable environment. In the live tenant this appeared as an `ENK...` id with
`participationStatus:"pending"` and `envStatus:null`; after the candidate entered CloudShare, the
same participant later reported an actionable `ENVS...` id with `participationStatus:"inProgress"`
and `envStatus:"ready"`. The portal must therefore treat `envId` as actionable **only when an
environment lifecycle signal is also present** (at minimum a non-empty `envStatus`), and it must be
able to replace an earlier placeholder correlation with the later active env id. Persisting the
first non-empty `envId` and never rechecking causes v3 suspend/resume to hit
`PUT /api/v3/envs/actions/{suspend|resume}?envId=...` with a placeholder id that returns `404
{"message":"Environment not found","code":"0x40402"}`.

**Update (2026-07-06, Issue #275 admin monitoring live verification):** a real admin read of
`GET /v4/trainings/EX0ZsJVCxxf6iEjZVt-YpC1Q2/students` for published Cohort Exam Session
`4b119722-3d0d-40a6-b031-b16e98b8c61c` confirmed the current live tenant returns a wrapped body with
`count` plus `items[]`, not a top-level bare array. The live row included
`id`, `firstName`, `lastName`, `email`, `participationStatus`, `firstJoined`, `envStatus`, and
`envId`. The portal's participant-read adapter and admin monitoring path therefore normalize both
participant identity and runtime status from that wrapped `items[]` shape while still tolerating the
broader envelope variants observed in earlier failures. This confirms `firstJoined`,
`participationStatus`, `envStatus`, and `envId` are present together on the current tenant for
monitoring, while preserving the earlier rule that `envId` is only actionable when accompanied by a
real lifecycle signal such as non-empty `envStatus`.

**Update (2026-07-06, issue #286 participant-correlation live probe):** direct live reads of
`GET /v4/trainings/EXto3q_Sf0jqPHm42GD2XLiw2/students` and
`GET /v4/trainings/EXkUygpfa1T3y5GtjqtUcLxQ2/students` confirmed the current tenant still returns the
wrapped `count` + `items[]` envelope and that each participant row includes a `customProperties`
field in the response shape, even when no custom keys are populated yet. On the observed tenant,
`customProperties` came back as an array-shaped value rather than a plain object, so the portal
adapter now normalizes both object and key/value-array bags. The observed row keys on this tenant
included: `id`, `email`, `firstName`, `lastName`, `participationStatus`, `firstJoined`,
`envStatus`, `envId`, `role`, `invitationStatus`, `markedAsComplete`, and `customProperties`.

The documented Sales Participant roster exposes `invitationStatus` and `invitedBy`, but no invitation-sent timestamp. Certalis therefore records nullable `lastInvitedAt` whenever its explicit invite or resend receives provider acknowledgement and an authoritative `sent` confirmation. Passive reconciliation never changes it; legacy sent rows remain null rather than deriving a fictitious time from `updatedAt`.

Certalis enforces lifecycle capability boundaries before provider or token mutation: ended Sales Sessions cannot register or repair participants, send invitations, or create/regenerate instant-launch links, and concluded participants cannot be invited or receive a new launch link. Revocation and read-only monitoring remain available for containment and support.
Both verified training IDs were `selfPaced`; an `instructorLed` read was not available to confirm on
2026-07-06. This means Cohort Exam Session monitoring can safely read explicit Certalis
participant-correlation values back from `customProperties` on this endpoint when later joins write
them.

---

## GAP-24 — No verified CloudShare API to resolve participant IDs by email across Experiences

**Jira tracking:** [BAC-26404](https://cloudshare.atlassian.net/browse/BAC-26404)

| Field | Detail |
|---|---|
| **Status** | Confirmed for current slice scope — training-scoped read exists; cross-Experience email lookup remains unverified/absent |
| **Verified live** | Partial — training-scoped participant read verified live on 2026-07-06; no broader lookup endpoint verified |

**Observed behaviour**

The CloudShare API surface verified during this slice exposes participant reads at the **training
/ Experience scope**:

- `GET /v4/trainings/{trainingId}/students`

That endpoint returns participant IDs, runtime status, and a `customProperties` object for one
specific training / Experience. This slice did **not** verify any CloudShare API that answers the
broader question "given an email address, which participant IDs exist across all Experiences?" No
current portal adapter, live probe, or documented endpoint evidence in this repo establishes such a
cross-Experience lookup.

**Impact on certification use**

- CloudShare participant IDs must be treated as **scoped to one training / Experience**, not as a
  reusable global identity anchored only by email.
- Cohort Exam Session monitoring must prefer explicit Certalis IDs read from participant
  `customProperties` inside the shared Experience, then fall back to email only when those explicit
  properties are absent.
- Diagnostics should always carry **training / Experience ID + participant ID + Certalis
  ExamAttempt ID** together where known, because participant ID alone is not enough to disambiguate
  across Experiences.

**Action required (if applicable):**

Confirm with CloudShare whether any supported participant-search or reporting endpoint can resolve
participant IDs by email across Experiences. Until such an endpoint is verified, keep Certalis
correlation anchored to the specific training / Experience.

**Code reference:** `src/integrations/cloudshare/participants.ts`,
`src/api/admin-cohort-exam-session-detail.ts`,
`src/api/cohort-exam-session-join-runtime.ts`

---

## GAP-15 — Per-project webhook registration via the v3 API is unverified

**Jira tracking:** [BAC-26392](https://cloudshare.atlassian.net/browse/BAC-26392)

| Field | Detail |
|---|---|
| **Status** | Suspected — documented endpoint, never exercised |
| **Verified live** | No |

**Observed behaviour**

Webhooks can reportedly be created per-project via the v3 POST webhook endpoint, but to date they
have only been created **manually** in the CloudShare portal. Combined with per-Customer secrets and
no custom-header support, the portal needs a **per-Customer webhook URL path** to select the right
secret, and may auto-register via v3 with a manual fallback.

**Impact on certification use**

- Public CloudShare v3 docs now list `GET /api/v3/webhooks`, `GET /api/v3/webhooks/{id}`,
  `POST /api/v3/webhooks`, and `DELETE /api/v3/webhooks/{id}` as the current management surface.
- Slice 9 now persists an opaque per-Customer `webhookPathToken`, and the receiver resolves the
  Customer from `/api/webhooks/cloudshare/{token}` before HMAC verification.
- The portal currently accepts only environment lifecycle events:
  `environment.created`, `environment.suspended`, `environment.resumed`, `environment.deleted`,
  `environment.extended`, and `environment.archived`. Other documented webhook families are not
  useful for this slice because they do not drive environment-state reconciliation.
- Because the CloudShare v3 registration contract is still unverified, the currently supported path
  is the **manual fallback** documented in `docs/api/cloudshare-webhook-registration.md`: read
  `webhookPath` from `GET /api/admin/cloudshare`, prepend the current public tunnel or deployment
  base URL, and register that full callback URL in CloudShare.
- This keeps webhook setup supportable without hard-coding a temporary tunnel hostname or
  fabricating an unverified API integration.

**Action required:** verify v3 webhook registration (request/response, project scoping) against a
live tenant. If it works, replace the manual-only fallback with a supported admin-triggered
registration flow and update this entry immediately.

---

## GAP-16 — v4 training scheduling request body requires PascalCase models

**Jira tracking:** [BAC-26394](https://cloudshare.atlassian.net/browse/BAC-26394)

| Field | Detail |
|---|---|
| **Status** | Partially verified — live validation probes, successful creation still pending |
| **Verified live** | Partial |

**Observed behaviour**

Slice 4 provisions CloudShare scheduling through the corrected v4 training endpoints:

- `POST /v4/trainings`
- `POST /v4/trainings/{trainingId}/students`
- `POST /v4/trainings/{trainingId}/sponsored-link`

The first live UI scheduling attempt returned a v4 `400` from `POST /v4/trainings` because the
adapter sent lower-camel placeholder fields. CloudShare reported these required fields as missing:

- `Name`
- `TeamId`
- `TimeZone`
- `Passphrase`
- `BlueprintIds`
- `MainInstructor`
- `UsersEarlyAccess`
- `CloudshareRegionIds`

Follow-up invalid-ID probes against the live v4 endpoint confirmed that the create-training body is
bound as a PascalCase model. `MainInstructor` must be an object, not a string; `{ Email: <email> }`
passes JSON conversion. `UsersEarlyAccess` must be an object with numeric enum field
`GrantEarlyAccess`; string enum names do not bind. `GET /api/v3/timezones` returned `200` and
included a UTC entry. `GET /api/v3/teams` returned `200`, but the documented endpoint retrieves all
available Teams in all available Projects, which is too broad for Project-first Exam authoring.

The current adapter sends:

- `Name`
- `Start` as the candidate's scheduled ISO timestamp
- `End` as `Start + Exam.openPeriodMinutes`; live Issue #251 verification confirmed CloudShare
  accepts this field and returns the expected `end` on the created training
- `Type: "instructorLed"`
- `ProjectId`
- `TeamId` resolved from the selected Project through the CloudShare adapter
- `BlueprintIds: [blueprintId]`
- `PolicyId`
- `CloudshareRegionIds: allowedRegionIds[]`
- `MainInstructor: { Email: configuredInstructorId }`
- `TimeZone: "UTC"`
- `Passphrase`
- `UsersEarlyAccess: { GrantEarlyAccess: 2 }` (modelled on v3 "No early access allowed")

The participant-add request and response body for `POST /v4/trainings/{trainingId}/students` must be
an array of student objects, not a single object:
`[{ email, firstName, lastName }]`. Candidate first name and last name must be stored by the portal,
not inferred from the email address, because CloudShare participant registration requires first name,
last name, and email. The sponsored-link body is still assumed to accept a single participant object;
that sub-resource shape still requires a successful live scheduling run.

**Update (2026-06-15, live v3/v4 contradiction):** a real candidate scheduling attempt confirmed
that `TeamId` is a required live field for `POST /v4/trainings`, despite not being marked required
in the v4 Stoplight page. Sending the selected Project ID as `TeamId` failed with:
`Id 'PR...' belongs to an incorrect type`. CloudShare IDs are type-prefixed, and the accepted Team
ID must be a `TM...` Team ID, not a `PR...` Project ID.

The documented v3 endpoint `GET /api/v3/teams` retrieves all available Teams across all available
Projects. The CloudShare GUI uses an undocumented Project-filtered variant:

```text
GET /api/v3/teams?getRows=true&projectId={projectId}&sortBy=name&sortAscending=true&skip=0&take=20
```

Live read-only probing against the local E2E credentials confirmed this endpoint returned `200` with
`{ totalRows, rows }`; `rows[0]` included `projectId`, `projectName`, `projectMembers`,
`endUsersMembers`, `isDefaultTeam`, `name`, and `id`, and the returned `id` used the expected `TM`
prefix. `getRows=true` and `projectId={projectId}` should be treated as required for this portal.
Because this endpoint is undocumented, the path, query parameters, and response-shape normalization
must remain isolated inside `integrations/cloudshare`.

**Impact on certification use**

- Automated tests can prove the portal builds a consistent request shape, but they cannot prove that
  the live tenant accepts the exact body fields, naming, or validation rules.
- A mismatch would surface at scheduling time as a CloudShare provisioning failure, now with
  candidate-safe responses and admin-visible diagnostics, but the slice still requires live UI
  verification before merge.

**Update (2026-06-15, Add Training Students body shape):** support-log request-body diagnostics
confirmed the portal was sending a single JSON object to `POST /v4/trainings/{trainingId}/students`,
while the v4 Add Training Students documentation and curl sample require an array of student
objects. A subsequent live attempt confirmed CloudShare also returns an array of student objects.
The adapter now sends and validates `[{ email, firstName, lastName }]`.

**Update (2026-06-15, training Name uniqueness and length):** live edge-case retries confirmed that
`POST /v4/trainings` rejects duplicate `Name` values with `{"Name":["Experience name must be unique"]}`
and enforces a 5-100 character range with errors such as
`{"Name":["'Name' must be between 5 and 100 characters. You entered 103 characters."]}`.
This matters because a previous partial provisioning attempt can create the Training before a later
step fails; retrying the same candidate, Blueprint, and schedule with the same name then fails at
create-training. The portal now builds the CloudShare `Name` from the Blueprint name, candidate name,
candidate email, scheduled UTC timestamp, and booking-created UTC timestamp, then deterministically
truncates identity fields when needed so the full name stays within 100 characters. This keeps names
human-readable without random suffixes and makes retries after partial provisioning produce a fresh
name.

**Update (2026-06-30, Issue #251 live verification):** scheduling now sends a PascalCase
`End` field in the `POST /v4/trainings` body. A real Candidate UI scheduling flow for the
10-minute `Windows Boxes` Exam created training `EXVUAmxA5jgVfM29E2D4cTNA2`; the admin-visible
`cloudshare.create_training` diagnostic recorded `Start: 2026-06-30T15:48:00.000Z` and
`End: 2026-06-30T15:58:00.000Z`, and a live `GET /v4/trainings/{id}` readback returned
`start: 2026-06-30T15:48:00` and `end: 2026-06-30T15:58:00`. The public Stoplight documentation
page was reachable but did not expose the create-training operation model in static HTML during
agent verification, so live tenant behavior is the evidence path for this field.

**Update (2026-07-02, Issue #252 live expiry smoke):** the same live
`GET /v4/trainings/EXVUAmxA5jgVfM29E2D4cTNA2` readback returned HTTP `200` with safe fields
`status: "ended"`, `start: "2026-06-30T15:48:00"`, and `end: "2026-06-30T15:58:00"`. Two
integration details are now confirmed for external-lease reconciliation:

- CloudShare training/Experience readback can use timezone-less timestamp strings rather than RFC
  3339 / `Z`-suffixed datetimes.
- A terminal training window is expressed directly as `status: "ended"` on the
  `/v4/trainings/{id}` resource, and the portal should reconcile that state to `ExamAttempt.expired`
  even when no environment correlation exists.

The external-lease adapter now tolerates this live response shape and keeps the full redacted
request/response evidence in admin diagnostics when reconciliation runs.

**Update (2026-07-05, Issue #273 Cohort Exam Session publish):** the first live UI publish of a
draft Cohort Exam Session attempted `POST /v4/trainings` with `Type: "selfPaced"` and no `End`
because the session's admission close was optional. CloudShare accepted the on-demand/self-paced
type binding far enough to validate the rest of the PascalCase model, but returned HTTP `400` with
`{"UsersEarlyAccess":["'Users Early Access' must not be empty."]}`. The on-demand creation adapter
therefore sends the same `UsersEarlyAccess: { GrantEarlyAccess: 2 }` field used by
instructor-led Exam scheduling. The admin UI kept the session in `draft`, displayed the correlation
ID, and recorded direction-aware request/response evidence in `DiagnosticLogEntry`.

**Follow-up (2026-07-05, same slice):** a second live UI publish with
`RegistrationType: "registeredStudentsOnly"` and `UsersEarlyAccess: { GrantEarlyAccess: 2 }`
created self-paced training `EXAmDkfU42vEJJaRWWH0Tg3g2` with HTTP `201`. The CloudShare response
confirmed `type: "selfPaced"`, `registrationType: "registeredStudentsOnly"`, `end: null` for the
optional admission close case, and the expected Project, Team, Blueprint, Policy, Region, and
Instructor identifiers. The admin UI displayed the persisted CloudShare training/Experience ID and
Team ID, and the success diagnostic retained direction-aware request/response evidence with correlation
ID `8c260d9e-33cb-4062-8254-29ae3098ad57`.

**Update (2026-07-10, Issue #301 Accelerate user-property correction):** the Classic v3
`/api/v3/class/*` custom-field endpoints are not the Accelerate Experience user-property contract.
They expose older project/class custom fields and must not be used to provision Accelerate
Experience user properties. Treat any new `/api/v3/class/` usage in Accelerate training flows as a
warning during review. The observed v3 custom-field gap still matters for Classic: the API can read
project custom-field definitions, but no public root-user create/update/delete API has been
identified for those Classic project fields.

The local exported v4 OpenAPI reference is now tracked in `docs/api/cloudshare-api-reference.md`
and `docs/api/assets/cloudshare-public-api-v4-2026-07-10.json`; use it as the first source for
Accelerate endpoint paths before coding.

Accelerate Experience metadata and user properties are separate concepts:

- Experience-level external correlation belongs on v4 training/Experience metadata such as
  `ExternalId`/`externalId`, with labels available for simple text tags.
- Per-user Certalis values belong in v4 training user properties. The portal must create/read those
  definitions on the specific Experience after `POST /v4/trainings` succeeds and before calling
  `POST /v4/trainings/{trainingId}/students` or the instructor equivalent.
- `certalisExamAttemptId` and `certalisCandidateId` are per-user property keys. The cohort/session
  identifier is Experience-level correlation and should not be created as a per-user property.

The corrected portal sequence is:

1. `POST /v4/trainings` with `ExternalId` set to the portal ExamAttempt ID for individual scheduled
   Exams, or the Cohort Exam Session ID for cohort-backed Experiences.
2. `GET /v4/trainings/{trainingId}/users/properties` to retrieve all property definitions for the
   Experience, treating `null` or `[]` as no definitions, then compare keys locally. If any required
   Certalis keys are missing, call `POST /v4/trainings/{trainingId}/users/properties` with an array
   request body such as `[{ "name": "certalisExamAttemptId" }]`; CloudShare also returns an array of
   created definitions.
3. `POST /v4/trainings/{trainingId}/students` with `customProperties` as an array of
   `{ Name, Value }` entries for the ensured per-user keys. Values may be `null` initially when the
   integration does not yet have the final value, and can later be updated through the v4
   student/instructor edit endpoints.

Earlier Issue #301 probe evidence remains useful for the participant payload shape:
`POST /v4/trainings/{trainingId}/students` rejected the old object-shaped
`customProperties` payload with a `$[0].customProperties` conversion error, while an array payload
advanced to property-name validation. That confirms the portal must send an array model and ensure
the Experience-level property definitions before adding participants.

**Follow-up (2026-07-10, Issue #301 ExternalId live format gap):** CloudShare documents the v4
training `externalId` as a string between 3 and 50 characters, but live `POST /v4/trainings`
rejected a canonical GUID value such as `0d379db9-6b08-4457-b863-eb5f45323d24` with
`'External Id' is not in the correct format.` The likely undocumented constraint is that hyphen
characters are not accepted. Until CloudShare confirms or fixes the contract, the portal preserves
its local UUID/GUID identifiers but sends the hyphenless 32-character form in the CloudShare
`ExternalId` field, for example `0d379db96b084457b863eb5f45323d24`.

**Update (2026-07-01, Issue #251 QA clarification):** the Project Policy detail endpoint is
undocumented but live-observed:
`GET /api/v3/projects/PRCU02uuokHPBfjMedkmradg2/policies/POavMAu1wiaVydJdYUOAExJg2` returned
`runtimeLeaseMinutes: 10`, `storageLeaseMinutes: 2880`, `allowSuspendLease`, `suspendLease`, and
related Policy fields. The CloudShare GUI's MVC Policy details page is not needed for this slice and
is not part of the portal API contract. `runtimeLeaseMinutes` is consumed only while the environment
is running and remains the Certalis ExamAttempt timer (`Exam.timeLimitMinutes`). `storageLeaseMinutes`
is continuous CloudShare retention/TTL evidence from environment spin-up and supports validation and
review-buffer evidence; it does not directly define the CloudShare v4 training/Experience `End`.
The portal persists a manually authored `Exam.openPeriodMinutes`, validates it is at least the
runtime time limit and no longer than known storage retention, and sends
`End = scheduledFor + Exam.openPeriodMinutes`. Environment extensions are ignored for this slice.

**Update (2026-07-01, Issue #251 supportability follow-up):** live admin project-resource refresh
now records one admin-visible `cloudshare.resource_sync.policy_detail.read` diagnostic per Policy
detail request, in addition to the aggregate `cloudshare.resource_sync.policies.read` entry. Each
detail diagnostic records `GET /projects/{projectId}/policies/{policyId}`, external IDs for
`resourceType: policy_detail`, Project, and Policy, and the policy lease evidence used by authoring:
Policy ID/name plus `runtimeLeaseMinutes` and `storageLeaseMinutes` when CloudShare returns them.
Failed detail reads are classified the same way, so support sees the exact Policy detail path and
Policy ID instead of only the aggregate Project Policy list read.

**Action required:** keep the remaining CloudShare create-training assumptions under review:
confirm whether `MainInstructor.Email` should come from the configured instructor email rather than
an opaque member ID, confirm the sponsored-link body shape, and update this entry immediately if any
remaining field names, required fields, enum values, or path semantics differ.

**Code reference:** `src/integrations/cloudshare/labs.ts`, `src/domain/scheduling.ts`

---

## GAP-17 — Provisioning responses omit Team ID and student/participant ID

**Jira tracking:** [BAC-26395](https://cloudshare.atlassian.net/browse/BAC-26395)

| Field | Detail |
|---|---|
| **Status** | Confirmed from adapter contracts; live confirmation pending |
| **Verified live** | No |

**Observed behaviour**

Slice 2B instruments the scheduling/provisioning write path with `DiagnosticLogEntry`s. Two
identifiers the support model would ideally carry are not returned by the v4 calls the portal makes:

- **Team ID** — `createTraining` resolves a Team internally (`GET /v3/teams`) but
  `CreateTrainingResult` only returns `{ trainingId }`, so the Team ID is not surfaced to the domain
  and is not recorded on the `cloudshare.create_training` diagnostic.
- **Student/participant ID** — `POST /v4/trainings/{id}/students` returns an array the adapter
  discards (`addTrainingStudentsSchema`), so no CloudShare-side student/participant ID is available
  to anchor the `cloudshare.add_participant` diagnostic.

**Impact on certification use**

Issue #76's "training/Team ID where known" and "participant/student ID when known" anchors are
satisfied as *null* for these two IDs. Support can still trace the thread via ExamAttempt ID,
training ID, Candidate email, and correlation ID, so forensic correlation is intact; only the
CloudShare-side Team/student IDs are missing.

**Action required (if applicable):**

If a later slice needs Team/student IDs in diagnostics, extend the lab adapter result types to
surface them (the data is present in the `GET /v3/teams` and add-students responses) and populate
the diagnostic `externalIds`. Confirm the add-students response shape against the live tenant first.

**Code reference:** `src/integrations/cloudshare/labs.ts`, `src/domain/scheduling.ts`

---

## GAP-18 — Rapid suspend/resume can return transient v3 environment action 500 while CloudShare state settles

**Jira tracking:** [BAC-26397](https://cloudshare.atlassian.net/browse/BAC-26397)

| Field | Detail |
|---|---|
| **Status** | Confirmed — observed during live QA follow-up for PR #102 / issue #104 |
| **Verified live** | Yes |

**Observed behaviour**

When the same environment is suspended and then resumed again in very quick succession, CloudShare's
v3 environment action path can transiently return `500` while the environment state is still
settling. In the live QA run this surfaced on the resume path (`PUT /api/v3/envs/actions/resume`)
even though the ExamAttempt remained recoverable once the environment finished transitioning.

**Impact on certification use**

- The portal must treat this as a recoverable external-state race, not a terminal Candidate failure.
- Candidate recovery should continue to rely on the authoritative ExamAttempt/environment state and
  allow retry/open once CloudShare settles.
- Support diagnostics for this case must preserve the CloudShare method, path, response status,
  correlation ID, ExamAttempt ID, and environment ID so admins can distinguish a transient
  CloudShare settle race from a broken entitlement or launch mapping.

**Action required (if applicable):**

Backlog issue #104 tracks any deeper product/workflow mitigation beyond the current recoverable
portal behavior and diagnostics coverage.

**Update (2026-07-03, issue #104 live smoke):** current tenant behavior did **not** reproduce the
earlier transient-v3-500 symptom under the portal/runtime path. A new live E2E smoke loop now
drives `schedule -> /enter -> correlated environment -> repeated suspend/resume` against the real
portal server on `localhost:3025` and fails if any portal response or admin diagnostic shows a v3
`500`.

Observed live evidence from the checked-in smoke:

- Exam: `Windows Boxes`
- ExamAttempt: `5df3f2eb-ffb9-4867-b69a-b1966a5b200b`
- Training: `EXw65Zrv-ToORkiv22ck7rKg2`
- Environment: `ENGi3Jjm89Xpe6rjai-BsZIA2`
- Participant: `PTfUzMEmlEKSYpew8x6xLcgg2`
- Schedule correlation: `59de581a-b676-4f52-b1d8-e2038ddd3f5a`

The smoke performed six rapid suspend/resume cycles, with an overlapping second resume request
250 ms after the first on each cycle. All suspend and resume HTTP responses returned `200`, the
admin drilldown recorded no failure rows, and no v3 `500` appeared in the captured diagnostic
evidence. The smoke then performed a final cleanup suspend with HTTP `200` so the disposable
environment was not left running.

**Code reference:** `src/api/suspend-resume.ts`, `src/web/lab-launcher.tsx`,
`tests/live-cloudshare-rapid-suspend-resume.e2e.test.ts`

---

## GAP-19 — Environment archive action exists but is undocumented

**Jira tracking:** [BAC-26398](https://cloudshare.atlassian.net/browse/BAC-26398)

| Field | Detail |
|---|---|
| **Status** | Partially verified — Ready-to-Archived and Preparing-to-Archived confirmed on separate owned Sales Environments; endpoint remains undocumented and other source states remain unverified |
| **Verified live** | 2026-09-19: issue #351 active cancellation, Ready (2) to Archived (4); 2026-10-26: bounded typed-seam probe, Preparing (8) to Archived (4) |

**Observed behaviour**

CloudShare appears to expose a v3 environment archive action at:

- `PUT /api/v3/envs/actions/archive?envId={envId}`

This endpoint is not present in the public CloudShare API material reviewed for the portal, but it is
the runtime operation that best matches the Candidate `End exam` action. The portal now routes early
ExamAttempt completion through the typed CloudShare environment controller's `archiveEnvironment`
command and then polls the authoritative environment state until it normalizes to `archived`.

**Impact on certification use**

Suspending a lab when the Candidate ends an ExamAttempt leaves completed environments visually
indistinguishable from intentionally paused/resumable environments in the CloudShare backend.
Archiving makes the backend state line up with the portal outcome: either the Candidate ended the
ExamAttempt early or the portal-owned runtime was exhausted. The portal deliberately does not delete
the environment, because completion still needs support evidence and, when enabled, score retrieval.

Because the endpoint is undocumented, support diagnostics must preserve the attempted operation,
method, path, response status/body where available, correlation ID, ExamAttempt ID, and environment
ID. Candidate responses must continue to hide sponsored-link URLs and credentials.

**Action required (if applicable):**

Live-verify the archive action against a disposable CloudShare environment before treating this as a
documented product contract. Confirm whether the action is idempotent for already-archived
environments and whether any CloudShare role/RBAC permissions differ from suspend/resume.

**Update (2026-09-19, issue #351):** owned Environment `EN0YJ4FccxfRaT4KGQmnoUWw2`, bound to Experience `EX1gJO4tHEshMyVUT-IAe0sQ2` and local Session `2cdb83d1-fc60-4202-bfcf-abf1edf908e9`, was observed with GET 200/status 2 (Ready), rechecked as 2, archived with PUT 204, and confirmed by exact-ID GET 200/status 4 (Archived). Cancellation command/correlation `541646d1-aaf4-493c-bff1-823f56b122e3` is retained at `2026-09-19T14:45:19.613Z`; v4 End/label PUT and confirming GET returned 200. This is one verified Ready-state transition, not proof of idempotency, RBAC equivalence or support for every status. Earlier status-8 Preparing preflight was rejected locally before any command or provider write. A separate proposed Preparing probe later read status 2 and stopped without direct archive dispatch. Preparing support remains OPEN; neither a success mock, a probe observing Ready nor later human acceptance of the mounted UI proves status-8 eligibility. This is historical evidence from unmerged PR #448; scheduled cancellation rejection and later future-Start deletion proof are recorded under GAP-20.

**Preparing update (2026-10-26, issue #351):** after real UI launch and explicit authorization for this exact Preparing target, Customer `cmri9ggzc00033ep83gj0s2ax`, Session `7435c96f-bc8a-4823-9b74-e800ee4c6fa1`, Experience `EXIbmgLxI1LHZdaQhqyvrbDA2`, and Environment `ENAjRVO5SiJ0A3r1bqcsAubw2` were verified by GET getextended 200/status 8 at `2026-10-26T13:30:54.932Z`, exactly one typed `PUT /api/v3/envs/actions/archive` returning 204, and exact-ID GET 200/status 4 at `2026-10-26T13:30:55.993Z`. This supersedes the earlier OPEN Preparing eligibility finding for this observed transition only. The portal subsequently displayed Concluded/Archived with invitation NotSent and no console warnings/errors. This was a typed-seam archive probe after UI launch, **not** full UI cancellation: no Session End change, deletion, cancellation command or replay occurred. All four Sessions and three Participants, including earlier #350/#351 evidence, remain retained. [Probe audit](https://github.com/cloudshare/cloudshare-demo-portal/pull/448#issuecomment-6417295310); protected local evidence and verification limits are recorded in `docs/verification/issue-351-cancellation.md`. The bounded handler repair admits status 8 at both existing eligibility fences while retaining exact identity checks, durable no-replay dispatch and status-4 confirmation. Idempotency, RBAC equivalence and other source states remain unverified.

**Full UI cancellation update (2026-10-26, issue #351):** the fresh authorized port-3000 flow on Session `8b7c07c1-da57-45ae-a992-36aea05a4f46`, Experience `EXc0fEapLX6svBAptptfaAzw2`, Environment `ENpWuYOY7NhzRDCwJQXS1V5w2` confirmed Preparing at both admission and pre-dispatch, one archive PUT 204 followed by exact-ID Archived readback, then one End/label PUT 200 and confirming GET. Correlation `60d3a79a-a533-4547-a5b5-fb77ffb7782d` finished at revision 6; Support displayed 16 rows, Activity completed at `2026-10-26T14:01:42.575Z`, and Verify confirmed Ended. Browser warnings/errors were empty. This is full UI cancellation evidence, separately from the earlier typed-seam probe. The retained Participant row exposed stale In progress/Preparing fields; the bounded read projection now uses exact confirmed cancellation evidence for Archived, labels its saved confirmation time, and displays portal Access blocked without fabricating provider participation status or a fresh roster observation. All history remains retained. See `docs/verification/issue-351-cancellation.md` for target identities, screenshots and verification limits. No broader status, idempotency or RBAC claim follows.

**Code reference:** `src/integrations/cloudshare/environment-controller.ts`,
`src/domain/exam-attempt-runtime-lifecycle.ts`,
`src/api/exam-attempt-early-completion-runtime.ts`

---

## GAP-20 — Experience cleanup is delete-only; no archive/hide lifecycle

**Agreed Sales exception (2026-09-19, issue #351):** the user defines an Experience with current provider Start in the future as not yet run and permits its deletion. The selected implementation uses documented `DELETE /v4/sales/{id}` (204), with fresh provider Start/timezone checks and a separate durable deletion step; all portal records and history remain. Other Experiences retain archive + End behavior. The failed End PUT below is preserved and never replayed. No historical-use attestation is required. Future DELETE was live-verified through the UI on the historical unmerged PR #448 head `76847e4c`: fresh future-Start GET 200, exactly one DELETE 204, then exact-ID GET 404, with portal history retained ([evidence](https://github.com/cloudshare/cloudshare-demo-portal/pull/448#issuecomment-5745245832)). This does not establish Preparing archive eligibility; the unconditional provider endpoint has no documented atomic Start guard.

**Sales cancellation update (2026-09-19, issue #351):** updating an active Sales Experience End succeeded (GAP-19), but scheduled End-before-Start was explicitly rejected. Owned Session `110561c6-26f4-4e3d-b82f-9996686cbb5c` had Start `2026-09-19T16:30:00Z`, with no invitation or launch. Cancellation `26648bd1-d455-4e65-ba3d-027cda70737c` at `2026-09-19T14:52:21.756Z` retained a `no_environment` target; its v4 End PUT returned 400 requiring End greater than scheduledStart (`16:30` UTC). GET confirmed unchanged `notStarted`, Start `2026-09-19T16:30:00Z`, End `2026-09-20T16:30:00Z`, and empty labels. The command remains unfinished with access state `dispatched`; the UI reports needs attention and no write was retried. This observed contract blocked the original scheduled End-update path. The separately authorized future-Start deletion proof above resolves that path for eligible future Experiences without replaying or resetting this failed command. No Start rewrite or deletion was attempted on this earlier target.

**Jira tracking:** [BAC-26400](https://cloudshare.atlassian.net/browse/BAC-26400)

| Field | Detail |
|---|---|
| **Status** | Confirmed — live cleanup on 2026-07-04 deleted training/Experience records because that is the available API behaviour today |
| **Verified live** | Yes |

**Observed behaviour**

The practical cleanup path for CloudShare training Experiences is to delete the Experience. Deleting
the Experience also deletes any environments inside it, so separate environment deletion is not
required for operator cleanup.

During the 2026-07-04 cleanup of PR #261 demo data, v4 `DELETE /trainings/{id}` returned `204` for
all 31 recorded training/Experience IDs. That was the only reliable way to remove the demo
Experience records from the tenant once the portal database had accumulated many test attempts.

**Impact on certification use**

Deletion is operationally convenient but poor for certification history. A completed or expired
ExamAttempt may still need support evidence, scoring evidence, audit traceability, or customer
review. Deleting the Experience removes or hides the CloudShare-side historical object instead of
preserving it in a terminal, non-primary-list state.

The desired CloudShare lifecycle is an Experience-level **archive** or **hide from main list** action:
retain historical evidence and diagnostics, stop candidates from using the Experience, remove it
from day-to-day operational queues, and keep it available for support/audit review.

**Action required (if applicable):**

Raise/track a CloudShare product/API gap for Experience-level archival. Until CloudShare exposes
that lifecycle, portal cleanup tooling should be explicit that Experience deletion is destructive
and should be reserved for demo reset/operator cleanup, not normal certification completion.

Verify whether an unended training/Experience can be retired non-destructively by updating its
`End` value to the current or near-current time. If supported, this should become the normal
Cohort Exam Session close/retire path: block new portal joins, let known active ExamAttempts finish
where appropriate, and preserve the CloudShare Experience record for history rather than deleting
it. Also verify whether `End` can be updated only while the current Experience end date is absent or
still in the future.

Before retiring a Cohort Exam Session, the portal should read
`GET /trainings/{id}/students` and account for both `participationStatus` and `envStatus`.
Participants with `participationStatus: inProgress` or non-terminal environments should be surfaced
to the admin as potentially interruptible. Treat `Archived` and `Deleted` as terminal environment
states; other observed values such as `Ready`, `Suspended`, `Publishing`, `Preparing`,
`CreationFailed`, `InGrace`, `Stopping`, `EditingNetworks`, `FutureAllocationScheduled`, and
`AllocationScheduledNoRun` require caution and support-visible diagnostics.

**Code reference:** `src/integrations/cloudshare/labs.ts`

---

## GAP-21 / FUTURE REQUEST — Reusable Guided Journey analytics across Experiences

| Field | Detail |
|---|---|
| **Status** | Future request — product/API enhancement and portal delivery-model gap |
| **Verified live** | No — requires CloudShare API/support confirmation |

**Observed behaviour**

CloudShare experience analytics are naturally scoped to a single multi-participant Experience.
The portal's current one-participant-per-Experience launch model prevents useful
Experience-level aggregate scoring: an aggregate over one participant is still just an individual
score. This is not necessarily a CloudShare analytics defect; it is a mismatch between the portal's
current individual on-demand delivery model and CloudShare's native cohort delivery model.

The deeper future request is to decouple Guided Journeys from individual Experiences. In the desired
model, a Guided Journey is a reusable scored learning/demo asset with a stable definition and
version, and an Experience is the runtime composition that joins:

- a Blueprint;
- a Policy;
- a Guided Journey;
- participants;
- lifecycle/timing.

CloudShare is already partly aligned with this direction through GitHub synchronisation for Guided
Journeys. The portal's originally scoped Guided Journey repository, later dropped from the MVP, would
have extended the same idea by allowing Guided Journeys to be reused across many Experiences rather
than treated as analytics permanently owned by one Experience.

**Impact on certification and demo use**

Cross-Experience Guided Journey analytics should group scores by Guided Journey definition/version
rather than by Experience ID. That would preserve meaningful aggregate score reporting for the
portal's individual on-demand model while also supporting CloudShare's native cohort model where many
participants share a single Experience.

CloudShare does expose an Experience-scoped aggregate Guided Journey progress endpoint:
`GET /v4/guided-journey/progress/{experienceId}`. That endpoint returns aggregate rates for all
participants in one Experience, including `avgExploredRate`, `avgInProgressRate`,
`avgNotStartedRate`, `avgPassedRate`, `avgFailedRate`, `avgNotInitiatedRate`, and section-level
`aggSectionStatuses[]` with per-section rates and timing fields. This should be treated as in-scope
for the first Cohort Exam Session feature because cohort delivery intentionally puts many
participants into one Experience. The first portal surface for this data should be the Cohort Exam
Session admin detail page, not the catalog Exam page, because the aggregate belongs to one shared
CloudShare Experience/session. It should be admin-only in the first version; Candidate score pages
remain scoped to the Candidate's own ExamAttempt.

That endpoint does **not** resolve the future request in this gap: it aggregates by Experience ID,
not by reusable Guided Journey definition/version across multiple Experiences.

The portal should therefore support both delivery modes in a future slice:

- **Individual on-demand Experiences** for isolated Candidate launches, current exam delivery,
  entitlement, suspend/resume, and per-attempt support diagnostics.
- **Cohort or ongoing Experiences** for Helios Admin-scheduled multi-participant delivery, richer
  CloudShare-native aggregate analytics, sales enablement sessions, demos, POCs, and reusable lab
  delivery.

This is broader than certification delivery. It reflects the general way CloudShare Experiences are
built and consumed, and should feed into the next portal iteration for sales enablement and
customer-owned demo/POC delivery.

**Action required (if applicable):**

Track this as both a portal future request and a CloudShare product/API gap. Confirm with CloudShare:

1. Whether Guided Journey definitions have stable IDs and versions independent of an Experience.
2. Whether GitHub-synchronised Guided Journeys expose enough identity/version metadata through the
   API to group progress across Experiences.
3. Whether Guided Journey progress endpoints can report aggregate results across multiple
   Experiences that use the same Guided Journey definition/version.
4. Whether Training/Sales Experiences with preconfigured participant environments can be created,
   populated, prepared, suspended, and resumed through API calls without fake participant login.
5. Whether CloudShare intends Experience analytics to remain the only aggregate boundary, or whether
   reusable Guided Journey analytics are an intended product direction.

Related external request: [BAC-24830](https://cloudshare.atlassian.net/browse/BAC-24830).

**Cross-links:** [CONTEXT.md](../../CONTEXT.md) defines `Experience`, `Exam`, `Blueprint`, `Policy`,
and `Guided Journey`; [PRD v2](../requirements/prd-cloudshare-demo-portal-v2.md) scopes current
score retrieval as a per-Exam flag; see also [GAP-7](#gap-7--certification-scoring-is-weak-bitmap-checkpoints-end-state-only)
for Guided Journey scoring limitations and [GAP-13](#gap-13--no-api-to-detect-whether-a-guided-journey-exists-for-an-experience)
for the current detection gap.

---

## GAP-22 — No controlled nth-environment admission workflow inside an Experience

**Jira tracking:** [BAC-26402](https://cloudshare.atlassian.net/browse/BAC-26402)

| Field | Detail |
|---|---|
| **Status** | Suspected — product gap surfaced during Cohort Exam Session design |
| **Verified live** | No — workflow exists as a Postman experiment; needs live/API confirmation |

**Observed behaviour**

CloudShare appears to support a setting that allows a participant to receive multiple environments
inside the same Experience, but the control is broad: when enabled, the participant may be able to
request one or more additional environments subject only to the Experience lifetime and Policy
limits. There is no known API or product workflow that routes a second/nth environment request to an
Instructor or administrator for per-request approval.

The available workarounds are unsuitable for high-integrity exam delivery:

- Delete and recreate the participant in the Experience, which risks losing history and support
  evidence.
- Temporarily enable multiple environments, force or simulate the participant login to allocate the
  next environment, then disable the setting again. This is operationally fragile, affects the whole
  Experience during the toggle window, and can require treating a sponsored-link login as an
  orchestration primitive rather than a Candidate action.

Referenced exploratory workflow:
[CloudShare public Postman folder](https://www.postman.com/cloudshare-api/workspace/cloudshare-public-apis/folder/25333509-dffb29ed-5ead-454d-a071-2ff26c9fc26b?action=share&source=copy-link&creator=25333509).

**Impact on certification use**

Cohort Exam Sessions should not allow overlapping active attempts by the same Candidate for the same
Exam, even when the shared CloudShare Experience technically permits multiple environments. A
Candidate may need a consecutive retake or replacement environment after a terminal attempt, but
that should be a deliberate portal/admin decision with audit and diagnostics, not an uncontrolled
CloudShare setting.

Until CloudShare exposes a controlled nth-environment admission flow, the portal should avoid
turning on the broad multiple-environments option for cohort exams. Retakes should be represented as
new terminal-to-new `ExamAttempt` transitions governed by explicit portal policy, likely in a later
slice. Same-Experience retakes are the preferred long-term operating model because they keep the
cohort's analytics and visibility in one CloudShare Experience, but CloudShare does not currently
appear to support that cleanly without participant delete/recreate or the Experience-wide
multiple-environments toggle workaround.

The first Cohort Exam Session slice should therefore block same-session retakes unless a clean
CloudShare-supported path is verified. A later stretch goal may let the portal own an explicit,
admin-approved retake workflow for nth attempts in the same Experience, with clear audit,
diagnostics, and guardrails around any CloudShare workaround.

**Action required (if applicable):**

Raise/track a CloudShare product/API enhancement for administrator-approved second/nth environment
allocation within an Experience. Confirm:

1. Whether the multiple-environments setting can be scoped per participant rather than per
   Experience.
2. Whether there is any API to request or approve a specific participant's additional environment
   without deleting the participant or toggling an Experience-wide setting.
3. Whether participant/environment history remains available after participant deletion and
   recreation.
4. Whether sponsored-link login can be avoided entirely when allocating a replacement environment.

---

## GAP-23 — Sponsored-link authentication exposes CloudShare's environment landing page after suspend

| Field | Detail |
|---|---|
| **Status** | Confirmed — observed after a sponsored-link authenticated Candidate suspended an environment; CloudShare-side controls still unverified |
| **Verified live** | Partial — landing-page exposure observed live on 2026-07-06; exact bypass outcomes and product mitigations require CloudShare/R&D confirmation |

**Observed behaviour**

After a Candidate enters a lab through a CloudShare sponsored link, CloudShare authenticates that
browser session on `use.cloudshare.com`. When the Candidate's current environment is suspended,
CloudShare redirects the browser to:

- `https://use.cloudshare.com/Authenticated/Landing.aspx`

The landing page lists the CloudShare user's active environments and pending environments. In the
observed session it displayed multiple active environments, including the environment that had just
been suspended, and a pending environment that could potentially be launched outside the Certalis
portal flow.

Evidence screenshot:
[cloudshare-authenticated-landing-bypass-2026-07-06.png](assets/cloudshare-authenticated-landing-bypass-2026-07-06.png)

**Impact on certification use**

This weakens the portal-owned entitlement and timing model. Even if Certalis records an
`ExamAttempt` as suspended, the Candidate may still have an authenticated CloudShare browser session
that exposes direct links to CloudShare environments. If those links can resume a suspended
environment or launch a pending environment, a Candidate could work around:

- the portal's resume endpoint and persisted Exam clock;
- server-side entitlement checks;
- time-gated launch windows;
- admin-visible suspend/resume diagnostics;
- pending-environment admission rules for scheduled attempts or cohort sessions.

Because the redirect happens after the browser is already on CloudShare's origin, Certalis cannot
reliably intercept or inspect that navigation with ordinary portal JavaScript due to browser
same-origin restrictions. The current separate-window launcher can detect coarse window lifecycle
events, but it cannot safely read or block `use.cloudshare.com/Authenticated/Landing.aspx` once the
CloudShare page has control.

This does not change the sponsored-link design requirement that the `loginUrl` remains server-only
and is reached via a 302. It does mean sponsored-link login may create a broader authenticated
CloudShare session than the portal can constrain by itself.

**Action required (if applicable):**

Confirm with CloudShare/R&D whether there is a supported way to prevent or constrain this landing
page for sponsored-link users:

1. Disable or hide `Authenticated/Landing.aspx` for sponsored-link sessions.
2. Scope a sponsored-link login to a single training/Experience/environment so other active and
   pending environments are not listed.
3. Configure a post-suspend or post-environment-exit redirect back to the Certalis portal instead of
   the CloudShare landing page.
4. Force logout or session invalidation after suspend without invalidating the Candidate's ability to
   resume through the portal later.
5. Prevent pending environments from being launched directly from the CloudShare landing page when
   the intended admission path is the portal.

If CloudShare has no product-side control, treat direct CloudShare landing-page access as a known
certification integrity limitation. The portal should continue to reconcile state from CloudShare and
surface admin diagnostics when CloudShare runtime state changes outside the expected portal action
thread, but reconciliation is detection/mitigation rather than prevention.

**Code reference:** `docs/decisions/ADR-002-server-side-sponsored-link-redirect.md`,
`src/web/lab-launcher.tsx`, `src/api/suspend-resume.ts`,
`src/domain/exam-attempt-runtime-lifecycle.ts`

---

## GAP-24 — Rate limiting and abuse protection need first-class handling and support evidence

**Jira tracking:** [BAC-26405](https://cloudshare.atlassian.net/browse/BAC-26405)

| Field | Detail |
|---|---|
| **Status** | Confirmed in portal handling; live CloudShare 429/abuse thresholds still partly unverified |
| **Verified live** | Partial — live `429` response shape observed during QA; intentionally forcing or sustaining abuse-list behaviour is unsafe |

**Observed behaviour**

CloudShare can reject requests with classic HTTP rate limiting (`429 Too Many Requests`) and may
also block requests through abuse-protection responses that present as non-success HTTP statuses with
body text referring to abuse protection or an abuse list. When this happens, the previous portal
behaviour treated the failure as a generic `CloudShareRequestError`, which caused three problems:

1. rate-limit state was not modelled explicitly at the integration boundary;
2. runtime Blueprint/Snapshot guards could misreport a temporary lookup failure as actual
   `snapshot_drift`;
3. repeated follow-up requests from the same Customer could hammer CloudShare immediately after a
   `Retry-After` response.

During 2026-07-09 QA, a live CloudShare v3 `ping` from the portal returned HTTP `429` with response
body code `0x42901` and no usable `Retry-After` header. Operator context from CloudShare indicates
that this can be caused by the request public IP landing on an abuse list. Once that happens, retrying
alone may not clear the condition; a CloudShare/admin action may be needed to remove the IP from the
abuse list or whitelist/allow-list the public IP. This is especially likely when the caller's public
IP changes, such as after moving location. A whitelisted public IP should not normally appear on the
abuse list.

The portal now treats these as a first-class integration condition:

- `CloudShareRateLimitError` is raised at the CloudShare boundary for `429` responses, including
  v4 OAuth token throttling, and for explicit `403` abuse-list/protection responses;
- redacted diagnostics retain `Retry-After` and related rate-limit headers;
- safe idempotent reads (`GET`) may perform one bounded retry using `Retry-After` or a short jittered
  delay;
- side-effecting writes (`POST`/`PUT`/`DELETE`) do **not** auto-retry;
- an observed rate limit activates a per-Customer cooldown so later requests fail fast with a typed
  rate-limit condition instead of immediately hitting CloudShare again.

**Impact on certification use**

- Candidate/admin-facing flows can now return a deliberate rate-limit response instead of a generic
  502/423, so support can distinguish "CloudShare is busy" from "the Exam configuration drifted".
- Snapshot guard diagnostics now separate true `snapshot_drift` from
  `snapshot_guard_unavailable` caused by throttling.
- Support diagnostics retain the redacted upstream headers needed to reason about retry timing
  without exposing credentials or bearer artifacts.
- Admin/support-facing 429 paths now share the same guidance: CloudShare is returning a 429 for the
  current request; support should treat this as likely rate limiting or abuse protection and check
  whether the public IP needs CloudShare allow-list or abuse-list review before retrying by contacting
  `support@cloudshare.com`.
- Candidate-facing 429 paths intentionally do **not** mention CloudShare support, allow-lists, abuse
  lists, or internal CloudShare details. Candidates are told that something is not working right now
  and to contact their instructor before trying again.
- The current cooldown store is intentionally minimal: it is **in-memory and per-process**, keyed by
  Customer. That protects the main server instance from immediate repeated calls, but it is not yet
  shared across multiple app instances or persisted across process restarts.

**Action required (if applicable):**

Confirm with CloudShare support/R&D:

1. which non-429 statuses/bodies are the authoritative abuse-protection signals beyond explicit
   `403` abuse-list/protection wording;
2. whether `Retry-After` is always present and whether other rate-limit headers have a documented
   contract;
3. the operational process for removing a public IP from the abuse list;
4. the exact whitelisting/customer allow-list process for demo traffic or portal server IPs, and how
   to detect when the caller's public IP has changed;
5. whether the portal should eventually persist/shared-cache the per-Customer cooldown across
   instances instead of relying on per-process memory.

**Code reference:** `src/integrations/cloudshare/errors.ts`,
`src/integrations/cloudshare/client.ts`,
`src/domain/cloudshare-rate-limit-message.ts`,
`src/api/runtime-blueprint-snapshot-guard.ts`,
`src/api/exam-attempt-scheduling-runtime.ts`,
`src/api/exam-attempt-runtime.ts`

---

## Gap template

## GAP-25 — Certalis Sales resource authoring live verification is blocked by local connection authentication

| Field | Detail |
|---|---|
| **Status** | Observed — local verification blocker |
| **Verified live** | Partial — v3 endpoint reached on 2026-07-12, but authentication was rejected |

**Observed behaviour**

The #346 live-check attempt reached the CloudShare v3 surface but returned HTTP `401` with the
redacted response code `0x40102` (failed signature authentication) for the locally available seed
connection. The browser-control session also became unavailable after local server restarts, so the
Certalis Sales Admin UI could not complete its live resource selection flow.

**Impact on sales enablement**

The portal's deterministic handler, adapter, and browser-component checks prove the resource
selection contract, but they do not substitute for required live Certalis CloudShare verification.
No Sales Item should be treated as live-verified until a current Certalis connection can read
Projects, Regions, project Blueprints, and Policies through the real Sales UI.

**Action required**

Refresh or correct the local Certalis CloudShare Connection, rerun the real Sales UI authoring flow,
and record the redacted request/response diagnostics and browser-console result in the PR before
merge.

**Update (2026-07-12, Certalis Sales UI live read):** The Certalis Sales Admin successfully loaded
the real Certalis Project, global Region, and Policy choices through the Sales UI. The observed
Policy storage lease was 30 days, and the browser console had no errors. The earlier zero-Blueprint
observation was a discovery/configuration mismatch: the current Certalis Sales Project returns two
Blueprints through the verified endpoint. Those resources can now be authored as Items and the
per-read diagnostics are persisted under the `sales-items` source. See GAP-25 for the confirmed
default-Snapshot Region intersection rule and the linked CloudShare R&D report.

---

Copy this section when appending a new gap discovered during implementation:

```markdown
## GAP-18 — LabProvisioner interface discards CloudShare response bodies and HTTP status

| Field | Detail |
|---|---|
| **Status** | Confirmed — architectural gap surfaced during Slice #76 |
| **Verified live** | Yes |

**Observed behaviour**

The `LabProvisioner` interface (`src/domain/lab-launch.ts`) was designed to return only the minimum
domain-useful payload from each provisioning call:

- `createTraining` → `{ trainingId: string }` (full training object discarded)
- `addParticipant` → `void` (full participant/student response discarded)
- `createSponsoredLink` → `{ loginUrl: string }` (status and any additional fields discarded)

The CloudShare adapter receives the full HTTP response — status code, headers, body — but strips it
to these minimal shapes before returning to the domain. The discarded data is never logged.

**Impact on certification use**

Admin support diagnostics for the scheduling/provisioning path (`cloudshare.add_participant`,
`cloudshare.create_training`, `cloudshare.create_sponsored_link`) show request bodies but no
response bodies or HTTP status codes. This makes it impossible to diagnose CloudShare-side
rejections that return a 2xx with an error payload, soft failures, or unexpected response shapes.
The principle is: **both successful and failing responses must be logged** — throwing away response
data makes the platform significantly harder to support.

**Superseded by issue #360 (2026-07-19):** CloudShare diagnostic evidence uses one direction-aware
contract across scheduling/runtime, Guided Journey, resources, Sales, and webhooks:

- **Request headers:** preserve only the explicit safe operational allowlist (Content-Type, Accept, Accept-Encoding, Content-Length, User-Agent, request/correlation IDs, and W3C trace headers); mask every other named or unparseable header.
- **Request/query and provider response bodies:** retain every value verbatim in protected admin
  `DiagnosticLogEntry` evidence, including API keys, bearer tokens, webhook secrets, signatures,
  passwords, passphrases, access links, sponsored-link `loginUrl` values, nested arrays/objects, and
  keys that resemble header names. Do not scrub bodies by endpoint, field name, or value pattern.
- **Generic traces and client surfaces:** retain metadata only; body evidence belongs solely in the
  protected Customer-scoped diagnostic recorder.

Candidate/client-facing APIs remain stricter: admin-only evidence such as `loginUrl` must not
appear in candidate responses or candidate-facing UI even though it can appear in admin support
diagnostics. Only explicitly allowlisted operational request-header values remain visible; every other request header remains redacted.

**Action required:**

A dedicated slice must:
1. Extend the `LabProvisioner` return types to carry `{ status: number; body: unknown }` alongside
   the current domain payload for all three operations.
2. Update the CloudShare adapter to capture and return the full HTTP response (status + parsed body).
3. Update `scheduleExam` to include `response.status` and `response.body` in every `recordSuccess`
   and `recordFailure` diagnostic entry.
4. Update all mock stubs and unit tests that implement `LabProvisioner` to supply the new fields.

Until this is resolved, the diagnostic log for provisioning operations is incomplete.

---

## GAP-25 — Accelerate permits an invalid multi-step Region selection

**Jira tracking:** [BAC-25976](https://cloudshare.atlassian.net/browse/BAC-25976) (authoritative); [BAC-26453](https://cloudshare.atlassian.net/browse/BAC-26453) (duplicate record)

| Field | Detail |
|---|---|
| **Status** | Confirmed |
| **Verified live** | Yes — Certalis Sales Customer, 2026-07-13 |
| **CloudShare R&D report** | [SUP-4994](https://cloudshare.atlassian.net/browse/SUP-4994) |

**Observed behaviour**

The native Accelerate Experience wizard lets an admin select every Region exposed by one
Blueprint, even when another selected step's default Snapshot is unavailable in one of those
Regions. Opening that incompatible step then fails.

**Portal mitigation**

Certalis Sales Items calculate their eligible Region set as the intersection of the current
default-Snapshot Region IDs for every ordered Blueprint step. The authoring UI only offers that
intersection and the Item save handler reads and revalidates every Blueprint detail before it
persists an Item. A missing shared Region or any submitted Region outside that intersection is
blocked with a Customer-scoped, redacted support diagnostic.

Live Certalis evidence: the Certalis Sales Project exposes two Blueprints, and their current
default Snapshots share Miami only. The portal therefore offers Miami for their combined Item;
it does not offer Amsterdam or Singapore merely because another selected Blueprint may expose
them.

**Future delivery requirement**

An Enablement Session must repeat this validation immediately before CloudShare provisioning,
because a default Snapshot can move after an Item has been authored.

**Code reference:** `src/api/sales-items.ts`, `src/integrations/cloudshare/resources.ts`

---

## GAP-26 — Sales Experience main Sales Pro preflight remains a live-tenant verification point

| Field | Detail |
|---|---|
| **Status** | Confirmed blocker |
| **Verified live** | Partial — read-only Certalis v4 probe on 2026-07-14 |

**Observed contract**

The local v4 OpenAPI export documents `POST /sales`, including `mainSalesPro`, required
`opportunity`, `registrationType`, explicit `start`/`timeZone`, and optional `end`/
`sendInvitations`. It also documents `GET /sales/{id}/salespros`, which is scoped to an
already-created Sales Experience. The export does not unambiguously identify a Project-scoped
pre-creation Sales-Pro eligibility path. A read-only direct probe of the inferred
`GET /v4/salespros` path against the Certalis Sales Connection returned HTTP 404 (request
completed in 3.6 seconds); the inferred path has been removed and must not be used.

**Portal mitigation**

The #347 Sales Delivery module makes the documented atomic `POST /sales` request and maps a
CloudShare main-Sales-Pro rejection to a supportable 422 result. It revalidates Demo Item
resources before the mutation and retains redacted evidence, but it cannot honestly claim a
separate pre-create eligibility check. The portal must not rely on a guessed endpoint.

Issue #409 extends that same documented `POST /sales` contract to Customer-scoped Sales Trial
Offerings. The portal publishes exactly one shared Sales Experience with `type: trial`,
`registrationType: registeredParticipantsOnly`, and `sendInvitations: dontSend`, while keeping
provider identifiers and full request/response evidence out of ordinary UI/API surfaces. Non-
ambiguous provider failures and pre-create Item revalidation failures now persist protected
Customer-scoped diagnostics, while ambiguous `POST /sales` outcomes remain a no-replay
`needs_attention` state.

**Action required:**

CloudShare must provide or document a legitimate Project-scoped eligibility endpoint, or the
issue acceptance criterion must explicitly waive a separate preflight in favour of atomic create
validation. Separately, run a safe disposable Certalis Sales Experience through the Sales UI to
confirm the direct request/response, field casing, and the resulting main Sales Pro behaviour.

**Code reference:** `src/integrations/cloudshare/sales-delivery.ts`, `src/api/sales-demo-sessions.ts`

---

## GAP-27 — Sales operator Instructor Console link needs a supported Experience-to-legacy mapping

**Jira tracking:** [BAC-25223](https://cloudshare.atlassian.net/browse/BAC-25223) (authoritative); [BAC-26454](https://cloudshare.atlassian.net/browse/BAC-26454) (duplicate record)

| Field | Detail |
|---|---|
| **Status** | Product/API dependency — not implemented or used by the portal |
| **Verified live** | No — do not probe or rely on the unproductized endpoint in Issue #347 verification |
| **CloudShare R&D ticket** | [BAC-25223](https://cloudshare.atlassian.net/browse/BAC-25223) — productize a supported Experience ID → legacy/class ID mapping for the operator Instructor Console URL |

**Required future capability**

An authorized Certalis sales operator (initially a Sales Admin; later potentially a Sales Rep or
Sales Engineer) may need an operator-only outbound link to the CloudShare Instructor Console for a
Sales Enablement Session, so they can monitor and manage participant environments in real time. The
desired external destination has the form:

`https://accelerate.cloudshare.com/instructor-console/<legacyClassId>`

This is a future optional navigation capability only. It must not embed the Instructor Console,
and its portal authorization, audit evidence, and outbound-link treatment must be designed in the
delivery/monitoring slice that introduces it.

**Why the current Sales Experience contract is insufficient**

The v4 Sales Experience creation response can include `accessLink`, but that is a participant
invitation/login URL. It is not an operator console URL and must remain distinct from any future
operator navigation; it must not be repurposed for Instructor Console access.

The Accelerate Sales Experience ID retained by a `SalesDemoSession` is also not directly usable in
the Instructor Console URL. Discovery identified an undocumented, unproductized read at
`GET https://accelerate-api.cloudshare.com/api/v1/Experiences/<experience-id>` that appears to
return a Classic `legacyId` / class ID. Certalis must not call, test, or make a runtime dependency
on that endpoint, including during Issue #347 live verification.

**Action required**

CloudShare must provide one of the following supported contracts before Certalis builds this link:

1. a documented, authorized mapping from Accelerate Experience ID to the legacy Classic class ID; or
2. a documented, authorized Instructor Console URL for an Accelerate Sales Experience.

The future slice should preserve the existing local Sales Experience correlation, avoid exposing
bearer credentials or participant `accessLink` values, apply role/Customer scoping, and write
redacted audit/diagnostic evidence for operator-link use.

**Code reference:** `src/domain/sales-demo-session.ts`, `src/api/sales-demo-sessions.ts`

---

## GAP-28 — Project-scoped Sales Pro eligibility is available only through an undocumented GUI member read

**Jira tracking:** [BAC-24702](https://cloudshare.atlassian.net/browse/BAC-24702) (authoritative); [BAC-26408](https://cloudshare.atlassian.net/browse/BAC-26408) (duplicate record)

| Field | Detail |
|---|---|
| **Status** | Implemented behind a typed, isolated Sales Enablement Session adapter pending productization |
| **Verified live** | Yes — safe read-only Certalis probe passed on 2026-07-14 |
| **Documentation defect** | [SUP-5002](https://cloudshare.atlassian.net/browse/SUP-5002) — the v4 Sales-Pro description refers to an undefined `Get/salespros` endpoint |
| **Productization path** | [BAC-24702 — Productise Project User Management APIs](https://cloudshare.atlassian.net/browse/BAC-24702) |

**Why the earlier `/salespros` assumption was wrong**

The local v4 export's `POST /sales/{id}/salespros` description says to use a `Get/salespros`
endpoint to list Sales Pros assigned to a Project. It does not define that endpoint in the OpenAPI
bundle. Treating prose in that description as a v4 `GET /salespros` path was an inference, not a
documented contract; the safe Certalis probe returned 404 and the inferred adapter call was removed.

**GUI discovery**

CloudShare's own GUI appears to list active Project members through the undocumented classic-v3
surface:

`GET https://use.cloudshare.com/api/v3/users?projectUsers=true&status=active&loggedIn=ever&projectId=<project-id>&getRows=true`

Live verification on 2026-07-14 confirmed HTTP 200 for a Certalis Project using
`projectUsers=true`, `status=active`, `projectId`, and `getRows=true`; that probe did not establish
the `loggedIn` behavior. A later live roster check on 2026-08-30 confirmed that omitting
`loggedIn=ever` falls back to CloudShare's default recent-login filter and can undercount active
Project members, while the GUI's `loggedIn=ever` query returns the full active roster. The response exposed a row collection
(observed as `Rows`) with member identity fields including email and name parts;
Certalis normalizes only email plus a display name and never returns raw CloudShare member IDs to
the browser. `projectUsers=true`, `getRows=true`, and `loggedIn=ever` remain required by the
implemented typed adapter; additional GUI parameters remain undocumented.

SUP-5002 tracks the misleading API documentation. BAC-24702 is the requested path to productize
the Project User Management APIs so a future Sales Delivery adapter can replace this unsupported
GUI surface with a documented contract.

**Prior-art check: Exam instructor seam**

The Exam authoring/delivery seam does **not** retrieve Project members or dynamically list
Instructors. It requires the explicitly configured, seeded Helios service-account instructor and
passes that configured email as `MainInstructor` when creating the Training/Cohort Experience. The
v4 export documents list/add instructor operations only for an already-created Training Experience;
its add-instructor description separately points to legacy v3 documentation for available Project
instructors. It is therefore not a supported precedent for a Sales pre-create eligibility lookup.

**Current Certalis containment**

The Sales Enablement Session form performs this live lookup only after the Sales Admin selects an
Item (thereby inferring its Project), does not cache it, and re-fetches/revalidates the selected
Sales Pro immediately before `POST /sales`. This check proves only that the chosen email is still
an active Project member on the undocumented GUI surface; it does **not** prove CloudShare will
accept that user as `mainSalesPro` for the eventual v4 Sales Experience create. Provider-side
authority remains with the documented `POST /sales` call, and Certalis must continue mapping any
main-Sales-Pro rejection from that mutation to supportable diagnostics rather than overclaiming the
preflight. A failed lookup or removed/inactive selection blocks creation with correlated, redacted
diagnostics. The narrow race after the revalidation and before
CloudShare processes the create request is accepted as an extreme edge case; CloudShare remains the
final authority. The selected email and display name are persisted on the immutable Session
correlation, not on the catalogue Item.

**Action required**

CloudShare should document and support a Project-scoped membership/eligibility read with the
minimum fields necessary to select and verify a Sales Pro as the requested `mainSalesPro`, including
authorization and stable response semantics. BAC-24702 is the requested productization path that
will replace this isolated GUI adapter with a supported contract.

**Code reference:** `src/integrations/cloudshare/project-members.ts`,
`src/api/sales-project-members.ts`, `src/api/sales-demo-sessions.ts`,
`docs/api/assets/cloudshare-public-api-v4-2026-07-10.json`

---

## GAP-29 — Sales participant-list response envelope differs from the published v4 export

**Jira tracking:** [BAC-26409](https://cloudshare.atlassian.net/browse/BAC-26409)

| Field | Detail |
|---|---|
| **Status** | Confirmed — portal adapter pages the observed collection safely and normalizes it |
| **Verified live** | Yes — Certalis Sales participant-monitoring read, 2026-07-17 |

**Observed behaviour**

The published v4 export describes `GET /sales/{id}/participants` as an object
containing `participants`, and declares `envStatus` as a string enum. During #348
human QA, the live Certalis Sales API instead returned the paged collection envelope
`{ count, items }`; registered, pre-environment participants had `envStatus: null`
and the provider placeholder `envId: "0"`. The previous strict adapter schema
rejected that otherwise valid roster before participant monitoring could be reconciled.

**Impact on sales enablement**

The portal could not display invitation or participation monitoring and emitted a
correlated reconciliation failure. The Sales Support aggregate also initially omitted
the `sales-session-participants` diagnostic source, making that failure inaccessible
from its supplied correlation link.

**Portal mitigation**

`SalesDelivery.listParticipants` now accepts either the published `{ participants }`
shape or the observed `{ count, items }` shape. For the latter it uses documented
`offset` and `limit` query parameters, reads until the declared count is satisfied,
and fails closed when a later page contradicts that count or makes no progress. A
null `envStatus` is preserved as the authoritative pre-environment state; the portal
does not infer a runnable environment from the placeholder `envId`. Every CloudShare
diagnostic now retains the full verbatim request body, response body, and query
parameters at the shared client boundary. Only the explicit operational request-header allowlist
remains visible; every other request header is redacted, while body credentials, tokens, invitation links, and sponsored-login URLs remain
intact in protected Customer-scoped admin evidence. Participant and environment
correlation values remain server-only in browser projections. Sales Support includes
the participant reconciliation source in both direct, Customer-scoped filtered reads
and the aggregate correlation feed.

**Action required**

CloudShare should reconcile the v4 OpenAPI definition for
`GET /sales/{id}/participants` with the live paged response, including pagination
semantics and the role of `count`.

**Code reference:** `src/integrations/cloudshare/sales-delivery.ts`,
`src/api/sales-diagnostics.ts`,
`docs/api/assets/cloudshare-public-api-v4-2026-07-10.json`

---

## GAP-31 — Live Sales roster uses lowercase `preparing` environment status

**Jira tracking:** [BAC-26412](https://cloudshare.atlassian.net/browse/BAC-26412)

| Field | Evidence |
| --- | --- |
| **Verified live** | Yes — Certalis Sales instant-launch QA, 2026-07-18 |
| **Exported contract** | `envStatus` enumerates PascalCase `Preparing` |
| **Live observation** | `GET /v4/sales/{id}/participants` returned HTTP 200 with `envStatus: "preparing"` after sponsored-link launch, then lowercase `envStatus: "ready"` as the same participant progressed. IDs, URLs, and credentials are intentionally omitted. |

**Impact:** Strict enum parsing rejected an otherwise valid roster and hid the participant from Certalis monitoring.

**Portal behavior:** `SalesDelivery` case-insensitively normalizes only values in the exact documented Sales environment-status enum to their canonical typed spelling. Unknown strings remain strictly rejected.

## GAP-30 — Sales participant invite acknowledgement does not confirm invitation dispatch

**Jira tracking:** [BAC-25363](https://cloudshare.atlassian.net/browse/BAC-25363) (authoritative); [BAC-26411](https://cloudshare.atlassian.net/browse/BAC-26411) (duplicate record)

| Field | Detail |
|---|---|
| **Status** | Provider now rejects the disabled-invitation request in production, but returns HTTP 400 rather than the BAC-25363 HTTP 409 contract; Certalis preflight retained |
| **Verified live** | Yes — original enabled/disabled invitation behavior on 2026-07-18; BAC-25363 production deployment probe with a disposable v4 Sales Experience and registered disposable participant on 2026-08-22 |
| **Provider ticket** | [SUP-5011](https://cloudshare.atlassian.net/browse/SUP-5011) |
| **Provider ticket title** | APIv4: invoking the send invitation endpoint for sales (and likley training) results in a 200 OK, even if the option to NOT send invites to either party has been enabled. This should be a 409 Conflict error |

**Observed behaviour**

The documented `POST /sales/{id}/participants/invite` endpoint accepts the documented
array of Sales Participant IDs and returns HTTP 200 with an empty body. In #348 human
QA, Certalis sent the exact documented request for two registered, property-correlated
Sales Participants. The immediate authoritative roster read still returned
`invitationStatus: "notSent"` for both participants.

CloudShare GUI verification then identified the prerequisite: the Experience was created
with both “Don't send Invitation to Participants” and “Don't send Invitation to Sales
Pros” enabled, corresponding to `sendInvitations: "dontSend"`. The GUI blocks the same
operation with “Sending invitations to participants was disabled for this experience.”
The REST endpoint instead returns HTTP 200 with an empty body and does not report that
precondition. The published endpoint does not return per-participant delivery results,
errors, or a job identifier. Certalis has no documented alternate native-invite endpoint
to call; it must not expose or fall back to participant invitation URLs.

On 2026-08-22, after CloudShare R&D marked BAC-25363 done, a production probe recreated
the same disabled configuration (`sendInvitations: "dontSend"`) on a disposable Sales
Experience through the documented v4 Sales endpoints, registered one disposable
participant through the documented endpoint, and called
`POST /sales/{id}/participants/invite` with that participant. Production rejected the
request with HTTP 400 and disabled-invitation semantics. This confirms the legacy empty
HTTP 200 acknowledgement is no longer present in the tested production path, but does not
confirm the BAC-25363 HTTP 409 Conflict contract. The response body also did not provide
a dependable structured error shape, so Certalis must not couple behavior to it.
Provider object identifiers, participant details, URLs, raw protected bodies, and exact
correlation values are intentionally omitted here; the Customer-scoped diagnostic record
retains the correlation metadata under the protected evidence contract. The disposable
Experience cleanup completed with a successful delete followed by an independent
not-found readback.

A disposable live Sales Experience was subsequently created with
`sendInvitations: "salesProsAndParticipants"`. CloudShare returned HTTP 201, persisted
that setting, and returned one Sales Pro and zero participants. The documented Sales Pro
roster does not expose an invitation-status field. CloudShare GUI human QA then confirmed
that the sole Main Sales Pro was `Not sent` (`0 of 1 invited`): enabling the capability at
creation does not itself issue an invitation email.

**Portal mitigation**

New Sales Experiences use the documented `sendInvitations: "salesProsAndParticipants"`
capability setting. Certalis makes no participant or Sales Pro invite request during
creation or registration; the GUI evidence above confirms CloudShare does not send an
automatic Main Sales Pro email merely because the capability is enabled. Before calling
the native participant invite endpoint,
Certalis reads the Experience configuration and returns an actionable 409 if participant
invitations are disabled. For enabled Experiences it performs a roster read immediately
after the POST and uses the returned `invitationStatus` as the only delivery authority.
It records the configuration read, POST, and roster exchanges under the same correlation
ID, persists the returned monitoring state, and never labels the empty-body
acknowledgement as a sent email.

The 2026-08-22 production verification independently exercised this preflight against the
same disabled disposable Experience. Certalis returned correlated
`409 native_invitations_disabled` after the capability read and made zero calls to the
participant invite endpoint. The provider's partial correction therefore remains defense
in depth and does not justify weakening the portal mitigation.

**Action required**

CloudShare R&D should complete the BAC-25363 contract for
`POST /sales/{id}/participants/invite`: a disabled Experience now yields a non-success
response in the tested production path, but it is HTTP 400 rather than HTTP 409 Conflict
and lacks a dependable structured error shape. Existing `dontSend` Experiences must be
amended in CloudShare or recreated before their native invitations can be sent. With
both invitation settings enabled, #348 human QA selected a Sales Participant, requested
the native invitation, observed the portal roster change to `sent`, and received the
native email. That confirms the explicit participant-delivery path. The separate
creation-time Main Sales Pro check also passed in the CloudShare GUI: `Not sent` / `0 of
1 invited`.

CloudShare support ticket [SUP-5011](https://cloudshare.atlassian.net/browse/SUP-5011)
tracks the provider acknowledgement defect.

**Code reference:** `src/api/sales-session-participants.ts`,
`src/integrations/cloudshare/sales-delivery.ts`,
`docs/api/assets/cloudshare-public-api-v4-2026-07-10.json`

---

## GAP-32 — Sales roster `envId` is not the v3 Environment ID

**Jira tracking:** [BAC-25629](https://cloudshare.atlassian.net/browse/BAC-25629) (authoritative); [BAC-26455](https://cloudshare.atlassian.net/browse/BAC-26455) (duplicate record)

| Field | Detail |
|---|---|
| **Status** | Confirmed; historical v3 mitigation #370, current v4 observation mitigation #469 |
| **Verified live** | Yes |

**Historical v3 evidence (#370)**

The v4 Sales participant roster returns a 19-character numeric `envId`; it is not the
opaque identifier accepted by v3 Environment actions. The verified resolution chain is
Customer-credential-scoped `GET /api/v3/envs?ownerEmail=<participant>&brief=false`, an
exact server-side match to the Session Item Project, then
`GET /api/v3/envs/actions/getextended?envId=<opaque-v3-id>`.

**Historical containment**

Exactly one same-Project match is required. Zero or multiple matches are persisted and
projected as an explicit needs-attention reason/source. Actual v3 exchanges and opaque IDs
remain confined to protected Customer-scoped diagnostics; the roster reference is stored
under a name that does not claim it is a v3 Environment ID.

**Current v4 evidence — 2026-10-26 (#469)**

At `80d88a8e54ff83fb2556a87065be78286a0c8261`, real Sales and Trial UI flows verified
opaque Environment observation through v4 list/detail, with exact normalized owner and Item
Project binding. The numeric Sales roster reference remains a separate value and is never sent
as an opaque Environment ID. Certification's training-correlated opaque ID also read successfully
through v4. Sales cancellation and Trial extension retained their existing v3 command transports
and confirmed outcomes through v4 readback. New status/time evidence is explicitly v4; old numeric
and roster evidence remains historical. See the [consumer evidence](../discovery/2026-10-26-environment-v4-migration.md)
for command counts, Support isolation, and verification limits.

**Code reference:** `src/integrations/cloudshare/environment-observation.ts`, `src/integrations/cloudshare/environments-v4.ts`,
`src/api/sales-session-participants.ts`

---

## GAP-33 — No documented per-participant Sales Environment history or count

**Jira tracking:** [BAC-25629](https://cloudshare.atlassian.net/browse/BAC-25629) (authoritative); [BAC-26413](https://cloudshare.atlassian.net/browse/BAC-26413) (duplicate record)

| Field | Detail |
|---|---|
| **Status** | Confirmed contract gap |
| **Verified live** | Partial — deleted Environment was absent from the Customer's v3 owner-email list on 2026-07-20 |

**Observed behaviour**

The documented v4 `GET /sales/{id}/participants` roster exposes one nullable `envId` and
an `envStatus` enum that includes terminal values such as `Deleted`. It does not expose an
array of Environment instances, a per-participant count, timestamps, or a documented guarantee
that the single reference represents a complete history when the Sales Experience permits
multiple sequential Environment activations. The documented v3 owner-email list is a
listable-Environment observation; HTTP `200` with an empty list is a semantic result, not a
provider request failure and not proof that the participant never consumed an Environment.

**Impact on Certalis Sales Sessions**

Certalis can display a roster-associated Environment state with its v4 source, and can perform the
separately labelled v4 owner-and-Project listable-Environment observation. It cannot claim a
complete historical Environment list or count for a participant in a Sales Experience. The
undocumented `environmentsGrid` route is not an integration path and must not be used to fill this
gap.

**Current v4 evidence — 2026-10-26 (#469)**

Real Sales and Trial flows at `80d88a8e54ff83fb2556a87065be78286a0c8261` confirmed current
opaque Environment reads, separate source/time persistence and unchanged command readback.
The v4 contract excludes storage-expired Environments and expired Projects. Its `expirationTime`
is storage deletion, not runtime remaining or Experience End. Live Trial extension/Ending retained
the Environment and its history; no deletion/history-completeness experiment was performed.
The dated v3 absence evidence above remains historical. Neither the current v4 observations nor
an empty list supplies a complete per-participant history/count or proves never-consumed state.
GAP-33 therefore remains open; GAP-28's Project-member eligibility contract is unaffected.

**Action required (CloudShare contract clarification)**

Request a documented Customer-scoped read that returns all Environment instances consumed by a
named Sales participant in one Sales Experience, including roster-associated and terminal state,
timestamps,
and a reliable count when multiple sequential activations are enabled.

CloudShare R&D follow-up: [SUP-5012](https://cloudshare.atlassian.net/browse/SUP-5012),
“APIv4: When listing the participants within an experience, what does the `envId` mean, and how
can you get a historical list of environments that might have been consumed?”

**Code reference:** `docs/discovery/2026-07-20-cloudshare-sales-participant-environment-history.md`,
`src/api/sales-session-participants.ts`

---

## GAP-34 — Ending a Sales Experience blocks sponsored-link access to policy-live environments

| Field | Detail |
|---|---|
| **Status** | Confirmed and mitigated |
| **Verified live** | Yes |

**Observed behaviour**

The local v4 OpenAPI export for `POST /sales` and `PUT /sales/{id}` models `end` as nullable on the
Sales Experience shape. Certalis now treats an explicitly opted-in open-ended Trial Offering as a
supported request and sends `end: null` on publish. Live QA confirmed that ending the Sales
Experience blocks its Sponsored Link even when a participant remains In Progress and their
environment still exists under its Policy storage lease. The documented v3
`GET /envs/actions/getextended?envId=...` response supplies the authoritative `expirationTime` and
numeric status. Status 4 (Archived) remains policy-live; only 5 (Deleted) and 9 (Creation Failed)
are terminal for this shutdown calculation.

**Impact on Certalis Sales Trial use**

End Trial now unpublishes the portal Offering immediately, then keeps the CloudShare Experience
open until five minutes after the latest non-terminal environment expiration. With no non-terminal
environments it uses a two-minute grace. Reconciliation runs immediately, on participant reopen,
on admin catalogue/monitoring reads, and every five minutes in the local Portal process. It may move
the provider end later but not earlier while active environments remain. Partial reads retain the
local `Ending` state, do not shorten the provider window, and expose protected support diagnostics.
The first all-terminal observation persists a separate two-minute terminal-grace target before the
provider mutation, so ambiguous PUT retries reuse exactly the same target. A renewable, fenced
per-Offering database lease serializes timer, admin, and participant-triggered reconciliation.

**Deployment note:** the five-minute timer is process-local for this demonstrator. A horizontally
scaled production deployment requires one durable external scheduler or distributed lease so that
only one worker owns each reconciliation pass.

**Code reference:** `src/api/sales-trial-offerings.ts`,
`src/api/sales-trial-enrollment.ts`,
`src/domain/sales-trial-ending.ts`,
`src/integrations/cloudshare/sales-environment.ts`,
`src/integrations/cloudshare/sales-delivery.ts`,
`docs/api/assets/cloudshare-public-api-v4-2026-07-10.json`

---

## GAP-35 — Live default extension outcome for a retained Trial Environment

**2026-10-27 migration note (#473):** the current command is bodyless v4 POST
`/v4/environments/{id}/extend`, followed by authoritative v4 observation. One actual automated
Sales UI extension returned 204, increased storage by 24 hours, coordinated a separate access PUT,
and displayed completed/confirmed readback. Separate viewer runtime readings increased from 48m
to 1h43m across elapsed time and rounding. This does not prove exact runtime seconds or preserved
guest data/work. Trial UI launch/binding/Ready evidence exists, but Trial Extend is held at zero
because no guest-work witness was obtained. At that earlier checkpoint, independent acceptance reviews kept preserved-work
proof blocking; structural identity continuity alone was insufficient. A second isolated Trial run
confirmed Incognito identity/local role controls and resumed the same Environment, but the guest
remained Connecting and no witness was saved. Correct isolation is not sole-cause proof. Trial
Extend remains zero; one additional cleanup Suspend confirmed Suspended and owned servers stopped. Scoped live Support success and
malformed-ID GET 400 evidence passed, alongside audited synthetic HTTP failure/recovery/isolation
checks. GET 400 is neither valid-missing 404 nor Extend 403 proof. The historical v3 evidence below
remains historical, not a general v4 eligibility guarantee. See the
[migration evidence, provenance and blocked gates](../discovery/2026-10-27-default-extension-v4-migration.md).

**2026-10-28 manual Sales update:** independent QA and Spec accepted the human-observed same
Windows/pfSense application state before/after extension with exact-Environment diagnostics.
No saved file is mandated by #473; the accepted witness proves observed application continuity,
not arbitrary guest bytes or saved pfSense configuration. One further bodyless Extend POST 204,
Ready GET and access PUT 200 increased storage expiry from `2026-10-29T13:53:30Z` to
`2026-10-30T13:53:30Z`. At that Sales checkpoint, Trial Extend and continuity remained pending and overall acceptance
was blocked. Port 3025 was left up for the human at that checkpoint; subsequent Trial acceptance
and cleanup are recorded below. The linked migration record contains the frozen manifest and timing limits.

**2026-10-28 manual Trial update:** independent QA and Spec accepted the same retained Windows
2022 Notepad document/text before and after one bodyless Extend POST 204 with Ready GETs and
expiry `2026-10-28T14:19:40Z` to `2026-10-29T14:19:40Z`. Close/reopen with unchanged contents
is separately human-reported. No new Trial console capture or portal screenshot was collected.
Live acceptance criteria now pass within the recorded limits; final exact-head reviews/merge
remain pending, with PR #476 draft/unmerged and issue #473 active. After confirmed viewer closure,
one guarded Suspend per owned Environment returned 204 and exact GET confirmed Suspended;
owned servers stopped and ports 3025/3026 are free. Frozen evidence and precise timestamps are
in the migration record. Earlier Trial Extend-zero and blocked entries remain historical.



| Field | Detail |
|---|---|
| **Status** | Confirmed |
| **Verified live** | Yes — the real Sales Admin UI extended one disposable retained Trial Environment on 2026-09-03 and reconciled the provider expiry before reporting success. |

**Observed behaviour**

The Certalis Sales Admin browser flow resolved one exact Customer-scoped retained Environment,
read its current state, and sent the documented bodyless
`PUT /api/v3/envs/actions/extend?envId=...` request. CloudShare returned 200. A post-operation
`getextended` read changed the provider expiration from `2026-09-04T13:19:10Z` to
`2026-09-05T13:19:10Z`, an exact 24-hour retention increase. The CloudShare UI independently
showed remaining runtime increase from 47 minutes to 1 hour 47 minutes, an exact 60-minute runtime
increase. Protected diagnostic correlation `df3fab1e-7eb8-4dad-8c05-8dc2f009cbe3` retains the
resolution, pre-read, PUT, and post-read exchanges without exposing provider identifiers in the
ordinary portal UI.

**Impact on Certalis Sales Trial use**

The verified tenant default is two-dimensional: one extension adds 60 minutes of runtime and moves
the deletion/retention expiry forward by 24 hours. Certalis does not assume those durations in code;
it remains fail-closed and reports success only after the provider expiry readback changes.

**Code reference:** `src/integrations/cloudshare/sales-environment.ts`,
`src/api/sales-trial-enrollment.ts`

---

## GAP-36 — Published v4 remote-access-file coverage does not replace VMware v3 coverage

**Jira tracking:** [BAC-29261](https://cloudshare.atlassian.net/browse/BAC-29261) (authoritative VMware request; Backlog),
parent [BAC-29246](https://cloudshare.atlassian.net/browse/BAC-29246) (Selected for Development), and
[BAC-26323](https://cloudshare.atlassian.net/browse/BAC-26323) (Merged public-cloud implementation).
Statuses were checked on 2026-10-29; a planned route is not published or deployed support.

| Field | Detail |
|---|---|
| **Status** | Confirmed published-contract coverage gap; VMware v4 implementation remains provider-owned backlog |
| **Verified live** | Partial — bounded VM metadata only on 2026-10-29; remote-access-file retrieval and native RDP remain untested |

**Observed behaviour**

The [official Classic v3 source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/V3/nodes/cloudshare-API-v3.openapi.json?branch=main)
documents `GET /api/v3/vms/actions/getremoteaccessfile` with required query parameters `vmId`
(an MC VMware VM example), `desktopWidth` and `desktopHeight`. Its 200 response is
`application/json`, model `RemoteAccessFile`, containing `rdpFileContent` and `clearTextPassword`;
it is not the v4 binary-attachment contract. The immutable user-provided v3 bundle and its
[provenance/comparison](cloudshare-api-reference.md#local-reference-files) preserve this reference.

The [official Infrastructure v4 source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/reference/infrastructure-Public-API.openapi.json?branch=main)
checked on 2026-10-29 documents
`GET /v4/environments/{environmentId}/public-cloud-vms/{vmId}/remote-access-file` for EN Environment
and EM public-cloud VM identifiers. It returns an `application/rdp` binary attachment, requires
Environment view permission, and documents 400 for a non-EM/malformed VM identifier, incomplete
provisioning or no external address. Its 404 includes a VM not belonging to the Environment.
These are documented outcomes, not tested failures, and this public-cloud contract is not a
documented MC replacement.

The bounded #411 metadata audit of one authorized disposable Environment returned four Windows
MC entries with external addresses; the public-cloud list had zero items and count zero. VMware
`count: null` leaves completeness unknown. The earlier viewer observation of two VMs was separate
loading-time evidence. No RDP endpoint was called, no file was generated/downloaded, no native
client connected, and no non-EM or absent-address failure was probed. Metadata alone proves
neither file availability nor native connectivity.

**Impact on Sales Trial use**

**Current disposition (2026-10-29, superseding the earlier v4-only direction):** the user authorizes
[#411](https://github.com/cloudshare/cloudshare-demo-portal/issues/411) / PR #478 to use the documented
v3 MC remote-access-file endpoint now, then migrate when v4 VMware coverage becomes available.
BAC-29261 is a future v4 migration follow-up, not a dependency or blocker for #411. Access remains
per Windows VM using provider-produced file content; a native-client credential prompt is accepted.
Locally generated RDP, EM/MC substitution, guessed routes and silent public-cloud Blueprint
substitution remain unauthorized. This documentation change implements no RDP behavior and claims
no successful file retrieval or connection.

**Historical disposition (earlier on 2026-10-29):** #411 / PR #478 was blocked under the then-current
v4-only direction, with no v3 fallback authorized. The current disposition above supersedes that
decision; the bounded metadata and untested-behavior observations remain unchanged.

“Private VM” here means the VMware/private-cloud category; it does not promise native RDP to a
secure-access-only or private-IP network.

**Action required (CloudShare contract and implementation)**

Reuse BAC-29261 rather than creating a duplicate. Its proposed
`/api/v4/environments/{envId}/vms/{vmId}/remote-access-file` is planned only. BAC-26323 explicitly
re-scoped generic download to the public-cloud route; its Merged status does not establish VMware
parity. Request published and deployed v4 coverage for eligible Windows VMware/private-cloud and
public-cloud VMs, with correct Customer/Environment/VM ownership and permissions, readiness and
external-address eligibility, explicit secure-access-only/unavailable outcomes, and provider-produced
files with documented content type/disposition. Provider confirmation and live verification of
the replacement contract are future v4 migration gates, not prerequisites for the authorized v3
implementation in #411. Closing documentation issue #485 does not
close #411 or change BAC-29261's provider-owned status.

---

## GAP-N — Short descriptive title

| Field | Detail |
|---|---|
| **Status** | Confirmed / Suspected / Unverified |
| **Verified live** | Yes / No / Partial |

**Observed behaviour**

[What CloudShare actually does, with enough detail to understand the deviation from
expected behaviour.]

**Impact on certification use**

[How this gap affects the proctoring portal, what risk it creates, and any mitigations
already in place.]

**Action required (if applicable):**

[Outstanding verification, support enquiry, or follow-up task. Omit if the gap is
fully understood and mitigated.]

**Code reference:** (optional) `src/...`
```

---

*Last updated: 2026-10-29 (added GAP-36 remote-access-file coverage; existing GAP statuses unchanged).
Maintained by: portal team. Append new entries above the gap template; do not renumber existing gaps.*
