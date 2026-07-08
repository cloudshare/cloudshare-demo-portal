# Cohort Exam Sessions — Grill-with-docs synthesis

Date: 2026-07-04

Status: Historical discovery from a pre-v1.1 `grill-with-docs` session. For new comparable planning
work, use `/wayfinder` when the effort is larger than one agent session; otherwise use `/grilling`,
then `/to-spec` and `/to-tickets`.

## Purpose

This note captures the agreed scope for adding **Cohort Exam Sessions** to Certalis. The feature is
for certification delivery, not the later sales enablement / demo / POC portal, although the delivery
mechanics are expected to be reusable in that future work.

## Core model

Certalis should support two Exam delivery modes:

- **Individual Exam Delivery**: current behavior. A Candidate chooses a start time, and the portal
  creates a dedicated one-Participant CloudShare Experience for that Candidate's ExamAttempt.
- **Cohort Exam Session**: a Helios Admin-created delivery instance where many Candidates join one
  long-running, on-demand CloudShare Experience during an admin-defined availability window.

The catalog **Exam** remains reusable and catalog-only when published. Publishing an Exam does not
create CloudShare runtime. Publishing a **Cohort Exam Session** creates the shared CloudShare
Experience.

An Exam explicitly controls delivery availability:

- individual-only;
- cohort-only;
- both.

Candidates should continue to browse by Exam. Delivery mode should not be a primary Candidate-facing
category. Future Candidate-facing distinctions are likely to be value/experience labels such as
proctored, AI-marked, instructor-reviewed, immediate start, scheduled window, price, voucher
requirement, or credential value.

## Session authoring

A Cohort Exam Session is created under an Exam. It inherits the Exam's CloudShare resource tuple:

- Project;
- Blueprint and its current default Snapshot;
- Policy;
- allowed Region set;
- Instructor;
- score-retrieval / Guided Journey flag;
- Candidate time limit.

The session should not re-author Blueprint, Policy, Regions, Instructor, or Guided Journey settings
in the first version. Session fields should focus on delivery lifecycle:

- name;
- open/admission time;
- optional close/end time;
- optional capacity;
- lifecycle status;
- CloudShare training/Experience identifiers after publish.

For v1, the session inherits the Exam's full allowed Region set. Region subset override may be useful
later, but it is deliberately out of scope because it turns session creation into another resource
authoring surface.

## CloudShare Experience creation

Cohort Exam Sessions use a CloudShare **on-demand** Experience rather than the current
`instructorLed` Experience type. CloudShare does not pre-provision participant environments for this
mode; each Candidate's environment is allocated when they join.

The shared CloudShare Experience should be created when the Helios Admin publishes the Cohort Exam
Session. Creating it at publish time:

- validates the CloudShare composition before Candidates can join;
- gives admins a concrete CloudShare Experience ID for diagnostics;
- keeps Candidate join focused on participant registration and sponsored-link creation.

Sponsored links should not be created at session publish time. They are bearer login tokens with
possible TTL concerns and no pre-provisioning value. Create the sponsored link only when the
Candidate starts/joins.

## Candidate join and timing

Candidates do not choose their own schedule inside cohort mode. The Cohort Exam Session defines the
admission window. A Candidate joins an available session and starts their ExamAttempt immediately.

Each Candidate keeps an independent ExamAttempt clock even though the CloudShare Experience is
shared. The shared session controls admission; the ExamAttempt clock controls Candidate runtime.

The secure launch model remains:

1. Experience is restricted to registered students/participants.
2. Candidate clicks Start exam for an available Cohort Exam Session.
3. Portal creates an ExamAttempt attached to that session.
4. Portal adds the Candidate as a participant to the existing CloudShare Experience.
5. Portal creates a sponsored link for that participant.
6. Candidate reaches the sponsored link only through the existing server-side 302 pattern.

Candidates must not have overlapping active ExamAttempts for the same Exam, even across different
delivery modes or Cohort Exam Sessions.

