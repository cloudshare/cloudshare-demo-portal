# PRD: Cohort Exam Sessions

**Date:** 2026-07-04
**Status:** Drafted from a pre-v1.1 `grill-with-docs` session. For new comparable scope, use
`/wayfinder` when the planning work exceeds one agent session, otherwise `/grilling`, then
`/to-spec` and `/to-tickets`.
**Sources:** `CONTEXT.md`, `docs/discovery/2026-07-04-cohort-exam-sessions-grill-with-docs-synthesis.md`, `docs/api/cloudshare-gap-report.md`, PRD v2, ADR-001 through ADR-005.

## Problem Statement

The current Certalis portal only supports Individual Exam Delivery: a Candidate chooses a start
time, and the portal creates a dedicated one-Participant CloudShare Experience for that Candidate's
ExamAttempt. That model is useful for isolated exam delivery, entitlement, suspend/resume, and
per-attempt diagnostics, but it prevents meaningful CloudShare Experience-level aggregate analytics.
An aggregate over a single participant is still only an individual result.

CloudShare's native cohort model is different. A long-running on-demand Experience can contain many
Participants, each with their own environment and Policy-governed runtime. That model is a better
fit for aggregate Guided Journey progress and is also closer to how CloudShare Experiences are
commonly consumed.

Helios Admins need a way to create a Cohort Exam Session under an Exam, publish it as one shared
CloudShare on-demand Experience, allow Candidates to join that session on demand, and monitor both
individual ExamAttempts and session-level Guided Journey aggregate progress without deleting
historical CloudShare evidence.

## Solution

Add **Cohort Exam Sessions** as a second delivery mode for Exams.

An Exam remains the reusable catalog item. Publishing an Exam remains catalog-only. A Cohort Exam
Session is a Helios Admin-created delivery instance under an Exam. Publishing the Cohort Exam
Session creates a shared, long-running CloudShare on-demand Experience. Candidates browse by Exam,
see available cohort sessions on the Exam card, and start an ExamAttempt by joining an available
session.

Each Candidate keeps an independent ExamAttempt clock even though the CloudShare Experience is
shared. Candidate joins continue to use the secure registered-students-only flow: add the Candidate
as a Participant to the existing Experience, create a sponsored link only at start time, and redirect
through the existing server-side 302 pattern.

Admins can monitor the Cohort Exam Session from the Exam admin area. The session detail page shows
portal ExamAttempts, CloudShare participant/environment status, diagnostics links, and admin-only
aggregate Guided Journey progress for that shared Experience.

## User Stories

