# Issue 351 cancellation verification

## Automated development evidence

The replacement implementation starts from checkpoint e27d86f. Failed draft files were preserved outside the repository by the lifecycle task, then replaced.

- Persistence RED: `npm test -- src/persistence/prisma-sales-session-cancellation.test.ts` ran one assertion test, failed with expected `new`, received `blocked` at admission. The earlier missing generated Prisma client was a setup failure, not RED evidence.
- Persistence GREEN: that test plus `src/persistence/prisma-sales-participant-extension-command.test.ts` passed (2 tests). SQLite `prisma/test.db` proves opaque identity retention, restart recovery, revision fencing, Customer isolation, immutable Experience/environment binding, and atomic extension exclusion through the existing shared unique fence.
- API RED: `npm test -- src/api/sales-demo-session-cancellation.test.ts` ran one test, failed with expected status 202, received 409.
- API GREEN: that test and cancellation persistence test passed (2 tests), and `npm run typecheck` passed. The connected archive mock reads the admitted command and asserts its exact opaque ID is already `dispatched` before invocation; explicit reconciliation calls the exact-ID read and does not replay the ambiguous archive. A matcher unsupported by Vitest 2 was replaced with separate call-count and argument assertions.

## Implemented contract and additional evidence

`GET/POST /api/sales/enablement-sessions/{sessionId}/cancel` requires an authenticated Sales Admin and derives Customer/actor from that session. POST requires a UUID command ID and `confirmed: true`; `reconcile: true` performs reads only, while `retrySafe: true` can attempt only durably pending/unattempted steps. Responses contain safe local Participant IDs/names, state, time and Support correlation, never provider response bodies or opaque Environment IDs.

Admission persists the exact opaque v3 Environment identity and a terminal Session fence in the existing command table, discriminated by `operation`. Its existing unique constraints exclude extension and cancellation atomically; legacy rows default to extension. Cancellation requested time is committed in that same transaction, immediately closing local launch/invite/registration/extension access. All history remains.

The archive seam precedes the single v4 End/label PUT. Every attempted write is reserved before dispatch and is never replayed after ambiguity. Exact-ID GET readback must observe v3 status 4 (Archived, not status 5 Deleted). The v4 PUT preserves Start and unrelated fields/labels, merging `certalis:cancelled`; End uses the captured cancellation instant projected to the provider's minute-precision Session timezone. Scheduled End-before-Start is deliberately sent without moving Start and remains a live acceptance gate.

The complete current provider roster must match every retained local Participant via provider ID, both Certalis custom properties, Contact/email and Item Project. A never-launched Participant is marked `no_environment` only when both projections are pending with no first join, its provider Environment reference is absent, and v3 owner/Project resolution explicitly finds none. Missing, duplicate, external/unbound, incomplete or ambiguous bindings fail closed. GAP-33 means this is not a claim to reconstruct every historical environment for a multi-step Experience.

Additional RED/GREEN evidence: End/label handler expected 200 versus 202 before implementation; label adapter expected merged reserved label before implementation; cancellation access-window expected closed versus open; UI expected no retry button for attempted-only ambiguity before correction. Typed API regression coverage includes per-environment partial outcomes, no blind replay, safe retry of a separate unattempted peer, Customer/correlation/roster/Deleted rejection, and local access gates. SQLite additionally races extension and cancellation admission and verifies exactly one winner.

Full-suite repair loop 1: initial cancellation GET accepted an unrelated object returned by broad existing workspace test fixtures, causing a missing-targets render error. The UI now rejects malformed readback safely. Existing parent-workspace tests isolate the cancellation child, matching their established extension-child isolation, because their assertions concern workspace refresh/verification request counts. Dedicated cancellation tests click the real confirmation controls and check the resulting HTTP request and rendered result; browser QA still must exercise the integrated page.

Actual Next production build passed (58 static pages). Isolated `prisma/qa351-fixture.db` received all 62 migrations, including the cancellation migration; no shared database or live provider was mutated. Lint and typecheck passed during development; final exact-head full-suite/build evidence follows in the PR.

## Gates still open

This document records development checkpoints, not acceptance. Independent review, browser QA, disposable live cancellation including scheduled End-before-Start behavior, and human QA remain required. No provider or shared database mutation is authorized by these offline tests. GAP-19 archive and GAP-33 historical Environment inventory limitations remain open.


