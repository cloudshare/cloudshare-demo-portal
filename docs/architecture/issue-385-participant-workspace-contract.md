# Issue #385 architecture and delivery contract

**Status:** architecture checkpoint; production implementation and Prisma migration are paused pending acceptance.

## Scope and retained seams

Issue #385 changes the existing Sales Session Participants area from a read-only roster preview into a bounded, row-focused workspace. It does not create a new Participant lifecycle or change CloudShare endpoint semantics.

The implementation must retain these established seams:

- authenticated Next.js routes resolve the Sales Admin and Customer, then call framework-agnostic `src/api/*` handlers;
- handlers are the primary acceptance interface and own safe response/error projection;
- domain modules own eligibility and state transition rules without framework, Prisma, or CloudShare wire knowledge;
- Prisma adapters own Customer predicates, stable ordering, bounded reads, and atomic persistence;
- the CloudShare Sales adapter remains the only place with provider paths, credentials, and wire shapes;
- protected Support Diagnostics and ordinary metadata projections remain separate server-enforced interfaces.

React receives only typed ordinary DTOs and invokes typed HTTP routes. It never receives CloudShare credentials, sponsored `loginUrl` values, protected bodies or headers, or roster Environment references.

No `CONTEXT.md` or ADR change is proposed. `Participant`, `Participant Environment`, `Experience`, and Certalis operation retain their existing meanings, and the decisions below are bounded, reversible delivery design rather than a new domain model or hard-to-reverse platform decision.

## Smallest deep modules

### 1. `SalesParticipantWorkspaceReader`

The seam lives in `src/domain/sales-participant-workspace.ts`; its production adapter lives in `src/persistence/prisma-sales-participant-workspace-reader.ts`.

```ts
interface SalesParticipantWorkspaceReader {
  readPage(input: {
    customerId: string;
    sessionId: string;
    query: string;
    offset: number;
    limit: number;
    now: Date;
  }): Promise<SalesParticipantWorkspacePage | null>;
}
```

`SalesParticipantWorkspacePage` contains only a stable Participant page, total count, `hasMore`, and per-Participant projections for invitation, participation, Participant Environment, action availability, current durable invitation outcome, and latest safe launch operation metadata/correlation. The existing Session workspace reader remains the sole owner of the Session summary and its independent operation/Experience projections. The interface hides Participant/contact joins, Customer/archive predicates, ordering, active launch-link lookup, invitation-attempt lookup, and a bounded metadata-only lookup of the latest launch Diagnostic row for the returned Participant IDs. It never selects protected diagnostic columns and performs no provider read.

Invariants:

- `customerId + sessionId` is mandatory and fail-closed; a cross-Customer or archived Session returns no record.
- `query` is trimmed and bounded; `offset` is non-negative; `limit` is `1..50` (the UI uses `25`).
- ordering is stable (`createdAt`, then Participant `id`) so range selection has a deterministic current-page anchor.
- the adapter fetches only the requested page plus bounded aggregate data; it never materializes the full roster in the browser or issues CloudShare calls.
- Certalis operation, CloudShare Experience, and Participant Environment remain independent fields with independent sources.
- ordinary DTO construction cannot access protected diagnostic columns or raw provider references.

This replaces the current unbounded `participants` include in `SalesSessionWorkspaceRepository.read`; the existing workspace reader continues to own summary, Activity, and Details. The Participants area calls a dedicated typed handler/route for this bounded page. This is a real seam because production uses a Prisma adapter and tests use an in-memory adapter.

### 2. `SalesParticipantInvitationLedger`

The seam lives in `src/domain/sales-participant-invitation-ledger.ts`; its production adapter lives in `src/persistence/prisma-sales-participant-invitation-ledger.ts`. It is a private collaborator of the existing invite handler, not a new umbrella route or action switch.

