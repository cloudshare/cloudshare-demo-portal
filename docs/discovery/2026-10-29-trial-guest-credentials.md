# #487 guest credential contract and verification plan

The deliberate `POST /api/sales-trial/offerings/{offeringId}/rdp/{selector}/credentials`
uses the existing authenticated Sales Trial RDP gate and a same-origin check. No body is required.
Success is exactly `{ username, password }`; all outcomes carry `Cache-Control: no-store`.
Failures use controlled participant messages (401/403/404/409/502/503), never provider evidence.
The RDP attachment GET and sponsored launch remain independent.

The current Infrastructure 4.0 export (`cloudshare-infrastructure-v4-2026-10-26.json`)
defines `GET /v4/environments/{envId}/vms/{vmId}` (`EnvironmentsV4_GetVm`) and `VmResponse`
with nullable string `username` and `password`. A dedicated detail schema validates these fields
and fresh VM identity, Windows OS, Running status, completed progress and configured FQDN.
The existing list projection remains credential-free. Missing/empty credentials fail closed.
Only the two required values leave the adapter on this action; no v3 file call is made.

Each action repeats own active enrollment, Customer, Experience, complete participant roster,
exact enrollment custom-properties/participant ID and email, and owner/Project Environment checks.
The selector binds Customer, enrollment, Environment and VM; fresh listing and detail revalidate it.
Numeric roster Environment references remain distinct from Infrastructure EN identifiers.

Fanout per action: one Experience GET, complete roster read, paginated Environment list plus one
Environment detail, paginated VM list (existing maximum 1000 records), one VM detail. All are reads;
no file/provision/resume/network operation. One-page fanout is six provider GETs plus one OAuth
request for a fresh client. Pagination and the existing single safe GET-429 retry count as physical
requests; existing token acquisition/renewal remains client-owned.
Live requests need a separately approved disposable asset/window and physical request/auth budget.
No live calls are authorized by this implementation plan.

Protected Customer-admin diagnostics reuse `sales-trial-rdp` and existing request observer, preserving
provider bodies and masking authorization headers. Ordinary errors/audits contain no credentials.
The credential action records controlled failure reasons for denied/stale/unavailable checks.

The UI starts with both values masked per the human instruction. Explicit Show/Hide and Copy controls
are scoped to one selected VM. Hide/dismissal clears fetched values; a later show fetches fresh.
Page exit/unmount invalidates pending responses and clears state. No storage, prefetch or logging.

Approved automated seams: existing handler, adapter, HTTP and UI. TDD covers owner success,
cross-Customer/participant denial, stale/unavailable/missing data, no-store, no-prefetch and secret-safe
errors. Independent browser QA must interact with Show/Hide/Copy and navigation and inspect console.
Live portal retrieval, protected support evidence and human native-RDP connection acceptance remain
separate required gates before merge.

## Initial automated evidence

Isolated physical worktree dependencies and Prisma client; its own `prisma/test.db`; no live secrets.
Red/green commands: `npx vitest run src/integrations/cloudshare/trial-rdp.test.ts` initially failed
for missing credential retrieval; handler test initially returned a file instead of credentials;
HTTP tests initially failed for the absent action/response; UI test initially lacked the action.
Each passed after the corresponding bounded implementation.
Final focused command: `npx vitest run src/api/sales-trial-rdp.test.ts src/api/sales-trial-rdp-http.test.ts src/integrations/cloudshare/trial-rdp.test.ts src/web/sales-trial-rdp.test.tsx` - 72 passed.
`npm run typecheck` passed. Full-suite, build, independent review, browser and live acceptance
are lifecycle-orchestrator gates, not claimed by this implementation evidence.

## Lifecycle full-suite checkpoint and bounded inherited-test repair

At `9c778c76301474beec41e4cfcdb2afe00d91b80c`, the lifecycle orchestrator reported
2631 passing and five failing tests. Four were known Candidate UI failures; the fifth was an
inherited Sales diagnostics source-order expectation. The relevant production/test files were
unchanged from baseline `18911189`. The orchestrator minimized the latter with
`npx vitest run src/api/sales-diagnostics-route.test.ts -t "keeps the Sales Customer scope" --maxWorkers=1`
(red). Parent-authorized repair only updates that expectation: tenth source `sales-trial-rdp`,
eleventh `cloudshare-integration`. No production behavior changes. A targeted passing rerun
would resolve this one failure only; it does not claim a clean full-suite run or resolve the four
Candidate UI failures.

