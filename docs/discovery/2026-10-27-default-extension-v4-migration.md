# Existing Sales and Trial default extension migration (#473)

## Scope and contract

The selected Sales Participant handler (`src/api/sales-participant-extension.ts`) and retained
Trial handler (`src/api/sales-trial-enrollment.ts`) both call the existing Customer-scoped
`SalesEnvironmentModule.extendById`. Its CloudShare transport in `environment-observation.ts`
uses `environment-command.ts`. That dispatcher now sends bodyless
`POST /v4/environments/{exact-opaque-id}/extend`. It never sends custom duration fields or falls
back to v3. Archive retains its v3 PUT/query request; Certification Suspend/Resume remain v4.

Contract: `docs/api/assets/cloudshare-infrastructure-v4-2026-10-26.json`,
`paths./v4/environments/{id}/extend.post`. An omitted optional body applies the Policy's full
runtime (current run) and storage extension. Empty 204 acknowledges the command. Permission,
state, or deprovisioning can reject it; this migration makes no new eligibility guarantee.

Existing authenticated routes, selection, exact Contact/Participant/Project/Environment binding,
Customer-scoped encrypted Connections, durable dispatch fences and captured-ID recovery remain
unchanged. Sales confirms increased storage expiry and usable state before coordinating the
separate Experience End update/readback. Trial preserves its retained-target history and existing
Preparing/Archived eligibility and readback rules. Trial ending retains its own timing/fence.
Storage expiry is deletion time, not remaining runtime. No runtime amount is inferred from it.

## Automated evidence

Three vertical RED/GREEN checks were run before their implementation:

1. Recording HTTP expected v4 Extend POST but received v3 PUT; then passed after transport migration.
2. Trial uncertain-POST handler evidence expected `extend_environment` but received
   `observe_environment`; then passed after the v4 Extend path classification was added.
3. Sales uncertain-write handler evidence expected `cloudshare.v4.environments.extend` but
   received the old v3 surface; then passed after correcting that surface.

Existing handler coverage retains selection/authorization/isolation, partial outcomes, pre-dispatch
failure, uncertain writes, no replay, exact-ID reconciliation, access coordination, and persistence
recovery. Recording HTTP additionally covers rejection/transport failure without fallback/retry,
exact opaque path encoding, empty 204, omitted body/query, protected provider bodies and absence
of provider IDs/body secrets from generic traces. Existing Suspend/Resume and Archive wire tests
remain regression checks. Fixtures are offline evidence, not live tenant proof.

## Live acceptance status — verified; final reviews pending

Sales default extension now has accepted observed application-state continuity from the human
run on 2026-10-28, alongside the earlier automated UI/provider/readback evidence. Independent QA
and Spec reviews accepted the same Windows/pfSense application state before and after extension
with exact-Environment diagnostics; #473 does not mandate a saved-file witness. This acceptance is
limited to observed application continuity, not arbitrary guest bytes or saved pfSense configuration.
The later manual Trial run below also passed independent QA and Spec acceptance, including
observed Notepad work continuity. Live criteria are now satisfied; final exact-head reviews and
merge gates remain pending. Human QA approval was waived earlier; the latest Sales and Trial
interactions were nevertheless performed by the human. PR #476 stays draft/unmerged and issue
#473 remains active pending those final gates; dependent #474 is not yet released.
No retained #350/#351 assets, primary checkout, port 3000, or primary database were changed.

## Remaining shipped v3 inventory after D

| Capability | Transport and implementation | Reason retained |
| --- | --- | --- |
| Archive | PUT `/envs/actions/archive?envId=...`; `environment-command.ts` via controller | Supported Archive replacement not established; DELETE is not equivalent |
| Blueprint/default Snapshot discovery | GET `/projects/{id}/blueprints` and detail; `resources.ts` | Existing catalog/Snapshot contract exception |
| VMware Regions | GET `/regions`; `resources.ts` (authoring and Sync Resources) | Existing VMware discovery exception |
| Teams | GET `/teams`; `labs.ts`, `cohort-experiences.ts`, `resources.ts` | Existing delivery/authoring exception |
| Project members / Sales Pro eligibility | GET `/users`; `project-members.ts`, resource discovery | Existing active-member contract exception |
| Timezones | GET `/timezones`; `timezones.ts` | Existing catalog exception |
| Connection ping | GET `/ping`; `ping.ts` | No v4 health probe |