```ts
interface SalesParticipantInvitationLedger {
  admitBatch(input: {
    customerId: string;
    sessionId: string;
    targets: readonly {
      participantId: string;
      intent: "invite" | "resend";
      expectedInvitationStatus: "notSent" | "sent";
      participantRevision: string;
    }[];
    commandId: string;
    at: Date;
  }): Promise<Admission>;
  markBatchDispatching(customerId: string, commandId: string, admissionToken: string, expectedRevision: number, at: Date): Promise<RevisionedInvitationCommand>;
  finishBatch(input: FinishInvitationCommand & { customerId: string; targetOutcomes: readonly InvitationTargetOutcome[] }): Promise<StoredInvitationCommand>;
  readCurrent(customerId: string, participantId: string): Promise<CurrentInvitationState | null>;
}
```

`Admission` is `admitted`, `same_command`, or `blocked`; the latter two return the current stored, controlled result without dispatch. Command/target identity and scope are immutable; lifecycle phase and per-target outcomes are revisioned because later read-only reconciliation may replace `confirmation_required` or an initial-Invite `no_replay` with `confirmed_by_reconciliation`. Result JSON is parsed through a closed schema containing only counts, failure-mode enums, and safe status metadata; arbitrary provider/context values are rejected.

`commandId` is immutably bound to the exact Customer, Session, ordered Participant set, and each target's derived Invite/Resend intent. Reuse with any mismatch fails closed as `409 command_id_mismatch`; it is never treated as a new command.

The module hides durable command/target recording, current-fence compare-and-set, same-command lookup, and atomic whole-command fence release/retention. Admission itself joins the exact Customer/Session-owned Participants and compares every explicit intent, expected status, and decoded `updatedAt` revision before recording any row or fence; validation and admission are one transaction, so there is no validation-to-admission race. Every ledger read/mutation requires and predicates exact `customerId`; UUID/token uniqueness is never cross-Customer authority. `markBatchDispatching` succeeds only when the command revision and every target fence still belong to its unexpired admission token; `finishBatch` writes every per-target outcome and releases or retains all applicable fences in one transaction. One batch provider POST is never authorized by a partial target set. The existing `handleInviteSalesSessionParticipants` retains provider capability/correlation revalidation, provider orchestration, audit, diagnostics, and its typed route. Existing launch-link routes and provider semantics remain distinct: `POST` generates/replaces a local portal capability and `DELETE` revokes it atomically through `SalesParticipantLaunchLinkRepository`. Their handlers are deepened only to catch persistence failures, assign a correlation ID, return a controlled failure, and record safe metadata best-effort so launch feedback remains attributable after reread. This avoids a shallow generic command module over capabilities with materially different semantics.

## Authoritative state and operation model

### State ownership

- CloudShare's complete Participant roster read is authoritative for invitation, participation, first-join, provider Participant correlation, and roster-provided Environment observation.
- the existing bounded Environment resolution path remains authoritative where the roster does not yield a projectable Environment observation; it may read at most four Environments concurrently and preserves current ambiguous/not-found attention semantics.
- the local `SalesSessionParticipant` projection is the last confirmed ordinary read model. A failed refresh retains it and reports a durable, attributable warning.
- `SalesParticipantLaunchLink` is authoritative for whether a portal launch capability is active or revoked. Generating/revoking this local capability does not claim that a CloudShare sponsored link has been created; the sponsored link is still created only at the server-side launch redirect.
- immutable Customer-scoped invitation attempts plus a separate current invitation fence are authoritative only for dispatch admission and stored safe outcomes. They never override the roster's business state.

### Capabilities are independent

There are exactly two independent capability owners:

- invitation dispatch: `invite` and `resend` share the invitation ledger fence because both invoke the same non-idempotent CloudShare write;
- launch capability: `generate_launch` and `revoke_launch` remain owned by the existing atomic launch-link repository because they replace or revoke the same local portal link.

An invitation awaiting confirmation must not block launch generation/revocation. A launch operation must not change invitation eligibility, attempts, or fence. Operations for different Participants do not block one another. No launch bearer token or portal launch token is persisted in an invitation attempt or reconstructable from an idempotency response.

