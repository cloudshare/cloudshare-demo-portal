# Existing-capability v4 migration closeout — #474

Inventory baseline: `3f324b2a1b34eb455325b70c2ebf7165443df7ea`, after A–D merged.
This record separates source inspection, published contracts and prior acceptance from fresh
closeout verification. It does not authorize new capabilities, live writes or retained-asset cleanup.
Fresh #474 browser/check results and final lifecycle disposition must be recorded before closure.

## Production call and consumer inventory

Inspected every production `requestV3*` / `requestV4*` call in `src`, the concrete adapter
factories and `composition.ts`, and their handler/domain consumers. The table uses version-prefixed
shorthand: “v4 `/projects`” means wire `/v4/projects`, and “v3 `/ping`” means `/api/v3/ping`.
`client.ts` supplies transport/auth and `v4-auth.ts` supplies the OAuth
token exchange. Fixtures/simulator traffic, diagnostic route labels and historical decoders are
not additional production calls.

| Capability and physical calls | Adapter | Shipped consumers / retained rule |
| --- | --- | --- |
| v4 `GET /projects`; `GET /projects/{projectId}/policies[/{policyId}]` | `resources.ts` | Exam bootstrap/selected-Project refresh/publish, runtime Blueprint guard, Sales Item create/update and provisioning revalidation, and the separate Admin Sync Resources lister. Projects traverse complete count/items pages; Policy detail checks both identities and keeps runtime/storage distinct. |
| v3 Blueprint list/detail and Regions | `resources.ts` | Same Exam/Sales authoring and runtime revalidation; Sync Resources lists Blueprints/Regions. Snapshot/default/deployed-Region projection remains selected-Blueprint detail, not a fabricated top-level Snapshot sync. |
| v4 `GET /environments`, `GET /environments/{id}` | `environments-v4.ts`, `environment.ts`, `environment-observation.ts`, `external-lease.ts` | Certification admission/runtime/heartbeat/completion/early completion/webhook reconciliation; Admin Attempt diagnostics; independent external-lease refresh; Sales participant monitoring, cancellation and extension pre/post reads; Trial enrollment/reopen/extension and Offering ending/reconciliation. Complete owner-email pages precede exact normalized owner + Project uniqueness and exact opaque-ID detail. Trial ending uses owner/Offering Item Project, never the numeric roster reference. |
| v4 `POST /environments/{id}/suspend`, `/resume` | `environment-controller.ts` | Candidate controls, heartbeat lost-liveness/lab-closed and logout through the persisted Certification lifecycle. Empty 204 is dispatch acknowledgement; authoritative observation settles clock/status. |
| v4 `POST /environments/{id}/extend` | `environment-command.ts` through `environment-observation.ts` | Selected Sales Participant and retained Trial extension. Body omitted for Policy defaults; existing durable fences, expiry/state confirmation and separate Sales access-window PUT remain. |
| v3 `PUT /envs/actions/archive?envId=…` | `environment-command.ts`, `environment-controller.ts` | Certification completion/early completion and Sales cancellation. No Environment DELETE call or substitution. |
| v3 `GET /teams` | `labs.ts`, `cohort-experiences.ts` | Individual Training and Cohort on-demand Training publication resolve Team for the selected Project. |
| v3 `GET /users` active Project-member query | `project-members.ts` | Sales Project member selection and fresh Sales Pro eligibility for Session creation and Trial publication. This is distinct from the v4 existing-Experience Sales Pro roster. |
| v3 `GET /timezones`; `GET /ping` | `timezones.ts`; `ping.ts` | Sales timezone reference handler; authenticated Connection test. Ping validates v3 credentials, not every v4 permission. |
| v4 `POST /trainings`; `GET /trainings/{id}`; `GET/POST /trainings/{id}/users/properties`; `POST/GET /trainings/{id}/students`; `POST /trainings/{id}/sponsored-link` | `training-delivery.ts` over `labs.ts`, `cohort-experiences.ts`, `participants.ts` | Individual scheduling; Cohort publication/admission; Participant/custom-property correlation; start-state checks; dashboards and monitoring. Sponsored links remain server-only behind portal 302 admission. |
| v4 `GET/PUT /trainings/{id}` | `cohort-experience-retirement.ts`, `external-lease.ts` | Cohort retirement to End and independent Training access-window evidence. No environment-retention inference from Experience End. |
| v4 `GET/POST /sales`; `GET/PUT/DELETE /sales/{id}` | `sales-delivery.ts` | Sales Session / Trial Offering publication, read/reconciliation, End coordination and cancellation. DELETE is the separate already-v4 future-Start Sales Experience policy with fresh Start/timezone and durable fences; it is not Environment Archive. |
| v4 `GET /sales/{id}/salespros`; `GET/POST /sales/{id}/users/properties`; `POST/GET /sales/{id}/participants`; `PUT /sales/{id}/participants/{participantId}` | `sales-delivery.ts` | Participant workspace/registration, correlation and monitoring, Trial enrollment, and Sales Pro launch-denial support contact. Complete roster and unique local Participant/Contact properties remain required. |
| v4 `POST /sales/{id}/participants/invite`; `POST /sales/{id}/sponsored-link` | `sales-delivery.ts` | Explicit invitation action with durable ledger; Sales Participant / Trial portal admission. No invitation is implied by registration or this inventory. |
| v4 `GET /guided-journey/progress/{experienceId}[/{participantId}]` | `guided-journey.ts` through Training delivery | Participant score, completed score capture, aggregate Cohort/Admin monitoring. No Guided Journey availability or scoring guarantee is inferred. |