The generic client's v3 request methods and historical diagnostic path projections are transport
infrastructure, not extra shipped operations. Webhook ingestion retains v3 envelope semantics;
it is not a new outbound command. Current Project/Policy and Environment observations are v4;
Experience, Participant, sponsored-link and Guided Journey workflows stay on their existing v4
contracts. RDP #411 remains deferred; #474 owns final migration closeout.

## Offline validation at implementation handoff

- `npm run lint`: passed, no warnings/errors.
- `npm run typecheck`: passed.
- Targeted integration and handler run: 128 passed before the six additional wire rejection cases.
- Full `npm test`: launcher 14 passed; Vitest 2545 passed, 4 failed, 292/293 files passed.
  All four failures are the unchanged CandidateHome test file, independently reproduced on the
  baseline by QA. They remain disclosed, not treated as migration regressions.
- Initial full execution through the Windows profile junction could not resolve setup files in
  25 jsdom suites. Running from the canonical Packages/LocalCache worktree path resolved those
  loading failures without source/config changes; the full result above uses that canonical path.
- `git diff --check`: passed.

## Independently audited HTTP simulation (2026-10-27)

Runtime source was exported exactly from `1fc7ee21ecf21af7b6d6ac07eae6abae267e766d`
into the external `qa-issue-473-http` evidence directory. Independent QA confirmed the export
archive hash and that the only runtime source difference is the fixture HTTP transport overlay.
Real Next routes, password/session authentication, domain logic, Prisma repositories, encrypted
per-Customer Connections, and scoped Support remained unchanged. Unknown synthetic requests fail
closed; the adapter never calls an actual provider network transport. A separate fresh database/key
used 65 migrations. Shared dependencies were read only.

The actual HTTP scenarios and verification assertions passed: 126 synthetic transport exchanges,
9 unique bodyless v4 Extend POSTs, exactly one per target, and zero live provider writes.
The 31 scenario HTTP calls exclude login, Support pagination, and RED/GREEN setup requests.
Sales rejection remained pending with fresh-command replay blocked; an applied-but-lost-acknowledgement
case recovered through explicit readback without another Extend. Mixed targets retained one confirmed
result and one unresolved rejection while confirming access only for the successful target.
A preflight failure dispatched nothing; a fresh command safely completed later. A subsequent retry of
the original command retained its old result after the newer command completed. Trial rejection stayed
fenced; uncertain dispatch and one simulated readback failure recovered on the next readback.

Foreign-Customer Sales access returned 404; candidate/unauthenticated requests returned 401.
Foreign-Customer Support omitted the owner's evidence. Scoped Support retained six synthetic
secret-body evidence rows verbatim and 123 authorization-header rows masked. Ordinary HTTP results
contained neither secret sentinels nor provider Environment IDs. This is evidence for the exercised
header and body cases, not a new exhaustive test of every possible header name.

RED used the stock fixture through actual HTTP and returned 502 against the expected 200. The first
overlay exposed two incomplete fixture inputs: required mutable Experience fields and a Trial
`lastLaunchedAt`. Both were repaired only in synthetic data/transport. The original access command
remained fenced, and a separate complete fixture scenario returned 200 with access confirmed.
GREEN evidence is `green.json` plus driver/verifier assertions; `green-test.log` is empty and is not
a transcript of passing assertions. No product repair or production source change was made.

Private evidence, source archive, transport/driver files, hashes, database, key and command history
remain outside the worktree at
`C:/Users/swins/AppData/Local/CodexProfiles/cloudshare/qa-issue-473-http`.
The owned synthetic server on port 3026 is stopped. This audit closes the simulated HTTP evidence
gap only; it does not close either real browser/live extension gate.

## Live evidence and remaining acceptance gap (2026-10-27)

Runtime remains `1fc7ee21ecf21af7b6d6ac07eae6abae267e766d`; subsequent commits change evidence
prose only. The existing read-only live suite passed 2 files / 3 tests at 13:21 UTC:
`tests/live-cloudshare-ping.e2e.test.ts` and `tests/live-certalis-sales-preflight.e2e.test.ts`,
using `vitest.e2e.config.ts --reporter=dot` and the existing private seed-file path. These cover
real v3 ping and active Sales Project members; no writes or temporary credential file were used.
Tool output was not saved as a standalone test log.