The local page projects `available_to_attempt` from persisted state; it is presentation guidance, never dispatch authority. The invite handler revalidates Session ownership/window, Participant state, provider invitation capability, complete-roster exact correlation, and every current fence immediately before atomic admission. Launch handlers retain their existing command-time ownership/window checks. Availability preserves current-main behavior exactly:

| Action | Available only when | Deliberate distinction |
| --- | --- | --- |
| Invite | Session invitation window remains open; Participant is not concluded; native Participant invitations are enabled; exact provider correlation exists; invitation baseline is `notSent`; no invitation fence blocks dispatch | Provider capability and exact roster correlation are rechecked before dispatch. |
| Resend | Same checks as Invite, but baseline is `sent`; no invitation fence blocks dispatch | `sent -> sent` is never presented as proof that the resend was delivered. |
| Generate launch | Participant is Customer/Session-owned; Session end is in the future; Participant is not concluded | This only creates/replaces a portal-relative capability; it does not call CloudShare. |
| Revoke launch | Participant is Customer/Session-owned and an active local launch capability exists | Revoke remains allowed after Session end or Participant conclusion; it is a defensive local operation and must not inherit Generate's gates. |

Primary-action precedence is deterministic and capability-independent: choose Invite when eligible; otherwise Generate launch when eligible; otherwise Resend when eligible; otherwise Open Diagnostics when invitation or Participant attention needs investigation. A blocked invitation never suppresses an eligible launch action. Revoke is always a separated, consequence-confirmed exception action, never the primary action. The inspector still exposes other eligible actions compactly with controlled reasons for unavailable ones.

### Pre-dispatch, post-dispatch, and no replay

For an invitation command, the existing invite handler atomically admits a caller-generated UUID `commandId` for the exact `(customerId, sessionId, ordered target scope and preconditions)` before provider dispatch. The adapter interface for `inviteParticipants` must return or throw typed dispatch evidence: `not_dispatched`, `provider_rejected`, `acknowledged`, or `ambiguous_after_dispatch`. OAuth acquisition is not assumed to be pre-dispatch: only an adapter result that explicitly proves the invitation endpoint was not called qualifies as `not_dispatched`.

1. Invalid input and initial ownership/eligibility checks happen before admission and create no command. After atomic admission, command-time revalidation failure or adapter-proven `not_dispatched`/`provider_rejected` finishes the command as `failed_retryable` and releases every target fence. A fresh explicit command may retry; the same `commandId` returns that command's current stored result.
2. Immediately before calling the adapter, the admitted command and every target fence change from `admitted` to `dispatching` in one compare-and-set transaction. A crash in `admitted` is safe to lease-expire before dispatch; a crash in `dispatching` is conservatively recovered as `no_replay` because Certalis cannot prove the request was not sent.
3. `ambiguous_after_dispatch` finishes as `no_replay` and retains the fence. There is no timeout-based or automatic clearing.
4. `acknowledged` records that CloudShare accepted the command. A complete authoritative roster reread may additionally confirm an initial invite only when the persisted baseline was `notSent` and the exact correlated Participant is now `sent`.
5. For resend, `sent -> sent` never proves delivery. An acknowledged resend finishes as `accepted_unconfirmed`, releases the fence, and does not claim delivery; the same command never dispatches again, while a later, explicitly initiated resend is a new command. An ambiguous resend remains indefinitely `no_replay` in this issue because roster state cannot prove it.
6. A failed/incomplete post-acknowledgement roster read or a confirmed-roster/local-save failure stores `confirmation_required` and retains the fence for an initial Invite; certain acknowledgement of a normal Resend stores terminal `accepted_unconfirmed` and releases it; ambiguous dispatch stores `no_replay` and retains it. Responses say exactly what is known and never silently replay.
7. A later read-only reconciliation may clear an initial-invite `confirmation_required` or `no_replay` fence only when a complete roster read proves the baseline transition for exactly one correlated Participant. Resend `no_replay` cannot be cleared from roster state and remains indefinitely fail-closed in this issue. Reconciliation never sends an invitation.
8. The command head lifecycle is only `admitted -> dispatching -> evaluating_confirmation -> settled`. Per-target outcomes are `confirmed`, `confirmed_by_reconciliation`, `accepted_unconfirmed`, `confirmation_required`, `no_replay`, or `failed_retryable`. Fence existence, not a fence phase, is the blocking fact: a different command is rejected for every target whose fence remains. `finishBatch` releases each target fence for `confirmed`, `confirmed_by_reconciliation`, normal acknowledged-Resend `accepted_unconfirmed`, or `failed_retryable`, and retains it for `confirmation_required` or `no_replay`.
9. A persisted `evaluating_confirmation` command is recoverable only by a read-only same-command or monitoring path: it repeats the complete roster read, applies revision checks, and settles target outcomes without invoking Invite/Resend. It never resumes provider dispatch.
10. The same `commandId` always reconstructs its current revisioned safe aggregate from the command head plus ordered target rows, even after later commands. Status precedence is finite: nonterminal `admitted`, `dispatching`, or `evaluating_confirmation` -> `202 in_progress`; any settled `no_replay` -> `409 blocked`; otherwise any `confirmation_required` -> `202 confirmation_required`; otherwise any `failed_retryable` -> `502 failed_retryable`; otherwise any `accepted_unconfirmed` -> `200 completed_with_unconfirmed`; otherwise all `confirmed`/`confirmed_by_reconciliation` -> `200 completed`. Mixed batches always include every ordered target outcome and counts, so an aggregate never hides a more severe target result.

