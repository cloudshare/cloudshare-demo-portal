# Issue #416 certification observability parity audit

Date: 2026-09-03

## Status

Issue [#418](https://github.com/swinster/cloudshare-demo-portal/issues/418) is merged and its retained-enrollment seams are now the baseline for #416. The implementation in PR [#423](https://github.com/swinster/cloudshare-demo-portal/pull/423) is on the pushed feature head; remaining gates are exact-head review and required live/browser/human QA, not an open implementation dependency.

Current checkout state at audit time:

- The audit was refreshed against the current `feature/issue-416-trial-workflow-observability` head; the working branch is pushed and is not detached.
- Review target: the pushed PR #423 feature head; verify its exact commit at review time rather than relying on a stale audit snapshot.

## Scope

This note records the pre-implementation certification-side baseline for:

- protected diagnostic persistence;
- authenticated Customer-scoped support access and filtering;
- CloudShare request recording coverage across certification workflows;
- successful-read, failure, mutation, webhook, and ordered multi-request representation;
- the highest shared seam that could guarantee capture of every CloudShare request;
- the Sales Trial gaps that #416 had to close without weakening the existing security contract.

## Canonical rules confirmed before code inspection

- `AGENTS.md` requires API-first integration slices, Customer-scoped protected diagnostics, and ordinary-surface confinement.
- `docs/architecture/integration-slice-protocol.md` requires provider-facing behavior to be observable, supportable, and safe to inspect after failure.
- `docs/decisions/ADR-004-typed-diagnostic-log-entry.md` defines the typed protected evidence model and its relationship to metadata-only ordinary logs.
- Issue #416 requires successful-read visibility, ordered child exchanges, metadata-only authentication steps, and exact subject-scoped workflow-log navigation for Trial Offerings and retained enrollments.

## Certification baseline

### Shared protected persistence and access model

The certification side already has the right protected evidence architecture.

- `src/domain/diagnostic-log.ts` exposes the shared recorder seam via `createDiagnosticRecorder()` and `DiagnosticRecorder.record()`.
- The recorder writes durable `DiagnosticLogEntry` records and applies `redactDiagnosticInput()` before persistence.
- `src/persistence/diagnostic-log-repository.ts` stores first-class filter columns for `customerId`, `examId`, `examAttemptId`, `candidateEmail`, `correlationId`, `subjectId`, `operation`, `integrationSurface`, and `externalId`, then enforces exact `customerId` scoping on reads.
- `src/api/admin.ts` derives the Customer scope from authenticated admin state and exposes exact filter inputs without trusting caller-supplied Customer identifiers.
- `src/web/admin-support.tsx` and `src/web/admin-shell-route.ts` provide the protected workflow-log UI and stable navigation intents for support, exam attempt, and correlation drill-down.

### Redaction and confinement contract

At the audit baseline, the certification contract matched the required protected-diagnostics model.

- Request headers are projected through the centralized allowlist and auth-bearing request headers are masked at the protected recorder seam.
- Protected request/query evidence and provider response bodies are retained for authorized Customer support users.
- Ordinary UI, browser state, generic logs, event logs, and candidate surfaces remain metadata-only and correlation-driven.

This contract must remain unchanged for #416. Sales parity cannot be implemented by weakening confinement or by introducing a second redaction scheme.

## Certification CloudShare call-path inventory

At the audit baseline, the certification side did not yet have a universal automatic transport recorder, but it already demonstrated broad explicit capture across live workflows.

### Connection and authoring

- `src/api/admin-cloudshare.ts`
  - CloudShare connection test success is logged as `cloudshare_connection.tested` with correlation metadata.
  - Connection test failures record protected request/response evidence through the diagnostic recorder.
- `src/api/admin-exam-authoring-runtime.ts`
  - Successful CloudShare reads for projects, regions, blueprints, policies, policy detail, and blueprint detail are explicitly recorded through `onReadSuccess`.
  - Failures record request/response evidence and return correlation IDs for support.
- `src/api/admin.ts`
  - Legacy resource sync also records successful and failed resource reads.

### Candidate scheduling and provisioning

- `src/domain/scheduling.ts`
  - Explicitly records provisioning workflow steps including create training, ensure user properties, add participant, create sponsored link, and final attempt state transitions.
  - Multi-request steps can preserve ordered child exchanges in `details.httpExchanges`.
- `src/api/exam-attempt-scheduling-runtime.ts`
  - Adds successful and failed CloudShare team-read diagnostics around scheduling.
  - Guards runtime blueprint/snapshot correctness before provisioning.

### Candidate runtime, suspend/resume, and score retrieval

- `src/api/exam-attempt-runtime.ts`
  - Records enter-path failures and successful `exam_attempt.enter` transitions.
- `src/api/exam-attempt-suspend-resume-runtime.ts`
  - Records successful suspend and resume transitions.
  - Records failure classifications for invalid state, lease issues, and provider/runtime failures.
- `src/api/exam-attempt-score-runtime.ts`
  - Records successful score correlation and score retrieval outcomes, including "no score yet" responses when CloudShare reads succeed.

### Monitoring and lease inspection

- `src/api/admin-cohort-exam-session-detail.ts`
  - Records successful and failed participant monitoring reads.
  - Records successful and failed Guided Journey aggregate reads.
  - Returns support-navigation seeds that already align monitoring views with exact diagnostics filters.
- `src/api/exam-attempt-external-lease.ts`
  - Records failed lease inspections and expiry reconciliation evidence.

### Webhooks

- `src/api/cloudshare-webhook.ts`
  - Records unknown target, missing signature, invalid signature, invalid payload, accepted webhook, signature verification, and reconcile outcomes.
  - Keeps invalid or unresolvable traffic metadata-only until Customer ownership is established.

## Pre-implementation baseline (before PR #423)

The certification side is the parity baseline, not the finished shared solution.

- `src/integrations/cloudshare/client.ts` can return detailed request/response evidence for v3 and v4 calls through `requestV3Detailed()`, `requestV3TextDetailed()`, and `requestV4Detailed()`, but it does not persist diagnostics on its own.
- `src/integrations/cloudshare/v4-auth.ts` performs OAuth token acquisition directly and throws typed errors with request/response context, but it does not emit a standalone metadata-only authentication step on success or failure.
- Current coverage therefore depends on higher-level runtime code remembering to call `diagnostics.record()` or to use callback-based explicit instrumentation.

Conclusion at baseline: certification proved the required evidence shape, filtering, support UI, and security model, but not yet a single shared capture seam that could guarantee universal coverage.

## Implemented result at the exact PR #423 head

PR #423 adds the shared observation seam, fail-closed ordinary trace paths, mandatory OAuth acquisition observation, and duplicate-safe retained-enrollment exchange recording. The statements above are historical baseline findings, not claims about the implemented head. Review and QA must verify the exact PR commit SHA and rerun the documented gates.

## Highest shared seam that can guarantee universal CloudShare capture

The narrowest shared seam that can guarantee recording for every CloudShare request is:

1. `src/integrations/cloudshare/client.ts`
   - instrument the detailed request execution path used by `requestV3Detailed()`, `requestV3TextDetailed()`, and `requestV4Detailed()`;
   - normalize every request into an ordered workflow child exchange with timestamp, duration, method, path, integration surface, status or transport failure, success/failure classification, and protected direction-aware request/response evidence.
2. `src/integrations/cloudshare/v4-auth.ts`
   - instrument OAuth token acquisition as a distinct metadata-only workflow step with timestamp, duration, correlation, and outcome;
   - never persist bearer values, access tokens, Authorization headers, or renderable token response bodies outside protected-safe metadata.

Why this seam:

- it is below screen- and feature-specific omissions;
- it sees every real HTTP exchange, including successful reads;
- it can preserve ordered child exchanges for multi-call workflows instead of forcing each feature module to reconstruct them;
- it can keep the existing `DiagnosticRecorder` and repository/filter/UI model intact instead of introducing a Sales-only diagnostics system.

## Sales Trial gaps at the pre-implementation baseline

### Support surface and navigation

- `src/api/sales-diagnostics.ts` correctly reuses the protected admin diagnostics endpoint behavior, but only for sales-specific sources.
- `src/web/sales-diagnostics.tsx` is intentionally locked to `source: "sales-records"` and is not the full Trial workflow-log entry point.
- `src/web/sales-workspace.tsx` routed support navigation through `correlationId`, `source`, and `subjectId`, but participant and offering screens did not yet expose the exact Trial Offering and retained-enrollment workflow-log links required by #416.
- The monitoring table exposed `View launch activity` for participant launch logs, but that was narrower than the full retained enrollment lifecycle required by the issue.

### Participant monitoring and retained-enrollment lifecycle

At the baseline, `src/api/sales-session-participants.ts` already recorded a significant amount of evidence, but it was still below the required parity bar.

- Successful participant reconciliation is recorded as `sales.demo_session.participants.reconciled`.
- Each mapped participant also gets an individual `sales.demo_session.participant.reconciled` entry.
- Successful and failed environment observations are recorded as `sales.demo_session.participant.environment_observed`.
- Multi-request operations can already stash ordered exchanges in `details.httpExchanges`.

Baseline gaps:

- the helper records these entries against `subject: { type: "sales_demo_session", id: session.id }`, not against a stable retained participant or retained enrollment subject;
- participant workflows were not yet exactly filterable from ordinary participant screens the way #416 requires;
- some multi-call workflows were represented as one combined parent row whose child exchanges existed only inside protected details;
- successful reads depended on this handler remembering to write them, rather than on a universal shared seam.

### Sales CloudShare adapters

- `src/integrations/cloudshare/sales-delivery.ts` already uses detailed CloudShare request helpers and returns rich evidence for create/read/update session, ensure participant correlation properties, register participants, list participants, invite participants, and create sponsored links.
- `src/integrations/cloudshare/sales-environment.ts` performs a two-call environment observation and returns both exchanges in order.

Baseline gaps:

- these adapters returned evidence to callers but did not write diagnostics themselves;
- list, update, registration, invitation, extension, and environment-observation workflows could collapse multiple HTTP exchanges into one feature-level row;
- v4 token acquisition was invisible as its own workflow step even when the underlying sales flow used v4 requests.

## Parity matrix: pre-implementation baseline and implemented PR #423 result

| Area | Pre-implementation certification baseline | Pre-implementation Sales Trial baseline | Implemented result at PR #423 head |
| --- | --- | --- | --- |
| Protected persistence | Shared typed recorder and repository with exact Customer filters | Reuses same repository and admin endpoint shape | Shared persistence and exact Customer scope retained |
| Support authorization | Authenticated admin Customer scoping is enforced server-side | Same endpoint family, but workflow entry points are narrower | Stable Trial Offering and retained-enrollment subject navigation added |
| Protected request headers | Explicit operational allowlist; auth-bearing headers masked | Same recorder policy | Same allowlist/masking policy retained across shared observer rows |
| OAuth token claims and bodies | Typed error context could contain token request/response evidence; no standalone event | Same gap | Acquisition rows retain only status, duration, failure mode, and classification; no client secret, access token, token claims, request, or response body |
| Successful read visibility | Present in many handlers | Partial and handler-specific | Shared observer captures each CloudShare read |
| Failure visibility | Strong and usually includes protected request/response evidence | Strong in major sales paths | Shared observer aligns feature failures; OAuth summary is metadata-only |
| Multi-request ordering | Often preserved through `details.httpExchanges` | Present in some paths, but often collapsed into one row | Ordered observer rows reconstruct child exchanges; guarded summary rows use `exchangeCount` |
| Subject-scoped navigation | Mature support, correlation, and exam-attempt drill-down | Correlation-driven support links, but no exact Trial Offering / retained-enrollment workflow-log links | Exact Trial Offering and retained-enrollment workflow links added |
| Ordinary-surface confinement | Strong | Strong | Provider IDs and opaque routes fail closed in ordinary projections |

## Constraints for the eventual implementation

- Preserve the final merged `#418` behavior as the production parity baseline during review and QA.
- Do not duplicate diagnostics logic at individual screens.
- Do not regress certification-side successful-read coverage while making the seam shared.
- Do not render provider bodies, tokens, sponsored links, provider IDs, or protected evidence on ordinary sales or participant surfaces.
- Keep timestamps deterministic and timezone-explicit.
- Keep invalid or unresolvable webhook traffic metadata-only until Customer ownership is proven.

## Implemented direction after #418 closed

1. Added shared CloudShare request instrumentation below feature handlers and above raw HTTP, centered on the detailed execution path in `src/integrations/cloudshare/client.ts`.
2. Added metadata-only v4 token-acquisition instrumentation in `src/integrations/cloudshare/v4-auth.ts`.
3. Threaded workflow parent and stable subject context into the shared recorder so Trial Offerings and retained enrollments can be filtered without cross-Customer probing.
4. Preserved combined workflow summary rows where they help operators without letting them replace ordered child exchanges.
5. Repointed sales workflow-log UI links to stable offering and retained-enrollment subjects after `#418` completed the retained enrollment seam.
6. Added regression tests proving certification behavior is preserved while successful sales reads and auth steps are universally visible.

## Result

The certification portal provided the correct protected diagnostics contract, Customer-scoped support access pattern, and many explicit successful-read and mutation recordings. PR #423 adds the missing shared CloudShare transport-plus-auth instrumentation seam, feeds the existing `DiagnosticRecorder` model, preserves ordered child exchanges, and lets Trial Offerings and retained enrollments navigate to exact protected workflow logs.

### Certification OAuth correlation inventory (exact-head update)

The composition root now always creates the mandatory Customer-scoped observer with a per-client correlation and ordered sequence. A narrower workflow observer is composed alongside it where a certification operation has an authoritative parent. The narrower row is not duplicated: each callback writes one Customer row and, when supplied, one distinct workflow row.

| Production path | authoritative workflow anchor |
| --- | --- |
| Individual Exam scheduling | Exam before attempt reservation (the narrowest existing parent) |
| Cohort Exam Session publication, retirement, aggregate Guided Journey and participant monitoring | Cohort Exam Session |
| Cohort participant admission | ExamAttempt |
| Candidate-dashboard and explicit environment correlation | ExamAttempt |
| External lease validation | ExamAttempt |
| Resource/catalogue reads without a narrower workflow | Customer-scoped default |

Both OAuth acquisition and subsequent v3/v4 requests use the same correlation and monotonic sequence within each observer. OAuth request and response evidence remains absent from both rows.
