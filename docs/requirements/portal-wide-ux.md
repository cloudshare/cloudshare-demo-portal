# Certalis Portal-Wide User Experience

**Status:** Agreed specification
**Source:** Wayfinder map [Discover and simplify the portal-wide Certalis user
experience](https://github.com/swinster/cloudshare-demo-portal/issues/366), resolved by
issues
[374](https://github.com/swinster/cloudshare-demo-portal/issues/374),
[375](https://github.com/swinster/cloudshare-demo-portal/issues/375),
[376](https://github.com/swinster/cloudshare-demo-portal/issues/376),
[377](https://github.com/swinster/cloudshare-demo-portal/issues/377), and
[378](https://github.com/swinster/cloudshare-demo-portal/issues/378).

This specification records the agreed destination. It does not authorize production
implementation or change the CloudShare, security, diagnostic, or domain contracts cited below.
Future implementation must be split into independent vertical tracer-bullet tickets.

## Problem Statement

The portal has accumulated working Customer administration, Sales Enablement, and Candidate
delivery workflows, but its navigation and operational presentation reflect implementation order
more than operator frequency. The Certalis Sales Admin workspace is especially difficult to scan:
Session provisioning and routine management compete for space, operational and provider states can
look interchangeable, participant operations are dense, and refresh feedback can make a live page
appear inert.

The portal needs one durable UX contract that makes frequent work fast without flattening the
different responsibilities of a Certalis Sales Admin, Helios Admin, or Candidate. It must preserve
Customer isolation, documented CloudShare behavior, server-owned entitlement and timing, protected
diagnostic confinement, and accepted workflows while giving future implementation agents
verifiable interaction and testing targets.

## Solution

The portal keeps distinct role workspaces and applies a small set of shared interaction rules
instead of imposing one identical shell.

The Certalis Sales Admin workspace becomes the deep operational model. It uses persistent left
navigation with **Sessions**, **Relationships**, **Items**, and **Support**, with Sessions as the
default. Sessions opens a desktop workbench for a paginated, route-backed operational queue.
Selecting a Session opens a dedicated route-backed Session workspace whose full-width local areas
are **Participants** (default), **Activity**, and **Details**.

The workbench separates three purposes:

- **Active** is the default operational queue and includes Upcoming (`notStarted`) and In progress
  (`inProgress`) CloudShare Sales Experiences together.
- **Needs attention** contains real, entity-specific Session-operation or Participant Environment
  problems. It does not include ordinary refresh failures.
- **History** contains Ended Sales Experiences and preserves access to historical context.

Participants are managed in a dense whole-row table with a persistent inspector. The Participant,
not a cell, is the focus and selection unit. Routine valid actions remain visible, secondary actions
are compact, bulk actions explain eligibility, and destructive or exceptional actions are separated
and consequence-confirmed.

Helios Admin adopts compatible persistent navigation around its existing workflows. Candidate
retains a simpler, guided, task-focused shell. All roles share route-backed location, deterministic
dates, understandable freshness, durable contextual feedback, explained unavailable actions,
visible focus, predictable keyboard behavior, and usable smaller-screen reflow.

## User Stories

### Certalis Sales Admin

1. As a Certalis Sales Admin, I want Sessions to be my default destination, so that routine
   operational work does not begin in setup.
2. As a Certalis Sales Admin, I want persistent access to Sessions, Relationships, Items, and
   Support, so that I can move between frequent destinations without losing orientation.
3. As a Certalis Sales Admin, I want Provision to remain separate from the normal Sessions queue,
   so that creation work does not crowd routine management.
4. As a Certalis Sales Admin, I want Active to show Upcoming and In progress Sessions together, so
   that normal work is visible in one queue.
5. As a Certalis Sales Admin, I want Ended Sessions in History, so that operational scanning is not
   dominated by completed work.
6. As a Certalis Sales Admin, I want Needs attention to identify the affected Session or
   Participant and explain the reason, so that unlike states are not collapsed into one warning.
7. As a Certalis Sales Admin, I want Account, Opportunity, and search filters to apply within the
   chosen queue view, so that results remain predictable.
8. As a Certalis Sales Admin, I want queue filters, pagination, scroll, selection, and focus
   restored after returning from a Session, so that investigation does not reset my work.
9. As a Certalis Sales Admin, I want a Session summary to separate name and revision, time window,
   Certalis operation, and CloudShare state/source/freshness, so that each fact can be scanned.
10. As a Certalis Sales Admin, I want stale provider state refreshed through a bounded list
    operation, so that the queue stays useful without one CloudShare call per row.
11. As a Certalis Sales Admin, I want one durable Retry/Support warning when a queue refresh fails,
    so that stored information remains usable without creating false row attention.
12. As a Certalis Sales Admin, I want an explicit Verify now action for one Session, so that I can
    investigate a specific state without refreshing unrelated Sessions.
13. As a Certalis Sales Admin, I want Participants to open as the default full-width Session area,
    so that dense participant work is not confined to a narrow column or modal.
14. As a Certalis Sales Admin, I want Activity and Details alongside Participants within the
    selected Session, so that local context does not become global navigation.
15. As a Certalis Sales Admin, I want to search a Session's Participants by name or email through a
    bounded Customer-scoped read, so that large rosters remain operable.
16. As a Certalis Sales Admin, I want the whole Participant row to be the selection unit, so that
    selection does not depend on spreadsheet-style cell focus.
17. As a Certalis Sales Admin, I want click, Ctrl/Cmd-click, Shift-click, page selection, and an
    explicit all-matching action, so that selection scope is deliberate across pagination.
18. As a keyboard user, I want row navigation, range selection, inspector entry, action traversal,
    and focus return to be predictable, so that I can operate the table without a pointer.
19. As a Certalis Sales Admin, I want one valid state-dependent primary action visible for a
    Participant, so that the next routine action is clear.
20. As a Certalis Sales Admin, I want secondary actions such as View Activity and Open Diagnostics
    in the inspector or a compact menu, so that the table remains dense but complete.
21. As a Certalis Sales Admin, I want bulk actions to state which selected Participants are eligible
    and why others are excluded, so that partial operations do not surprise me.
22. As a Certalis Sales Admin, I want native Invite and Resend to remain explicit actions, so that
    creating or editing a Session never silently sends communication.
23. As a Certalis Sales Admin, I want participant-specific instant-launch actions to remain
    revocable, window-gated, audited, and just-in-time, so that bearer access is controlled.
24. As a Certalis Sales Admin, I want participant progress and results near the affected row and
    inspector, so that feedback is attributable.
25. As a Certalis Sales Admin, I want bulk progress and results in the bulk-action bar, so that I
    can distinguish aggregate work from a single Participant action.
26. As a Certalis Sales Admin, I want important results to remain visible after a toast disappears,
    so that transient feedback is never the sole record of required action.
27. As a Certalis Sales Admin, I want readable Activity summaries linked by correlation ID to
    Support Diagnostics, so that ordinary work stays safe while forensic evidence remains reachable.

### Helios Admin

28. As a Helios Admin, I want persistent navigation among Connection, Exam catalog, Candidates,
    Individual and Cohort delivery, Session Monitoring, Support Diagnostics, and Audit, so that
    existing workflows are easier to reach without changing their domain meaning.
29. As a Helios Admin, I want Session Monitoring, Support Diagnostics, and Audit to remain distinct,
    so that current state, forensic evidence, and actor changes answer different questions.
30. As a Helios Admin, I want project-first Exam authoring and inherited Cohort configuration
    preserved, so that navigation improvements do not redesign accepted authoring contracts.
31. As a Helios Admin, I want failures to show safe, durable guidance and a correlation path to
    Customer-scoped Support Diagnostics, so that I can investigate without exposing protected data.

### Candidate

32. As a Candidate, I want a simple task-focused shell, so that administrative density does not
    enter the registration, scheduling, joining, or Lab experience.
33. As a Candidate, I want my current ExamAttempt and next valid action to be route-backed and
    understandable, so that reload and back navigation preserve orientation safely.
34. As a Candidate, I want unavailable actions to explain timing or eligibility without exposing
    protected details, so that server-owned rules are understandable.
35. As a Candidate, I want scheduling, enter, resume, suspend, complete, and optional score
    presentation to preserve their existing lifecycle, so that UX work does not change delivery.
36. As a Candidate, I want status and time feedback to be accessible and durable, so that I do not
    depend on color, motion, or a disappearing toast.

### Shared support, accessibility, and security

37. As an operator, I want displayed dates in deterministic ISO-style order with explicit
    timezone/reference context where ambiguity matters, so that times are comparable.
38. As an operator, I want visible refresh progress with equivalent screen-reader text, so that
    asynchronous work never makes the page appear inert.
39. As an operator, I want unavailable actions explained and destructive or exceptional actions
    separated and confirmed, so that consequences are clear.
40. As a keyboard user, I want semantic navigation, controls, alerts, dialogs, tables, and reliable
    focus return, so that every task remains operable without a pointer.
41. As a smaller-screen user, I want navigation, toolbars, tables, bulk controls, and inspectors to
    reflow or remain independently reachable, so that essential actions are not clipped or trapped.
42. As a Customer admin, I want all reads, writes, connections, Audit, and diagnostics scoped to my
    Customer, so that one Customer cannot discover another Customer's data.
43. As a support operator, I want authorized Customer-scoped Support Diagnostics to retain the
    complete protected evidence contract, so that provider failures remain diagnosable.
44. As any ordinary portal user, I want ordinary screens and APIs to expose only controlled
    metadata and correlation, so that protected evidence cannot leak into browser or client state.

## Implementation Decisions

### Role workspaces and navigation

- Keep Customer-configured workspace routing from ADR-006. Do not introduce a unified portal shell,
  a brand-name routing exception, a new Sales role, or cross-Customer administration.
- The Certalis Sales Admin desktop left navigation is Sessions, Relationships, Items, and Support.
  Sessions is the default. Provision is a Sessions action/view, not a primary global destination.
- The Session workspace is a dedicated route. Participants is its default full-width local area;
  Activity and Details are sibling local areas. The complete Participant workspace must not be a
  modal, side sheet, or narrow workbench column. Those containers are reserved for bounded tasks.
- Helios Admin uses persistent left navigation but retains its existing certification
  destinations and domain contracts. Candidate retains a lower-density, task-focused shell.
- Current location and meaningful view state belong in route/query state. Ephemeral visual state
  may remain local, but back/forward navigation must restore valid queue filters, page, scroll,
  selection, and focus. Missing, archived, or stale targets fail safely with an explanation.

### Queue, attention, and history

- Active combines CloudShare Sales Experience `notStarted` and `inProgress`; History contains
  `ended`. These are Experience views, not Certalis operation values.
- Needs attention includes genuine Session-operation or Participant Environment exceptions. Every
  entry names the affected entity, status dimension, and actionable reason.
- A list refresh failure is page-level durable feedback with Retry and Support paths. It retains the
  last safe stored result and never manufactures row-level Needs attention.
- Account and Opportunity filtering is repository-backed at the target scale. Search, filters,
  sort, and pagination are Customer-scoped, bounded, route-backed, and non-enumerating.
- The target operating scale is 200–500 Sessions with multiple Participants. Queue and search
  interfaces must not require loading every Session or Participant into the browser.

### Session summary, freshness, and refresh

- Queue summaries use responsive lines or fields for Session name/revision, time window, Certalis
  operation, CloudShare Experience state, and source/freshness. They must not collapse these into an
  ambiguous sentence.
- A verified CloudShare Experience observation is fresh for five minutes. When it is stale or
  absent, the UI may show a schedule-derived estimate only when labelled in plain language, such as
  “Estimated from the Session schedule — not recently confirmed with CloudShare.”
- Cheap portal-list polling and provider-observation freshness are separate concepts. Re-reading
  the local API does not make a CloudShare observation fresh.
- Automatic stale refresh is bounded, filtered, and paginated behind one local module interface.
  Its CloudShare adapter uses the documented filtered Sales Experience list contract. It must not
  issue one provider read per rendered row or expose provider endpoint/wire details to UI callers.
- One Session retains an explicit Verify now operation using the documented single-Sales-Experience
  read. The sticky Session toolbar contains source/freshness, automatic refresh progress, Verify now,
  and durable refresh failure feedback.
- Refresh feedback includes visible progress and a semantic status message. Announcements do not
  steal focus.

### Status dimensions and CloudShare constraints

- Keep these dimensions independent in domain, API, filters, UI labels, and tests:
  1. Certalis Session operation: `provisioning`, `correlated`, or `needs_attention` with reason.
  2. CloudShare Sales Experience: `notStarted`, `inProgress`, or `ended`, with source/freshness.
  3. Participant Environment state, with its own source and correlation exception.
- Schedule prediction never becomes a verified provider state. Participant Environment state never
  becomes a Session operation state. “Needs attention” never acts as a union of unrelated enums.
- Use only documented CloudShare paths, fields, pagination, and enums through typed adapters.
  Provider identifiers and roster Environment references remain server-only unless an existing
  controlled projection explicitly permits them.
- Preserve per-Customer encrypted CloudShare Connections and instantiate clients at call time.
- Preserve explicit Sales creation semantics: one Item, ordered Blueprints, Policy, eligible
  Regions, start/end plus named CloudShare timezone, fresh Project-member selection,
  registered-participants-only, and no implicit invitation.
- Preserve Candidate delivery semantics: server-recomputed entitlement, server-only sponsored
  `loginUrl` behind the time-gated 302, portal-owned persisted clock, polling/reconciliation as
  truth, and webhooks as optional hints.
- Preserve the three Exam clocks from ADR-005: runtime lease, authored open period, and storage
  lease. UX labels must not collapse them.
- Do not invent generic Guided Journey discovery or undocumented provider capabilities.

### Participant table, inspector, actions, and keyboard

- The Participant is the unit of active focus and selection. Interactive controls within a row
  remain operable without turning every cell into a spreadsheet focus stop.
- Pointer selection: click selects a row; Ctrl/Cmd-click toggles non-contiguous rows; Shift-click
  extends from the selection anchor; the header selects the current page. Selecting all matching
  results across pagination is a distinct, confirmed follow-up action whose scope is stated.
- Keyboard interaction when the table owns focus:
  - Up/Down moves the active Participant row without changing selection.
  - Space toggles the active row.
  - Shift+Space extends selection from the anchor through the active row.
  - Enter opens or focuses the persistent inspector for the active Participant.
  - Tab moves through inspector controls in document order.
  - Escape closes/leaves a menu or inspector interaction and returns focus to the originating row.
- Row action controls must not duplicate the row's focus semantics. Space/Enter on an actual button
  activates that button; table shortcuts apply only when focus is on the row interaction target.
- Selection, active row, total matching scope, bulk eligibility/exclusions, loading, errors, and
  results have semantic names. Selection is not conveyed by color alone.
- One valid state-dependent primary action is visible in the row or inspector. Secondary actions,
  including View Activity and Open Diagnostics, use the inspector or a compact keyboard-operable
  menu. Invalid lifecycle actions are hidden or disabled with an accessible explanation.
- Eligible bulk actions appear in a contextual bulk-action bar. The bar states selected, eligible,
  and excluded counts and makes exclusion reasons available before execution.
- Destructive or exceptional actions are visually and semantically separated and require a
  consequence-specific confirmation. Dialogs contain focus and return it to the invoking control.
- Participant-specific progress, error, and result feedback stays in the affected row/inspector.
  Bulk feedback stays in the bulk bar. Toasts may acknowledge but never replace durable feedback.

### Activity, diagnostics, and ordinary surfaces

- Session Activity is a readable operational summary. It may expose safe operation, outcome,
  timestamps, actor/subject metadata, safe identifiers, and correlation ID, then link to authorized
  Support Diagnostics. It does not copy protected evidence into the Session workspace.
- Session Monitoring answers “what is happening now”; Support Diagnostics answers “what happened
  and in what order”; Audit answers “who changed what.” Navigation and labels preserve this split.
- Authorized Customer-scoped Support Diagnostics retain request/query and provider-response bodies
  verbatim under ADR-004, including credential-like body values and sponsored links. Request headers
  expose only the explicit operational allowlist; all other named or unparseable headers are masked.
- Same-Customer ordinary Event Log, Activity, Audit, generic logs, Candidate/Participant UI,
  ordinary APIs, and browser state/console receive metadata-only, fail-closed projections with
  correlation ID. Another Customer receives no record or projection. Unknown or unscoped evidence
  is not rendered.
- Client code must never receive protected evidence merely to decide whether to display it.
  Authorization, Customer scoping, and projection happen at the server-enforced interface.

### Dates, timezones, cache, and copy

- Display dates in deterministic `YYYY-MM-DD...` order. Label UTC or another reference timezone
  explicitly whenever omission could change interpretation.
- Sales start/end retain CloudShare wall-clock values plus the named timezone; presentation must not
  silently reinterpret them as browser-local instants.
- Candidate date formatting remains deterministic. Add timezone context where ambiguity matters
  without redesigning the Candidate workflow.
- Use plain language for cache/source state. Avoid internal jargon such as “schedule prediction; no
  fresh provider read” or presenting local polling as provider verification.

### Accessibility and smaller screens

- Use semantic landmarks and headings, labelled controls, status/alert regions, visible focus,
  programmatic names, and non-color status cues. Preserve established combobox
  Arrow/Home/End/Enter/Escape behavior.
- Route changes place focus at a useful destination without unexpectedly stealing it during refresh.
  Returning to a queue restores focus to the originating Session when still valid.
- Sticky controls must not obscure focused content. Motion respects reduced-motion preferences.
- Desktop density is intentional; mobile optimization is not. At constrained widths, navigation,
  sticky toolbar, table, bulk bar, and inspector must stack, collapse, scroll, or become separately
  reachable without clipping essential actions, overlapping content, creating a keyboard trap, or
  requiring pointer-only horizontal access.
- A horizontally scrollable table is permitted when comparison remains valuable, but row identity,
  selection, primary action, and inspector access must remain discoverable and keyboard reachable.

### Module interfaces and seams

- Keep the typed, framework-agnostic `src/api/*` handler seam as the primary acceptance surface.
  React drives handlers through typed HTTP routes and never calls CloudShare or persistence directly.
- Keep Session queue/search/filter/pagination and queue restoration behind a Customer-scoped local
  read-model interface. Its implementation owns repository-backed Account filtering and bounded
  pages.
- Introduce or deepen one bounded Session-refresh module interface rather than distributing refresh
  orchestration through rows. The interface returns safe Session observations plus batch-level
  progress/failure information; the CloudShare Sales adapter remains internal to its implementation.
- Keep Participant operations behind handler/domain interfaces that return per-Participant
  eligibility, safe results, and correlation metadata. Bulk orchestration consumes those interfaces
  and reports partial eligibility deliberately.
- Keep protected diagnostics behind the existing server-enforced Customer-scoped diagnostic
  interface and ordinary metadata behind its fail-closed projection interface.
- Prefer tests at the highest stable interface. Do not expose provider wire contracts, persistence
  layout, or React state machinery solely to make them testable.

## Acceptance Criteria

### Navigation and route state

- [ ] A Certalis Sales Admin lands on Sessions and can reach Relationships, Items, and Support from
  persistent left navigation.
- [ ] Provision remains reachable from Sessions but is not the normal management landing surface.
- [ ] Selecting a Session opens a dedicated URL whose default local area is Participants and whose
  sibling areas are Activity and Details.
- [ ] Browser back/forward restores valid view, filters, search, page, scroll, selection, and focus;
  a no-longer-valid target produces an explained safe state.
- [ ] Helios Admin's accepted workflows remain reachable without merging their semantics, and
  Candidate remains a simpler task-focused shell.

### Queue and refresh

- [ ] Active returns Upcoming and In progress together; History returns Ended; Needs attention
  contains only real entity-specific exceptions with dimension and reason.
- [ ] Search/filter/sort/page state is URL-backed, Customer-scoped, bounded, and tested at 200–500
  Session scale with multiple Participants.
- [ ] Queue refresh uses bounded filtered/paginated list behavior and automated tests prove it does
  not issue a provider call per rendered row.
- [ ] A provider refresh failure retains stored rows and shows one durable page-level Retry/Support
  warning without changing row attention.
- [ ] Five-minute provider freshness, stale schedule estimate, local polling, refresh progress, and
  single-Session Verify now are distinguishable in accessible plain language.

### Participant operation

- [ ] Pointer and keyboard tests cover whole-row selection, toggle, range extension, current-page
  selection, explicit all-matching selection, inspector entry, action traversal, and focus return.
- [ ] Tests distinguish a row interaction target from controls inside the row, so Space/Enter never
  ambiguously both select and invoke an action.
- [ ] The inspector exposes the selected Participant, one valid primary action, compact secondary
  actions, explained unavailable actions, and participant-scoped durable feedback.
- [ ] Bulk controls state selected/eligible/excluded scope before execution and retain durable
  aggregate progress and results.
- [ ] Destructive/exception actions are separated, consequence-confirmed, keyboard operable, and
  return focus to their invoker.

### Status, security, and integration

- [ ] Domain/handler/UI tests independently assert Certalis operation, CloudShare Experience, and
  Participant Environment status/source and prove no union or fallback collapses them.
- [ ] Activity and same-Customer ordinary APIs contain controlled metadata and correlation ID only;
  negative tests prove protected bodies, disallowed headers, sponsored links, tokens, and unsafe
  provider references such as roster Environment references do not reach ordinary browser/client
  surfaces, while cross-Customer reads return no record.
- [ ] Authorized Customer-scoped Support Diagnostics preserve the ADR-004 body and header contract;
  cross-Customer and non-admin reads fail closed.
- [ ] UI code has no CloudShare calls or provider endpoint knowledge. Adapter contract tests cover
  the documented list and single-Session read shapes used by refresh and verification.
- [ ] Candidate entitlement, 302 sponsored-link confinement, clock behavior, polling truth, webhook
  hint behavior, and the three Exam clocks retain their existing automated coverage.

### Accessibility, responsive behavior, and QA

- [ ] Automated browser interaction covers every changed control, including route navigation,
  filters, refresh/Verify now, row and bulk selection, inspector/menu/dialog actions, and error
  recovery; screenshots or DOM-presence assertions alone do not satisfy this criterion.
- [ ] Browser QA records console errors and warnings and accepts no unexplained new output.
- [ ] Keyboard-only QA completes the queue-to-Participant-action flow with visible focus, semantic
  status/alerts, predictable announcements, and correct focus return.
- [ ] Screen-reader-oriented assertions cover names, state, counts, progress, durable results, and
  non-focus-stealing announcements.
- [ ] Human QA exercises representative desktop and constrained-width layouts. Essential navigation,
  selection, primary/bulk actions, feedback, and inspector access remain usable without clipping,
  overlap, or keyboard traps.
- [ ] Dates and times use deterministic ISO-style presentation and explicitly communicate relevant
  UTC, named CloudShare timezone, or other reference context.

### Completion evidence for future implementation tickets

- [ ] Each user-visible ticket records lint, typecheck, automated test, changed-path browser
  interaction, console, and focused human-QA evidence on the PR.
- [ ] Each ticket that changes active CloudShare behavior separately records automated verification
  and live end-to-end UI verification against the real tenant, including support diagnostics in the
  real failure path, as required by `AGENTS.md`.
- [ ] Refactor-only tickets may omit human QA only under the documented behavior-preserving rule and
  must record the concrete smoke evidence and reason.

## Testing Decisions

A good test observes behavior through the highest stable interface: route/query restoration,
Customer-scoped handler results, domain status projection, adapter request/response mapping, or an
exercised browser interaction. It does not assert React implementation details or add shallow
interfaces only for tests.

- **Domain:** test the three status dimensions, five-minute freshness, schedule-estimate fallback,
  attention classification, action eligibility, and selection/bulk invariants without framework
  imports.
- **API handlers:** test Customer-scoped queue/filter/search/page contracts, Session workspace reads,
  refresh/Verify now, Participant actions, partial bulk eligibility/results, safe error contracts,
  and diagnostic links. These are the primary acceptance seam.
- **Persistence:** test repository-backed Account/Opportunity filtering, bounded pagination, stable
  ordering, selection targets across data changes, and Customer isolation against SQLite.
- **CloudShare Sales adapter:** stub HTTP only at the integration seam. Contract-test documented
  filtered list and single-Session requests, typed enums, pagination, malformed/partial responses,
  timeouts, and evidence capture.
- **Diagnostics:** test authorized protected evidence and ordinary fail-closed projection separately,
  including negative leakage and cross-Customer cases.
- **Web/browser:** test route navigation and restoration, accessible refresh feedback, full
  Participant keyboard/pointer behavior, inspector and bulk actions, durable failure/result
  presentation, dialogs, constrained widths, and console output.
- **Regression:** preserve existing tests for workspace routing, Sales records, Sales Session
  provisioning/management, Participant search/invite/instant launch, Helios administration,
  Candidate delivery, entitlement, sponsored redirects, monitoring, Support, and Audit.
- **Prior art:** follow the existing framework-agnostic handler, domain, CloudShare adapter,
  SQLite-repository, and browser interaction suites. Do not replace accepted handler coverage with
  UI-only tests.

## Out of Scope

- Production implementation, production UI changes, live CloudShare calls, and tracer-bullet ticket
  creation in this specification task. Ticket creation belongs to the next Wayfinder frontier.
- A unified shell or merged role model; Certalis provider-admin UI; a new Sales role; Customer
  onboarding; multi-Customer management; or a workspace chooser for `both`.
- Mobile-first design or product-level mobile optimization. Usable and accessible constrained-width
  behavior remains required.
- Redesigning CloudShare endpoint semantics, status enums, timing semantics, invitation behavior,
  provider capability discovery, diagnostics security, or Customer isolation.
- Scheduled invitation delivery, tracked independently by
  [#365](https://github.com/swinster/cloudshare-demo-portal/issues/365).
- Contact-to-Participant reconciliation, tracked independently by
  [#361](https://github.com/swinster/cloudshare-demo-portal/issues/361).
- Direct Item list Edit/Archive and explicit fresh-detail loading regressions, tracked independently
  by [#358](https://github.com/swinster/cloudshare-demo-portal/issues/358).
- Sales Session extension and cancellation behavior, tracked independently by
  [#350](https://github.com/swinster/cloudshare-demo-portal/issues/350) and
  [#351](https://github.com/swinster/cloudshare-demo-portal/issues/351). Future UX may expose those
  actions only after their independent domain/integration contracts are delivered.
- Reimplementing completed Sales Session provisioning/management or diagnostic-confinement work.
- Certification journeys beyond one Exam, SSO/OIDC, prerequisite eligibility, external monitoring
  export, and other PRD-v2 exclusions.

## Further Notes

- `CONTEXT.md`, ADR-001 through ADR-006, the PRD v2, Sales requirements, documented CloudShare API
  references, and accepted issue resolutions remain authoritative. Where this specification appears
  to change one of those contracts, it must be corrected rather than used to override it.
- **Session** is contextual domain language, not one shared implementation abstraction. Sales
  Enablement Sessions, Cohort Exam Sessions, and Candidate ExamAttempts retain distinct domain and
  integration interfaces.
- The chosen model combines the prototype workbench's queue/triage strength with a focused page's
  full-width information capacity. It rejects a focused page as the primary queue, a narrow
  participant column, a complete participant modal, a low-density conventional table, and
  spreadsheet-style cell focus.
- This specification settles the UX destination. The next independent Wayfinder task may derive
  small vertical tracer-bullet implementation tickets without reopening the decisions above.