Same-Experience retakes are desirable long term, but CloudShare does not currently appear to support
controlled nth-environment allocation cleanly. The first version should block same-session retakes
unless a clean supported path is verified. See
[GAP-22](../api/cloudshare-gap-report.md#gap-22--no-controlled-nth-environment-admission-workflow-inside-an-experience).

## Admin monitoring and analytics

The Cohort Exam Session admin detail page should show:

- session lifecycle state;
- CloudShare training/Experience ID;
- participant and ExamAttempt rows;
- active/in-progress/completed/problem counts;
- relevant diagnostics links;
- admin-only aggregate Guided Journey progress for the shared Experience.

CloudShare exposes Experience-scoped aggregate Guided Journey progress at:

```text
GET /v4/guided-journey/progress/{experienceId}
```

This returns aggregate rates such as `avgExploredRate`, `avgInProgressRate`,
`avgNotStartedRate`, `avgPassedRate`, `avgFailedRate`, `avgNotInitiatedRate`, plus section-level
`aggSectionStatuses[]`. This is in scope for the first Cohort Exam Session feature because the
feature intentionally puts many participants into one Experience.

The aggregate belongs to the Cohort Exam Session admin detail page, not the catalog Exam page.
Candidate score pages remain scoped to the Candidate's own ExamAttempt.

This does not solve cross-Experience Guided Journey analytics. Cross-Experience aggregation by
Guided Journey definition/version remains a future request. See
[GAP-21](../api/cloudshare-gap-report.md#gap-21--future-request--reusable-guided-journey-analytics-across-experiences).

## Close and retire lifecycle

Cohort Exam Session lifecycle should distinguish:

- **Close admission**: block new Candidates from joining; existing ExamAttempts continue.
- **Retire Experience**: block new joins and update the CloudShare Experience `End` to now or
  near-now where CloudShare supports it; this may interrupt active participants.
- **Delete**: not a normal product lifecycle for published/consumed sessions.

Published/consumed Exams and Cohort Exam Sessions should not be deleted as normal behavior. At best,
they should be archived/hidden from active lists while remaining navigable for history, diagnostics,
score review, and analytics.

Before retiring a session, the portal should read `GET /trainings/{id}/students` and account for:

- `participationStatus`: especially `inProgress`;
- `envStatus`: terminal states appear to be `Archived` and `Deleted`; other states require caution.

Retire should warn admins about active or non-terminal participant environments before changing the
CloudShare Experience `End`. The delete-only CloudShare lifecycle and the possible `End = now`
retirement path are tracked in
[GAP-20](../api/cloudshare-gap-report.md#gap-20--experience-cleanup-is-delete-only-no-archivehide-lifecycle).

## Proposed vertical slices

Each slice should be deep enough to be testable through the relevant UI/API path.

1. **Admin creates a draft Cohort Exam Session**
   - Add Exam delivery availability: individual-only, cohort-only, or both.
   - Add draft Cohort Exam Session create/list/view under an Exam.
   - Candidate visibility remains unchanged.

2. **Admin publishes a Cohort Exam Session to CloudShare**
   - Publish creates the shared on-demand CloudShare Experience.
   - Persist CloudShare identifiers.
   - Record success/failure diagnostics.
   - Surface CloudShare publish failures clearly to the admin.

3. **Candidate joins a published Cohort Exam Session**
   - Candidate Exam card shows available cohort sessions.
   - Start creates an ExamAttempt attached to the session.
   - Portal adds the Candidate to the existing Experience.
   - Portal creates a sponsored link and redirects through the existing enter path.
   - Enforce no overlapping active attempts for the same Exam.

4. **Admin monitors a Cohort Exam Session**
   - Admin detail shows session participants and linked ExamAttempts.
   - Read CloudShare student/participant state from `GET /trainings/{id}/students`.
   - Surface participant status, environment status, and diagnostics links.

5. **Admin views aggregate Guided Journey progress**
   - Add adapter for `GET /v4/guided-journey/progress/{experienceId}`.
   - Display admin-only aggregate rates and section statuses on the session detail page.
   - Do not expose cohort aggregates to Candidates.

6. **Admin closes/retires a Cohort Exam Session**
   - Close admission without interrupting active attempts.
   - Warn on active/non-terminal participants before retire.
   - Retire by updating CloudShare Experience `End` where verified.
   - Preserve session history; do not delete consumed sessions.

## Open CloudShare verification

- Exact request shape for creating an on-demand training/Experience.
- Whether `End` is optional for on-demand Experiences.
- Whether an unended Experience's `End` can be updated to now/near-now, and only before it has
  already passed.
- Sponsored-link TTL and whether delayed creation remains the safest path.
- Whether same-Experience retakes can be controlled without participant delete/recreate or
  Experience-wide multiple-environment toggling.
- Whether aggregate Guided Journey progress returns the same shape live as shown in the docs.
