# CloudShare Demo Portal — Codex Instructions

> **Source of truth for scope, domain & decisions:** `CONTEXT.md` (glossary),
> `docs/decisions/ADR-001..ADR-005`, and `docs/requirements/prd-cloudshare-demo-portal-v2.md`.
> This file is a quick orientation; where it differs from those documents, **they win.**
> The earlier Genesys/Kryterion "proctoring" framing is **retired** (see the 2026-06-13
> `grill-with-docs` re-scope, `docs/discovery/2026-06-13-grill-with-docs-synthesis.md`).
> The Matt Pocock skills v1.1 are available here too — use the current flow:
> Grilling/Wayfinder -> `/to-spec` -> `/to-tickets` -> `/implement` -> `/code-review`.

## Project purpose

Build a CloudShare demo portal that **demonstrates CloudShare's capabilities** — real experience
provisioning, sponsored-link login, suspend/resume, and scoring — through a believable, interactive
certification-provider portal. Build it as a reusable framework, not a one-off script.

Actor model (cosmetic names; see `CONTEXT.md`):

- The portal **is** the certification **Provider** (brand: **Certalis**) — not an external system.
- The **Customer** (brand: **Helios CX**) owns its CloudShare subscription and supplies its own
  CloudShare API credentials into the portal. Its admin curates the exam catalog and monitors sessions.
- A **Candidate** is a Customer end-user who logs in, schedules, and sits an exam delivered on a real
  CloudShare environment.

**North star:** CloudShare is the only live integration. When a choice trades portal richness against
showing real CloudShare behaviour, CloudShare wins.

## Working rules

1. Do not code before clarifying the requirement.
2. For unclear or meaningful new scope, start with `/grilling`; use `/wayfinder` instead when the
   work is too large for one agent session, has substantial unknowns, or needs front-end/prototype
   exploration before a spec. Do not enact the plan until the user confirms shared understanding.
   **Done** for the current MVP scope — captured in `CONTEXT.md` + ADRs + PRD v2.
3. Convert agreed scope into a spec using `/to-spec` (replaces `/to-prd`). The existing canonical
   v2 spec is still stored as `docs/requirements/prd-cloudshare-demo-portal-v2.md` for continuity.
4. Break the spec into vertical tracer-bullet tickets using `/to-tickets` (replaces `/to-plan` and
   `/to-issues`). **Done** for the current MVP scope — GitHub issues #39–#47.
5. Use `/implement` for each ticket; inside implementation use `/tdd` for every feature or
   behavioural change, at pre-agreed seams.
6. Use `/diagnosing-bugs` for bugs, broken tests, unclear runtime behaviour, or integration failures.
7. Use `/code-review` before completing implementation work.
8. Use `/codebase-design` before changing architecture or module boundaries, and
   `/improve-codebase-architecture` regularly, especially after several features have landed.

### Autonomous continuation

When the user explicitly authorizes autonomous work (for example, asks the agent to continue
without further check-ins), treat that authorization as binding until the requested work is
genuinely complete or a real blocker requires the user's authority, credentials, or QA action.
Keep progress updates in commentary; do **not** end the active turn with a status-only final
response while implementation, review, verification, or merge work remains. A final response is
reserved for completion, an explicit user-requested pause, or a genuine blocker.

## Local server convention

- Keep port `3000` available for the user-owned tunnel-facing server. The user may stop/restart that
  tunnel independently, and it should continue to point at their service on `localhost:3000`.
- When Codex needs its own local Next.js dev server for checks or QA, prefer `localhost:3025`
  (`npm run dev -- -p 3025`) unless the user asks for a different port.
- The `3000` and `3025` servers are expected to use the same repo `.env` and therefore the same local
  database. Actions performed through `3025` should be visible to the tunnel-facing `3000` server as
  long as both servers are running against the same environment.
- Before requesting human QA, make the user's main project folder
  (`D:\Code_projects\cloudshare-demo-portal`) ready by default: fast-forward or check out the PR QA
  branch to the reviewed head commit, regenerate/migrate if required, restart or positively confirm
  the port `3000` server is serving from that checkout, smoke-test the changed path on
  `http://localhost:3000`, and report the exact branch and commit. Do not ask the user to update the
  checkout manually unless the main project folder has uncommitted user work or another explicit
  blocker.
- When a branch adds or changes Prisma schema/migrations, do not hand the port `3000` checkout to
  human QA until that checkout has had its Prisma client regenerated and its local database migrated
  or deliberately reset from a backup. A clean git checkout alone is not enough for schema-changing
  slices.
- Before human QA on port `3000`, smoke-test the changed path against the same `D:\Code_projects`
  checkout and port the user will use after the checkout has been updated. Codex-owned `3025` smoke
  is useful but does not prove the tunnel-facing server is ready.

