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

## Live acceptance status

At implementation handoff, this ticket has **no live extension proof yet**. Independent QA must
exercise both real browser workflows, capture console results, authoritative expiry/state,
separate runtime evidence where safely available, preserved work and Sales access coordination.
Live Support success/safe failure remains a QA gate. Audited simulated HTTP rejection,
ambiguity and partial-result evidence is recorded below; it does not establish live behavior.
Archived/Preparing provider acceptance is not inferred from old v3 evidence or published schemas.
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

## Live preparation and current browser blocker (2026-10-27)

On runtime head `1fc7ee21ecf21af7b6d6ac07eae6abae267e766d`, the existing read-only live suite
passed 2 files / 3 tests at 13:21 UTC: `tests/live-cloudshare-ping.e2e.test.ts` and
`tests/live-certalis-sales-preflight.e2e.test.ts`, run with `vitest.e2e.config.ts --reporter=dot`
and the existing private seed-file path. These checks cover real v3 ping and active Sales Project
member preflight; no provider writes or temporary credential file were used. The tool output was
not saved as a standalone test log. They do not verify Extend.

Real Sales UI creation at 13:19:43 UTC and subsequent Participant registration succeeded on the
owned disposable Session. Its original authored window is 2026-10-27T13:19–2026-10-28T13:19 UTC.
Exact Customer, Contact, Participant and resource identity guards remain in private QA evidence.
Unfiltered creation, registration and settled Participants console captures contained zero warnings
or errors (info/log entries only). An earlier click with no request produced no write; its cause
remains unproven. Reload, committed selection and one actual submission succeeded without a
product change.

The unchanged live ledger is: Sales Experience POST 1; scoped correlation-property POST 1;
provider Participant registration POST 1; local portal launch-capability issuance 1 (active).
Sponsored-link POST, viewer activation, Environment creation, Extend, Sales access PUT, Trial
records/Experience, invitation, Archive and Delete counts are all zero. Thus there is no live
extension, retained-work, runtime-extension or live Support success/failure proof yet.

The page reported clipboard-write success and consequently cleared its manual-copy field, but the
Browser Use virtual clipboard read was empty. One normal paste failed before input with
`Browser Use virtual clipboard has no data to paste`. The proposed alternate hostname
`localhost.localdomain` failed DNS before any further capability issuance; no alternate hostname
or regeneration followed. A subsequent exact human-mentioned Chrome tab attempt returned:

> Google Chrome is blocking automation because another extension UI is open on this page.
> Complete or dismiss that extension UI in Google Chrome, then ask me to continue.

The responsible extension is unknown. A human screenshot showing popup permission enabled and a
site-information panel does not establish the cause. Automation stopped after that bounded attempt;
the user was asked to press Escape in Chrome and reply READY, which remains pending. No alternate
automation path or further provider action is claimed. The user's original Example tab was restored.

The isolated live QA server remains ready on port 3025 with jobs disabled solely for human browser
setup. Its external database, key and history are preserved at
`C:/Users/swins/AppData/Local/CodexProfiles/cloudshare/qa-issue-473`.
The main checkout, port 3000, primary database and retained earlier-ticket assets remain untouched.
Human QA is waived by the issue's accepted work order; this browser setup intervention does not
waive automated browser/live acceptance. Both extension workflows, separate runtime/work evidence,
live Support evidence, final exact-head two-axis review and QA evidence-accuracy review remain
required. No completion, merge, or provider-contract gap closure is claimed.
