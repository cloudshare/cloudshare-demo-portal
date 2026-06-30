# CloudShare API Gap Report

Living document tracking observed gaps between the CloudShare API's behaviour and the
requirements of a high-integrity certification/proctoring integration. Seeded from
discovery sessions and implementation experience; later slices should append new gaps
in the format below.

**How to append a gap:** copy the [gap template](#gap-template) at the bottom, assign
the next `GAP-N` identifier, and fill in the five fields. Commit alongside the slice
PR that surfaced the gap.

---

## GAP-1 — Dual, inconsistent authentication schemes

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

**Impact on certification use**

- Score retrieval must be keyed by the correlated CloudShare participant id, so missing or stale
  participant correlation is now a supportable retrieval failure rather than a misleading "no score".
- The portal now maps the participant-progress payload to the candidate score UI by
  showing raw Guided Journey rates plus section progress, while avoiding any fake composite
  certification score.
- Final certification pass/fail weighting is determined outside this portal's Guided Journey view.
- These limitations must be disclosed to the exam author when configuring checkpoints.

**Code reference:** `src/integrations/cloudshare/guided-journey.ts`,
`src/domain/environment-correlation.ts`, `src/api/score.ts`

---

## GAP-8 — Documentation is fragmented; pre-provision SLA is ambiguous (UNVERIFIED)

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

| Field | Detail |
|---|---|
| **Status** | Confirmed / partially verified — from CloudShare admin and live v3 resource probing |
| **Verified live** | Partial (resource scoping verified; some response shapes still pending) |

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

| Field | Detail |
|---|---|
| **Status** | Confirmed — from CloudShare admin |
| **Verified live** | Partial (v3 ping exists; v4 requested, not available) |

**Observed behaviour**

v3 exposes a simple `ping` → `pong`; v4 has no equivalent health endpoint (requested of CloudShare,
not yet shipped). Connection validation must therefore use the **v3 `ping`**.

---

## GAP-13 — No API to detect whether a Guided Journey exists for an experience

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

---

## GAP-15 — Per-project webhook registration via the v3 API is unverified

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
- `End` as `Start + Exam.timeLimitMinutes`; live Issue #251 verification confirmed CloudShare
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
`End` field in the `POST /v4/trainings` body, derived from the Exam's persisted
`timeLimitMinutes` (`Start + timeLimitMinutes`). A real Candidate UI scheduling flow for the
10-minute `Windows Boxes` Exam created training `EXVUAmxA5jgVfM29E2D4cTNA2`; the admin-visible
`cloudshare.create_training` diagnostic recorded `Start: 2026-06-30T15:48:00.000Z` and
`End: 2026-06-30T15:58:00.000Z`, and a live `GET /v4/trainings/{id}` readback returned
`start: 2026-06-30T15:48:00` and `end: 2026-06-30T15:58:00`. The public Stoplight documentation
page was reachable but did not expose the create-training operation model in static HTML during
agent verification, so live tenant behavior is the evidence path for this field.

**Update (2026-07-01, Issue #251 QA clarification):** the `End` field on
`POST /v4/trainings` is the CloudShare training/Experience run-window end, not the storage-release
time. For a Policy with a 10-minute runtime lease and a separate 2-day storage lease, the portal
should send `End = Start + 10 minutes`; the 2-day storage release remains Policy-owned CloudShare
retention behavior and is not controlled by the v4 create-training `End` field. The CloudShare GUI's
Policy details page may use an MVC URL such as
`/Ent/PackagesReport.mvc/Details?token={policyIdWithoutPoPrefix}` (for example, Policy
`POavMAu1wiaVydJdYUOAExJg2` is viewed with `token=avMAu1wiaVydJdYUOAExJg2`), but this is UI routing
evidence rather than the portal's API contract. Do not infer that the Policy edit/details MVC token
URL is required for this slice: the portal's read-side Policy evidence path remains the
live-verified v3 Project policy detail endpoint
`GET /api/v3/projects/{projectId}/policies/{policyId}` for fields such as `runtimeLeaseMinutes` and
`storageLeaseMinutes`.

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

**Code reference:** `src/api/suspend-resume.ts`, `src/web/lab-launcher.tsx`

---

## Gap template

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

**Update (2026-06-29, issue #244 redaction taxonomy audit):** CloudShare diagnostic bodies now use
an explicit three-way taxonomy across client traces, scheduling/runtime diagnostics, Guided Journey
diagnostics, and resource diagnostics:

- **Always redact:** API keys, bearer tokens, authorization headers, webhook secrets,
  HMAC/signature values, passwords, and actual credentials.
- **Admin-only server evidence:** sponsored-link `loginUrl` values and training `passphrase`
  values remain visible in admin-only `DiagnosticLogEntry` evidence.
- **Ordinary support evidence:** CloudShare request bodies, response bodies, and parsed webhook
  event payloads remain visible by default, including auth-adjacent body field names such as
  `token` or `authorization` when they are payload evidence rather than actual credentials.

Candidate/client-facing APIs remain stricter: admin-only evidence such as `loginUrl` must not
appear in candidate responses or candidate-facing UI even though it can appear in admin support
diagnostics. Header values remain conservatively redacted for now; a future guarded sensitive
diagnostic flag may make selected header values visible when needed.

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

*Last updated: 2026-06-24 (recorded CloudShare webhook `CreatedAt` as webhook-definition time, `EnvironmentName` as the CloudShare environment/blueprint display name, and archive webhook delivery lag after portal completion; retained polling/reconcile as the source of truth).
Maintained by: portal team. Append new entries above the gap template; do not renumber existing gaps.*