## QA operating notes

- Do not hand vague failure-path QA back to the user. If QA requires triggering errors such as
  suspend/resume integration failures, first look for a safe simulated path the agent can run.
- Prefer delegating simulated failure-path QA to a focused sub-agent when available. The sub-agent
  should create disposable local data, call the real HTTP/API route on the Codex-owned server
  (`localhost:3025` by convention), capture the observable evidence, and clean up its test data.
- The ticket task still owns the QA result: review the sub-agent's evidence, verify cleanup,
  update the PR notes, and clearly separate simulated QA from live CloudShare E2E verification.
- Do not pause for a human check after every refactor slice by default. If the slice is
  behavior-preserving, does not change active CloudShare runtime behaviour, and does not change
  user-facing UI, the ticket task may treat targeted automated checks plus a concrete smoke test as
  sufficient QA. In that case, record why human QA is not required in the PR, merge after a clean
  implementation review, and include the decision in the final report.
- Human QA is still required for user-visible behaviour, UI changes, active CloudShare runtime
  behaviour, live integration changes, or any slice where smoke evidence does not prove the changed
  path.
- For any UI path change, automated smoke must exercise the changed browser path, not only render it:
  click or submit the changed controls, capture browser console errors/warnings, and record both the
  interaction evidence and console result in the PR. Layout-only checks such as screenshots,
  DOM presence, or overflow measurements are not enough by themselves.

## Engineering discipline

- Work in small vertical slices (one GitHub issue at a time, in dependency order).
- For any slice touching CloudShare or another live integration, follow
  `docs/architecture/integration-slice-protocol.md` before coding, during implementation, and before review.
- Before adding or changing CloudShare v4 endpoint paths, consult
  `docs/api/cloudshare-api-reference.md` and the exported OpenAPI bundles in `docs/api/assets/`.
  Do not infer paths from naming patterns.
- Prefer boring, explicit code over clever abstractions.
- Displayed portal dates/times must use deterministic ISO 8601-style formats rather than locale-dependent rendering. Use a `YYYY-MM-DD...` shape, and make the timezone explicit whenever the view is showing UTC or another non-local reference time.
- Build API-first. Any capability that changes or exposes portal state needs a typed HTTP API route
  and framework-agnostic `src/api/*` handler before or alongside the UI. React screens call those
  APIs; they do not bypass them.
- Every integration boundary must be wrapped behind a typed service/module interface.
- Do not couple UI components directly to **CloudShare** APIs — go through the integration adapter.
- The CloudShare client is instantiated **per-Customer** from a stored, encrypted `CloudShareConnection`
  (ADR-001) — never from global env vars.
- Keep CloudShare-backed Exam timing explicit (ADR-005): Policy `runtimeLeaseMinutes` feeds the
  Candidate's `Exam.timeLimitMinutes`; manually authored `Exam.openPeriodMinutes` defines the v4
  training/Experience `End`; Policy `storageLeaseMinutes` is retention/validation evidence, not the
  direct Experience duration.
- CloudShare v3 `cs_sha1` signing must follow CloudShare's documented wire format exactly:
  `Authorization: cs_sha1 userapiid:<id>;timestamp:<epoch-seconds>;token:<nonce>;hmac:<sha1>`.
  The `token` nonce is exactly **10 alphanumeric characters**. Do not use UUIDs.
- Do not hard-code secrets, API keys, blueprint/snapshot/policy/region/project IDs, or exam IDs; these
  are per-Customer data or per-Exam config, not constants.
- All external calls must have typed request/response models, error handling, logging, and test coverage.
- Failed external API calls must produce actionable internal errors, not generic 500s.
- Mock the external provider only at the `integrations/cloudshare` boundary; never inside `domain`.
- Keep demo/seed data clearly separated from runtime configuration.
- **Supportability is a requirement, not optional:** every slice must be operable by an admin — real
  authentication where the slice needs it, and admin-visible, redacted diagnostics on any integration
  failure (attempted operation, integration surface, returned status / transport failure mode).
- **Tests are written as part of the slice (`/tdd`), not bolted on afterwards.** A slice that lands
  without tests written for it is not done.
- Local live credentials in `.env.e2e.local` are the evidence path for safe CloudShare E2E checks.
  Do not commit them; do use `npm run test:e2e:live` whenever the slice can be verified cheaply.
  If `.env.e2e.local` is missing in a Codex worktree, the user's local seed credentials live at
  `D:\Code_projects\cloudshare-demo-portal\config\portal-seed.local.json`; generate a temporary,
  ignored `.env.e2e.local` from that file without printing secret values, run the live check, and
  remove the generated env file afterward.

## Domain language