Targeted resolution: `npx vitest run src/api/sales-diagnostics-route.test.ts src/web/sales-trial-rdp.test.tsx --maxWorkers=1`
passed both files, 23 tests, after the correction and loading-text repair. No full-suite repeat
was run; the four known Candidate UI failures remain explicitly unresolved by this slice.

## Repair 3: unsupported credential-route methods

Synthetic real-HTTP QA found the framework-generated GET 405 lacked `Cache-Control: no-store`.
The parent approved a bounded correction only in the new credential route: GET, HEAD, PUT, PATCH,
DELETE and OPTIONS explicitly return a static 405 with `Allow: POST`, reusing the existing
noncacheable response helper. POST is unchanged. Tests import the actual route exports: all six
failed before the correction, then passed. The affected HTTP/handler run passed 43 tests;
`npm run typecheck` and `npm run lint` passed with no lint warnings/errors. No full-suite repeat
is claimed. Fresh independent review, fixture rebuild and actual HTTP recheck remain required.
This reaches the three-repair boundary; further product changes require explicit parent direction.

## Synthetic browser and HTTP acceptance (2026-10-29)

Independent QA built and tested application head `805d61569ea23645799a1fc37152cfbcf6a5f22f`
with a temporary provider-boundary fixture, a fresh migrated disposable database and process key,
seed off and background jobs disabled. This is synthetic evidence, not live CloudShare acceptance.
Both independent review axes were clean at that exact head.

Actual HTTP verified credential POST 200 with exactly username/password and no-store; listings
omitted both. Missing credentials, stale readiness and provider denial produced safe 502; other
participant 404, unauthenticated 401 and cross-origin 403 were noncacheable. All six unsupported
methods returned 405, no-store and Allow: POST after repair 3.

Actual browser controls verified no credential prefetch on render or desktop check, both fields
masked initially, each Show/Hide, dismissal, fresh retrieval and reload clearing. Four deliberate
credential POSTs were counted in the browser capture window, excluding the HTTP checker. Actual
Copy clicks for both fields matched their synthetic fixture values using private browser clipboard
comparisons; values were not emitted. An initial invalid comparison against the browser inspection
redaction sentinel was corrected without product changes or instrumentation. Reload was exercised;
BFCache restoration and delayed responses were not separately browser-tested (late-response
invalidation has automated UI coverage). The task tab had zero console warnings/errors.

Owner Offering and Enrollment workflow evidence buttons reached protected credential-failure
records. Explicit sales-trial-rdp source showed operation, integration surface, provider 403 and
masked Authorization. Local foreign-Customer filters returned no entries for either owner scope;
this is portal Customer-isolation evidence, not a second live CloudShare tenant.

Owned server PID 130380 was positively stopped; port 3027 is free. Only the new task tab 925992435
was closed; the retained viewer, primary checkout, port 3000 and old 3025 service were untouched.
The provider overlay was reversed and its source removed; checkout was clean. Private redacted
summary/scripts/build logs and SHA256 manifest remain externally in qa/issue-487-synthetic-qa.
Retention limitation: disposable synthetic DB/key/accounts/server logs were removed before their
hashes were captured; those hashes are unavailable. No full-retention claim is made.

Overlay SHA256: 50fb155b5b39aef90a38fc41c61e491e7ba0a61bbcb61dbe5972218c3124048e.
Fixture SHA256: 7cc3b017f686f0280800d19ec42b41b4e06c2b5c09066a3b025cfc55f7e10e1b.
Redacted summary SHA256: 5c97194de1c9fbfeeeee805a9687b810179b67c0b502222f257e3858f3b94859.

Live preflight, separately authorized disposable Trial UI retrieval, protected live diagnostics,
human native-RDP connection and explicit acceptance remain required before merge. No live calls
were made during synthetic QA. The original full-suite result and targeted repairs above remain
qualified; no clean full-suite run is implied.

