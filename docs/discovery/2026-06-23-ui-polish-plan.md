# UI Polish Plan — Admin and Candidate Surfaces

**Date:** 2026-06-23  
**Scope:** planning only. No product behavior changes in this document.

## What this is

This is a narrow UI polish backlog for issue #99. It keeps the current functional flow intact and
focuses on layout, hierarchy, and responsive clarity.

## What this is not

- Not a redesign.
- Not a CloudShare integration change.
- Not a fix for functional bugs such as overlapping attempts (#103) or the CloudShare suspend /
  resume gap (#104).

## Observed pain points

- Admin support work is functional, but the diagnostics page is dense and the current context is too
  easy to miss when a drilldown changes filters or opens a deeper view.
- Wide admin tables are acceptable on desktop, but they read as heavy and cramped on smaller
  screens.
- Candidate home is usable, but published exams and scheduled attempts sit at the same visual
  weight.
- Candidate lab and score pages are sparse wrappers around working features; they need a clearer
  attempt frame and stronger action grouping.

## Ordered slices

1. **Admin diagnostics frame and table density**
   Make the active investigation context obvious at the top of the Diagnostics tab, keep the primary
   Diagnostic Log visually dominant, and make the legacy/raw evidence area secondary.  
   **Smoke:** 1440px desktop and 390px mobile; confirm drilldowns still land on the same filtered
   view and tables still overflow intentionally rather than breaking layout.

2. **Candidate home hierarchy**
   Tighten the exam cards and scheduled-attempt section so the candidate can scan status, timing, and
   the primary action faster.  
   **Smoke:** wide and narrow viewport; confirm schedule, enter/resume, and score actions still
   route exactly as before.

3. **Candidate lab and score framing**
   Add a stronger attempt header and action grouping to the dedicated lab and score pages without
   changing the child-window flow or score content.  
   **Smoke:** open a lab attempt, confirm the attempt identity/state is clear, then open the score
   page and confirm the same attempt framing remains visible.

4. **Shared responsive panel behavior**
   Normalize the spacing and panel treatment used by dense admin/candidate surfaces so desktop views
   feel less empty while small screens stay readable.  
   **Smoke:** verify the common panel/table patterns still fit within the viewport and do not create
   horizontal clipping beyond the intended table overflow.

## Implementation order

Do the admin diagnostics slice first, then the candidate home slice, then the lab/score slice, and
leave shared responsive cleanup last unless one of the earlier slices needs a tiny reusable helper.

