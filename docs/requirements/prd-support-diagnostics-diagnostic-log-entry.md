# PRD: Correlated Support Diagnostics and DiagnosticLogEntry

**Date:** 2026-06-20
**Status:** Drafted from support workflow design review
**Supersedes:** Issue #67 and PR #73 queue-first Support Workbench direction.
**Sources:** `CONTEXT.md`, `docs/decisions/ADR-004-typed-diagnostic-log-entry.md`, Session Monitoring QA, webhook diagnostics QA, and the Slice 2 support-workflow design review.

## Problem Statement

Helios admins need a support surface that lets them reconstruct how the Certalis Portal behaved for a Candidate, Exam, ExamAttempt, CloudShare webhook, external request, or platform action. The current Support Workbench direction incorrectly mixes Session Monitoring queues with support-log widgets. That duplicates the Session Monitoring tab and still leaves support unable to trace a problem because diagnostic rows do not consistently include the Candidate, Exam, ExamAttempt, CloudShare identifiers, operation, outcome, request/response, or other thread identifiers needed for forensic diagnosis.

Support needs a correlated diagnostic log, not another monitoring dashboard.

## Solution

Introduce a typed, append-only `DiagnosticLogEntry` model as the platform support source of truth. It should be generic enough for the portal's future extensibility beyond exams, while carrying nullable exam-domain anchors where known.

The Support area should become a searchable diagnostic-log workflow. Session Monitoring remains responsible for current ExamAttempt queues and state summaries. Support should show what happened, in what order, and how each action relates to Customer, actor, subject, Candidate, Exam, ExamAttempt, CloudShare identifiers, request/response data, webhook data, and correlation IDs.

Existing prototype support-log rows are development data and do not need migration. They may be reset, archived, or discarded if that keeps the DiagnosticLogEntry model clean.

## User Stories

1. As a Helios admin, I want to search diagnostic entries by ExamAttempt ID, so that I can trace everything that happened for one Candidate taking one Exam.
2. As a Helios admin, I want to search diagnostic entries by Candidate email, so that I can investigate issues reported by a specific Candidate.
3. As a Helios admin, I want to search diagnostic entries by Exam ID, so that I can investigate lifecycle and operational issues related to a catalog Exam.
4. As a Helios admin, I want diagnostic entries to include successful actions, so that I can reconstruct normal behavior as well as failures.
5. As a Helios admin, I want diagnostic entries to include failed actions, so that I can see what operation failed, where, and with what external response.
6. As a Helios admin, I want diagnostic entries to include CloudShare training, environment, participant, project, blueprint, policy, region, webhook, and correlation identifiers where known, so that I can correlate portal behavior with CloudShare.
7. As a Helios admin, I want webhook receipt, signature verification, and reconciliation to appear in the diagnostic log, so that I can diagnose webhook trust and correlation problems.
8. As a Helios admin, I want resource-sync reads from CloudShare to appear in the diagnostic log, so that I can understand what infrastructure data the portal retrieved.
9. As a Helios admin, I want Candidate account creation and login/logout attempts to appear in the diagnostic log, so that identity-related support questions have trace evidence.
10. As a Helios admin, I want admin login/logout attempts to appear in the diagnostic log, so that operator access can be diagnosed.
11. As a Helios admin, I want ExamAttempt scheduling, CloudShare training creation, student add, and sponsored-link creation to appear in one correlated thread, so that provisioning issues can be diagnosed end to end.
12. As a Helios admin, I want Candidate enter, suspend, resume, heartbeat auto-suspend, and score retrieval to appear in one correlated thread, so that runtime issues can be diagnosed end to end.
13. As a Helios admin, I want raw request/response details when supportability requires them, so that CloudShare issues can be verified without external tooling.
14. As a Helios admin, I want secrets, API keys, bearer tokens, authorization headers, and webhook secrets redacted while CloudShare sponsored-link `loginUrl` values remain available in admin-only diagnostics, so that diagnostics preserve support evidence without leaking non-diagnostic credentials.
15. As a Helios admin, I want an explicitly enabled, time-boxed sensitive diagnostic mode, so that replicable integration issues can be diagnosed when normal redaction hides material needed to prove the problem.
16. As a Helios admin, I want missing-signature and invalid-signature webhook attempts to expose safe metadata but not arbitrary raw untrusted request bodies during normal logging, so that public webhook traffic cannot become a sensitive data sink.
17. As a Helios admin, I want DiagnosticLogEntry rows to be append-only, so that the log remains a record of what was known at the time.
18. As a Helios admin, I want later correlation discoveries to emit new linked entries rather than rewrite old rows, so that the diagnostic timeline remains truthful.
19. As a future Certalis builder, I want DiagnosticLogEntry to be a generic platform trace with nullable domain anchors, so that future LMS, sales-demo, or Salesforce-like flows can reuse the same support model.
20. As a reviewer, I want tests to prove diagnostic entries are emitted on success and failure paths, so that supportability does not regress.
21. As a reviewer, I want tests to prove filtering works on first-class correlation fields, so that the Support UI is not dependent on brittle JSON-string searches.