## Authorized read-only live preflight and identity gate (2026-10-29)

At reviewed documentation head `a5b4a517272ada0b518cef27ad8e13b7a5e046c7` (application
unchanged from `805d6156`), the separately authorized metadata preflight completed exactly seven
physical provider GETs and one OAuth request, all HTTP 200. Reads were Projects, Regions, selected
Project Blueprints, selected Blueprint detail, Project Policies, selected Policy detail and active
Project members. No Experience, Environment/VM, credential, file or business-write operation ran.
The selected local Item resources matched uniquely. Fresh protected evidence confirmed default/latest
Chris's Fourth Snapshot, version 3, createTime 2026-10-29T09:52:52Z, supporting the selected Region.
The Policy reports runtime 60 minutes/storage 1440 minutes; two Policies and three active members
were observed, with the selected Sales Pro uniquely active.

A fresh migrated isolated database and Customer Connection reencrypted under a new key were used.
Database/key/runtime/scripts/ledger/protected evidence and manifest are retained externally under
qa/issue-487-live-preflight-20261029. The before-UI database backup matches the retained database
hash. A clean production build without the synthetic overlay passed at a5b4a517, seed off and
background jobs disabled; no server was started and no further provider calls occurred.

The parent conditionally released one separate disposable live Trial with cumulative whole-run
ceilings of 42 provider GETs, 7 OAuth and 4 business POSTs (Experience, optional property definitions,
participant registration and sponsored link only). Planned future phase is 30 GETs/6 OAuth with
one credential retrieval and one provider file. That phase has NOT started: the retained viewer
shows only a greeting and archived Environment, without establishing the current account email.
Historical identity is insufficient. One human identity-confirmation/sign-in question is pending.
No Settings/identity endpoint, logout, persona switch, new Experience or native action was attempted.

No new transport hook, preload, counter or guard framework is authorized. Future execution must use
the unchanged reviewed runtime and existing protected physical exchange/OAuth evidence after each
sequential UI action, stopping on errors/retries, identity ambiguity, cap or missing count evidence.
Preflight totals remain seven GETs/one OAuth; business writes remain zero. Primary checkout/3000,
old 3025, retained viewer and all prior live assets remain untouched. Live UI, human native-RDP
acceptance, final gates and merge remain pending.

## Live UI attempt and existing-correlation blocker (2026-10-29)

Human-provided account-menu evidence confirmed the intended existing QA participant identity.
The unchanged clean production build ran in the isolated Customer/database/key on owned port 3027,
seed and background jobs off. One new Trial was published for 2026-10-29T13:13Z to 13:53Z.
Publication used six GETs, two OAuth requests and one Experience POST201; UI setup used two GETs.

The first launch at 13:13:15Z read Experience200/notStarted and correctly denied access before any
enrollment or business write. Local audit confirmed zero enrollment rows and no provider business
POST. Parent explicitly authorized one further normal launch after at least 60 seconds and amended
budgets; no separate probe/poll or third launch was allowed. That action succeeded, creating only
the required correlation definitions/participant/sponsored link. The new viewer became visibly
ready after preparation; no portal status polling occurred. Start propagation is a possible cause
of the earlier notStarted response, not a proven general provider guarantee or duration.

The single authorized desktop-status action then failed closed. Protected Environment-list data
contained two exact owner-email/Project matches: the new ready Environment and retained archived
411 Environment. The accepted resolver requires one match before detail/readiness, so it refused
both. No credentials or RDP file were retrieved. Cumulative observed canonical transport evidence,
including preflight, is 23 GETs, 6 OAuth and 4 business POSTs, with no transport retry/failure.
Business writes were exactly one Experience, definitions, participant and sponsored link. Semantic
rows referencing the same exchange IDs were excluded from physical counts. Post-denial consistent
database backups and private evidence were retained and hashed; no provider cleanup occurred.

Independent read-only diagnosis confirmed this is the existing resolver contract, not a regression
introduced by credential controls. The generic local_request_failed summary also predates 487:
SalesEnvironmentResolutionError has reason/exchanges, while the shared projection accepts typed
CloudShare error context. Correlated protected transport records retain the actual list evidence.
No additional diagnostic repair was proposed or enacted.