The canonical glossary is **`CONTEXT.md`** — use its vocabulary exactly. Key terms: `Certalis`
(Provider / the portal), `Helios CX` (Customer), `Candidate`, `CloudShare Connection`, `Exam`
(catalog item) vs `Certification` (the un-built journey), `ExamAttempt`, `LabLaunch`, `Entitlement`,
`Experience`/training, `Project`, `Blueprint`, `Snapshot`, `Region`, `Policy`, `Instructor`,
`Participant`, `Standby`, `Guided Journey`, `IntegrationEvent`.

**Do not use** `Genesys`, `Kryterion`, or `ProctoringSession` — they are retired.

## Architecture

Modular boundaries, domain free of framework imports:

- `web` — UI routes/forms: admin (connect, catalog, monitoring) and candidate (register, schedule, lab) screens
- `api` — HTTP route handlers (REST, the time-gated `/enter` redirect, the webhook receiver)
- `domain` — business logic & state transitions (entitlement, scheduling lifecycle, clock, reconcile)
- `integrations/cloudshare` — the only external integration; per-Customer client (v3 `cs_sha1`, v4 Bearer)
- `persistence` — repositories (incl. the encrypted `CloudShareConnection` and correlation mapping)
- `auth` — email/password sessions; server-side entitlement
- `observability` — logging with secret redaction, audit events
- `config` — typed runtime config (incl. the portal master encryption key)

The `integrations/genesys` and `integrations/kryterion` modules are **removed** as slices supersede them.

## MVP scope