## Implementation Decisions

- Support diagnostics use a typed, append-only `DiagnosticLogEntry` model as the support source of truth.
- `DiagnosticLogEntry` is a generic platform trace with nullable domain anchors, not an Exam-only log.
- Core fields should include occurred time, level, source, operation, outcome, Customer ID, actor type/ID/email where known, subject type/ID where known, message, correlation ID, external IDs, request metadata, response metadata, and details.
- Exam-domain anchors should include Candidate email, Exam ID, and ExamAttempt ID where known.
- CloudShare identifiers should be represented as structured external IDs rather than hidden only in free-form JSON.
- Free-form data may remain in details/request/response, but filtering-critical fields must be first-class.
- Diagnostic entries are append-only evidence. Do not mutate old rows to add identifiers that were unknown at the time.
- Later discoveries, such as environment correlation, should emit new entries that include the newly discovered ID and the known thread identifiers.
- Session Monitoring remains the current-state queue surface. Support should not duplicate Session Monitoring queues as its primary workflow.
- Audit Trail remains separate. Audit answers who changed what and whether it was allowed; Support diagnostics answer what the platform did and how to trace behavior. Some actions emit both.
- Event Log is not a primary support workflow. Events that matter to support should appear as DiagnosticLogEntries or correlated timeline rows.
- Existing prototype support-log rows are disposable development data and should not constrain the new model.
- Normal DiagnosticLogEntry output must redact secrets, API keys, bearer tokens, authorization headers, webhook secrets, and other sensitive values. CloudShare sponsored-link `loginUrl` values are an explicit exception for admin-only diagnostic evidence: they may be retained in DiagnosticLogEntry data, but they remain server-only and must never be returned to Candidate/client-facing responses, Candidate/client-facing UI, or non-admin APIs. Admin-only DiagnosticLogEntry and Support Diagnostics surfaces may display them as support evidence.
- Sensitive diagnostic capture may exist, but only as an explicit debug mode with strong guardrails: disabled by default, admin/operator visible, audited when enabled/disabled, time-boxed with automatic expiry, restricted to a specific Customer or diagnostic scope where possible, and clearly marked in the UI. It exists for replicable issues where normal redaction prevents diagnosis, not for routine logging.
- First write-path instrumentation should cover Candidate account creation; Candidate login/logout attempts; Customer admin login/logout attempts; Candidate ExamAttempt scheduling; CloudShare training creation; Candidate participant/student add; sponsored-link creation; Candidate enter/resume/suspend; CloudShare webhook receive/verify/reconcile; Guided Journey score retrieval; and CloudShare resource-sync reads.
- Exam authoring and lifecycle changes should emit diagnostics alongside audits, but they are lower priority than the candidate exam delivery path.

## Testing Decisions

- Test through the highest stable seams: framework-agnostic API/domain handlers for write-path emission and the Support diagnostic read API for search/filter behavior.
- Repository tests should prove DiagnosticLogEntry persists first-class correlation fields and structured request/response/details safely.
- API/domain tests should prove success and failure paths emit diagnostic entries with the expected anchors.
- Redaction tests should prove secrets, auth headers, API keys, bearer tokens, webhook secrets, and untrusted webhook raw bodies do not leak, while admin-only DiagnosticLogEntry data may retain CloudShare sponsored-link `loginUrl` values.
- Sensitive diagnostic mode tests should prove sensitive capture is disabled by default, expires automatically, emits audit/diagnostic records when toggled, and changes captured fields only within the intended scope.
- Support read-model tests should prove filtering by Candidate email, Exam ID, ExamAttempt ID, operation, outcome, correlation ID, CloudShare external IDs, and time range.
- UI tests or browser smoke tests should prove the Support page filters the diagnostic log itself, not unrelated monitoring widgets.

## Out of Scope

- Building a full SIEM.
- Exporting diagnostics to an external observability platform.
- Migrating historical prototype support-log rows.
- Rebuilding Session Monitoring.
- Replacing Audit Trail.
- Adding production retention, archival, or role-based access controls beyond the current admin-only support surface.
- Completing every possible future LMS, sales-demo, or Salesforce diagnostic anchor.
- Building sensitive diagnostic mode in the first write-path slice unless that slice explicitly scopes it; the first slice may define the configuration seam without exposing a full UI.

## Further Notes

This PRD supersedes the queue-first Support Workbench Slice 2 direction. The replacement implementation should start with the write path: create the DiagnosticLogEntry model/repository and instrument the highest-value flows before rebuilding the Support UI. Without correlated diagnostic writes, support filters cannot be reliable.
