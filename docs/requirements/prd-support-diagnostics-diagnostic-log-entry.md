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
13. As a Helios admin, I want CloudShare API diagnostic entries to include protected HTTP evidence — request method, path, query parameters, credential-masked request headers with safe operational headers visible, request body when present, response status, response headers, and provider response body — so that CloudShare issues can be verified without external tooling.
14. As a Helios admin, I want every request/query and provider-response body value retained verbatim, including `passphrase`, `accessLink`, `loginUrl`, tokens, and nested values, while credential-bearing request headers remain masked and safe operational request headers remain visible, so that diagnostics preserve complete support evidence without client leakage.
15. As a Helios admin, I want an explicitly enabled, time-boxed sensitive diagnostic mode, so that replicable integration issues can be diagnosed when normal redaction hides material needed to prove the problem.
16. As a Helios admin, I want missing-signature and invalid-signature webhook attempts to expose safe metadata but not arbitrary raw untrusted request bodies during normal logging, so that public webhook traffic cannot become a sensitive data sink.
17. As a Helios admin, I want DiagnosticLogEntry rows to be append-only, so that the log remains a record of what was known at the time.
18. As a Helios admin, I want later correlation discoveries to emit new linked entries rather than rewrite old rows, so that the diagnostic timeline remains truthful.
19. As a future Certalis builder, I want DiagnosticLogEntry to be a generic platform trace with nullable domain anchors, so that future LMS, Sales Enablement, or Salesforce-like flows can reuse the same support model.
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
- CloudShare API diagnostics must not stop at a derived status or summary. They must store the
  redacted request and response evidence needed to reproduce and support the integration call:
  method, path, query parameters, request headers, request body when present, response status,
  response headers, response body, and transport failure details when no response was received.
- Later discoveries, such as environment correlation, should emit new entries that include the newly discovered ID and the known thread identifiers.
- Session Monitoring remains the current-state queue surface. Support should not duplicate Session Monitoring queues as its primary workflow.
- Admin investigation actions should route into the Diagnostic Log with pre-applied filters such as ExamAttempt ID or correlation ID. The older Support Log remains only as a transitional raw-evidence fallback, not the primary investigation view.
- Audit Trail remains separate. Audit answers who changed what and whether it was allowed; Support diagnostics answer what the platform did and how to trace behavior. Some actions emit both.
- Event Log is not a primary support workflow. Events that matter to support should appear as DiagnosticLogEntries or correlated timeline rows.
- Existing prototype support-log rows are disposable development data and should not constrain the new model.
- Normal DiagnosticLogEntry output follows a direction-aware contract:
  - **Credential-aware request headers:** always mask Authorization, Proxy-Authorization, cookies, API-key/token/signature/authentication-bearing headers, and analogous credentials; preserve safe operational headers such as Content-Type, Accept, Content-Length, User-Agent, and correlation/request IDs.
  - **Admin-only protected body evidence:** retain every request/query and provider-response body value verbatim, including API-looking values, passphrases, access links, sponsored login URLs, tokens, nested objects, and arrays. Do not field-name scrub or value-pattern scrub bodies.
  - **Access control:** protected body evidence is Customer-scoped and returned only through server-enforced admin diagnostic routes. It never appears in participant/candidate views, ordinary client APIs, browser state, or browser console.
  Admin-only DiagnosticLogEntry and Support Diagnostics surfaces may display the admin-only evidence above as support evidence.
- Sensitive diagnostic capture may exist, but only as an explicit debug mode with strong guardrails: disabled by default, admin/operator visible, audited when enabled/disabled, time-boxed with automatic expiry, restricted to a specific Customer or diagnostic scope where possible, and clearly marked in the UI. It exists for replicable issues where normal redaction prevents diagnosis, not for routine logging.
- First write-path instrumentation should cover Candidate account creation; Candidate login/logout attempts; Customer admin login/logout attempts; Candidate ExamAttempt scheduling; CloudShare training creation; Candidate participant/student add; sponsored-link creation; Candidate enter/resume/suspend; CloudShare webhook receive/verify/reconcile; Guided Journey score retrieval; and CloudShare resource-sync reads.
- Exam authoring and lifecycle changes should emit diagnostics alongside audits, but they are lower priority than the candidate exam delivery path.

### Diagnostic body redaction taxonomy

Diagnostic evidence is classified by direction and exposure:

- **Request headers:** mask credential-bearing values in persisted rows, rendered admin output, and logs, including Authorization, cookies, API-key/token/signature/authentication headers, and analogous credentials. Preserve safe operational values such as Content-Type, Accept, Content-Length, User-Agent, and correlation/request IDs.
- **Request/query and provider response bodies:** retain their complete original data verbatim in protected admin diagnostics. This includes passphrases, access links, sponsored URLs, tokens, credentials-looking names, nested objects, arrays, and raw parsed webhook payloads. There are no endpoint allowlists and no field-name/value-pattern scrubbing.
- **Exposure:** the above bodies remain server-only Customer-scoped admin-support evidence and must never reach candidate/participant UI, ordinary client APIs, browser state, browser console, or non-admin users.

The same direction-aware contract applies to client traces, request/response error contexts, scheduling diagnostics, suspend/resume and heartbeat diagnostics, Guided Journey score diagnostics, resource diagnostics, and webhook diagnostics. The recorder owns header masking; upstream adapters must not pre-scrub bodies.

## Testing Decisions

- Test through the highest stable seams: framework-agnostic API/domain handlers for write-path emission and the Support diagnostic read API for search/filter behavior.
- Repository tests should prove DiagnosticLogEntry persists first-class correlation fields and structured request/response/details safely.
- API/domain tests should prove success and failure paths emit diagnostic entries with the expected anchors.
- Direction-aware tests must prove actual request-header slots are masked while complete request/query and provider-response bodies, including valid or rejected webhook raw bodies, passphrases, access links, sponsored URLs, tokens, nested arrays, and collision keys, remain exact in Customer-scoped admin diagnostics and never reach non-admin or ordinary client projections.
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
- Completing every possible future LMS, Sales Enablement, or Salesforce diagnostic anchor.
- Building sensitive diagnostic mode in the first write-path slice unless that slice explicitly scopes it; the first slice may define the configuration seam without exposing a full UI.

## Further Notes

This PRD supersedes the queue-first Support Workbench Slice 2 direction. The replacement implementation should start with the write path: create the DiagnosticLogEntry model/repository and instrument the highest-value flows before rebuilding the Support UI. Without correlated diagnostic writes, support filters cannot be reliable.
