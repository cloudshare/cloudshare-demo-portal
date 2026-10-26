# Project and Policy v4 migration — issue #468

## Scope and inventory (2026-10-26)

Baseline: `1f615591456c6106ebec1d798a334d1ff1bebfa1`.
Inventory completed before implementation using production references to `listProjects`,
`readProjects`, `listProjectPolicies`, `readProjectPolicies` and `/projects`/`policies` paths.

| Production consumer | Discovery interface | Behavior retained |
| --- | --- | --- |
| Admin Exam bootstrap and Project resource handler; Sales authoring uses the same handler | `createCloudShareExamAuthoringSource` | Customer cache, refresh, per-read observer anchors; await Policy list observer before starting details; prompt rejection with successful sibling observations |
| Exam publish and runtime Blueprint guard | Same authoring source | Blueprint/default-Snapshot reads remain v3; selected Policy validation uses cached/refreshed authoring resources |
| Sales Item create/update validation | `createCloudShareSalesItemResourceSource` | Fresh selections, storage-derived Sales duration, all-settled detail evidence and first input-order failure |
| Sales Item provisioning revalidation | Same Sales source | Selected Policy availability and default-Snapshot Region checks; all completed evidence retained |
| Admin Sync Resources | `createCloudShareResourceLister` | Per-instance cached Projects/Regions promises (including failures); Project-scoped concurrent Blueprint/Policy reads and existing observer anchors |
| Live Certalis Sales member preflight test | Shared discovery | Exact Project id passed to retained v3 member source |

All production Project and Policy provider calls are in `resources.ts`. No Environment interface,
read or command changes are included. Portal HTTP request/response shapes and authorization are
unchanged. The internal grouped Project read returns normalized data plus separate physical page
reads, never a synthetic aggregate provider body. Sales records completed pages even if a later
page fails; Exam and Sync observers record pages before requesting the next page.

## Published contract

Downloaded the [current official Infrastructure 4.0 source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/reference/infrastructure-Public-API.openapi.json?branch=main)
on 2026-10-26 via direct HTTPS. The browser source fetch was inaccessible; direct HTTPS succeeded.
Preserved byte-for-byte as `docs/api/assets/cloudshare-infrastructure-v4-2026-10-26.json`.
SHA-256: `58d85edb9f8982c9130138c120dcbd5546d9bf3eb140be4a763a174d11f7c325`.
This is published-contract evidence, not tenant verification.

- `GET /v4/projects`: `{count, items}`; `Count=true` requests total, `Offset` defaults to 0,
  `Limit` defaults/caps at 100. Adapter explicitly sends all three and traverses until total.
  Missing count/items, changing counts, duplicate identities, oversized or prematurely empty pages
  fail with the physical failing exchange; no partial result reaches authoring/cache.
- `GET /v4/projects/{projectId}/policies`: active Policies only; omitted limit returns all;
  lack of Team Member permission can return an empty list. Adapter requests `Count=true`, omits
  limit, verifies complete count and exact Project membership. Empty remains empty.
- `GET /v4/projects/{projectId}/policies/{policyId}`: detail supplies `runtimeMinutes` and
  `storageMinutes`; exact Project and Policy identities are checked before normalization.
  These map to `runtimeLeaseMinutes` and `storageLeaseMinutes`. Existing absent-duration handling
  remains null (no invented duration); invalid supplied durations fail schema validation.
- Exam runtime, authored open period and storage retention stay separate under ADR-005. Sales
  continues to derive its default duration from storage, not Exam runtime.
- Per-Customer encrypted Connections, opaque Bearer tokens/expiry handling and request-header
  allowlisting are unchanged. Protected page/list/detail response bodies remain verbatim.
- No v3 fallback. Blueprint/default-Snapshot, VMware Regions, Teams, members, timezones, ping and
  all Environment operations remain on their existing transports. Exact v4 Project ids pass
  unchanged to retained v3 discovery and existing v4 Experience payloads.

## Automated evidence

RED before GREEN at the accepted recording-HTTP discovery seam:

1. Paginated Project response initially failed against the old v3 array contract; changed to v4
   traversal with separate page evidence, then passed.
2. Incomplete, count-changing and duplicate Project pages initially returned partial/duplicate data
   or read past an empty page; contextual schema validation now fails on that physical page.
3. Policy envelope and detail-minute mapping initially failed against v3; migrated list/detail and
   Sync Resources, then passed.
4. Wrong Policy/Project identity and incomplete Policy list initially passed or failed on a later
   read; exact-identity/complete-list schema checks now fail at the relevant exchange.
5. Sales aggregate diagnostics initially claimed v3-only authoring; the neutral mixed-transport
   authoring surface now passes the handler assertion. Physical exchange surfaces retain v3/v4.

Regression coverage retains Exam observer ordering, Sales partial-success ordering, missing timing,
selected-resource validation, Customer isolation, cache refresh and ADR-005 behavior. New handler
coverage verifies page evidence is Customer-scoped, ordinary responses/logs exclude protected body
sentinels, and incomplete discovery never populates the authoring cache. Additional recording-HTTP
coverage exercises 101 Projects, empty permission responses, field-error and legacy errors,
failed-cache reuse, and exact v4 Project ids passed to retained v3 Blueprint reads.

The 2026-10-26 initial complete offline run from the physical Windows worktree passed 287 files /
2459 tests with only four pre-existing CandidateHome failures. Independently exported pristine
baseline `1f615591` into an ignored test directory and reproduced the same four failures (7 passed
of 11): missing current heading, scheduled explanatory text, and initial/refreshed card
`aria-labelledby`. CandidateHome production/tests are unchanged. The virtual CodexProfiles cwd
caused jsdom setup-file resolution errors; using the physical Packages/LocalCache worktree fixes
those without changing test configuration. Final exact-head results belong in PR #470.

## Live and browser evidence

Pending the independent QA role on the pushed implementation head. Required evidence is Project
and Policy selection through Exam and Sales authoring, selected-resource validation, Sync Resources,
exact provider IDs/durations, protected Support success/safe failure, browser console capture and
compatibility with retained v3 reads. Active-only/permission semantics are published above and must
be distinguished from observed tenant behavior. No provider mutation was performed by the
implementation role. No human-QA gate per the explicit user waiver for #468/#469.

Sync Resources has an authenticated shipped handler but no shipped admin tab (an existing UI test
asserts its absence). The coordinator approved a disposable same-origin HTML form for an actual
browser click/submit to that handler, followed by real Support UI inspection. This is labeled
browser-harness evidence, not a newly shipped product control; no product UI is added.
