# Environment v4 migration — #469

Implementation base: #468 merge `9d7f383ab42704f3becd59552846475c6c4ca359`.
Contract: preserved Infrastructure 4.0 export, `EnvironmentResponse`, Environment list/detail.

## Read inventory and accepted seams

| Consumer | Migrated implementation | Offline evidence |
| --- | --- | --- |
| Certification state and training-correlated opaque ID | `environment.ts` via `environments-v4.ts` | recording HTTP identity/status/404 tests; runtime handler tests |
| Independent external lease | `external-lease.ts` | lease errors, rate-limit history, unknown nonauthorization |
| Admin diagnostics | `admin-exam-attempt-diagnostics.ts` | refresh/persistence/Support tests |
| Suspend/resume, heartbeat, completion, early completion, webhook reconciliation | shared Certification state source | existing runtime, completion, webhook and reconciliation suites |
| Sales participant observation | `environment-observation.ts`, participant application | exact owner/Project pagination, protected exchanges, ordinary source/ID safety |
| Sales cancellation | semantic Sales reading over retained facade | 25 admission/second-fence/archive/readback/no-replay handler tests |
| Sales extension | shared semantic observation | existing selection/preflight/readback/fence tests |
| Trial enrollment observation, reopen and extension readback | shared semantic observation + retained roster evidence | existing enrollment handler suite |
| Trial Offering ending | owner + Offering Item Project resolution, never numeric roster ID | latest-expiry/buffer/rounding/fixed-target/fence tests; numeric-ID and unknown-state regressions |
| Persistence/workspace/search/queue | additive v4 status/time fields | SQLite public repository + workspace-reader history/isolation tests |

All actual v3 Environment read implementations were inventoried before coding: Sales list/getextended,
Certification detail, and independent external-lease detail. All now use v4. Numeric compatibility
is derived only for retained fixtures/facade; production persistence uses explicit v4 status/time.
Cancellation consumes semantic states. Old numeric evidence and source labels remain readable.

Owner filtering is substring matching; all pages must complete before exact normalized owner and
Project selection. Detail revalidates ID, owner and Project. Counts changing, duplicates, missing
pages, malformed responses and zero/multiple matches fail closed. Completed pages survive failures
on the original typed error; Customer-scoped request observers retain every physical exchange.

New v4 states remain distinct. Unknown/transitional states do not grant Ready, an active lease,
cancellation, extension or Trial Ending writes. Existing Preparing admission and Trial timing rules
remain. RFC1123 UTC expiration is storage deletion, not runtime remaining or Experience End.

## Remaining v3 register

| Capability | Reason retained |
| --- | --- |
| Environment suspend/resume/archive/extend | Commands explicitly excluded from #469; no transport change or DELETE substitution |
| Blueprint/default Snapshot | Accepted exception; no supported replacement in this slice |
| VMware Regions | Accepted exception |
| Teams and active Project-member/Sales Pro eligibility | Accepted exception |
| Timezones and ping | Accepted exception |
| Webhook ingestion | Existing v3 event semantics unchanged; polling remains truth |

No undocumented GUI history endpoint is used. Live lists omit storage-expired Environments and
expired Projects, so an empty list is not complete participant history or proof of never launching.

## Verification status

RED/GREEN cycles covered all-page exact identity, strict v4 status/date/lease behavior, provenance,
source freshness, and Trial Ending numeric-reference/unknown-state safeguards. Existing handler
fixtures were updated for v4 state reads while preserving lifecycle assertions and unchanged v3
commands. Legacy numeric/parser behavior remains tested through the explicit compatibility adapter;
new wire behavior is tested through the real client with recording HTTP.

Full offline run before the final label correction: 2488 tests, 2483 passed, five failed. One stale
completion-diagnostic v3 expectation was corrected and its test now passes. The other four are the
inherited `candidate-home-route-focus.test.tsx` failures. The test and its CandidateHome/state modules
are byte-identical (normalized line endings) to baseline `1f615591`; isolated reproduction and final
exact-head checks are recorded on the PR. Lint and typecheck passed.

Live browser/Support, live identity compatibility and per-consumer proof are separate pending gates,
owned by the lifecycle orchestrator/QA role. This document does not claim live parity or close
GAP-28/32/33 before that evidence. Human QA is explicitly waived for this ticket; other gates remain.