The legacy `LabProvisioner.createExperience` / `addStudent` methods and generic
`/experiences/{id}/sponsoredLinks` branch in `labs.ts` have no shipped caller: production
`createCloudShareLabProvisioner` construction is inside `TrainingDelivery`, which invokes
`createTraining`, `ensureTrainingUserPropertyKeys`, `addParticipant` and sponsored links with
`trainingId`. These older compatibility methods/tests predate A–D; they are not a missed live
migration or a migration-only bridge. No public interface removal is bundled into this closeout.
The numeric compatibility projection and old persisted v3/roster decoders still have consumers
and history; they must not be deleted merely because new provider observations are v4.

## Current primary contracts and necessary v3 exceptions

Retrieved official sources by read-only HTTPS on **2026-10-28, approximately 10:59–11:01 UTC**:

- [Infrastructure 4.0 source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/reference/infrastructure-Public-API.openapi.json?branch=main), HTTP 200,
  SHA256 `58D85EDB9F8982C9130138C120DCBD5546D9BF3EB140BE4A763A174D11F7C325`.
  It matches the committed 2026-10-26 export exactly.
- [Experience source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/reference/CloudShare-Public-API.json?branch=main), HTTP 200,
  SHA256 `272B9036B23F6BA77E9539508AC0F30E9E8BCFE832217CF8792EF6BB63E0E05C`.
- [Classic v3 source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/V3/nodes/cloudshare-API-v3.openapi.json?branch=main), HTTP 200,
  SHA256 `82DB4960996432A8CA0383D29B1C80CC34644B1FFE28EF4500A5682C43BFFDA0`.
- [Current v4 Introduction](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/docs/Introduction.md?branch=main), HTTP 200,
  SHA256 `553213F99F28249B9E39B72A061977B8DB683EA397DE2578F8F512A61CFE5DD8`.
  Its coexistence section explicitly retains v3 users/teams, Blueprint/Snapshot catalog,
  Regions/timezones and webhooks. Token contents remain opaque to this application.

