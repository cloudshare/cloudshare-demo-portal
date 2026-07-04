# Codex handoff prompt — continue PR #261 (issue #257)

Copy everything below the line into Codex.

---

I'm handing you an in-progress GitHub PR that needs rework after failed human QA. Read `AGENTS.md`, `CONTEXT.md`, and `docs/requirements/prd-cloudshare-demo-portal-v2.md` in the repo root first — they're the source of truth for scope, domain vocabulary, and the branch/PR/review workflow this project requires. Follow that workflow exactly (branch naming, draft PR, lint/typecheck/test before requesting review, human QA required before merge for UI changes).

## Repo and branch

- Repo: `D:\Code_projects\cloudshare-demo-portal`
- Branch: `feature/issue-257-standardize-page-widths-margins` (already exists, already pushed)
- PR: [#261](https://github.com/swinster/cloudshare-demo-portal/pull/261), currently in **draft**, closes issue #257
- Issue #257 is "Standardize portal page widths and margins" — originally a narrow container-width fix, later expanded by the user mid-implementation to also cover general visual polish ("beautification") of the whole portal.

## What's already on the branch, and what happened

Two phases of work landed on this branch:

**Phase 1 (commit `e6914507`) — width standardization.** Added `src/web/page-shell.ts`, a shared 1120px-max-width page-container style, applied consistently to Admin Console, Candidate Home, Candidate Lab, and Candidate Score. **This phase was reviewed and is fine — do not revert it.**

**Phase 2 (commits `3846f1bb`..`8c7a7856`) — visual polish.** Added shared style-constant modules (`src/web/design-tokens.ts`, `src/web/button-styles.ts`, `src/web/card-styles.ts`, `src/web/status-badge.ts`), a `next/font/google` typography setup (Fraunces serif for headings + Manrope sans for body, in `app/layout.tsx` + `app/globals.css`), and applied all of that across Login, Register, Candidate Home/Lab/Score, and Admin Console (all 8 tabs, with a lighter "tokens only" pass on the denser tabs). This work passed automated tests (891/891), lint, typecheck, and multiple rounds of code review — but **failed human QA badly**. The user's verdict: "one of the worst makeovers I've seen," seriously considering junking it entirely.

**Design docs on the branch** (for context on what was attempted and why, but treat their conclusions as unproven given the QA result): `docs/plans/2026-07-03-portal-visual-polish-design.md`, `docs/plans/2026-07-03-portal-visual-polish-plan.md`.

## Actual human QA feedback (this is the real spec now — ignore the design docs' assumptions where they conflict with this)

Posted as a PR comment on #261 (`gh pr view 261 --comments` to read it verbatim), summarized here:

**General / cross-page:**
- The serif display font (Fraunces) is disliked. Drop it — go back to a plain sans-serif (system-ui or a single clean sans font, no serif).
- Header treatment is inconsistent: Candidate Home wraps its header (eyebrow label + title + description) in a bordered box; Candidate Score, Candidate Lab, and Admin Console do not. Pick one pattern — box everywhere, or box nowhere — and apply it consistently. (Candidate Home's version is the one the user likes.)
- The "Signed in as X / Log out" block differs in color and position across pages. Unify it.
- Section headers ("Metric tiles", "Step progress", etc.) have inconsistent/poor spacing throughout.

**Candidate Score page (`app/candidate/score/page.tsx`, `src/web/score-display.tsx`):**
- Missing eyebrow/caption above the "Session complete" heading.
- Missing the header box (see above).
- Action buttons inconsistent with other pages.
- **This is a functional fix, not cosmetic:** swap the primary headline metric from "X% complete" to **Pass rate**. CloudShare's "completion" only means time was spent in a section, not that its checks passed — a candidate can complete quickly without passing, or use the full time without engaging meaningfully. Guided Journey **pass rate** (based on actual checks) is what should be visually primary. The "X of N Guided Journey steps are marked explored or complete" line should be demoted or moved since its current prominence wrongly implies completion is the headline result. Check `src/domain/score-result.ts` / `ScoreResult` for the exact fields already available (a pass-rate-equivalent field may already exist, given "Passed rate 100%" is already rendered in one of the metric tiles — this may just be a layout/hierarchy change, not a new data requirement).
- Visible double borders and misalignment in and around the Result Summary metric tiles.

**Candidate Home page (`src/web/candidate-home.tsx`):**
- The header box treatment here is correct/liked — it's the standard to replicate elsewhere, not to change here.
- Large, apparently unintentional horizontal gap between the two scheduled-attempt cards — the grid/flex layout is wasting the widened 1120px container's space rather than filling it well.
- The long Exam description text inside a published-exam card is flagged as an area of poor space usage — look at that card's internal layout.

**Candidate Lab page (`src/web/candidate-lab-shell.tsx`):**
- No header box (see general note).
- Log out button inconsistent with other pages.
- "Current action" and "Launcher status" panels are near-duplicate information while the attempt is in "ready" state (before the lab is actually running) — reads fine once live, but redundant/confusing before that. Consider consolidating or differentiating them more when not yet launched.

**Admin Console — Session Monitoring tab (`src/web/session-monitoring-panel.tsx`, `src/web/admin-console.tsx`):**
- No header box (see general note).
- Tab navigation doesn't feel consistent with the rest of the app's chrome.
- "Refresh Monitoring" no longer reads as an obviously clickable button — a real regression from the styling pass (it was changed to `compactButtonStyle`, which is too subtle/outline-only here). Fix its affordance, and consider moving it below the status widgets.
- The Completed/Expired history list renders all entries (32 in the test data) as a flat undifferentiated list — flagged as unusable at real data volumes ("going to become ridiculous to view"). This needs pagination, a table, or collapsed grouping — independent of any color/token decisions.

## Your call to make

Given the severity of the feedback, seriously consider **reverting the visual-polish commits** (`3846f1bb`..`8c7a7856`, i.e. resetting the branch content back to `e6914507` for everything except issue #257's original width-standardization scope) and starting the visual-polish work fresh with much tighter incremental validation — e.g., get the user to confirm a *screenshot* of one representative page before applying the same pattern everywhere, rather than committing to a full plan based on abstract design-direction Q&A. The shared-module *architecture* (small typed style-constant files: tokens/buttons/cards/status-badge, following the existing `page-shell.ts` pattern) may still be sound — it's the *execution and taste* (serif font, inconsistent box treatment, spacing, button affordance) that failed, not necessarily the approach. Use your judgment on how much of Phase 2 is salvageable vs. worth rebuilding.

Whichever path you choose, this project's `AGENTS.md` requires: work on this exact branch (never on `main`), lint/typecheck/full test suite passing, a genuine browser smoke pass (not just screenshots — interact with the page, check console errors) before requesting review, and explicit human QA on `http://localhost:3000` before merge (this is user-visible UI work). Update the PR body and comment thread on #261 with what changed and why once you've made progress. Do not mark the PR ready-for-review until you're confident the specific feedback above has been addressed — the user has already rejected one "ready" version of this work and lost confidence as a result, so don't ask for another round of human QA until you're sure.