1. As a Helios Admin, I want to mark an Exam as available for Individual Exam Delivery, Cohort Exam Sessions, or both, so that I control which delivery options Candidates can use.
2. As a Helios Admin, I want to create a draft Cohort Exam Session under an Exam, so that I can prepare a shared delivery instance before Candidates can join it.
3. As a Helios Admin, I want a Cohort Exam Session to inherit the Exam's CloudShare resource tuple, so that I do not have to re-author Blueprint, Policy, Region, Instructor, or Guided Journey settings.
4. As a Helios Admin, I want the Cohort Exam Session to inherit the Exam's allowed Region set, so that CloudShare can place participant environments across the already validated regions.
5. As a Helios Admin, I want to name a Cohort Exam Session, so that Candidates and admins can distinguish sessions over time.
6. As a Helios Admin, I want to define when a Cohort Exam Session admits Candidates, so that I control when Candidates may start.
7. As a Helios Admin, I want the session end/close date to be optional, so that long-running exam sessions can remain available for months when appropriate.
8. As a Helios Admin, I want to publish a Cohort Exam Session, so that Certalis creates the shared CloudShare on-demand Experience.
9. As a Helios Admin, I want publish failures to be visible and supportable, so that I can fix CloudShare configuration issues before Candidates are blocked.
10. As a Helios Admin, I want publish success to show the CloudShare training/Experience ID, so that I can correlate Certalis with CloudShare.
11. As a Helios Admin, I want publishing an Exam to remain catalog-only, so that normal catalog changes do not create or delete CloudShare runtime.
12. As a Helios Admin, I want a published Cohort Exam Session to appear under its Exam, so that session management stays attached to the relevant catalog item.
13. As a Helios Admin, I want a session detail page, so that I can inspect one Cohort Exam Session without mixing it with other sessions for the same Exam.
14. As a Helios Admin, I want to see portal ExamAttempts for a Cohort Exam Session, so that I can monitor which Candidates joined and what state their attempts are in.
15. As a Helios Admin, I want to see CloudShare participant status for a Cohort Exam Session, so that I can compare portal state with CloudShare state.
16. As a Helios Admin, I want to see CloudShare environment status for each participant, so that I can identify running, suspended, failed, archived, or deleted environments.
17. As a Helios Admin, I want active/in-progress/problem counts, so that I can understand the operational health of a session quickly.
18. As a Helios Admin, I want session actions and CloudShare calls to emit Diagnostic Log Entries, so that support can reconstruct publish, join, monitor, aggregate, close, and retire behavior.
19. As a Helios Admin, I want aggregate Guided Journey progress for one Cohort Exam Session, so that I can see how the cohort is performing in that shared Experience.
20. As a Helios Admin, I want aggregate Guided Journey progress to be clearly labelled as Experience-scoped, so that I do not confuse it with cross-Experience analytics.
21. As a Helios Admin, I want aggregate Guided Journey progress to stay admin-only, so that Candidates only see their own ExamAttempt score.
22. As a Helios Admin, I want to close admission for a Cohort Exam Session, so that no new Candidates can join while existing attempts continue.
23. As a Helios Admin, I want to retire a Cohort Exam Session without deleting it, so that the session disappears from active lists while history remains navigable.
24. As a Helios Admin, I want a warning before retiring a session with active participants, so that I understand who may be interrupted.
25. As a Helios Admin, I want session retire behavior to preserve CloudShare and portal evidence, so that certification history, scores, and diagnostics are not destroyed.
26. As a Candidate, I want to browse Exams as I do today, so that I do not need to understand CloudShare delivery mechanics.
27. As a Candidate, I want to see available Cohort Exam Sessions on an Exam card, so that I can start an Exam when a session is available.
28. As a Candidate, I want to start an available Cohort Exam Session immediately, so that cohort delivery feels on-demand.
29. As a Candidate, I want my exam timer to start when I join, so that I receive the same allotted exam time as other Candidates even if we join at different times.
30. As a Candidate, I want my suspend/resume and heartbeat behavior to work as it does for Individual Exam Delivery, so that my exam runtime is controlled consistently.
31. As a Candidate, I want my own score page to show only my ExamAttempt result, so that cohort aggregate results are not exposed to me.
32. As a Candidate, I want the portal to prevent duplicate active attempts for the same Exam, so that I do not accidentally create overlapping environments.
33. As a support operator, I want Cohort Exam Session diagnostics to include session, Exam, ExamAttempt, Candidate, training, participant, environment, and correlation identifiers where known, so that I can trace issues across portal and CloudShare state.
34. As a reviewer, I want Cohort Exam Session behavior tested through the same high-level API and UI seams as existing exam delivery, so that the feature is safe to change.
35. As a future Certalis builder, I want Cohort Exam Sessions to remain distinct from reusable sales/demo/POC delivery sessions, so that the certification portal stays focused while preserving a reusable delivery pattern.

## Implementation Decisions

- `Exam` remains the reusable catalog item. Publishing an Exam does not create CloudShare runtime.
- Add an explicit Exam delivery availability setting: Individual Exam Delivery only, Cohort Exam Sessions only, or both.
- Add a `Cohort Exam Session` concept under an Exam.
- Publishing a Cohort Exam Session creates the shared CloudShare on-demand Experience.
- Cohort Exam Sessions inherit the Exam's CloudShare resource tuple: Project, Blueprint/default Snapshot, Policy, allowed Region set, Instructor, score-retrieval flag, and Candidate time limit.
- Cohort Exam Sessions do not override Blueprint, Policy, Region set, Instructor, or Guided Journey settings in the first version.
- For v1, a Cohort Exam Session inherits the Exam's full allowed Region set. Session-level Region subset overrides are out of scope.
- Cohort Exam Sessions use CloudShare's on-demand Experience type, not the current instructor-led type.
- CloudShare Experience creation happens when the session is published, not when the first Candidate joins.
- Sponsored links are created only when a Candidate starts/joins, not when the session is published.
- Candidate join attaches to an existing Cohort Exam Session and creates an ExamAttempt for that Candidate.
- Candidate join uses the registered-students-only model: add the Candidate as a Participant, then create the sponsored link.
- The sponsored link remains server-only and is reached only through the portal's server-side redirect.
- Candidate ExamAttempt clocks remain independent per Candidate.
- The session admission window controls whether a Candidate may start. It does not replace the Candidate's ExamAttempt timer.
- Candidates may not hold overlapping active ExamAttempts for the same Exam across delivery modes or Cohort Exam Sessions.
- Same-Experience retakes are desirable long term but out of scope until CloudShare exposes or the portal owns a controlled nth-environment workflow.
- The first version blocks same-session retakes unless a clean CloudShare-supported path is verified.
- Cohort session management lives inside the existing Exam admin flow as a child area of an Exam.
- Candidate browsing remains Exam-first. Available Cohort Exam Sessions appear as options inside the relevant Exam card rather than separate catalog items.
- Candidate-facing labels should describe the Candidate experience or value, not the internal delivery mode. Future labels may include proctored, AI-marked, instructor-reviewed, immediate start, scheduled window, price, voucher requirement, or credential value.
- Admin session detail is the first surface for Experience-scoped aggregate Guided Journey progress.
- Aggregate Guided Journey progress is admin-only in the first version.
- Aggregate Guided Journey progress is Experience-scoped and does not solve cross-Experience Guided Journey analytics by definition/version.
- Session close and retire are distinct actions. Close admission blocks new joins while preserving active attempts. Retire makes the session inactive/archived and may update the CloudShare Experience end time where verified.
- Published or consumed Cohort Exam Sessions should not be deleted as normal product behavior.
- CloudShare Experience deletion remains operator/demo cleanup only because it destroys or hides historical CloudShare evidence.
- Retire must check CloudShare participants and account for both participation status and environment status before warning the admin.
- Terminal environment states are treated as archived/deleted; other observed environment states require caution and support-visible diagnostics.
- External CloudShare calls remain behind typed integration interfaces. UI components do not call CloudShare directly.
- CloudShare behavior is mocked only at the integration boundary in automated tests.
- Supportability is part of the feature: publish, join, aggregate progress retrieval, close, and retire paths all need admin-visible diagnostics on success and failure.