Finite transition table:

| Command-head phase before event | Required evidence | Next command phase / target outcome | Target fence |
| --- | --- | --- | --- |
| none | valid atomic admission | command `admitted`; targets pending | acquired per target |
| `admitted` | same command, valid admission token/lease, and no dispatch marker | stored `admitted`; the owning request may advance the same command through compare-and-set | retained |
| `admitted` | lease expires and an atomic recovery CAS proves the command is still admitted and every target fence is still owned | `failed_retryable` | all target fences released atomically |
| `dispatching` | adapter proves invitation endpoint was not called | `failed_retryable` | released |
| `dispatching` | explicit non-2xx provider response proving rejection | `failed_retryable` with controlled provider-rejected metadata | released |
| `dispatching` | 2xx acknowledgement | command `evaluating_confirmation`; targets pending | retained during evaluation |
| `dispatching` | timeout, interrupted response, process death, or any unclassified exception | `no_replay` | retained |
| `evaluating_confirmation` | initial Invite baseline `notSent`, complete roster, exact single match now `sent`, atomic local commit | target `confirmed`; command settles after all targets | released for target |
| `evaluating_confirmation` | Resend baseline `sent`, complete roster still `sent` | target `accepted_unconfirmed`; command settles after all targets | released for target; no delivery claim |
| `evaluating_confirmation` | incomplete/unprovable roster, missing/duplicate correlation, or local commit failure after certain acknowledgement for initial Invite | target `confirmation_required`; command settles after all targets | retained for target |
| persisted `evaluating_confirmation` after process interruption | same-command/monitoring read-only recovery obtains a new complete roster and passes current revision checks | settle each target by the same action-specific rules | release/retain per target; never dispatch |
| settled target `no_replay` or `confirmation_required` | later complete roster proves initial Invite `notSent -> sent` against captured baseline and unchanged revisions | target `confirmed_by_reconciliation`; command aggregate rereads from targets | released for target |
| settled target `no_replay` | Resend or no unique transition proof | target remains `no_replay` | retained indefinitely |

