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
  controls plus logout/lost-liveness; provider before/after, clock/work, server302/Archive,
  Customer-scoped Support success/failure and browser console. Live proof is separate from mocks.

RED/GREEN: Suspend v3 PUT was observed before v4 POST passed; Resume independently failed then
passed. Missing persisted claim/settle failed before implementations. An uncertain suspend sent
twice before the fence; now exactly one POST and a pending retry. Resume responses/logs exposed
provider identity before the projection fix. Recording HTTP handler tests prove204 cannot advance
the clock; Preparing confirmation, settlement-failure recovery, claim acknowledgement loss,
opposite pending request, heartbeat and logout all preserve one dispatch and persisted clock.

Final implementation full suite: 2,536 passed / four inherited CandidateHome failures (2,540 total),
launcher14/14; lint and typecheck pass. Runtime handler53/53, recording controller11/11,
production SQLite command1/1 and in-memory command2/2 pass.
The four failures match QA's independent pristine-baseline reproduction. Independent exact-head review and live evidence remain pending. Human QA waived by the issue work order.

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