Current saved roster envId is an opaque-looking string literally equal to one listed Environment
ID, but the Sales export specifies only string|null without guaranteeing Infrastructure identity;
GAP32's historical numeric-reference distinction remains. One review identified a possible additive
positive-literal-match gate with exact detail checks; the other recommended retaining the existing
contract and using a fresh unique participant/profile. Either continuation requires explicit scope
or asset/profile/budget authority. No conversion, archive filtering, first/newest/Ready heuristic,
source edit, fourth repair, provider probe or new ticket was authorized during diagnosis.

The parent recommends a fresh participant in a separately allocated clean QA profile to keep this
credential slice bounded; the human choice is pending in the parent chat. Existing ready asset,
viewer, owned server, database/key/evidence and original 13:53Z end are retained. No forced timing
rewrite or second Experience is authorized if the window expires. Live credential/file retrieval,
human native-RDP acceptance, final audit and merge remain blocked. Primary checkout/3000 and old
411/3025 assets remain untouched. No exact-correlation safeguard is waived.

## Fresh two-hour live phase (2026-10-29; native acceptance pending)

The human chose a fresh independent participant, then explicitly authorized serial reuse of the
dedicated QA profile through normal CloudShare logout and fresh sponsored sign-in. A visible login
form proved the old persona signed out; the new viewer User menu privately matched the fresh local
email. Old tabs/assets were preserved where practical, but old authentication is not claimed to
survive the cookie change. Browser web authentication/viewer navigation is separate from the portal
integration API ledger. No correlation repair, security change or native automation occurred.

After the short window elapsed, parent authority allowed one NEW Experience for
2026-10-29T15:31Z to 17:31Z, timed only after setup was ready. No old End was rewritten. Creation
returned 201; two-hour access does not change Policy runtime 60 minutes/storage 1440 minutes or
promise two-hour compute. One launch at Start+90 seconds succeeded without a separate status probe.
The fresh viewer visibly reached readiness before the single desktop check. Publication revalidated
configured resources through unchanged code.

The single live desktop check selected Windows Server 2025 Standard; other displayed targets
reported public access not configured. One credential retrieval returned both fields, initially
masked, retained in the existing participant page. The agent did not reveal/copy/dismiss/reload or
refetch them. One unchanged RDP attachment downloaded: 585 bytes, privately equal to protected
provider rdpFileContent. No file bytes, password or hostname was emitted.

Whole-run observed canonical integration totals INCLUDING earlier preflight/blocked actions:
52 GETs, 12 OAuth and 8 business POSTs, with no observed transport errors/retries. Business writes
were exactly two Experiences, two property-definition requests, two registrations and two sponsored
links. This is within conditional 60 GET/12 OAuth/8 POST ceilings; OAuth/write allowances are now
exhausted. No further provider action is authorized. Counts use existing canonical exchanges/OAuth
metadata, not automatic global network enforcement; observer persistence failure is not ruled out
by construction. No such warning/gap was observed.

Separate local HTTP cookie jars preserved participant browser authentication for Support checks.
Owner Enrollment plus sales-trial-rdp source returned 21 entries (18 GET200 transports/three OAuth),
all 18 Authorization headers masked. Offering default returned 20 entries; Offering plus RDP source
returned zero because successful RDP transports anchor to Enrollment. Enrollment default returned
48 entries including parent Offering. Actual View workflow subjectType/subjectId semantics traverse
Enrollment-to-parent, not Offering-to-all-Enrollments. Foreign Offering/Enrollment queries each
returned zero. This is live-evidence API verification; Support browser buttons were exercised
synthetically, not repeated live. No guest password appeared in ordinary audit/server logs;
participant console warnings/errors zero. Live no-store headers were not captured; actual synthetic
HTTP verified them separately.

Consistent post-live database backups, protected owner/foreign evidence, provider file copy,
redacted summary and hashes remain private. Earlier synthetic DB/key retention limits are unchanged.
The owned server/current participant/viewer pages are retained for the human. One native desktop,
controls and QA/merge acceptance question is pending. No additional provider requests or cleanup.