An `admitted` command is the only safely resumable nonterminal phase because the durable dispatch marker proves no adapter call began. Admission returns an opaque token with a short lease. `markBatchDispatching` atomically checks the token, lease, command revision, and ownership of every target fence. Expiry recovery atomically changes that still-admitted command to `failed_retryable` and releases all fences, so a delayed old request's later `markBatchDispatching` necessarily fails and cannot call the provider. The no-timeout-clearing rule applies after dispatch: `dispatching`, `evaluating_confirmation`, `confirmation_required`, and `no_replay` are never released merely by elapsed time. The safe page DTO exposes only `currentCommandId` for attribution, never its admission token; a reload receives stored state but has no authority to resume dispatch. Only the original server request holding the valid token may advance an admitted command. Once `dispatching` is durable, absence of typed adapter proof is always no-replay. Evidence-recorder failure is recorded best-effort separately and cannot convert an acknowledged or ambiguous provider outcome into retryable; the safe command outcome and correlation ID remain available even if secondary Audit/Diagnostic recording fails.

The command, targets, current fences, and Participant projections are updated in one Prisma transaction after authoritative confirmation. Diagnostic evidence stays append-only; reconciliation emits a new correlated record rather than rewriting evidence.

Launch capability operations retain their existing local atomic behavior and do not use invitation idempotency or no-replay state. The later anonymous launch redirect retains its existing entitlement/window checks, server-only sponsored-link handling, and diagnostic behavior.

## HTTP contracts

All routes require the existing authenticated `admin` session in the `sales` workspace and derive `customerId` and actor server-side. `401` is returned before any entity lookup; cross-Customer entity reads otherwise use the same controlled `404` as a missing record. Every JSON response is `Cache-Control: no-store`.

### Bounded Participant page

The canonical bounded local workspace page is served at `GET /api/sales/enablement-sessions/{sessionId}/participants?...`. The former provider-backed GET on that path has been retired from the application route because no in-repo caller, link, or test depends on it; provider participant reads remain unchanged behind the CloudShare integration adapter and are not exposed by this page route. The old `.../participants/page` path is a compatibility alias owned by the canonical route and is time-bounded for removal no later than 2026-12-31 (or the next documented portal major release, whichever comes first). Removal requires a fresh repository-wide caller/link search, confirmation that the live tenant has no consumer of the portal HTTP path (deployment/access-log evidence or an explicitly recorded absence of such telemetry), and a final release-note migration notice. In this slice we checked all tracked source, tests, and docs with a repository-wide search; we do not claim external consumer absence because live access logs were not available.

Before the Stage 3 invitation ledger migration exists, `currentCommandId` and invitation outcome in this DTO are explicitly `null` (the safe ready/no-current-command projection). Stage 3 populates these same fields from durable ledger state without changing the ordinary DTO shape.

- `GET /api/sales/enablement-sessions/{sessionId}/participants?query={0..100}&offset={0..10000}&limit={1..50}`
- `200`: `{ participants: SafeParticipantRow[], total, offset, limit, hasMore }`; rows contain portal IDs and `participantRevision`, controlled names/email, three independent status projections/sources, `available_to_attempt` guidance/reasons, active local launch-capability boolean, safe `currentCommandId` attribution/outcome metadata, and latest safe launch operation/outcome/correlation metadata. `participantRevision` is an opaque wire encoding of the persisted `updatedAt` instant and is compared against exact `updatedAt` by the handler; no new Participant revision column is required.
- `400`: invalid query/page; `401`: unauthenticated/wrong workspace; `404`: missing, archived, or cross-Customer Session.
- This route is a local bounded read and never calls CloudShare. It returns no provider Participant/Environment reference, launch token/URL, diagnostic body/header, or arbitrary attempt JSON.
- `View Activity` opens the existing unfiltered safe Session Activity and carries a correlation anchor only when the row already has one; it does not claim that current Session Activity supports Participant filtering. `Open Diagnostics` uses the existing authorized Customer-scoped Support route. Neither link copies evidence into the Participant DTO.

### Existing invitation route, deepened

