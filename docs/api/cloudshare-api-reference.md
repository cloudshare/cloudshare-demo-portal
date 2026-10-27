# CloudShare API Reference Sources

This project keeps local CloudShare API exports so implementation agents do not infer endpoint
paths from memory or from earlier slices.

## Source and implementation status (2026-10-27)

**PUBLISHED CONTRACT:** The [current official Infrastructure 4.0 source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/reference/infrastructure-Public-API.openapi.json?branch=main)
was downloaded on 2026-10-26 and preserved in the export listed below. Projects and Project-scoped
Policy list/detail use this contract. The July Experience export has a different scope.

**IMPLEMENTED IN #468 / PR #470:** All Project and Policy discovery consumers use v4, including
Exam/Sales authoring, Sales provisioning validation and Sync Resources. Projects traverse the
`{count, items}` pages with `Count=true`, `Offset` and `Limit=100`; Policy lists omit limit to return
all active rows, and details supply exact-identity runtime/storage minutes. See the
[migration inventory and evidence](../discovery/2026-10-26-project-policy-v4-migration.md).
**LIVE VERIFIED (2026-10-26, `e11d674`):** Independent browser QA exercised Exam and Sales Item
selection/save/reopen, Sync Resources through a disposable same-origin form, Support success and
an authorized OAuth-403 failure/restoration. Console: zero warnings/errors; relevant live checks:
3/3. Exact v4 Project ids worked with retained v3 Blueprint/member/Team reads. No new Experience
write, known-inactive Policy exclusion or Team Member permission-empty behavior was live-proven;
see the dated evidence report above for these boundaries.

