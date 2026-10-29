# Issue 411 — authenticated Trial remote desktop downloads

## Contract and scope

Each existing Windows VM is shown by friendly name with its own explicit Download RDP link. There is no provisioning choice. Browser Trial launch remains independent. The participant may need guest credentials in their desktop client; Certalis does not generate a file or embed the provider's separate clear-text password.

- `GET /api/sales-trial/offerings/{offeringId}/rdp`: authenticated participant status and opaque VM selectors; no provider IDs or credentials.
- `GET /api/sales-trial/offerings/{offeringId}/rdp/{selector}`: fresh ownership, continued-enrollment lifecycle, participant correlation, exact Environment, and VM membership checks; provider file as an `application/rdp` attachment. All outcomes are `no-store`.
- Environment and VM discovery use v4. The narrowly authorized v3 `GET /vms/actions/getremoteaccessfile` uses the discovered MC ID and required 1920×1080 dimensions. The public-cloud EM-only v4 download operation is not used for these machines.
- File-request readiness requires a ready, unexpired Environment, completed VM preparation and a server-side public-remote-access configuration signal derived from FQDN using human-confirmed tenant semantics. External IP/address and web-access fields do not determine eligibility or connection availability. The documented positive Running display label is required; missing, unknown and transitional labels fail closed without treating the provider status as a stable enum. No resume, provisioning, ending reconciliation, or other provider mutation occurs.
- Protected Customer-scoped diagnostics retain provider evidence through the existing observer; ordinary responses and audit metadata exclude the separate password, raw provider bodies and provider IDs. The explicit attachment alone carries the provider's RDP content.

## Acceptance evidence

Automated seams: handler ownership/lifecycle and opaque selection; HTTP authorization/no-store/attachment; provider pagination, VM detail membership and signed v3 mapping; UI explicit availability check and native attachment link.

Live behavior, native-client opening, browser interaction/console evidence and protected Support diagnostics still require independent QA. Automated fixtures do not establish real network reachability or provider no-public-IP behavior. Human QA remains required before merge.

The Codex-owned server was stopped before source edits. No live assets, primary checkout, or port 3000 were changed during implementation.

## Implementation verification (2026-10-29)

Runtime/test head: `182eeec0d518be7bcb09b3e15041af6d5a936054`.

- Focused feature tests: 29 passed (handler 16, adapter 9, HTTP 2, UI 2), included in the full run.
- Typecheck passed; lint passed with no warnings/errors.
- Full `npm test`: launcher 14/14; Vitest 2579 passed and 4 failed across 297 files (296 passing), 186.74 seconds. All four failures are the previously established `candidate-home-route-focus.test.tsx` baseline: task-control focus/announcement, scheduled-attempt explanation, complete-card aria labels, and background-refresh card aria labels. No new failure occurred.
- Tests used the native physical worktree path and an external configuration preserving repository test settings with serial workers and an absolute, disposable `prisma/test.db` in this worktree. The initial alias-path UI bootstrap failure was reproduced on an unchanged test and resolved by canonical paths; no tracked test-runner/package change was made.
- One test-fixture repair narrowed its v4 VM-detail URL matcher so it no longer intercepted the v3 file endpoint. No production repair loop was needed.
- Browser/live/native-client/Support and human QA are pending. No live provider call or service start was performed by implementation.


## Independent review repair 1 (2026-10-29)

Runtime/test/build head: `f809b588` (documentation-only follow-up does not change it).

Addressed the three reported P2 findings: unknown/transitional VM labels cannot authorize download; aggregate preparing status and per-machine reasons accurately distinguish preparation, absent public address and unconfirmed readiness; derived roster/page failures retain typed protected request/response context, operation, integration surface and failure mode while ordinary client errors remain static. The existing diagnostic failure projection is reused.

Each affected behavior was observed failing before its fix. Final focused checks: 36/36. Typecheck and lint passed. Fixture production build passed, including both RDP routes, with seed off, background jobs disabled, a temporary process-only random key and this worktree's disposable test database; no real credentials or server were used. Final full `npm test`: launcher 14/14; Vitest 2586 passed + the same four candidate-home baseline failures, 296 passing files/297, 283.29 seconds. No new failure. Build and test processes terminated before releasing the CPU slot.

Both independent review axes must re-review this repair; browser/live/Support/native-client and human QA remain pending. No additional feature scope or provider routing was added.

## New-fact reconciliation 2 (2026-10-29)

The saved private/NAT addresses and the human's SparkGateway explanation invalidate the prior
external-address presence gate. It has been removed from both the parsed VM projection and file
request checks; no IP classifier, DNS lookup or exposure inference replaces it. The UI states that
it requests a provider connection file and that connection availability is unverified. Running
and completed preparation remain necessary readiness checks, alongside all fresh ownership and
membership checks. Download remains an explicit per-VM action with no prefetch.