- `POST /api/sales/enablement-sessions/{sessionId}/participants/invite`
- Body is `{ commandId: UUID, targets: [{ participantId, intent: "invite" | "resend", expectedInvitationStatus: "notSent" | "sent", participantRevision }] }` with `1..100` unique targets; issue #385 sends exactly one target. The handler rejects stale revision/status or an intent that does not match the explicit baseline, so a clicked Invite can never silently become Resend (or vice versa). These exact ordered target preconditions are bound into the command scope hash. The former bare `participantIds` shape is replaced at all in-repo callers and cannot bypass explicit intent.
- Response union: `200` for `completed` or `completed_with_unconfirmed` (targets may include `confirmed_by_reconciliation`); `202` for nonterminal `in_progress` or settled initial-Invite `confirmation_required`; `400` for invalid body; `401` unauthorized; `404` missing/cross-Customer entity; `409` for `no_replay`, `command_id_mismatch`, unavailable action, blocking fence, disabled provider capability, or failed exact correlation; `502` for aggregate `failed_retryable`. Command responses contain aggregate outcome, ordered controlled per-target outcomes, counts, correlation ID, and safe reasons only.
- Repeating the same `(customerId, commandId)` with the exact bound preconditions returns the current stored result without provider dispatch. The command stores a safe `httpStatus` appropriate to its current revision; replay preserves that status until reconciliation legitimately changes the outcome/revision, after which replay returns the new current status. A different command is evaluated against the current invitation fences. The handler never accepts email/provider IDs and never returns provider exchanges.

### Existing launch-capability routes

- `POST /api/sales/enablement-sessions/{sessionId}/participants/{participantId}/launch-link` atomically replaces the local capability and returns `201 { launchUrl: "/sales/launch/{opaque-token}", correlationId }`; it preserves existing `404` ownership confinement and `409` ended/concluded denial.
- `DELETE` on the same path atomically revokes the active capability and returns `200 { correlationId }`; it preserves controlled `401/404` behavior and remains allowed after end/conclusion.
- These routes have no invitation `commandId`. The returned portal-relative token is delivered once and is not stored in an idempotency result. The later `GET /sales/launch/{token}` alone calls CloudShare and keeps sponsored `loginUrl` server-only behind the existing 302.

### Evidence contract

Ordinary route results contain controlled status, reason, and correlation metadata only. The established diagnostic recorder separately retains Customer-scoped protected request/query/provider-response bodies and the safe request-header allowlist under ADR-004. Pre-dispatch, provider-rejected, acknowledged, post-dispatch-ambiguous, and reconciliation events each use distinct controlled operation/failure metadata so Support can determine why replay is or is not allowed without sending protected evidence to the browser.

## Bounded roster reads and race ownership

The page reader owns local search/paging only. Provider reconciliation is an explicit Participant command follow-up or existing monitoring action, never a per-row render effect.

One server-side reconciliation for a Participant:

- obtains one CloudShare roster result whose adapter type explicitly carries `completeness: "complete"`, request shape, and pagination/exhaustion provenance; any missing, truncated, malformed, or unprovable completeness fails closed;
- matches the Participant using both persisted Certalis correlation properties, never email alone;
- captures one exact Participant `updatedAt` plus command/target revisions before the provider read, then applies the observation only when all still match; a stale compare-and-set failure is returned for a fresh read and is never retried with the old observation;
- uses the existing concurrency cap of four only for required Environment reads;
- persists the confirmed projection before returning it, then the browser rereads the bounded local page;
- cannot overwrite a newer terminal Participant state or clear another command's fence.

The CloudShare Sales adapter's existing list operation is deepened to return `CompleteSalesParticipantRoster`, not a naked array. Its validator proves the documented response collection is exhaustive, including any count/pagination fields required by the exported contract, and attaches `completeness: "complete"`; there is no caller-set completeness flag. If the live contract cannot prove exhaustiveness, the adapter returns a typed incomplete result that may update no projection or fence and the gap report is updated.

