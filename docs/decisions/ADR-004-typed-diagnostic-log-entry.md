# Typed DiagnosticLogEntry as the support source of truth

Accepted.

Support diagnostics will use a typed, append-only `DiagnosticLogEntry` model as the platform support source of truth, rather than treating the existing free-form support-log JSON as the long-term model. The portal is intended to become an extensible demo platform, not only an Exam demo, so diagnostic entries are generic platform traces with nullable domain anchors such as Candidate email, Exam ID, ExamAttempt ID, CloudShare IDs, and future LMS or sales-demo identifiers. Existing prototype support-log rows are disposable development data and must not constrain the new diagnostic model.

**Consequences**

- Session Monitoring remains the surface for current ExamAttempt queues; Support becomes the searchable forensic diagnostic-log workflow.
- Diagnostic entries are append-only evidence. Later discoveries emit new correlated entries rather than mutating old rows to add identifiers that were unknown at the time.
- Core correlation fields must be first-class so support users can filter by Customer, actor, subject, operation, outcome, correlation ID, external IDs, Candidate email, Exam ID, and ExamAttempt ID.
- Normal diagnostics use a three-way taxonomy:
  - **Always redact:** API keys, bearer tokens, authorization headers, webhook secrets, HMAC/signature values, passwords, and actual credentials.
  - **Admin-only server evidence:** CloudShare sponsored-link `loginUrl` values and training `passphrase` values may be retained in admin-only diagnostics as support evidence, but they remain server-only and must never appear in Candidate/client-facing responses.
  - **Ordinary support evidence:** non-credential request/response fields remain visible so support can reconstruct CloudShare behavior.
  A sensitive diagnostic mode may be added for replicable issues, but it must be explicit, audited, time-boxed, disabled by default, scoped as narrowly as possible, and clearly visible to operators while enabled.
