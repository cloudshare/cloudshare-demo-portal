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

## Live and browser evidence (2026-10-26)

Independent QA verified exact head `e11d67447d691b085165f38eb180f1c155c8c1e2` using an isolated
local database/configuration and the Codex-owned server. The requested `gpt-5.6-terra` model was
unavailable; QA used the recorded equivalent `gpt-5.6-sol` at medium reasoning. Human QA was
explicitly waived for #468/#469; real automated browser interaction and live checks were retained.

- **Exam authoring:** browser selected Helios Exams 2 from live v4 Projects, then retained v3
  Blueprint, v4 Policy, Snapshot and Region. Saved a disposable local draft and reopened/refreshed
  with exact selections retained. Authoritative Policy detail supplied runtime **20160** and storage
  **43200** minutes; manually authored open period **21000** remained distinct in catalog/readback.
- **Sales Item authoring:** browser selected Certalis Sales from v4 Projects, retained v3 Blueprint,
  v4 Policy and Region; default duration **1440** minutes came from storage. Saved/reopened/refreshed
  and reselected successfully. Only disposable local catalog records were changed.
- **Sync Resources:** no shipped Resources tab exists (an existing UI test asserts its absence).
  A coordinator-approved disposable same-origin HTML form was clicked/submitted to the shipped,
  authenticated `POST /api/admin/sync-resources` handler. Result: **2 Projects, 3 Regions,
  4 Blueprints, 4 Policies**. This is browser-harness evidence, not a newly shipped product control.
- **Browser console:** clean acceptance tab reported **0 warnings and 0 errors**.
- **Support success:** real Support UI showed the exact per-request v4 Policy-detail GET, HTTP 200,
  runtime/storage fields and masked protected authorization header. Ordinary UI exposed no API key
  or Bearer credential.
- **Support safe failure:** an authorized invalid-key save through UI in the isolated QA Connection
  caused real Exam-create bootstrap failure at `cloudshare.v4.oauth.token`. Support retained HTTP
  **403**, `failureMode: http_failure`; ordinary UI stayed generic and disclosed no credential.
  Valid credentials were restored through UI, Test connection succeeded and Projects loaded again.
  This proves the OAuth prerequisite failure path, **not a Projects-endpoint non-2xx response**.
- **Cross-version reads:** the exact v4 Project id was accepted unchanged by browser v3 Blueprint
  discovery, live Sales Project-member preflight and an authorized direct v3 Team GET (**200**, one
  Team). The final relevant exact-head live checks passed **3/3**.

No Experience was created and no provider resource mutation was performed. Compatibility of writes
is supported by unchanged code/test mapping (`projectId` to v4 training `ProjectId`, resolved v3 Team
id to `TeamId`), not by a new live Experience write in this slice. Live Policy results were consistent
with the published active-only contract, but no known inactive Policy existed to prove exclusion.
Team Member permission-empty behavior remains contract plus fixture evidence: no suitable Team
Member credentials were available and no new authorization was created. These limitations do not
imply broader live coverage.

Final offline implementation verification at `cc19b817` passed lint/typecheck and 2462 tests across
287 passing files; the same four baseline CandidateHome failures remained in the one failing file.
The test-only repair `d6a69a3` corrected malformed-Policy Sync coverage (RED at the wrong request,
then 20/20 recording-HTTP tests GREEN with the exact second request and failure body asserted).
`e11d674` aligned canonical documentation; neither follow-up changed production behavior. Final
review confirmation and merge metadata are recorded in PR #470.