Review repair loop 1: concrete SQLite Add/Invite interleavings exposed cancellation admission while an Add could still publish (expected blocked, received new). A fully correlated needs_attention Session exposed the operational-status guard (expected 200, received 409). The focused persistence/API command then passed 14 tests after transactional admission/dispatch checks, publication quiescence, and a current local roster identity check. Existing Add/Invite/application coverage passed 112 tests. No schema change.

`npm test -- src/api/sales-participant-launch.test.ts`: cancellation during sponsored-link minting returned 302 in RED; after the authoritative Session/window reread it passes all 15 tests and returns no redirect or bearer URL. This is not atomic launch/cancellation: a cancellation after the final reread, a previously released link, or provider/browser work already in flight remains governed by provider End enforcement. Live QA must verify that enforcement and allocation timing; no durable launch framework was added.

`npm test -- src/integrations/cloudshare/sales-cancellation-fixture.test.ts`: after a typed empty implementation, both real assertions failed (undefined instead of 200/503); both pass with the exact synthetic transport scenarios. The initial missing-module failure was setup-only. Fixture-only IDs use `qa351-{fixture,active,ambiguous,retry}-sales-experience`, corresponding local Participant/Contact IDs and opaque v3 Environment IDs. The fixture scenario has never launched. Active archives successfully. Ambiguous archives but returns 503 and fails the first post-write read, requiring later read-only reconciliation. Retry fails the second owner-email list read after admission, before archive dispatch. State survives client creation and resets on server restart. This simulation is not live CloudShare evidence.

UI recovery RED/GREEN: after a rejected pre-admission POST and explicit saved-state-null GET, Cancel remained disabled (expected false, received true). The control now permits a manually confirmed resubmission with the same command ID; no automatic POST or new identity. All three real component interaction tests pass.

Review repair loop 1 final gates: lint and typecheck passed; full suite 284 files / 2360 tests passed; actual Next build passed with 58 static pages. Browser and live acceptance remain separate gates.

Review repair loop 2: cancellation-during-mint RED exposed a false opened/success diagnostic and audit claiming redirect. GREEN records provider success as participant_launch.minted with protected response and a pending-final-check message; the denied race records opened/failure. No evidence await was moved after the final access reread. All 15 launch tests, lint, typecheck and full 284 files / 2360 tests pass. Prior actual build remains unaffected by this audit/message-only change; no schema or provider behavior changed.

## Live active cancellation and bounded Support repair (2026-09-19)

The owned live Session `2cdb83d1-fc60-4202-bfcf-abf1edf908e9`, Experience `EX1gJO4tHEshMyVUT-IAe0sQ2`, and Environment `EN0YJ4FccxfRaT4KGQmnoUWw2` completed active cancellation under command/correlation `541646d1-aaf4-493c-bff1-823f56b122e3` at `2026-09-19T14:45:19.613Z`. Retained provider evidence records GET 200/status 2 (Ready), pre-dispatch recheck status 2, archive PUT 204, and exact-ID GET 200/status 4 (Archived). The v4 End/label PUT and confirming GET returned 200. This verifies Ready-to-Archived for this owned Environment only; it does not establish archive eligibility for Preparing or other states.

Earlier Preparing (status 8) preflight was rejected locally with zero cancellation commands and no archive or End/label dispatch. A later separately prepared direct-probe preflight observed status 2 and stopped at its status-8 guard without any direct archive dispatch. Preparing cancellation remains unresolved. Its diagnostic RED test expected 200 but received 502 twice; the success-mocked archive assumption proves the local gate, not provider support. The test fragment is retained as an ignored local evidence artifact instead of a supported regression in the passing suite.

The successful cancellation's protected diagnostic rows existed under the correct Customer, but Support omitted them because `sales-session-cancellation` was absent from the exact Sales source registry. The authorized third repair adds only that source. RED: `npx vitest run src/api/sales-diagnostics.test.ts src/api/sales-diagnostics-route.test.ts -t 'cancellation|exact .*source'` produced three assertion failures: correlation-link retrieval returned no rows; explicit-source handler and authenticated HTTP route returned 400 instead of 200. GREEN: the handler, HTTP isolation, diagnostics-page access and cancellation-link component suites passed 59 tests. The regression excludes another Customer sharing the correlation and an unrelated command, and confirms caller-supplied Customer scope cannot override the authenticated admin.

Scheduled cancellation QA, repaired Support browser verification, independent exact-head review and human acceptance remain pending. This repair changes no provider status gate, command lifecycle or diagnostics framework.