Absent, null and private/NAT address regressions were observed red before the adapter change;
the disclosure regression was observed red before the wording change. Updated focused checks:
38 passed. The earlier no-address refusal evidence is historical and is superseded here. Protected
diagnostics and safe provider-failure messages remain. This is a correction from new evidence,
not additional network functionality. Fresh independent reviews and bounded live/native-client
verification are still required; new Snapshot availability and its effect on new Environments
have not been verified by implementation.

**Final automated verification for reconciliation 2:** both independent review axes returned no
blocking findings at `12203daff2ccf99dfdb7fa8d4eff3f1d07d44348`. The production fixture build then
passed at that exact head (seed off, background jobs disabled, ephemeral process-only key and
owned disposable test database, no live credentials). The subsequent serial full `npm test`
finished: launcher 14/14; Vitest 2588 passed + the same four candidate-home baseline failures,
296 passing files/297, 198.88 seconds. All 38 feature tests passed; no new failure. Types and lint
had already passed for the same application source. All build/test processes ended. This final
note changes documentation only; application and test files remain identical to the reviewed,
built and tested head. Browser/live/native-client/Support and human acceptance remain pending.

## Human-confirmed FQDN correction 3 (2026-10-29)

The parent explicitly approved this third, bounded new-evidence correction after the human
confirmed a saved Snapshot and supplied the four-VM JSON/tenant FQDN semantics. The adapter
retains only `publicRdpConfigured` (true/false/unknown), discarding the hostname from its parsed
projection. Nonblank FQDN is necessary alongside Windows/Running/progress 100; null/blank means
not configured and missing/nonstring is unknown. Fresh detail repeats the same check. Suspended
VMs remain unavailable, with no resume or other provider write. Public connection availability
is still unverified. No name, NAT-address, web-access or DNS inference is introduced.

The four-VM eligibility and configuration-message regressions were observed RED before GREEN.
All 46 focused tests pass, including the changed-detail refusal and hostname/address/ID leakage
checks. Docs attribute the signal to human-confirmed tenant behavior, not an OpenAPI guarantee
or agent live evidence. Both fresh reviews and coordinated final build/full-suite verification
remain required at the new exact head. Any further blocker must be escalated before another
repair loop; this correction adds no product scope.

Final correction-3 verification: both independent review axes found no blockers at
`275d8dd3fa17011346bcbd38a0c3b8fccc612db4`, including the accepted main PostCSS dependency
merge. Own dependency install and Prisma client generation completed; types and lint passed.
The isolated production fixture build passed (seed off, jobs disabled, process-only key and
owned test DB). The strictly serial full suite completed: launcher 14/14; Vitest 2596 passed
and exactly the same four established candidate-home-route-focus failures, 296 passing files
of 297, 194.29s. No new failures. All verification processes ended. This evidence update changes
only documentation; application/test source remains identical to the reviewed and tested head.
Browser/live/native-client/Support and human acceptance remain pending; no live calls or services
were started by implementation.

## Support visibility repair 4 (2026-10-29)

The parent explicitly authorized this bounded fourth repair after synthetic QA found persisted
RDP diagnostics absent from Sales Support. Root cause: the Sales diagnostics source allowlist
omitted `sales-trial-rdp`; aggregate queries returned no rows and explicit source queries returned
400. The production fix adds that single source. A parameterized real-repository handler regression
first reproduced both failures, then passed while retaining owned 403 operation/surface evidence
and excluding other-Customer/unrelated evidence. All 39 diagnostics tests, types and lint pass.
Fresh reviews and an isolated production build remain required. Prior full-suite evidence at
275d8dd3 is reused with this narrow delta explicitly qualified; no new full-suite claim is made.
Actual Support/foreign-Customer and browser-independence QA must repeat. No live actions occurred;
any additional blocker requires escalation before a fifth repair.

## Support causal-filter completion 5 (2026-10-29)

Both reviewers identified that repair 4 missed parallel source selections for the actual workflow
evidence buttons. Parent explicitly approved completing the three existing selections: direct
Offering, direct Enrollment, and Enrollment-to-parent Offering, including explicit source branches.
Both reviewers confirmed the bounded matrix before edits. Eight real-repository cases (Offering/
Enrollment × source absent/RDP × correlation absent/present) failed empty before the fix and pass
afterward. They retain owner 403 operation/surface evidence, mapped parent scope, exact Offering
scope, foreign/sibling/unrelated exclusions and correlation filtering. No traversal/filter framework
was introduced. All 47 diagnostics tests, types and lint pass. Fresh independent reviews and one
fixture build remain pending; full-suite275d8dd3 evidence remains qualified prior-head evidence.
Actual Support/browser QA must repeat. Any further blocker requires explicit escalation before
repair 6; no live actions or services were started.
