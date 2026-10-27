# Suspend/resume v4 migration - #472

Baseline: #469 merge c605217f. Scope: existing Certification controls, heartbeat and logout;
no new UI. Existing authenticated endpoints, entitlement, time gates and server302 admission remain.

## Contract, consumers and acceptance

Official provenance: `docs/api/assets/cloudshare-infrastructure-v4-2026-10-26.json`,
EnvironmentsV4_Suspend/Resume: bodyless Bearer POST `/v4/environments/{id}/suspend|resume`.
The exact Customer-correlated opaque ID is encoded as one path segment. No immediate/query/body,
ID transformation or v3 fallback. Empty204 is acknowledgement, never proof of completion. Existing
authoritative Ready/Preparing resume semantics remain. Edit permission is required; ownership alone
is insufficient. Unsupported states, field errors, legacy errors, empty error bodies, permission,
rate limiting and transport failures retain typed safe outcomes and protected Support evidence.

| Consumer | Path and evidence |
| --- | --- |
| Candidate suspend/resume | authenticated route -> runtime -> lifecycle -> typed controller; recording HTTP and handler tests |
| Heartbeat lost liveness/lab closed | same persisted lifecycle and controller; handler recording HTTP |
| Candidate logout | logout -> suspend handler -> shared lifecycle; handler recording HTTP |
| Completion/early completion | Archive unchanged, v3 PUT/query, never DELETE |
| Sales/Trial default extension | retained v3 dispatcher; #473 owns migration |

Protected evidence retains request/provider body verbatim and masks non-allowlisted request headers.
Candidate responses and generic resume success logs omit Environment identity. Reconciliation-only
success is labelled `portal.environment.reconciliation`, not a fabricated command exchange.

## Durable runtime command invariants

Parent approved the narrow missing safeguard required by this issue. A dedicated per-ExamAttempt
row holds Customer, commandId, action and exact Environment. It is separate from the public
ExamAttempt projection. Five optional repository operations read/claim/finish-dispatch/settle/release are fail-closed
for runtime callers when absent. The production and in-memory adapters implement them.

Atomic claim checks Customer, expected status and absence of another command. Only the winner
may POST; lost claim acknowledgement cannot dispatch. A persisted `dispatching` phase cannot be
settled by another caller, even if a target state is observed. Only the owner moves it to `observing`
after its POST has returned/rejected, or after deciding no POST is needed. It cannot send afterward.
Pending same/opposite requests cannot retire an in-flight owner; observing requests read only;
source/unknown/timeout/restart cannot replay. Fresh unknown/transitional state rejects before POST.
Authoritative target precedes one transaction updating persisted clock and attempt status and
removing only the matching command. Terminal attempts cannot be resurrected or have their clock
restarted. Missing-clock behavior and pause/resume arithmetic match the existing clock module.
Definite HTTP400/401/403/404/429 may release the matching marker; ambiguous transport/5xx,
confirmation and persistence failure retain it. No TTL, override UI or generic command engine.
An `observing` ambiguous command remains blocked until authoritative target evidence. A crash or
lost phase acknowledgement that leaves `dispatching` deliberately remains fenced even at a target
state: absence of a live owner is not inferred, and there is no automatic expiry or replay.

## Accepted seams and verification

- Typed controller with recording HTTP: exact paths/auth/no body, empty204, failure evidence,
  no transport retry/fallback; retained Archive and Extend wire requests.
- Existing authenticated/runtime/heartbeat/logout handlers: ownership, time gates, asynchronous
  confirmation, no-op/unknown states, pending command recovery and safe projections.
- Public repository seam: scoped concurrent claim, exact marker, clock/status settlement and
  terminal guard, including production disposable SQLite and adapter recreation.
- Independent automated browser/live QA: minimal owned disposable Certification attempt, actual
  controls plus logout/lost-liveness; provider before/after, clock/work and server302,
  Customer-scoped Support success/failure and browser console. Live proof is separate from mocks.

RED/GREEN: Suspend v3 PUT was observed before v4 POST passed; Resume independently failed then
passed. Missing persisted claim/settle failed before implementations. An uncertain suspend sent
twice before the fence; now exactly one POST and a pending retry. Resume responses/logs exposed
provider identity before the projection fix. Recording HTTP handler tests prove204 cannot advance
the clock; Preparing confirmation, settlement-failure recovery, claim acknowledgement loss,
opposite pending request, heartbeat and logout all preserve one dispatch and persisted clock.