Hashes are of the retrieved UTF-8 content. Source URIs were resolved from official Stoplight
project/branch metadata, not inferred provider route naming. Classic project `321784`, main
branch `13584755`, exposes `/cloudshare-API-v3.openapi.json`; Accelerate project `299551`, main
branch `11861928`, exposes the three sources above. The v3 workspace root returned 404, but its
official source and [Classic documentation overview](https://docs.cloudshare.com/rest-api/v3/overview/)
returned 200. Search-engine queries alone returned no useful results and were not treated as
absence evidence. All source path keys were inspected; this bounds absence to these current
published sources, not every possible/private/future CloudShare API.

| Remaining v3 capability | Specific contract search and reason retained |
| --- | --- |
| Archive | Neither current Infrastructure nor Experience path inventory contains Archive. Classic has other `/envs/actions/*` operations but also omits Archive. Existing `PUT /envs/actions/archive` is therefore an explicitly retained live-evidenced contract gap, not a newly published contract claim (GAP-18 / #351 evidence). Infrastructure Environment DELETE deletes and may affect owner membership; it is not equivalent. |
| Blueprint / default Snapshot | Classic `/projects/{projectId}/blueprints` and `/{blueprintId}` GET, `Blueprint.createFromVersions` and `Snapshot.isDefault`; list `defaultSnapshot` is documented. No catalog equivalent in current v4 sources. Infrastructure Snapshot public-cloud-resource endpoints do not enumerate the catalog/default/deployed VMware Regions. |
| VMware Regions | Classic `/regions` GET documents available Regions (optional Project filter); current v4 Introduction retains Regions in v3. Infrastructure public-cloud APIs do not establish VMware Region equivalence. Portal intentionally uses its existing global list. |
| Teams | Classic `/teams` GET publishes available Teams, but no query parameters. Existing Project/getRows/sort/skip/take query shape remains tenant-verified legacy behavior, not fully published parameter support. No equivalent v4 Team lookup found; A's exact Project compatibility and Training provisioning evidence remain the reason for retention. |
| Active Project members / Sales Pro eligibility | Classic source omits `/users` GET and the `projectUsers=true,status=active,loggedIn=ever,projectId,getRows=true` GUI query. Current v4 only supplies an existing Sales Experience's `/sales/{id}/salespros`, not the Project eligible-member selector. Project caller permissions do not enumerate members. Retained fresh GUI lookup remains GAP-28 / BAC-24702, with exact Project scope and explicit undocumented status. |
| Timezones | Classic `/timezones` GET; current v4 Introduction retains timezones in v3. No replacement in either current v4 path inventory. Existing Sales timezone semantics remain. |
| Ping | Classic `/ping` GET tests v3 credentials. No v4 health-check replacement in either current path inventory; OAuth is an authentication prerequisite, not equivalent Connection/permission proof. |

Inbound webhook HMAC/correlation semantics are not an outbound v3 provider call. Production has
no automatic webhook-registration implementation to migrate. Keep manual registration and
polling-as-truth separate. #411 remains deferred; public-cloud VM remote-access files do not
prove VMware RDP support. No new provider capability follows from this inventory.

## A–D exact-head ledger and source equivalence

GitHub PR metadata checked on 2026-10-28 confirms all four merged. The PRs report zero unresolved
non-outdated review threads at their completion; #474 must still check its own exact head.

| Slice / evidence source | Reviewed final head | Merge SHA | Runtime/browser evidence head |
| --- | --- | --- | --- |
| A #468 / [PR470](https://github.com/cloudshare/cloudshare-demo-portal/pull/470), [record](2026-10-26-project-policy-v4-migration.md) | `9316cd3eca4d0f7c8c2f0d08ef9f59822fd8e005` | `9d7f383ab42704f3becd59552846475c6c4ca359` | `e11d67447d691b085165f38eb180f1c155c8c1e2` |
| B #469 / [PR471](https://github.com/cloudshare/cloudshare-demo-portal/pull/471), [record](2026-10-26-environment-v4-migration.md) | `9d5742eba76c94113cd408c883a34761dde0000f` | `c605217f59b25f8e10c11556415222ce448f3421` | `80d88a8e54ff83fb2556a87065be78286a0c8261` |
| C #472 / [PR475](https://github.com/cloudshare/cloudshare-demo-portal/pull/475), [record](2026-10-26-suspend-resume-v4-migration.md) | `8a3def02476abe83176477f043a18c068a86e548` | `c9e929821c38a60617fb18034511ce28ef3a5eae` | `7756114f81f8276362cf547f6b07a356921eae72` |
| D #473 / [PR476](https://github.com/cloudshare/cloudshare-demo-portal/pull/476), [record](2026-10-27-default-extension-v4-migration.md) | `5eff112ccf81961e2a0fe4d3f7c6ffb1d89cd138` | `3f324b2a1b34eb455325b70c2ebf7165443df7ea` | `1fc7ee21ecf21af7b6d6ac07eae6abae267e766d` |

`git diff <runtime-head> 3f324b2a -- <paths>` establishes these bounded reuse decisions:

- **A discovery:** no change in `resources.ts`, `admin.ts`, `admin-exam-authoring-runtime.ts`,
  `admin-exam-publish-runtime.ts`, or `sales-items.ts`. Reuse the authoring/Sync evidence;
  later Environment migrations do not turn A's read evidence into write proof. Support code
  changed in B, so A's Support observation is historical, not whole-surface source equivalence.
- **B observation:** no change in `environments-v4.ts`, `environment.ts`, `external-lease.ts`.
  In `environment-observation.ts` the only later change replaces Extend's legacy fallback
  evidence; the list/detail/resolution logic is identical. B's old command proof is historical:
  C supersedes Suspend/Resume and D supersedes Extend. Do not reuse B's v3 Extend as v4 proof.
- **C runtime:** D does not change `environment-controller.ts`, Certification runtime handlers,
  runtime lifecycle or command persistence. D changes only the Extend branch of the shared
  dispatcher; Archive and C's Suspend/Resume remain unchanged. C's real clock/control proof is
  reusable; D's Sales/Trial extension proof is required separately.
- **D:** `git diff 1fc7ee21 3f324b2a -- src app prisma` is empty. All later D changes are evidence
  prose; its exact runtime/source is the E baseline.
- **Already-v4 delivery:** A's runtime through E has no differences in `labs.ts`,
  `training-delivery.ts`, `cohort-experiences.ts`, `participants.ts`, `sales-delivery.ts`, or
  `guided-journey.ts`. This supports focused regression/evidence reuse, not fresh live claims
  for an invitation or Guided Journey operation that was not exercised.

The current inventory also corrects the file attribution in D's dated v3 register: Teams are
implemented in `labs.ts` / `cohort-experiences.ts`, and member eligibility in `project-members.ts`,
not `resources.ts`. Sync Resources still directly reads v3 Regions and Project Blueprints in
`resources.ts`; its Project/Policy calls use migrated discovery. Old `getextended` strings in
diagnostic classification and generic route sanitization are not live outbound requests.

## Capability evidence matrix

| Capability | Actual prior UI/live proof | Other evidence and explicit limits |
| --- | --- | --- |
| Projects / Policy / resource sync | A Exam and Sales Item selection/save/reopen/refresh; Sync submitted via disposable same-origin form; Support success and OAuth403 restoration; console 0 warnings/errors | Sync harness is not a shipped Resources control. Inactive-Policy contrast and Team Member empty permission remain published-contract/fixture evidence. A: lint/types, 2462 offline passes plus four independently reproduced CandidateHome failures, safe live 3/3. |
| Environment reads / correlation / lease | B Certification runtime, Sales monitoring/cancellation, Trial reopen/ending; independent external-lease dashboard used a local-only fixture bound to already-owned archived Environment | B numeric roster reference remained distinct; API input-rejection400 is not valid-missing404. Early Certification authoring console and child view were not captured. Lifecycle/Admin/Support/lease consoles clean. B: 2509 pass + same four baseline failures, targeted267, safe live3/3. |
| Suspend / Resume / heartbeat / logout / clock | C replacement real UI S3/R2, all204 with exact readbacks; settled consoles clean and clock retained. Original flow guest/pfSense view continuity; real server302 | Narrow environmental console findings preserved, not blanket zero. Support synthetic invalid-ID400 plus foreign-Customer API404; Archive regression was audit +58 deterministic tests, current C Archive0. C: 2540 pass +same four failures, launcher14, live3/3. |
| Sales default Extend / separate access End | D automated UI Extend204 + accessPUT200, exact same Environment/expiry and clean captured console. Later human UI extension established observed guest/application continuity | Earlier structural identity alone was insufficient and is not relabelled. Screenshots establish observed state, not arbitrary-byte integrity. D subsequent manual run added one Sales Extend/accessPUT; total2 each. |
| Trial default Extend / retained work | D human UI test on same enrollment/Environment: Extend204 and Ready200, later storage expiry, same Notepad document; human separately reported reopen | No new manual Trial portal screenshot/console; not an automated Trial run. D's direct human work order superseded its earlier verification method. D:2545 pass +same four baseline failures, independent134, live3/3; real HTTP synthetic126 exchanges/9 targets/no replay remain simulation. |
| Training / Sales provisioning and Participant properties | C real Schedule and server302; B Sales/Trial real launch; D Sales/Trial creation/registration and retained same identities | Reuse only exact unchanged delivery modules above. No new provider writes or unsolicited invitations are implied. Cohort variants and invitation ambiguity/isolation remain deterministic seams unless fresh run is separately recorded. |
| Invitations / Guided Journey | No fresh live invocation claimed by this closeout inventory | Existing adapter/handler/persistence tests cover explicit invites, durable ambiguous outcomes and score parsing/correlation. Missing Journey and provider permissions remain observable limitations; no invitation sent merely to obtain evidence. |
| Archive / future-Start Experience deletion | B actual Ready Archive; #351 separate current Preparing→Archived exact-target typed probe after UI launch, plus historical future-Start Sales DELETE UI evidence | Preserve `docs/verification/issue-351-cancellation.md` and GAP-18 chronology. Preparing probe was not full UI cancellation. Oct23 “unmerged PR448” statements remain dated; PR448 is in E's baseline. No Environment DELETE. |

Existing regression seams include `resources.test.ts`, `environments-v4.test.ts`,
`environment-commands-v4.test.ts`, `environment-observation.test.ts`, `external-lease.test.ts`,
`training-delivery.test.ts`, `labs.test.ts`, `sales-delivery.test.ts`, `guided-journey.test.ts`,
authenticated scheduling/runtime/heartbeat/completion/cancellation/extension/Trial/enter/score
handler tests, and public SQLite command/invitation persistence tests. They cover malformed or
incomplete pages, identity/Customer isolation, safe error projection, durable dispatch ambiguity
and recovery. No new test duplicates are warranted by a documentation-only inventory.

## Closeout execution ledger

At inventory preparation, no #474 live provider action, primary checkout change, database change,
server start or asset cleanup was performed by the implementation role. Fresh full offline
checks, combined automated browser interactions/console and Support proof, safe live checks,
independent exact-head reviews, cleanup and final PR/issue state remain the lifecycle owner's
pending acceptance entries. Prior evidence above is reusable only within its explicit bounds.
The four inherited CandidateHome failures must be independently reproduced at E's baseline;
previous reports alone do not waive a new regression.
