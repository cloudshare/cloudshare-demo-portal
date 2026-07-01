# ADR-005: Exam time limit, open period, and storage lease are separate clocks

**Status:** accepted (2026-07-01)

## Decision

Certalis models three distinct timing concepts for CloudShare-backed Exams. The CloudShare Policy `runtimeLeaseMinutes` is the Candidate's running-time allowance and feeds `Exam.timeLimitMinutes` / the ExamAttempt timer. `Exam.openPeriodMinutes` is manually authored in the Exam catalog and defines the CloudShare training/Experience `End` as `scheduledFor + openPeriodMinutes`. The CloudShare Policy `storageLeaseMinutes` is retained as continuous environment retention/TTL evidence and as an authoring validation bound, but it does not directly define the Experience end time.

## Why

The Policy runtime lease and storage lease answer different CloudShare questions: runtime is consumed only while the environment is running, while storage starts counting down when the environment is spun up and controls how long the environment can exist. The Experience open period is a Certalis exam-delivery decision: it defines how long the Candidate may enter the Experience, and it may intentionally be shorter than storage retention so an Instructor can review the environment after the Candidate's access window closes.

## Consequences

- Exam authoring must preserve an editable open period and validate it is at least the runtime time limit.
- When Policy storage evidence is known, the open period must not exceed the storage lease.
- Scheduling must send CloudShare training `End = scheduledFor + Exam.openPeriodMinutes`, not runtime lease or storage lease.
- Environment extensions are out of scope for this decision.