Reviewed runtime head: `7756114f81f8276362cf547f6b07a356921eae72`. Both independent review
axes accepted the runtime repair. Lint/typecheck pass; launcher 14/14; full Vitest 2,540 pass /
four inherited CandidateHome failures (2,544 total), independently reproduced at the baseline.
Focused runtime 56, Support 16, lifecycle 25 and public persistence 4 tests pass. Human QA was
waived by the issue work order; mandatory automated browser/live evidence was not waived.
Documentation reconciliation requires exact-head review. Acceptance remains BLOCKED; #473 remains blocked.

## Live acceptance matrix (2026-10-27)

| Criterion | Evidence and disposition |
| --- | --- |
| Real Candidate admission | Passed: UI scheduled one owned disposable Attempt; actual child and guest opened; server `/enter` returned 302 without retaining a bearer Location. Exact roster/detail matched Customer-owned Participant, Environment, Project and owner. Live ping/read-only preflight 3/3 passed. |
| Explicit Suspend, logout and heartbeat | Runtime behavior passed: three physical v4 POST 204 Suspend writes, one per trigger, with authoritative Suspended readbacks. Clock paused at 345437, 517900 and 555891 ms respectively. Mandatory explicit Suspend/logout/post-timeout heartbeat console evidence remains BLOCKED. |
| Resume and guest state | Two physical v4 POST 204 Resume writes, authoritative Ready reads, prior elapsed time retained. Same Windows Server VM retained the preexisting pfSense WAN page, field values and scroll position; no guest data was edited. Later Resume pre-navigation console captured zero warnings/errors; this does not cover all runtime phases. |
| Support and isolation | Real Customer Admin Support UI showed Suspend/Resume/heartbeat success paths, 204, source, anchors and correlation. Synthetic invalid-ID GET returned 400 and appeared in real Support UI; protected-record assertions verified body/response headers and request-header masking. Foreign Customer authenticated attempt drilldown returned 404 (API evidence, not foreign UI search). Support console captured zero warnings/errors. |
| Unchanged Archive regression | Coordinator option 2 replaces the extra live End/Archive test with independent exact-runtime-head audit and six existing offline files, 58/58 passing with DB setup disabled. Both review axes confirmed Archive logic/transport, completion handlers and Extend unchanged. B's earlier live evidence remains historical only; #472 made zero Archive writes and claims no live completion. |
| Final acceptance | BLOCKED on required console capture and final evidence review. Earlier runtime/logout captures were lost. A pre-login hydration warning has unproven cause/inheritance; no all-zero console or provider-bug claim. |

The coordinator revision removes the extra unchanged End/Archive live regression from this slice's
plan; it does not waive mandatory changed UI, console or Support verification. Two prior End dialog
accept attempts timed out in Chrome focus emulation and sent no recorded Archive. Native control
was stopped by the user's physical Escape; the subsequent Chrome-only preference excludes native
fallback. No direct API completion substitute was used.

The minimum additional same-asset console repair budget was at most three Suspend/two Resume
writes. Chrome page creation detached before control/console twice: first Candidate entry redirected
to an existing Admin session; the final permitted reset/direct-Admin retry also detached. Jobs and
server were stopped after each. Additional budget used: zero; physical totals remain S3/R2/Archive0.
No further GUI retry occurred. The separately authorized API preservation cleanup below does not
consume this UI evidence budget or replace its missing console evidence.

## Resource preservation and genuine blocker

The pre-cleanup exact read at 2026-10-27T11:29:51Z found the owned provider Environment Ready
while the local Attempt was Suspended, clock paused at 555891 ms, pending commands zero. Human
external viewer interaction was reported, but causation of that earlier Suspended-to-Ready
transition is unknown; no provider bug is inferred.

