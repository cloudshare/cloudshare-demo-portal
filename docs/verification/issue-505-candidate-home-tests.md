# Issue 505: CandidateHome route-focus test clock

The four failures were caused by dated fixtures running against the real clock,
not obsolete UI expectations. On 2026-11-10, attempts scheduled for 2026-10-23
were outside their open windows. The real CandidateHome route correctly fell
back to Schedule, whose exam cards have different headings and labels.

## Accepted contract and diagnosis

- `24232e6` introduced the route-backed Candidate task flow and focus tests.
- `7be4275` ("Keep current attempt cards stable and accessible") added named
  attempt cards, distinct per-attempt actions, and the refresh ordering test.
- The unchanged production component still renders the expected current heading,
  scheduled explanation, and article `aria-labelledby`. The route uses
  `getCandidateAttemptDisplayStatus` to exclude attempts whose open windows ended.
- PRD v2 Candidate scheduling/launch requirements keep state and time-gated entry
  explicit; bypassing that expiry behavior would contradict the intended flow.

The ranked hypotheses were stale UX assertions, a production accessibility
regression, and a fixture/render-state problem. Baseline DOM showed zero current
attempts and the Schedule fallback. Source/history inspection rejected the first
two; pinning the fixture clock confirmed the third without changing assertions.

## Repair and targeted evidence

Baseline at `5426337`, run twice on 2026-11-10:

```text
npx vitest run src/web/candidate-home-route-focus.test.tsx
4 failed, 7 passed
```

Each failing case was then repaired and run individually. The three interactive
tests pin `Date.now` at `2026-10-23T16:00:00.000Z`, retaining real timers for user
interactions. The refresh test pins its existing fake clock at the same instant,
then advances it by 30 seconds. Mock restoration prevents clock leakage.

All original assertions remain: task-control focus and route announcements,
non-focusable destination headings, accessible card labels, card flip keyboard
behavior, per-attempt actions, and stable card identity/order after refresh.
The existing completed/expired history and time-gating tests are unchanged.

No production, dependency, database, server, credential, or CloudShare change is
included. Logs live outside the repository in
`D:/Code_projects/issue505-validation-logs`. Full validation and independent
review/QA results are recorded on PR #506 by the lifecycle task.