Real Sales UI creation and registration succeeded on owned disposable assets, with exact private
Customer/Contact/Participant/resource guards. The original authored Session window remains
2026-10-27T13:19–2026-10-28T13:19 UTC. Creation, registration and settled Participants captures
contained zero console warnings/errors. An earlier no-request click had no write and an unproven
cause; normal reload/committed selection followed by one submission succeeded without code changes.

The original CUA trace records the single automated **Extend selected Participants** click at
14:09:07.186 UTC (tool output 14:09:08.630), correcting the earlier report timestamp of 14:09:28.
The real bodyless v4 Extend returned 204 at 14:09:28.650; the separate Sales access PUT returned
200 at 14:09:29.786. Authoritative exact-ID storage readback increased by 24 hours. The original
14:09:40.674 accessibility-tree diff shows “Extension completed”, confirmed Session access until
2026-10-29T13:54 UTC, confirmed expiry 2026-10-29T13:53:30.000Z, and matching command correlation
`294ae15b-4f6b-4163-9f9b-ba017cf1dc84`. The same tool output records one console entry and zero
warnings/errors. Existing server HTTP 200 evidence is retained independently.

Separate viewer evidence showed runtime 48m at 14:05:37 and 1h43m at 14:10:17, alongside elapsed
wall time and display rounding; this is not inferred from storage expiry or an exact-second runtime
increment measurement. The same ten viewer tab/entity IDs were observed. They are **not** a verified
seven-provider-VM-ID inventory and do not prove guest bytes or work preservation. No guest-data or
work witness was obtained in this earlier run. No structural-only waiver was accepted.

Trial real UI publication, registration, Open Trial launch, exact binding, Ready state, runtime,
storage and relevant console evidence were captured. One normal guest view remained “Connecting”.
No guest-work witness was obtained, so Trial Extend remains held at zero. No additional assets,
extensions, timing rewrites or workaround operations are authorized by these observations.

Owning-Customer Support UI displayed the actual success evidence and an actual malformed-ID GET
400 diagnostic with masked authorization and verbatim provider body. Relevant Support captures had
zero warnings/errors. This proves input rejection, not valid-missing 404 or Extend permission 403.
A separate foreign-Customer HTTP login returned 200 and Support returned 200 with zero entries.
Five Grammarly warning/error entries elsewhere were retained and independently attributed narrowly;
there is no global-zero-console claim.

The run 1 live ledger before preservation cleanup was: Experience creation 2; correlation-property POST 2;
Participant registration 2; sponsored-link POST 2; viewer activations 2; Environment creations 2.
Sales Extend 1 and its access PUT 1 are spent. Two local portal capabilities were issued: the old
one is revoked, the new one active. Trial Extend, invitations, Archive and Delete remain zero.
No unrelated End rewrite occurred. The Sales access PUT above is the required extension coordination.

Earlier clipboard-copy success cleared the manual field while the virtual clipboard was empty;
a paste failed before input. A proposed alternate hostname failed DNS before issuance. Chrome then
reported another extension UI blocking automation; its identity/cause was not established by the
human screenshot. Human clipboard/context assistance was disclosed and enabled continuation.
The changed Sales Extend itself was an automated UI click; human setup assistance is not human QA
approval and does not change the accepted waiver.

## Evidence integrity and preservation

All raw evidence remains external/private under
`C:/Users/swins/AppData/Local/CodexProfiles/cloudshare/qa-issue-473`:

- `sales-frozen-1/manifest.json` SHA256
  `A112FA9FE4965F554985A205FDFD28E8DC19AE7613A8D390CDF8C023ECEF9B56`.
- `trial-support-frozen-1/manifest.json` SHA256
  `6172D9982332641FA0356624C04B551C7C39845FB431704CDA3CF7C31CD9AB39`.
- `sales-frozen-1-cua-addendum/manifest.json` SHA256
  `88C0EB8821082822F2814D8994527A5BCDD844300D0F9D0DA29A3CEE419F2C42`.

The original ad hoc pre-operation JSON was overwritten by a later read. Its original contents are
not claimed recovered: actual append-only provider pre-exchanges and the durable captured target
were exported instead. The six original CUA lines were recovered without new UI actions, source-log
modification or reconstruction; offsets, byte lengths and hashes are preserved. The captured source
hash `51d23de54d79405f50798160a9337a3769343762d55355b32bdd46369d740610` applies to the
first 8,654,395 bytes, not the current full append-only log. The later prefix verification and all
six byte-range hashes matched. This proves a contemporaneous accessibility-tree diff, not a full
DOM or browser network archive.