Concurrent commands for the same capability are serialized by the database uniqueness/compare-and-set rule, not by a process-local map. Browser in-flight guards improve presentation only and are never authority.

## UI focus and selection state

Selection is current-page navigation state; it is not persisted as business data and is not accepted by the server as authority. Meaningful view state is URL/history-backed so browser back/forward restores it.

- `participantQuery`, `participantOffset`, active Participant ID, selected current-page IDs (maximum 25), range anchor ID, and logical focus target (`row` or `inspector`) are serialized in the route query and hydrated through a small pure row-interaction reducer. Scroll position is stored/restored through browser history state.
- transient DOM refs and the currently focused element remain ephemeral React state; route restoration converts the logical focus target into a DOM focus action only after the bounded page is loaded.
- click selects one row; Ctrl/Cmd-click toggles; Shift-click extends within the current stable page; Up/Down moves the active row; Space toggles; Shift+Space extends; Enter focuses the persistent inspector.
- events from buttons, links, inputs, menus, or dialogs inside a row never reach row selection commands.
- Escape from the inspector and completion/cancellation of the revoke dialog return focus to the originating row/action when it remains on the page; otherwise focus moves to the Participants heading with an explained status.
- search/page changes update route state, retain an active Participant only if it remains present, prune invisible selections, reset an invalid range anchor, and never imply cross-page selection. Back/forward hydrates the same validation path.
- the inspector derives its Participant and eligible primary action from the latest server DTO. Unavailable actions render their controlled reason. Durable per-Participant command feedback remains in the row/inspector across focus changes and page rereads.
- constrained-width layout may scroll the table, but row identity, selection, primary action, and inspector entry remain keyboard reachable without pointer-only controls.

Offset paging is deliberate for this bounded local dataset. Concurrent registration may move page membership; hydration validates every URL-selected ID against the newly read page, removes missing IDs, and announces that the roster changed rather than selecting a different row at the old ordinal position.

## Persistence and migration boundary

After acceptance, add three narrow durable tables: `SalesParticipantInvitationCommand` with immutable identity/scope keyed by `(customerId, commandId)` plus mutable phase, admission-token hash/lease, correlation ID, timestamps, and revision; `SalesParticipantInvitationTarget` keyed by `(customerId, commandId, salesSessionParticipantId)` with immutable intent/baseline/revision precondition plus controlled outcome; and `SalesParticipantInvitationFence` keyed by `(customerId, salesSessionParticipantId)` with the current `commandId` and revision. One transaction admits the command, all targets, and all fences; dispatch/finish compare-and-set the command and every fence as one batch. The parent Participant model gains/uses `@@unique([customerId, id])`. Target and fence tables use composite Customer/Participant foreign keys; targets also use `(customerId, commandId)` and fences use `(customerId, currentCommandId)` foreign keys to the Customer-scoped command head, so no target/fence can outlive or point across Customers from its command. No token, sponsored URL, raw provider response, or protected evidence is stored here.

The migration is additive and contains no data backfill. Existing Participants begin with no command, target, or fence, which means ready subject to current eligibility. No Participant, launch-link, diagnostic, or audit data is rewritten. The Prisma adapter owns whole-command compare-and-set admission, Customer-scoped reads of the current revisioned command result, and transactional confirmed projection updates. The migration will not be created until this checkpoint is accepted.

## Replacement and deletion plan

This is replace-not-layer work:

1. replace the workspace repository's unbounded Participant include/DTO with the bounded page reader; do not leave a compatibility path that loads all Participants;
2. retain the established typed invite and launch-link routes/handlers; deepen the invite handler with the private ledger and add no generic command route;
3. replace ad hoc row keyboard/selection logic with the pure route-state reducer; do not add a process-local operation coordinator in React or the server;
4. delete superseded shallow tests that assert the old unbounded preview after equivalent behavior is proven through the page handler interface; retain route tests for the established action contracts;
5. do not copy the coordinator, roster reader, operation modules, migration, or dense client orchestration from PR #440. Its failure evidence is used only to ensure those patterns are not repeated.