The coordinator subsequently accepted preservation of the owned Experience, Environment, Attempt,
history, isolated DB/key and forensic evidence, and authorized at most one Customer-scoped cleanup
Suspend. Fresh preflight verified the exact Customer, Experience, Participant/roster, opaque
Environment, Project and owner; provider Ready, local Suspended/paused, no pending command or Trial
Offering. With server/jobs stopped, the production client and typed EnvironmentController used the
stored encrypted Customer Connection for one v4 Suspend POST 204. One authoritative v4 GET then
returned 200 Suspended. Local status and paused 555891 ms clock remained unchanged, pending zero.
The protected cleanup intent, acknowledgement and exchange are retained privately. This is API
preservation evidence, not UI or console proof: physical totals are UI Suspend 3 / Resume 2 plus
API cleanup Suspend 1 (aggregate Suspend 4 / Resume 2), Archive 0. No Delete, timing rewrite,
corrective Resume or retained-asset mutation occurred.

Owned port 3025 remains stopped/free and jobs stopped. Recovery records and assets are retained by
coordinator decision; primary checkout/3000 and retained #350/#351/B assets are unchanged. Authored
Experience End is 2026-10-27T12:06:00Z; recorded storage expiry is 2026-10-29T08:06:41Z. Neither
proves automatic runtime suspension at Experience End or guarantees extended retention. Recheck
exact identity, state, access window and Experience End before proposing any future bounded flow.
Cleanup changed the starting state to Suspended: the historical Ready/no-POST console plan and its
unused budget are not authority for a Suspended-start retry. A fresh state/window/budget plan needs
coordinator approval; no replay, replacement asset or timing change is authorized by this record.

Sanitized source, read in full including its superseding cleanup section: external
`codex-home/qa-evidence/issue-472/consolidated-post-cleanup-7756114f.md`, SHA-256
`5BB964C28D9F1E9AD047B7AAA28C350F120E2BF806F7554B9319DBD4508429AC`.
Its final section supersedes the earlier cleanup-open/Ready wording; the coordinator option-2
revision supersedes mandatory current-ticket live Archive. Exact IDs and credentials remain in
private evidence. Repeated Chrome connection failure still blocks explicit Suspend, logout and
post-timeout heartbeat console evidence. Authorized preservation is not ticket acceptance or a
waiver; reliable Chrome control and final evidence review remain required.

## Remaining v3 register and operating notes

Archive; Extend until #473; Blueprint/default Snapshot; VMware Regions; Teams and active
Project-member/Sales Pro eligibility; timezones; ping; existing webhook ingestion semantics.
Historical v3 diagnostics remain readable. No Environment DELETE substitution.

Schema is additive: regenerate Prisma and migrate isolated QA storage before browser verification.
Primary checkout, DB and port3000 and retained #350/#351 assets are untouched. No live credentials
or protected evidence is printed or committed. Test reports are retained outside the worktree.


## Independent review repair 1

Standards reproduced an in-memory settlement yielding during clock persistence: competing
settlements both returned true and an ordinary Completed save could be overwritten. Public
repository RED observed `[true,true]`; one mutation queue now serializes command mutations and
ordinary saves, with no nested queue calls. Reads wait for preceding mutations. Regression proves
one settlement winner and terminal save retention.

Spec/security reproduced an owner suspended in preflight while another observer removed its
marker and an opposite Resume completed. The late owner then sent Suspend without a marker:
recorded writes were `[resume,suspend]`. Handler RED reproduced that exact interleaving. Persisted
`dispatching`/`observing` plus exact-command CAS now permits only the original Suspend; observer
and opposite calls remain202 and cannot clear the owner. Production SQLite also rejects settlement
before the owner phase transition, preserves it across adapter recreation, and rejects stale IDs.
Lost phase acknowledgement tests cover both committed and uncommitted transitions without replay.

Additive migration `20261026204600_runtime_command_dispatch_phase` defaults existing markers to
`dispatching` conservatively. Apply both migrations and regenerate the isolated QA client. No
provider actions, primary checkout/database changes or broader lifecycle changes in this repair.

Repair1 verification: lint/typecheck pass; launcher14/14; full Vitest2,540 pass and the same four
independently reproduced CandidateHome baseline failures (2,544 total). Focused runtime56,
Support16, lifecycle25 and public persistence4 tests pass. External report:
`codex-home/qa-evidence/issue-472/implementation/repair1-full-tests.json`.
