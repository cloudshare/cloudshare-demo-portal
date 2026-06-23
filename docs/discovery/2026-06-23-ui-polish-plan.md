# UI Polish Plan - Admin and Candidate Surfaces

**Date:** 2026-06-23
**Scope:** planning only. No product behavior changes in this document.

## What this is

This is the planning slice for issue #99. It audits the current admin and candidate surfaces, separates
visual/information-hierarchy work from functional bugs, and turns the result into an ordered backlog.

## What this is not

- Not a redesign.
- Not a CloudShare integration change.
- Not a product-behavior change.
- Not a duplicate of the functional follow-ups already tracked in #103 and #104.

## Functional follow-ups kept separate

The audit found two live issues that should stay out of this polish backlog:

- #103 covers overlapping candidate attempts for the same exam.
- #104 covers the CloudShare suspend / resume 500 gap during rapid transitions.

Those are behavior and integration follow-ups, not UI polish slices.

## Audit summary

The current portal is usable, but several high-frequency workflows are harder to scan than they need
to be:

- Session Monitoring shows the right data and actions, but the summary strip, queue/history split,
  and attempt cards read as flat and take longer to parse.
- Support Diagnostics has the correct evidence, but the filter panel and diagnostic rows are dense,
  which slows forensic work.
- The admin shell exposes the right tabs, but the support-related journey is not visually cohesive
  enough to guide operators from monitoring into diagnostics and back.
- Candidate home puts scheduling, readiness, and return-to-exam actions in the same visual weight,
  which makes the landing page harder to scan.
- Candidate lab and score pages are working wrappers, but the status, recovery, and completion
  frames are too generic for the highest-stress moments in the flow.

## Ordered backlog

1. **Admin: Session Monitoring scanability**
   Preserve the current data and actions, but improve the status strip, queue/history separation,
   and attempt-card scanability so the live operational view is easier to read quickly.
   **Smoke:** `/admin?tab=monitoring` on desktop and mobile; active queue/history screenshots;
   empty-state screenshot; no overlap or clipping.

2. **Admin: Support Diagnostics table ergonomics**
   Keep the current filter semantics and evidence model, but make the investigative filter panel and
   diagnostic rows easier to scan, including expanded evidence order and drilldown hints.
   **Smoke:** `/admin?tab=diagnostics&examAttemptId=...` and `&correlationId=...`; expand a row;
   desktop and narrow viewport overflow / wrapping checks.

3. **Admin: Console navigation and support workflow context**
   Make the active tab and support-oriented context obvious in the shell so Session Monitoring and
   Support Diagnostics read as one support workflow without changing routing or state behavior.
   **Smoke:** `/admin`, `/admin?tab=monitoring`, `/admin?tab=diagnostics`; verify active tab,
   content, and preserved switching state.

4. **Candidate: Home layout and hierarchy**
   Split the candidate landing page into clearer sections for account/header, scheduled attempts, and
   published exams so the primary scheduling and launch actions are easier to find.
   **Smoke:** `/candidate` with no exams/loading; `/candidate` with published exams and
   scheduled/ready/completed attempts; 390px and 1440px screenshots.

5. **Candidate: Lab shell status and recovery clarity**
   Add a tighter summary frame for attempt identity, timing, and recovery state so launch, resume,
   suspend, and error states are easier to understand without changing behavior.
   **Smoke:** lab page in ready, in_progress, suspended, and completed states; popup-blocked and
   open-failed presentation; mobile wrapping; desktop header/status/launcher cohesion.

6. **Candidate: Session complete / score page polish**
   Improve the completion shell and score summary composition so the end-state metrics and
   limitations are more legible while keeping the same retrieval behavior.
   **Smoke:** score available; no score; API error state; mobile stacking; desktop metric alignment.

## Implementation order

Do the admin monitoring slice first because it is the most operationally dense and gives the best
support-work baseline. Follow with diagnostics, then the console context slice, then the candidate
home, lab, and score slices in that order so the candidate journey is refined from the entry page to
the end-state pages without broadening scope into unrelated behavior changes.