## Finite test matrix

| Seam | Cases |
| --- | --- |
| Page handler eligibility | each action across Session ended, Participant concluded, invitation mode/capability, invitation status, active launch link; primary-action precedence; three status dimensions remain independent |
| Row reducer | click, modifier toggle, pointer/keyboard range, Up/Down, Space, Shift+Space, Enter, Escape, nested-control exclusion, URL/history hydration, disappearing active row, concurrent page-membership change, page/query reset |
| Page handler/adapter | 0/1/25/26/500 rows; name/email query; stable paging; Customer/archive isolation; bounded SQL; no provider call; no raw references or protected evidence |
| Invitation ledger | same-command current result after later commands/reconciliation, mismatched command-ID reuse, concurrent whole-batch admission, invitation/launch independence, different-Participant independence, process restart in every command-head phase, mixed target outcomes, stale compare-and-set, typed result-schema rejection |
| Invitation dispatch | adapter-proven not-dispatched; provider rejection; acknowledged initial invite and exact transition; acknowledged resend without false confirmation; ambiguous transport; malformed/incomplete/unprovable-completeness reread; missing/duplicate correlation; projection-save failure; no automatic replay |
| Read-only reconciliation | exact initial-invite transition clears fence; resend does not; unchanged/missing/duplicate/incomplete fails closed; ambiguous resend remains indefinitely blocked; never invokes invite; stale observation cannot overwrite newer state |
| Launch capability | generate replaces prior token atomically; revoke; generate ended/concluded denial; post-end/conclusion revoke; persistence failures return correlation and durable safe metadata; only portal-relative URL returned; sponsored URL absent |
| Handler security | cross-Customer not found; non-admin route denied; correlation metadata allowed; tokens, provider references, bodies, and disallowed headers absent |
| Browser | every specified pointer/keyboard interaction; nested controls; primary/secondary actions; durable success/failure/pending copy; dialog focus trap/return; paging/search; constrained width; no unexplained console output |
| Regression/live | existing Session workspace, invite/resend, instant-launch, Activity/Support, entitlement and redirect suites; live tenant UI verifies invite/resend dispatch states and protected Support evidence; port-3000 human QA is mandatory |

## Non-goals

- no new Participant lifecycle or provider capability;
- no new bulk UI or cross-page execution; the existing bounded invitation handler remains batch-capable for its current callers;
- no Session extension/cancellation, contact synchronization, or scheduled invitations;
- no change to CloudShare endpoints, auth, status enums, invitation semantics, sponsored-link redirect, diagnostics retention, or Customer isolation;
- no per-row provider refresh, background replay, timeout-based fence clearing after dispatch, or email-only reconciliation;
- no redesign of Activity, Support Diagnostics, Helios administration, Candidate delivery, or the wider Session workspace;
- no compatibility wrapper around PR #440's abandoned orchestration.

## Delivery order after acceptance

1. write failing interface-level tests for bounded page reads, security projections, eligibility, and row interaction;
2. implement the page reader and replace the unbounded Participants projection;
3. write failing invitation admission/no-replay tests, then add the additive command/target/fence migration and adapter;
4. deepen the existing invite handler with dispatch evidence and the ledger while preserving its route, CloudShare adapter, and diagnostics; deepen the existing launch-link handlers only for controlled correlated persistence-failure evidence;
5. build the table/inspector from the typed page and action DTOs, then delete old preview/orchestration code and obsolete tests;
6. run exact-head review, automated checks, changed-path browser/console QA, mandatory live-tenant invite/resend UI and Support-diagnostic verification, and port-3000 human QA before merge.

The plan is bounded because it adds one caller-facing page-reader interface, one private invitation-ledger interface, three narrow additive persistence records, one bounded page route, and one pure route-state reducer while retaining the existing action routes, provider operations, and security seams. It explicitly deletes the unbounded preview/ad hoc client orchestration it replaces.
