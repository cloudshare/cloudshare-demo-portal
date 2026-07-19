# Typed DiagnosticLogEntry as the support source of truth

Accepted.

Support diagnostics will use a typed, append-only `DiagnosticLogEntry` model as the platform support source of truth, rather than treating the existing free-form support-log JSON as the long-term model. The portal is intended to become an extensible demo platform, not only an Exam demo, so diagnostic entries are generic platform traces with nullable domain anchors such as Candidate email, Exam ID, ExamAttempt ID, CloudShare IDs, and future LMS or Sales Enablement identifiers. Existing prototype support-log rows are disposable development data and must not constrain the new diagnostic model.

**Consequences**

- Session Monitoring remains the surface for current ExamAttempt queues; Support becomes the searchable forensic diagnostic-log workflow.
- Diagnostic entries are append-only evidence. Later discoveries emit new correlated entries rather than mutating old rows to add identifiers that were unknown at the time.
- Core correlation fields must be first-class so support users can filter by Customer, actor, subject, operation, outcome, correlation ID, external IDs, Candidate email, Exam ID, and ExamAttempt ID.
- Normal diagnostics use a three-way taxonomy:
  - **Request headers are always redacted:** all request-header values, including `Authorization` and authentication artefacts, are masked in persisted, rendered, and logged diagnostic representations.
  - **Admin-only server evidence:** all CloudShare request/query and provider-response body data is retained verbatim, including `passphrase`, `accessLink`, sponsored `loginUrl`, tokens, nested values, and analogous fields. No body field-name or value-pattern redaction is permitted.
  - This override is prospective and portal-wide. The retained evidence remains Customer-scoped, server-enforced admin diagnostics only; it is never exposed to candidate/participant UI, ordinary client APIs, browser state, or non-admin users.
  A sensitive diagnostic mode may be added for replicable issues, but it must be explicit, audited, time-boxed, disabled by default, scoped as narrowly as possible, and clearly visible to operators while enabled.
