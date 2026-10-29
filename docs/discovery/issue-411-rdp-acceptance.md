# Issue 411 — authenticated Trial remote desktop downloads

## Contract and scope

Each existing Windows VM is shown by friendly name with its own explicit Download RDP link. There is no provisioning choice. Browser Trial launch remains independent. The participant may need guest credentials in their desktop client; Certalis does not generate a file or embed the provider's separate clear-text password.

- `GET /api/sales-trial/offerings/{offeringId}/rdp`: authenticated participant status and opaque VM selectors; no provider IDs or credentials.
- `GET /api/sales-trial/offerings/{offeringId}/rdp/{selector}`: fresh ownership, continued-enrollment lifecycle, participant correlation, exact Environment, and VM membership checks; provider file as an `application/rdp` attachment. All outcomes are `no-store`.
- Environment and VM discovery use v4. The narrowly authorized v3 `GET /vms/actions/getremoteaccessfile` uses the discovered MC ID and required 1920×1080 dimensions. The public-cloud EM-only v4 download operation is not used for these machines.
- Readiness requires a ready, unexpired Environment, completed VM preparation and a public external address. The documented positive Running display label is required; missing, unknown and transitional labels fail closed without treating the provider status as a stable enum. No resume, provisioning, ending reconciliation, or other provider mutation occurs.
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