Final exact-head Standards, Spec/security, and QA evidence-accuracy/actual-acceptance reviews remain
required after this prose update. Accurate evidence is not completed acceptance. The primary checkout
and database stay untouched; isolated databases, encryption keys, histories and frozen evidence remain
preserved outside the worktree. The synthetic server on port 3026 remains stopped.

## Run 1 preservation cleanup (2026-10-27)

Both owned viewer tabs were closed before fresh exact-identity/state/fence guards. One typed,
bodyless v4 Suspend for the owned Sales Environment returned 204, followed by authoritative GET
Suspended at 14:32:53 UTC. The separately guarded Trial Environment received one Suspend 204,
followed by GET Suspended at 14:33:19 UTC. Exactly two cleanup POSTs occurred, without retry,
Archive, Delete, unrelated End rewrite, link revocation or new capability. This is housekeeping,
not UI acceptance evidence or preserved-work proof.

The owned server processes (60316/65876) were stopped, jobs remained disabled, and ports 3025 and
3026 were free. User-shared portal tabs were left open. Two local capabilities remain preserved
(one revoked, one active). The main checkout remained on `main` at `1f615591` with its two original
untracked files; port 3000, the primary database and retained earlier-ticket assets were untouched
by this task. The ticket worktree remains preserved because the work is incomplete.

The run 1 external `after-cleanup-frozen-1/manifest.json` SHA256 is
`B11DB43CD69FC4FD593748C5ED74FE2ACAA18070079E335FE78673C5709206BA`.
It preserves the isolated database/key/resource tuple, private cleanup exchanges, Trial credential,
Support-isolation evidence and server logs. Earlier frozen manifests remain unchanged. QA returned
no overall merge approval: at this run 1 checkpoint, preserved-work acceptance remained blocked and Trial Extend remained zero.
PR #476 remains draft/unmerged, issue #473 active, and #474 blocked pending the outstanding gates.

## Isolation run 2 and cleanup (2026-10-27)

A bounded second run reused the owned Trial assets with independently confirmed Incognito Trial
identity and local portal role controls. Correct isolation was demonstrated; it does not establish
that identity/context was the sole cause of the earlier guest-connection problem. A third local
role switch was unused. No guest witness was saved and Trial Extend remained at zero.

This run issued one Resume POST returning 204 at 17:43:13.478 UTC, followed by authoritative Ready
at 17:43:41.006. One fresh sponsored-link POST returned 200 during 17:44:15.977–17:44:16.195.
The guest view still showed “Connecting” through 17:47:46. This is evidence of attempted access,
not evidence of guest data or preserved work. No new Environment or Experience is inferred from
the fresh sponsored link.

The owned viewer tab ending 354 was closed at 17:49:16.947. Fresh exact-identity/state/fence guards
then allowed one cleanup Suspend POST returning 204 and GET Suspended at 17:50:04.797. Owned server
processes 119048/122236 were stopped; ports 3025/3026 were free, and the primary checkout/database
remained untouched. This API cleanup is preservation housekeeping, not changed-path UI acceptance.

The earlier run 1 ledger and frozen evidence remain unchanged. Run 2 adds exactly one Resume,
one sponsored-link POST and one cleanup Suspend. Therefore the cumulative recorded sponsored-link
POST count is three, Resume count one, and cleanup Suspend count three. Sales Extend remains one,
its coordinated access PUT remains one, and Trial Extend remains zero. The run 1 creation counts
remain two each for Experiences, Participants and Environments. No additional guest-work proof or
acceptance is implied by those cumulative counts.

External frozen manifests under the same private QA evidence root are:

- `isolation-run-2-precleanup-frozen/manifest.json` SHA256
  `541EF09E856341D7FB429D695A04C623D9389186AE4E03623295517FA38EA303`.
- `isolation-run-2-aftercleanup-frozen/manifest.json` SHA256
  `D676BC27B8E88B885B99315DE058D4160A3274FB916B9A3117CE67A7F048633E`.

Both hashes were checked before this prose update. Prior evidence was preserved rather than
rewritten. Runtime code remains `1fc7ee21ecf21af7b6d6ac07eae6abae267e766d`. Acceptance remains
**blocked** at this run 2 checkpoint: Sales work preservation had not been demonstrated and Trial Extend was not exercised. The later Sales evidence below supersedes that Sales-only gap.
PR #476 remains draft/unmerged, issue #473 active, and dependent #474 blocked.