## Testing Decisions

- Test through the highest useful seam: typed HTTP/API routes and framework-agnostic runtime handlers for create, publish, join, monitor, aggregate progress, close, and retire behavior.
- Existing CloudShare integration boundary tests are the model for adapter-level tests. Mock CloudShare only at that boundary.
- Existing exam scheduling, candidate lab, score retrieval, admin exam publishing, suspend/resume, heartbeat, and diagnostics tests are prior art for this feature.
- API/runtime tests should prove that publishing creates a shared on-demand Experience, persists identifiers, emits diagnostics, and surfaces failures without leaking credentials.
- Candidate join tests should prove that the portal creates an ExamAttempt, adds the Candidate to the existing Experience, creates the sponsored link at start time, and blocks overlapping active attempts.
- UI tests should focus on non-trivial state rendering and interactions: admin session creation/publish state, Candidate Exam card session options, session detail status, aggregate progress display, and retire warnings.
- Aggregate progress tests should validate the documented Experience-scoped response shape without inventing certification pass/fail scoring.
- Retire tests should prove the portal warns on in-progress participation or non-terminal environments before updating the CloudShare Experience end time.
- Diagnostics tests should cover both successful and failing CloudShare calls.
- UI path changes require browser smoke that exercises the changed controls and checks browser console output.
- Integration slices that create, update, or read real CloudShare Experiences require safe live E2E verification through the real UI where practical, using local live credentials and recording admin-visible diagnostic evidence.

## Out of Scope

- Sales enablement, demo, POC, and non-certification reusable lab delivery sessions.
- Preconfigured participant environments and prebuild orchestration.
- Fake sponsored-link login to pre-allocate environments.
- Participant delete/recreate flows for retakes.
- Temporarily toggling CloudShare's multiple-environments setting as part of first-version retakes.
- Same-session nth attempts unless a clean CloudShare-supported path is verified.
- Cross-Experience Guided Journey analytics grouped by Guided Journey definition/version.
- A portal-owned Guided Journey repository.
- Session-level Blueprint, Policy, Region set, Instructor, or Guided Journey overrides.
- Candidate-facing cohort aggregate score publication.
- Custom Certalis scoring, pass/fail normalization, weighting, or checkpoint-level scoring evidence beyond what CloudShare exposes.
- Deleting published or consumed Cohort Exam Sessions as normal product behavior.
- General instructor-led class delivery where all participants are expected to start at the same time.

## Further Notes

This PRD depends on several known CloudShare gaps and verification items:

- Experience delete-only cleanup and the possible `End = now` retirement path.
- Experience-scoped aggregate Guided Journey progress is available, but cross-Experience Guided Journey analytics remain a future request.
- CloudShare does not currently appear to provide controlled administrator-approved nth-environment admission inside one Experience.
- The exact create/update body for on-demand Experiences, optional `End`, and update-after-start behavior require live verification.
- Sponsored-link TTL should be verified, but the first-version design avoids early sponsored-link creation.

The feature should be delivered as deep vertical slices. Each slice should cut through schema,
domain/runtime handlers, API routes, UI, diagnostics, and tests enough to be independently demoable
or verifiable.
