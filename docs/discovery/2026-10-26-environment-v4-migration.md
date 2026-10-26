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

## Verification — 2026-10-26

Implementation and live QA head: `80d88a8e54ff83fb2556a87065be78286a0c8261`.
Independent Standards and Spec/security reviews were clean after two bounded repair loops.
The final offline suite had 2,513 tests: 2,509 passed and four inherited
`candidate-home-route-focus.test.tsx` failures, independently reproduced on the baseline.
Lint and typecheck passed; targeted repair/adjacent checks passed 267 tests.

RED/GREEN coverage includes all-page exact identity, status/date/lease behavior, separate
v4 provenance and absence, preserved roster timestamps, fail-closed eligibility, truthful
failure-phase diagnostics, and Trial Ending numeric-reference/fixed-target safeguards.
Recording HTTP proves the v4 wire contract; retained legacy fixtures still test historical
numeric/parser behavior. Customer-scoped persistence tests cover history and isolation.

### Real UI and live provider evidence

| Consumer | Observed evidence at the implementation head |
| --- | --- |
| Certification state and opaque training correlation | Real Candidate Schedule/Enter/Suspend/Resume/End and Admin monitoring. One v3 Suspend 204, one Resume 204, one Archive 204, each followed by v4 Environment detail 200; Candidate Completed with paused portal clock. |
| Independent external lease | A disposable local suspended Attempt with a closed authored window referenced the same owned archived Environment. Reloading the real Candidate dashboard invoked `external-lease-inspection` / `candidate-portal`: v4 detail 200 at `2026-10-26T20:12:10.644Z`, then local Expired at `20:12:10.853Z`. Candidate and Support UI confirmed it; no provider writes. Correlation `e2943a9a-53e8-4769-a0fc-77520ce84aab`. |
| Sales observation and cancellation | Real Session/participant/launch UI proved opaque Environment resolution independently of the numeric roster reference. Exact owner/Item Project observations preceded one cancellation: v3 Archive 204, v4 post-read 200, Sales End/cancelled-label update 200 and final confirmation 200. UI showed Cancelled, archived Environment and Access blocked. The pre-cancellation state was Ready; Preparing was observed earlier, not archived in this proof. |
| Trial observation, extension and ending | Real Trial launch/reopen and Admin controls. One v3 Extend 200 between v4 pre/post reads 200; persisted authoritative v4 Ready. One existing Sales End update 200 produced fixed-target Ending through `2026-10-28T19:49Z`. Storage expiry was `2026-10-28T19:43:57Z`, distinct from portal access End and runtime. Environment/history retained; no archive, delete or Start rewrite. |
| Support and Customer isolation | Owning Customer Support displayed lifecycle success, safe Trial launch-unavailable failure, and v4 input-rejection diagnostics. Foreign-Customer search for the failure correlation returned zero entries. Protected evidence checks confirmed method/path, status, body and response-header retention; Authorization/non-allowlisted request headers were masked. No protected bodies were expanded in browser evidence. |

The external-lease fixture changed only isolated local records; its provider read used the
already-owned archived Environment. The ordinary Certification Resume is not substituted for
this separate consumer proof. Trial's first Open failed before enrollment/provider writes while
the Experience was notStarted; one bounded retry followed a confirmed state transition. No
ambiguous lifecycle command was replayed.

Targeted live ping and Sales preflight verification passed **3/3 tests in two files**:
`vitest run --config vitest.e2e.config.ts tests/live-cloudshare-ping.e2e.test.ts tests/live-certalis-sales-preflight.e2e.test.ts`.
The broad live suite was excluded because its unrelated six-cycle suspend/resume stress mutation
was unnecessary for this slice. These checks complement, rather than replace, the real UI flows.

### Evidence limits and cleanup

Two synthetic opaque-shaped IDs returned HTTP 400 through the real Admin diagnostics route.
This proves live input-rejection diagnostics only: it neither proves valid-missing-ID behavior
nor contradicts the documented 404 contract. Valid-missing 404, malformed calendar/weekday,
pagination failures and changed identity remain offline contract coverage.

Captured lifecycle, completion, Admin, Support and external-lease browser paths had zero console
warnings/errors. Early Certification authoring/scheduling console capture was not armed; its
external CloudShare child was not visually observed. Sales and Trial child windows were observed.
These limits are retained explicitly. Human QA was waived; automated browser/live QA was completed.

The QA-owned 3025 server was stopped, five QA tabs closed, and isolated DB/key files removed;
`.env.e2e.local` was absent. Primary checkout/database/port 3000 and retained #350/#351 assets
were untouched. Provider Experiences, participants, Environments and history remain retained.

Sanitized evidence: `sanitized-live-qa-report-80d88a8e.md` in the lifecycle task's local QA evidence
folder, SHA-256 `F4A27D427349AC6F9D72C1F9FFB38E3981B42BDD37B22256FE57B63121233643`.
No credentials, launch capabilities or protected provider bodies are copied here. GAP-28 remains
unchanged; GAP-32 has current v4 mitigation evidence, while GAP-33's complete-history contract gap
remains open.
