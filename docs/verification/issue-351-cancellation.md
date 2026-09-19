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
