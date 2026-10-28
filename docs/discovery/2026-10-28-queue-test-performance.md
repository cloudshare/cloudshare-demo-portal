# Queue test performance — issue #480

## Evidence and scope

- Accepted baseline: `ae1e1a704d38a342e61c0979359fd63e96cc65d0`.
- Wall-clock and queue behavior files are unchanged from the earlier `25e659e6` baseline.
- Earlier full-suite evidence timed out the queue test at 17.582 seconds against its 10-second verification budget.
- An isolated pre-repair Vitest 4 run took 5.76 seconds; synchronous phase measurement attributed 5,530ms (about 96%) to classification.
- Its scale classification consumed 5,183ms wall / 5,063ms process CPU; query await was 13ms, mapping 0.24ms, and 197-record insertion 28ms.
- These measurements identify classification as the bottleneck; source inspection identified repeated timezone resolution and formatter construction inside its scan.

## Change

- Resolve the timezone and construct the wall-clock formatter once per conversion, then reuse it locally.
- Preserve the complete 113-offset scan, ambiguity/skipped-time rejection, formatter options, and existing invalid-input behavior.
- No global cache, UTC shortcut, query, paging, existing queue fixture or assertion, schema, provider call, or public-interface changes.
- Add public semantic cases for UTC and fractional-offset Windows/IANA conversion, malformed input, and unknown timezone rejection.

## Verification

- Temporary verification runtime: Node 24.22.1, Vitest 4.1.12, Vite 6.4.4, Prisma client 6.19.3; Zod 4.6.6, Next 15.5.28, and Sharp 0.35.5 retained.
- Seven timezone tests passed. The existing real-SQLite queue test retained all 200 active records and passed in 327ms under the 10-second verification budget.
- Lint and typecheck passed. Serial full suite: 2,550 passed; exactly four pre-existing Candidate Home failures remained; 14 launcher tests passed.
- A temporary path-alias setup-resolution failure was isolated; using the same canonical physical worktree for cwd/config/database resolved it. The affected browser-interaction test then passed all 53 cases.
- Accepted-baseline runtime compatibility: Vitest 2.1.9 passed all eight targeted timezone/queue tests; the queue passed in 323ms with its original default timeout. Typecheck passed with original test annotations.
- Timings are individual observed runs, not a statistical performance guarantee. No second baseline full-suite run was needed; its accepted evidence already records the same four Candidate Home failures.

## Verification isolation

All temporary dependency, test-compatibility, timeout, and database/path configuration overlays were restored byte-for-byte before commit. They are not part of this change. Local evidence and restoration hashes are under `D:/wt/issue480-evidence/`. The implementation preserves behavior; automated semantic coverage and the real SQLite queue exercise the changed path without live CloudShare calls or UI changes.
