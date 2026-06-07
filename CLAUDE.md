# CloudShare Demo Portal — Claude Code Instructions

## Project purpose

Build a CloudShare demo portal that demonstrates practical integrations around CloudShare labs.

The first production-quality use case is a proctoring portal that integrates:

- CloudShare lab environments
- Genesys certification exam workflows
- Kryterion proctoring platform events or session state

The portal must be designed as a reusable demo/integration framework, not a one-off script.

## Working rules

1. Do not code before clarifying the requirement.
2. Before any meaningful implementation, run `/grill-me` (if there is no code base) or `/grill-me-with-docs` (or there is an existing codebase).
3. Convert agreed scope into a PRD using `/to-prd`.
4. Break the PRD into vertical implementation slices using `/to-issues`.
5. Use `/tdd` for every feature or behavioural change.
6. Use `/diagnose` for bugs, broken tests, unclear runtime behaviour, or integration failures.
7. Use `/zoom-out` before changing architecture or module boundaries.
8. Use `/improve-codebase-architecture` regularly, especially after several features have landed.

## Engineering discipline

- Work in small vertical slices.
- Prefer boring, explicit code over clever abstractions.
- Every integration boundary must be wrapped behind a typed service/module interface.
- Do not couple UI components directly to CloudShare, Genesys, or Kryterion APIs.
- Do not hard-code secrets, tenant IDs, API keys, exam IDs, blueprint IDs, policy IDs, or region IDs.
- All external calls must have typed request/response models, error handling, logging, and test coverage.
- Failed external API calls must produce actionable internal errors, not generic 500s.
- Mock external providers in tests.
- Keep demo data clearly separated from production configuration.

## Domain language

Use these terms consistently:

- `Portal` — the web application being built.
- `Lab` — a CloudShare environment or experience made available to a learner/candidate.
- `Candidate` — the person taking a certification exam.
- `ProctoringSession` — the Kryterion-supervised exam session.
- `ExamAttempt` — the candidate’s specific attempt at a Genesys certification exam.
- `LabLaunch` — the controlled creation, start, resume, or access flow for a CloudShare lab.
- `IntegrationEvent` — an inbound or outbound event exchanged with CloudShare, Genesys, or Kryterion.
- `Entitlement` — the decision that a candidate is allowed to access a specific lab for a specific exam attempt.

## Initial architecture expectation

Use a modular architecture with clear boundaries:

- `web` — UI routes, forms, candidate/proctor/admin screens
- `api` — HTTP/API route handlers
- `domain` — core business logic and state transitions
- `integrations/cloudshare`
- `integrations/genesys`
- `integrations/kryterion`
- `persistence` — database access
- `auth` — authentication and authorisation
- `observability` — logging, tracing, audit events
- `config` — typed runtime configuration

The domain layer must not depend on framework-specific request/response objects.

## Proctoring portal MVP

The first MVP must support:

1. Candidate identity lookup or registration.
2. Exam attempt creation or lookup.
3. Proctoring session creation or association.
4. Lab entitlement check.
5. Controlled CloudShare lab launch.
6. Audit trail for:
   - who requested access
   - what exam attempt it relates to
   - what lab was launched
   - when access was granted
   - any external API failures
7. Admin/debug view for support teams.

## Security and compliance

This project touches certification and proctoring flows. Treat it as high-integrity software.

- Never expose raw API keys or tokens in logs.
- Never trust client-side state for lab entitlement.
- Validate all inbound webhooks.
- Use signed webhook verification where possible.
- Store only the minimum candidate/session data required.
- Keep a clear audit log.
- Make replay, duplicate events, and out-of-order events safe.
- Assume integrations will fail, timeout, retry, or return partial state.

## Git workflow

Never commit directly to `main`.

For each slice:

```bash
git checkout main
git pull
git checkout -b feature/<short-description>
```

Before completion:

```bash
npm run lint
npm run typecheck
npm test
git status
```

Then prepare a PR summary including:

- What changed
- Why it changed
- Tests added/updated
- Risks or follow-up work

## Definition of done

A slice is not done unless:

- The requirement is documented.
- Tests exist and pass.
- Types pass.
- Linting passes.
- Errors are handled deliberately.
- External API behaviour is mocked or contract-tested.
- The README or relevant docs are updated.