Defined by **PRD v2** and the slice issues #39–#47 (dependency order #39 → #40 → #41 → #42 → #43 →
{#44, #45, #46} → #47). In summary: admin connects CloudShare → builds/publishes Exams from live
resources → candidate registers/logs in, browses, and schedules → time-gated launch into a real
environment via a hidden sponsored-link redirect → suspend/resume with a portal-owned persisted clock
and heartbeat auto-suspend → optional Guided Journey scoring → admin session monitoring. Webhooks are
an optional, polling-backed enhancement (ADR-003).

## Security and compliance

High-integrity software.

- Never expose raw API keys, bearer auth headers, webhook secrets, or similar credentials in generic logs or client responses. Protected Customer-scoped admin diagnostics are the explicit direction-aware exception: retain all request/query and provider-response body data verbatim, including API keys, tokens, webhook secrets, passphrases, access links, and sponsored-link `loginUrl` values. For request headers, preserve only the explicit operational allowlist (Content-Type, Accept, Accept-Encoding, Content-Length, User-Agent, correlation/request IDs, and W3C trace headers); mask every other named or unparseable header. This evidence must never appear in candidate/client-facing responses, ordinary APIs, browser state/console, non-admin surfaces, or another Customer's diagnostics.
- Store CloudShare credentials per-Customer, **encrypted at rest**; decrypt only at call time.
- Treat the sponsored-link `loginUrl` as a bearer credential — server-only; reach it via a 302 (ADR-002).
- Never trust client-side state for entitlement; recompute it server-side.
- Validate all inbound webhooks; verify the HMAC signature using the per-Customer secret (ADR-003).
- Polling `GET environment` / list-students is the source of truth; make replay, duplicate, and
  out-of-order events safe.
- Store only the minimum candidate/session data required; keep a clear audit log.
- Assume integrations will fail, timeout, retry, or return partial state.

## Git workflow

Never commit directly to `main`.

### Slice orchestration

#### Self-contained ticket lifecycle

The parent orchestration task selects and claims tickets, creates exactly one visible lifecycle-
orchestrator ticket task per issue, monitors that task and its GitHub PR, coordinates dependency,
live-asset, and checkout gates, and receives its final report. The parent does not implement, review,
QA, or merge ticket changes. It never creates a second task or PR for the same issue unless the first
is explicitly retired with its work and evidence preserved.

The visible ticket task is itself the lifecycle orchestrator. It owns the issue end to end in its
isolated worktree, branch, and draft PR, including internal implementation, independent review, QA,
repair loops, human-QA preparation, merge, issue closure, and cleanup. Internal agents are private
sub-agents within this task, not user-visible issue tasks, and therefore do not violate the one-visible-
task rule.

The ticket task's first checkpoint, immediately after opening the draft PR and before substantive
changes, reports the issue, worktree, baseline commit, branch, PR URL, and planned internal roles. It
keeps review and QA findings inside the ticket: findings return to implementation, then the affected
checks repeat until clean or a genuine blocker requires parent, user, credential, or QA authority.

While a ticket task is active, the parent monitors its updates and the current GitHub PR head and
comments at least every two minutes. Parallel ticket tasks are allowed only for unblocked, independent
tickets with no shared-code or mutable CloudShare/test-asset conflict. If overlap becomes possible,
the parent records the dependency and coordinates ordering or an explicit rebase before either ticket
continues through review or merge.

The ticket task's compact final report includes the PR URL; exact reviewed head and merge SHA;
validation plus browser, live, and human-QA evidence as applicable; unresolved non-outdated review-
thread count; ticket-worktree and primary-checkout branch/status; cleanup; blockers; and follow-on
dependency edges. Missing required evidence means the ticket remains active.

Each implementation slice must run through an explicit branch-and-PR workflow. Do not let slice work
accumulate as local-only commits.

- The ticket task must explicitly spawn and coordinate all three mandatory internal roles before
  completion: implementation/TDD with `gpt-5.6-luna` at low reasoning; independent Standards plus
  Spec/security review with `gpt-5.6-sol` at high reasoning (especially for integration or security
  work); and browser/live QA with `gpt-5.6-terra` at medium reasoning. Model and effort must be set at
  spawn time, using the closest available explicit equivalent only when a requested model is unavailable
  and recording that limitation on the PR. The implementation role follows the issue and project docs
  and does not redesign scope unless genuinely blocked.
- While any internal implementation or review agent is active, the ticket task must monitor it and the
  current PR head/comments. It must not merge or report completion while an expected result is pending.
  If a reviewer exits before implementation is pushed, spawn a fresh reviewer after the PR head changes.
- The implementation agent fixes review findings on the same PR branch. Re-review until the review
  agent reports no blocking findings; QA findings return to implementation and the affected review or
  QA reruns on the new exact PR head. A collaboration-tool failure is retried or replaced with an
  explicitly independent equivalent mechanism; independent review is never silently collapsed into
  self-review.
- A checkpoint, temporary tool failure, long-running test, or remaining safe in-scope work is not a
  final handoff. Report only when all gates are clean or a genuine blocker requires parent, user,
  credential, or QA authority.
- Human QA is required before merge for user-visible or integration behaviour, especially CloudShare
  flows. For behavior-preserving refactor slices with no UI change and no active CloudShare runtime
  behaviour change, human QA is not required when targeted tests and smoke evidence prove the changed
  path; the ticket task may merge after recording the evidence and human-QA decision.

For each slice, before implementation starts:

```bash
git fetch origin main
git switch -c feature/issue-<number>-<short-description> origin/main
```

Then immediately open a draft PR linked to the issue with a closing keyword:

```bash
git push -u origin feature/issue-<number>-<short-description>
gh pr create --draft --base main --head feature/issue-<number>-<short-description>
```

The PR body must include:

```text
Closes #<issue-number>
```

The ticket task must complete the initial checkpoint above before continuing with substantial changes.
All commits for the slice go to that PR branch, not to `main` and not to an unreviewed local-only branch.

Before requesting review:

```bash
npm run lint
npm run typecheck
npm test
git status
```

For integration slices, also run the relevant live E2E checks where safe, such as
`npm run test:e2e:live`, and follow `docs/architecture/integration-slice-protocol.md`.

Then update the PR summary including:

- What changed
- Why it changed
- Tests added/updated
- Risks or follow-up work
- Human QA server availability: whether the change is present in `D:\Code_projects\cloudshare-demo-portal`
  on port `3000`, or the exact branch/commit/server URL QA should use instead

After review and QA:

- Address all blocking review findings on the same PR branch.
- Re-run the relevant checks after fixes.
- Record human QA/live verification in the PR or issue when required. For refactor-only slices that
  do not require human QA, record the smoke evidence and the reason human QA is not needed.
- Merge only after review is clean and required QA is accepted or explicitly not required by the
  refactor-only rule above.
- Confirm the linked issue closed automatically; if it did not, add a closing comment and close it
  manually.

## Definition of done

A slice is not done unless:

- The requirement is documented.
- Tests exist and pass.
- Types pass.
- Linting passes.
- Errors are handled deliberately.
- External API behaviour is mocked or contract-tested.
- The README or relevant docs are updated (incl. the gap report if a live-tenant assumption is confirmed/contradicted).

### Integration slices (anything touching a live external integration) — additional bar

Automated tests are **necessary but not sufficient**. Such a slice is not done until:

- It is **verified in a real end-to-end flow against the live tenant**, with real credentials and real
  runtime behaviour, **through the real UI** — not only isolated handlers, mocked tests, fixture
  replay, or direct API calls.
- Acceptance criteria **distinguish automated verification from live verification**.
- Any integration failure in the live flow produces **supportable, admin-visible diagnostics**: the
  attempted operation, the integration surface used, the returned status or transport failure mode,
  and structured, redacted server logs.

DoD for integration slices = lint + typecheck + automated tests + **live end-to-end verification** +
**support diagnostics confirmed in the real flow**.
