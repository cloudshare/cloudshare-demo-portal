# CloudShare Demo Portal — Claude Code Instructions

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

## Lifecycle authority

`AGENTS.md` is the authoritative source for the complete portal ticket lifecycle, including the
parent/ticket-task boundary, mandatory internal implementation/review/QA roles and model settings,
repair loops, exact-head review, duplicate-task prevention, branch/PR checkpoints, QA gates, and
completion reporting. Read and follow it for every ticket. This file contains only Claude-specific
tooling or invocation deltas; it must not restate or override those shared rules.

## Engineering discipline

- Work in small vertical slices (one GitHub issue at a time, in dependency order).
- For any slice touching CloudShare or another live integration, follow
  `docs/architecture/integration-slice-protocol.md` before coding, during implementation, and before review.
- Prefer boring, explicit code over clever abstractions.
- Build API-first. Any capability that changes or exposes portal state needs a typed HTTP API route
  and framework-agnostic `src/api/*` handler before or alongside the UI. React screens call those
  APIs; they do not bypass them.
- Every integration boundary must be wrapped behind a typed service/module interface.
- Do not couple UI components directly to **CloudShare** APIs — go through the integration adapter.
- The CloudShare client is instantiated **per-Customer** from a stored, encrypted `CloudShareConnection`
  (ADR-001) — never from global env vars.
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

- Never expose raw API keys, bearer auth headers, webhook secrets, or similar credentials in logs or client responses. The CloudShare sponsored-link `loginUrl` remains server-only and must never appear in candidate/client-facing responses, but admin-only diagnostic logs may retain it as support evidence.
- Store CloudShare credentials per-Customer, **encrypted at rest**; decrypt only at call time.
- Treat the sponsored-link `loginUrl` as a bearer credential — server-only; reach it via a 302 (ADR-002).
- Never trust client-side state for entitlement; recompute it server-side.
- Validate all inbound webhooks; verify the HMAC signature using the per-Customer secret (ADR-003).
- Polling `GET environment` / list-students is the source of truth; make replay, duplicate, and
  out-of-order events safe.
- Store only the minimum candidate/session data required; keep a clear audit log.
- Assume integrations will fail, timeout, retry, or return partial state.

## Git workflow

Never commit directly to `main`. Follow the branch, draft-PR, checkpoint, validation, review, QA,
merge, and cleanup lifecycle in `AGENTS.md`; no Claude-specific Git workflow overrides it.

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