## Manual Sales continuity evidence (2026-10-28)

Independent QA and Spec reviews accepted actual observed work preservation: the same Windows and
pfSense application state was visible before and after the human-performed Sales extension, with
exact-Environment diagnostics. Neither review requires a saved file under #473. This satisfies
the Sales continuity criterion for the observed application state; it does not establish arbitrary
guest-byte preservation or saved pfSense configuration.

Correlation `9d55f599-136e-4bdb-a884-85be56087dc8` records one bodyless Extend POST 204,
exact-ID Ready GET, and separate access PUT 200. Storage expiry changed from
`2026-10-29T13:53:30Z` to `2026-10-30T13:53:30Z`; access became `2026-10-30T13:54Z`.
Screenshots show runtime `1h17` to `2h12` and storage `1d3h29` to `2d3h25`, subject to elapsed
time and display rounding. Screenshot artifact times `10:24:31`, `10:29:52`, and `10:30:21` UTC
are not click times. Earlier automated interaction and console evidence remain separate; no new
console result is inferred from these screenshots.

The four-file private bundle `manual-sales-evidence-frozen/manifest.json` has SHA256
`24E95A3559F2B05CA25190BB1168FE3DFC77F26BFA92D2FF46A461A6CB1D8938` under the existing QA evidence
root. Prior frozen evidence and historical run ledgers remain unchanged. This manual run adds one
Sales Extend and one access PUT to the earlier totals (two of each cumulatively).

At this manual Sales checkpoint, Trial Extend and Trial continuity remained pending and overall
acceptance was **blocked**. PR #476 remained draft/unmerged and issue #473 active. Port 3025 was left running for the human;
the earlier cleanup/server-stop records describe their own checkpoints and are not a current
shutdown claim. No new cleanup is claimed by this update.


## Manual Trial continuity evidence and final cleanup (2026-10-28)

Independent QA and Spec reviews accepted the retained Trial extension and observed work continuity.
The before and after images show the same Windows 2022 Notepad document `qa473-trial` with
`This is a test file`. The human separately reported closing and reopening it with unchanged
contents; the still images do not themselves prove that action. Runtime displays increased from
`34m` to `1h29` and storage from `3h39` to `1d3h34`, subject to elapsed time and rounding.
The manual navigation was **Open monitoring** before Participants. The human reported the UI
interaction; provider records independently establish the extension. No new Trial-specific browser
console capture or portal screenshot was collected, and this is not an automated browser run.

Correlation `f667d031-4ef3-45b2-8d32-1512c0812475` records Ready GET 200 at
`2026-10-28T10:42:39.921Z`, exactly one bodyless Extend POST 204 at `10:42:40.113Z`, and
exact-ID Ready GET 200 at `10:42:41.050Z`. Expiry increased from `2026-10-28T14:19:40Z` to
`2026-10-29T14:19:40Z`. Image artifact times `10:40:44.436` and `10:45:29.345` UTC are not
click times. The private `manual-trial-evidence-frozen/manifest.json` (two PNGs and database) has
SHA256 `126596C0D2CED5D696368707A078AB965D9B79440D2C7E5414294D9A73453210`.
Earlier Trial Extend-zero entries describe earlier checkpoints; this run adds one Trial Extend.

After the human confirmed both viewers were closed and Spec acceptance passed, fresh guards
preceded one bodyless Suspend POST 204 per owned Environment. Exact GET confirmed Sales Suspended
at `2026-10-28T10:49:44.853Z` and Trial Suspended at `10:50:08.409Z`. There were no retries or
other writes during this cleanup. These two cleanup Suspends bring the recorded cumulative cleanup
Suspend count to five; they are housekeeping, not extension acceptance evidence.
Owned server processes 69476/80808 were stopped and ports 3025/3026 are free. The primary checkout
remains on `main` at `1f615591` with the same two original untracked files, untouched by this task.

Private `manual-aftercleanup-frozen/manifest.json` has SHA256
`59082876BC0EF23DC74A26D755C5D36D9AC9E9F2B9E23B70809D80FC1FABA0A0`, preserving the database,
key, resource tuple, receipts and server logs. Previous manual Sales, Trial and run 2 manifests
remain unchanged. All live acceptance criteria now have independent QA/Spec acceptance within
the stated evidence limits. Final exact-head reviews and merge remain pending; PR #476 remains
draft/unmerged and issue #473 active. No merge or issue completion is claimed.
