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
The replacement live evidence below completes the three previously missing console gates.
Documentation reconciliation and final lifecycle acceptance still require exact-head review; no
merge or dependency release is claimed here.

## Live acceptance matrix (2026-10-27)

| Criterion | Evidence and disposition |
| --- | --- |
| Real Candidate admission | Passed: replacement real UI Schedule created one Attempt/Experience, with Start 2026-10-27T12:50:00Z and End 2026-10-27T16:50:00Z. Four provisioning POSTs returned 201/201/201/200; server `/enter` returned 302, one owned Environment matched Participant/Project/owner and Ready readback, and the actual child viewer showed the guest. Initial heartbeat 409 preceded settled admission; later heartbeat returned 200. Complementary live preflight 3/3 remains separate evidence. |
| Explicit Suspend | Passed: one replacement UI v4 POST 204, authoritative Suspended readback, clock paused 62728 ms; settled console zero warnings/errors. |
| Heartbeat lost liveness | Passed: replacement navigation away, bounded jobs-enabled 30-second timeout, one v4 POST 204 and Suspended readback, clock paused 130782 ms. Post-timeout Home console zero warnings/errors; jobs stopped immediately after capture. |
| Logout | Passed: real replacement UI logout returned 200, one v4 Suspend POST 204 and Suspended readback, clock paused 185978 ms, session removed. Settled login-page console zero warnings/errors. |
| Resume and guest state | Two replacement UI v4 POST 204 Resumes with authoritative Ready reads and prior elapsed retained, including Resume 2. Resume/admission captures had zero warnings/errors. Earlier original-flow pre/post VM/pfSense page, fields and scroll position provide guest working-state continuity; no new marker or guest data edit is claimed. |
| Support and isolation | Original real owner-Customer Admin Support UI showed Suspend/Resume/heartbeat success and synthetic invalid-ID GET 400 with method/path/status/source/correlation. Protected-record assertions verified response body/headers and request-header masking. Foreign Customer authenticated drilldown 404 is API isolation evidence, not foreign UI search or valid-missing provider 404. Replacement correlated diagnostics cover all five physical runtime writes. |
| Unchanged Archive regression | Coordinator option 2 accepts independent exact-runtime-head source audit and six existing offline files, 58/58 passing with DB setup disabled. Both axes confirmed Archive logic/transport, completion handlers and Extend unchanged. B's live evidence remains historical; current-ticket Archive count is zero and no live completion is claimed. |
| Console disposition | Three mandatory replacement captures independently accepted. Stage 0 had the narrowly attributed environmental signatures described below; this is not an all-zero-console claim. Earlier lost original-flow captures remain lost, not retrospectively clean. |

The first replacement login emitted a hydration mismatch naming extra `fdprocessedid` attributes.
Raw server HTML and current/pristine baseline source lacked them; a neutral script-free form in
the same Chrome environment acquired them on rendered controls. A separate extension-source
`Params are not set` error appeared on Example Domain and the neutral page. Independent review
accepted only these demonstrated environmental signatures, outside portal-supplied JavaScript;
the injector and timing remain unidentified. A different hydration diff, application exception or
failed interaction would still block. No extension setting or product code was changed.

Replacement setup used a separate DB with all 65 migrations, projecting the existing Candidate,
published Exam and required identities/configuration without old Attempt/Launch/clock/command/
heartbeat/Trial/diagnostic history. A temporary password hash for that same Candidate enabled real
UI login; it was restored afterward. Exact identity and original hash equality were verified;
all other rows were unchanged by restoration and the original DB hash remained unchanged. No
session was fabricated. One empty controlled-field submission sent no request; authorized normal
keyboard/blur recovery produced the single Schedule.

## Historical attempts and authorized preservation

The original UI flow produced Suspend 3 / Resume 2, all 204, with clocks paused at 345437,
517900 and 555891 ms. Two End dialog confirmations timed out without Archive. Native control
stopped on the user's physical Escape; subsequent work followed the Chrome-only preference.
Two later Chrome page creations detached before control/console, using zero of that proposed
extra UI budget. Those failures and missing captures are historical; the separately authorized
replacement flow above supplies the three missing gates.

The original provider was later observed Ready while local status remained Suspended/paused
555891 ms. Reported human viewer interaction does not establish causation; no provider bug is
inferred. A separately authorized typed Customer-scoped API cleanup sent exactly one Suspend
POST 204, followed by exact GET 200 Suspended, preserving local state. Original ledger is UI
S3/R2 plus API cleanup S1 (aggregate S4/R2), Archive 0. Replacement ledger is separately UI S3/R2,
all 204, with no extra API cleanup. Diagnostic projections are not duplicate provider writes.

Original authored End remains 2026-10-27T12:06:00Z and recorded storage expiry
2026-10-29T08:06:41Z. No original Start/End rewrite, Archive or Delete occurred. The original
Experience/history/DB/key/forensics remain retained by coordinator decision; expiry and End do
not establish automatic suspension or extended retention. Original assets were not reused to
bypass the expired access window.

After replacement logout and browser cleanup, the 2026-10-27T12:58:49Z exact Customer-scoped GET
confirmed Suspended with matching Project/owner; local Attempt was Suspended, clock paused
185978 ms, pending commands zero, sessions zero. Replacement recorded storage expiry is
2026-10-29T12:50:44Z. The agent-created child was closed and the provided tab restored to Example
Domain. Port 3025 and jobs are stopped. Both isolated DBs, key, history and protected evidence
remain retained pending coordinator preservation disposition; this report authorizes no cleanup
write. Primary checkout/3000 and retained #350/#351/B assets are unchanged.

Sanitized final source, read in full:
`codex-home/qa-evidence/issue-472/replacement-live-qa-9238d179.md`, SHA-256
`42578B06D17E4BB08411E4F035825B2128615632893F04D3B3E80E3B599ECB94`.
Historical source: `consolidated-post-cleanup-7756114f.md`, SHA-256
`5BB964C28D9F1E9AD047B7AAA28C350F120E2BF806F7554B9319DBD4508429AC`.
Credential restoration artifact SHA-256:
`3799E73777FA990AE4B94F2FD11D85F92060AE9B1559C31B0C128715C04B3F77`.
Exact identities, bearer links, credentials and protected exchanges remain private.

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
