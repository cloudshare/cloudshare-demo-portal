# Portal visual polish — design

**Date:** 2026-07-03
**Issue:** [#257](https://github.com/swinster/cloudshare-demo-portal/issues/257) "Standardize portal page widths and margins" (scope extended by the user during implementation to also cover visual polish, not just container widths)
**PR:** [#261](https://github.com/swinster/cloudshare-demo-portal/pull/261)

## Background

Issue #257 was originally scoped narrowly: unify inconsistent page container max-widths across Admin Console and Candidate pages (already implemented via `src/web/page-shell.ts`, see the first commit on this PR). The user then clarified the real intent of the issue is broader — the pages should also look polished/professional ("look really good"), not just share a consistent width.

## Direction

Confirmed with the user:

- **Visual direction:** clean, minimal enterprise SaaS look (Stripe/Linear-admin register) — refined neutral palette, generous whitespace, subtle borders/shadows, restrained accent color. Not a bold/branded redesign, not a maximally-dense operational look.
- **Implementation approach:** small, named, typed style-constant modules under `src/web/`, following the existing `page-shell.ts` / `candidate-home-layout.ts` pattern (plain `CSSProperties` objects + a colocated unit test). Explicitly not a UI component library, not Tailwind, not a theme provider/design system.

## Scope

In scope:

- Login (`app/login/login-form.tsx`) and Register (`app/register/register-form.tsx`) — currently unstyled forms with a native browser button and no card treatment. Included so the first-impression pages aren't a visibly unfinished corner of an otherwise-polished portal.
- Admin Console, all 8 tabs (`src/web/admin-console.tsx` and its sub-components: `session-monitoring-panel.tsx`, `diagnostic-log-table.tsx`, `event-log-table.tsx`, `monitoring-attempt-details.tsx`).
- Candidate Home, Candidate Lab, Candidate Score (`src/web/candidate-home.tsx`, `src/web/candidate-lab-shell.tsx`, `src/web/score-display.tsx`, `app/candidate/score/page.tsx`).

Out of scope:

- The internal `/demo` tooling page (`app/demo/page.tsx`) — not user-facing, not part of the Admin/Candidate portal experience.
- Any product/business behavior: scheduling logic, CloudShare integration behavior, data models, entitlement, timers. This is a pure presentational change.
- Domain vocabulary/copy — unchanged.

## New shared style modules (`src/web/`)

1. **`design-tokens.ts`** — the single source of truth for the palette, spacing scale, radius scale, and shadow used everywhere else. Named color roles (surface, surface-muted, border, text-primary, text-muted, accent, and status colors for scheduled/ready/in-progress/suspended/completed/expired/error/warning) rather than hand-copied hex values.
2. **`button-styles.ts`** — `primaryButtonStyle`, `secondaryButtonStyle`, `dangerButtonStyle` style objects, replacing the dozen-plus slightly different ad hoc inline button styles currently scattered across Login, Admin Console, Candidate Home, and Candidate Lab.
3. **`card-styles.ts`** — one consistent panel/card treatment (border, radius, subtle shadow, background), replacing near-duplicate `{border: "1px solid #d9e2ec", borderRadius: "8px", ...}`-shaped blocks repeated across files.
4. **`status-badge.ts`** — a small color-coded pill style/helper for ExamAttempt and Exam statuses (Scheduled/Ready/In Progress/Suspended/Completed/Expired), used in Candidate Home and Session Monitoring in place of plain text.
5. **`app/globals.css`** (new, minimal) — font smoothing plus `:hover`/`:focus-visible` states for buttons, tabs, and links. This is the one piece that has to be real CSS rather than inline styles, since inline `style` objects cannot express pseudo-classes and today's buttons/tabs give no interaction feedback at all.

Each new style-constant module gets a colocated `*.test.ts` in the same style as `page-shell.test.ts` — asserting on the meaningful style properties (e.g., that status colors are distinct, that button styles set expected padding/radius/color), not pixel/visual snapshots.

## Per-page treatment

- **Login / Register:** wrap the form in the new card style, apply `primaryButtonStyle` to the submit button, tighten vertical rhythm with the shared spacing scale.
- **Admin Console:** apply the card style to each tab's section panels, `primaryButtonStyle`/`secondaryButtonStyle` to actions (Save Connection, Test Connection, Publish, etc.), `status-badge` styling in Session Monitoring's queues and history rows, and a consistent eyebrow-label section header treatment per tab (matching the pattern Candidate Home already uses for "SCHEDULED ATTEMPTS" / "PUBLISHED EXAMS").
- **Candidate Home / Lab / Score:** already closest to the target look today; adopt the same tokens/buttons/cards/badges for full consistency with the rest of the portal, and apply status-badge styling to attempt status text.

## Testing

- New style-constant modules: unit tests following the existing `page-shell.test.ts` pattern.
- No new behavioral tests are needed — this is a presentational-only refactor of already-tested components; existing component tests (state/logic) must keep passing unchanged.
- `npm run lint`, `npm run typecheck`, `npm test` all re-run before requesting review.
- Browser smoke on an agent-owned port: Login, Register, Admin Console (all 8 tabs, esp. Session Monitoring), Candidate Home, Candidate Lab, Candidate Score — desktop and mobile widths, console-clean, following the same process used for the width-only pass earlier on this PR.

## Explicitly not doing

- No UI component library, no Tailwind, no CSS-in-JS framework, no theme provider.
- No changes to scheduling logic, CloudShare integration behavior, data models, entitlement, or domain vocabulary/copy.
- No dark mode (not requested; out of scope).