**RETAINED V3:** Blueprint/default-Snapshot, VMware Regions, Teams, active Project members,
timezones, ping and Environment Archive/Extend commands (Extend is tracked by #473). #472 migrates
suspend/resume to bodyless v4 POST with empty204 acknowledgement and a durable per-Attempt
no-replay marker; see [contract and acceptance evidence](../discovery/2026-10-26-suspend-resume-v4-migration.md). #469 migrates all
Environment list/detail observations to v4. Existing v4 Experience/participant/sponsored-link/Guided Journey behavior is unchanged.
#351 / PR #448 is merged in the baseline; its older unmerged wording is historical.

## Suspend/resume live evidence (#472, 2026-10-27)

Reviewed runtime head `7756114f81f8276362cf547f6b07a356921eae72` is unchanged. An isolated
replacement real UI flow produced three bodyless v4 Suspend POST 204 writes (explicit, heartbeat,
logout) and two Resume POST 204 writes, with exact Suspended/Ready readbacks and retained clock.
Settled explicit Suspend, post-timeout Home and logout console captures each had zero warnings/
errors and were independently accepted. Stage 0's demonstrated browser-side attribute injection
and extension-source error have a narrow environmental attribution; not every console was zero.
Original real Admin Support success/synthetic invalid-ID GET 400 and foreign Customer API 404
remain separate evidence; no provider valid-missing 404 claim is made.

Original UI S3/R2 plus separately authorized API cleanup S1 remain historical, separate from the
replacement S3/R2 ledger. Final replacement provider/local state was Suspended, clock paused
185978 ms, no pending command or session; jobs/server stopped and temporary credential restored.
Coordinator option 2 accepts unchanged Archive regression through independent audit and 58/58
existing automated tests. B's live Archive evidence is historical; current-ticket Archive count is
zero. Archive/Extend transport remains v3, never DELETE. See the
[acceptance matrix, chronology and preservation limits](../discovery/2026-10-26-suspend-resume-v4-migration.md).
Final documentation review and lifecycle disposition remain required; no merge is claimed.

## Local Reference Files

- `docs/api/assets/cloudshare-infrastructure-v4-2026-10-26.json`
  - Current official Infrastructure 4.0 OpenAPI export, retrieved 2026-10-26.
  - Project/Policy contracts: `/v4/projects`, `/v4/projects/{projectId}/policies`,
    `/v4/projects/{projectId}/policies/{policyId}`; `PolicyBriefResponse` / `PolicyResponse`.
  - SHA-256: `58d85edb9f8982c9130138c120dcbd5546d9bf3eb140be4a763a174d11f7c325`.

- `docs/api/assets/cloudshare-public-api-v4-2026-07-10.json`
  - Exported CloudShare Accelerate API OpenAPI 3.1 bundle.
  - Source date: 2026-07-10.
  - API title/version in export: `Accelerate API` / `v4`.
- `docs/api/assets/cloudshare-guided-journey-progress-2026-07-10.yml`
  - Exported Guided Journey Progress OpenAPI 3.0.1 bundle.
  - Source date: 2026-07-10.
  - API title/version in export: `CloudShare Guided Journey APIs` / `1.0.0`.

When changing CloudShare v4 integration code, check these local exports first. If the live tenant
contradicts the export, update `docs/api/cloudshare-gap-report.md` with the live evidence and keep
the adapter isolated behind `src/integrations/cloudshare`.

## Accelerate v4 Training Contract Inventory

The July exported v4 bundle lists the following training paths relevant to the MVP. This is a
published-contract inventory, not a claim that every operation is shipped or live verified:

| Capability | Method | Path |
| --- | --- | --- |
| Create/list trainings | `GET`, `POST` | `/trainings` |
| Read/update/delete training | `GET`, `PUT`, `DELETE` | `/trainings/{id}` |
| Add/list students | `GET`, `POST` | `/trainings/{id}/students` |
| Edit student | `PUT` | `/trainings/{trainingId}/students/{studentId}` |
| Add/list instructors | `GET`, `POST` | `/trainings/{id}/instructors` |
| Edit instructor | `PUT` | `/trainings/{trainingId}/instructors/{instructorId}` |
| Sponsored link | `POST` | `/trainings/{id}/sponsored-link` |
| Training user-property definitions | `GET`, `POST`, `DELETE` | `/trainings/{trainingId}/users/properties` |
| Specific training user-property definition | `PUT`, `DELETE` | `/trainings/{trainingId}/users/properties/{propertyId}` |
| Student environment correlation | `POST` | `/trainings/{trainingId}/students/{studentId}/environment` |
| Create student unassigned environment | `POST` | `/trainings/{trainingId}/students/unassigned-environment` |
| Read/delete student unassigned environment | `GET`, `DELETE` | `/trainings/{trainingId}/students/{studentId}/unassigned-environment` |

Important: training user-property definitions use `/trainings/{trainingId}/users/properties`, not
`/trainings/{trainingId}/user-properties`.

For training user-property definitions, `GET /trainings/{trainingId}/users/properties` returns all
definitions for the Experience; it is not filterable by key. Treat a `null` or empty array response
as no definitions, then compare keys locally. `POST /trainings/{trainingId}/users/properties` takes
an array body such as `[{ "name": "certalisExamAttemptId" }]` and returns an array of created
definitions.

## Guided Journey Progress Paths

The Guided Journey export lists:

| Capability | Method | Path |
| --- | --- | --- |
| Experience aggregated progress | `GET` | `/guided-journey/progress/{experienceId}` |
| Participant progress | `GET` | `/guided-journey/progress/{experienceId}/{participantId}` |

These endpoints are v4 Accelerate endpoints and use the same base URL:
`https://api.accelerate.cloudshare.com/v4`.

## Guardrails For Future Changes

## Environment observation (#469)

Certification state/lease reads and Sales/Trial observation use `GET /v4/environments/{id}`.
Sales owner resolution traverses `GET /v4/environments?OwnerEmail=...&Count=true&Offset=...&Limit=100`.
Owner filtering is a substring search; exact normalized owner and exact Project are checked after
all pages and again on detail. Zero/multiple matches, inconsistent pages and changed detail identity
fail closed. Numeric Sales roster `envId` remains distinct from opaque Environment IDs.

Only live/non-storage-expired Environments are listed; expired Projects are excluded. No complete
participant history/count is inferred. Historical numeric evidence remains v3; new persisted v4
status/time is separate from roster evidence. Known history survives a missing list match.

RFC1123 UTC `startTime`/`expirationTime` are validated at the integration seam; expiration means
storage deletion, never runtime remaining or Experience End. All documented statuses remain
non-actionable unless existing lifecycle rules admit them. Unknown states do not grant an active
external lease. Archive remains v3, never DELETE; all command dispatch/fences remain unchanged.

Live UI verification on 2026-10-26 at `80d88a8e54ff83fb2556a87065be78286a0c8261` confirmed
Certification training-to-opaque-Environment correlation, the separate external-lease consumer,
Sales exact owner/Project resolution and numeric-roster distinction, and Trial Extend/Ending
readback. Commands remained on their existing transports. See the
[consumer evidence and limits](../discovery/2026-10-26-environment-v4-migration.md).
Synthetic-ID HTTP 400 proves input-rejection diagnostics only; valid-missing 404 remains offline
coverage. GAP-28 is unchanged and GAP-33 remains a complete-history contract gap.

- Do not use `/api/v3/class/*` endpoints for Accelerate Experience user properties.
- Do not invent v4 endpoint paths from surrounding naming patterns; verify them in the local export.
- Preserve typed request/response models at the `integrations/cloudshare` boundary.
- Keep failed CloudShare calls supportable with redacted method/path/status/request/response evidence.
- When CloudShare docs and live behavior differ, prefer the live-safe adapter behavior and record the
  discrepancy in `docs/api/cloudshare-gap-report.md`.

## Existing default Environment extension (#473)

Selected Sales Participant and retained Trial extension use bodyless
`POST /v4/environments/{id}/extend` from the Infrastructure export. Omitting the body applies
both Policy runtime and storage defaults; no custom duration is sent. Empty 204 is acknowledgement,
not lifecycle confirmation. Existing authoritative v4 expiry/state readback and Sales access-window
coordination remain required. Archive stays v3. See the [consumer and remaining-v3 inventory](../discovery/2026-10-27-default-extension-v4-migration.md)
for implementation evidence and pending live acceptance; historical v3 extension results are not
v4 eligibility proof.

**Verification update (2026-10-27):** independent audit accepted the exact-runtime-head actual HTTP
simulation: 126 synthetic exchanges, 9 unique bodyless Extend POSTs, no replay, protected evidence
and Customer isolation. Three live read-only checks passed. One real automated Sales Extend UI
click produced POST 204, authoritative increased storage expiry, separate access PUT 200 and
completed/confirmed UI evidence. Independent viewer runtime observations are retained separately.
Live Support success and malformed-ID GET 400 diagnostics passed; this is not Extend 403 evidence.
Trial launch/Ready evidence exists, but Trial Extend remains zero. Both Sales and Trial lack the
required guest-data/preserved-work witness, so acceptance remains blocked with no structural-only
waiver. See the [migration evidence record](../discovery/2026-10-27-default-extension-v4-migration.md)
for corrected original-click timestamps, console limitations, provenance and preservation state.
No general v4 state-eligibility or guest-work-preservation guarantee is inferred.
