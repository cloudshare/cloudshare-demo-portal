# Existing Sales and Trial default extension migration (#473)

## Scope and contract

The selected Sales Participant handler (`src/api/sales-participant-extension.ts`) and retained
Trial handler (`src/api/sales-trial-enrollment.ts`) both call the existing Customer-scoped
`SalesEnvironmentModule.extendById`. Its CloudShare transport in `environment-observation.ts`
uses `environment-command.ts`. That dispatcher now sends bodyless
`POST /v4/environments/{exact-opaque-id}/extend`. It never sends custom duration fields or falls
back to v3. Archive retains its v3 PUT/query request; Certification Suspend/Resume remain v4.

Contract: `docs/api/assets/cloudshare-infrastructure-v4-2026-10-26.json`,
`paths./v4/environments/{id}/extend.post`. An omitted optional body applies the Policy's full
runtime (current run) and storage extension. Empty 204 acknowledges the command. Permission,
state, or deprovisioning can reject it; this migration makes no new eligibility guarantee.

Existing authenticated routes, selection, exact Contact/Participant/Project/Environment binding,
Customer-scoped encrypted Connections, durable dispatch fences and captured-ID recovery remain
unchanged. Sales confirms increased storage expiry and usable state before coordinating the
separate Experience End update/readback. Trial preserves its retained-target history and existing
Preparing/Archived eligibility and readback rules. Trial ending retains its own timing/fence.
Storage expiry is deletion time, not remaining runtime. No runtime amount is inferred from it.

## Automated evidence

Three vertical RED/GREEN checks were run before their implementation:

1. Recording HTTP expected v4 Extend POST but received v3 PUT; then passed after transport migration.
2. Trial uncertain-POST handler evidence expected `extend_environment` but received
   `observe_environment`; then passed after the v4 Extend path classification was added.
3. Sales uncertain-write handler evidence expected `cloudshare.v4.environments.extend` but
   received the old v3 surface; then passed after correcting that surface.

Existing handler coverage retains selection/authorization/isolation, partial outcomes, pre-dispatch
failure, uncertain writes, no replay, exact-ID reconciliation, access coordination, and persistence
recovery. Recording HTTP additionally covers rejection/transport failure without fallback/retry,
exact opaque path encoding, empty 204, omitted body/query, protected provider bodies and absence
of provider IDs/body secrets from generic traces. Existing Suspend/Resume and Archive wire tests
remain regression checks. Fixtures are offline evidence, not live tenant proof.

## Live acceptance status

At implementation handoff, this ticket has **no live extension proof yet**. Independent QA must
exercise both real browser workflows, capture console results, authoritative expiry/state,
separate runtime evidence where safely available, preserved work and Sales access coordination.
Support success/safe failure and simulated rejection/ambiguity/partial cases remain QA gates.
Archived/Preparing provider acceptance is not inferred from old v3 evidence or published schemas.
No retained #350/#351 assets, primary checkout, port 3000, or primary database were changed.

## Remaining shipped v3 inventory after D

| Capability | Transport and implementation | Reason retained |
| --- | --- | --- |
| Archive | PUT `/envs/actions/archive?envId=...`; `environment-command.ts` via controller | Supported Archive replacement not established; DELETE is not equivalent |
| Blueprint/default Snapshot discovery | GET `/projects/{id}/blueprints` and detail; `resources.ts` | Existing catalog/Snapshot contract exception |
| VMware Regions | GET `/regions`; `resources.ts` (authoring and Sync Resources) | Existing VMware discovery exception |
| Teams | GET `/teams`; `labs.ts`, `cohort-experiences.ts`, `resources.ts` | Existing delivery/authoring exception |
| Project members / Sales Pro eligibility | GET `/users`; `project-members.ts`, resource discovery | Existing active-member contract exception |
| Timezones | GET `/timezones`; `timezones.ts` | Existing catalog exception |
| Connection ping | GET `/ping`; `ping.ts` | No v4 health probe |

The generic client's v3 request methods and historical diagnostic path projections are transport
infrastructure, not extra shipped operations. Webhook ingestion retains v3 envelope semantics;
it is not a new outbound command. Current Project/Policy and Environment observations are v4;
Experience, Participant, sponsored-link and Guided Journey workflows stay on their existing v4
contracts. RDP #411 remains deferred; #474 owns final migration closeout.

## Offline validation at implementation handoff

- `npm run lint`: passed, no warnings/errors.
- `npm run typecheck`: passed.
- Targeted integration and handler run: 128 passed before the six additional wire rejection cases.
- Full `npm test`: launcher 14 passed; Vitest 2545 passed, 4 failed, 292/293 files passed.
  All four failures are the unchanged CandidateHome test file, independently reproduced on the
  baseline by QA. They remain disclosed, not treated as migration regressions.
- Initial full execution through the Windows profile junction could not resolve setup files in
  25 jsdom suites. Running from the canonical Packages/LocalCache worktree path resolved those
  loading failures without source/config changes; the full result above uses that canonical path.
- `git diff --check`: passed.
