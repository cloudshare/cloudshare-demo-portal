# Sales Participant extension (#350)

The canonical bounded Participant workspace offers one deliberate extension action. All eligible active Participants across pages are selected by default; visible-page exclusions narrow that selection without fetching the full roster into the browser. Each command is limited to 100 selected Participants. Existing row-adjacent Inspect/Close is unchanged.

## HTTP contract

`POST /api/sales/enablement-sessions/{sessionId}/participants/extend` requires a Sales Admin session. Its strict body contains a UUID `commandId` and either `selection: { mode: "all", excludedIds: string[] }` or `selection: { mode: "selected", participantIds: string[] }`. Reusing the command returns its durable result. `reconcile: true` performs provider reads and can complete a previously undispatched access-window step, but never replays a v3 extension or a dispatched v4 update. `retrySafe: true` retries only targets with durable pre-dispatch failure evidence while an unfinished command retains its fences. A finished partial command can be followed by a fresh command selecting only its unattempted targets.

`GET` at the same path returns the latest Customer/Session-scoped result, allowing recovery after reload. An active command takes priority over completed history. Transactional admission assigns monotonically increasing millisecond creation times per Session so same-tick commands retain deterministic history order. Ordinary responses contain local Participant IDs, safe outcomes, actual confirmed expiry, explicit timezone, and diagnostic correlation only. Provider IDs, credentials and HTTP bodies stay server-side.

## Sequencing and provider authority

The operation requires a complete v4 roster and independently unique provider ID, local Participant custom property, and Opportunity Contact custom property, with matching scoped Contact/email. It uses the existing GAP-32 resolution chain: the Customer's v3 owner-email list, exactly one match to the Session Item Project, then getextended with the opaque v3 ID. This is the supported live-verified resolver; it does not claim a numeric roster reference maps directly to that opaque ID or prove a complete historical environment inventory. Missing, duplicate, changed or ineligible bindings fail closed.

Admission captures the immutable Session/Experience/timezone, selection and per-target local revision, provider Participant, Contact/email/Project, opaque Environment and pre-expiry. SQLite unique constraints fence the Session, Participant and Environment across commands. Revision-checked state writes persist each target's dispatch point before its bodyless v3 PUT. Failures after that point remain ambiguous unless a read confirms a later actual expiry; no timeout, 5xx, or generic error authorizes replay. Preflight failures remain explicitly unattempted and retryable.

Confirmed targets can preserve access even when other targets are unresolved. The v4 target End is the maximum of the current provider End and confirmed selected expiries, rounded up to the provider's minute precision in the Session timezone. It is stored before PUT and confirmed by GET before the repository updates the Customer-owned local Session projection. Readback must report notStarted or inProgress; an ended Experience cannot confirm access even if its End covers the expiry. A partial batch remains partial, even when the access update succeeds. An ambiguous End update is read-only reconciled, never replayed. No replacement Experience is created.

## Evidence and remaining gates

Deterministic API, persistence, adapter and browser-component tests cover ordering, selection, immutable correlation, concurrency/restart fencing, ambiguity/no replay, safe retry and Customer isolation. Per-command audit and protected diagnostic records retain provider exchanges and transport failures. GAP-35 is existing live evidence for the tenant-default extension, not live proof of this new combined Session flow.

Independent review, browser interaction/console QA, disposable live UI extension with provider readback and support diagnostics, and human QA on port 3000 remain lifecycle gates owned by the ticket orchestrator. The implementation does not mutate live assets or the port-3000 checkout.

### Eligibility projection on entry (repair round 2)

Opening the canonical Participant workspace automatically posts to the authenticated,
Customer-scoped `participants/refresh` endpoint. This invokes the existing provider-read
Participant projection handler server-side and returns only completion metadata and a
correlation ID. It does not perform provider writes or return the provider roster. The
browser then rereads the bounded local Participant page before enabling extension selection.
The canonical Participant GET remains local; there is no manual Resync control or polling.
Session generations fence delayed refresh/history responses, and page generations fence
superseded bounded reads. Extension and reconciliation results also trigger a bounded reread.
A failed eligibility read leaves extension disabled with a read-only retry.

Live QA exposed the missing projection trigger: an exactly correlated provider Participant
was in progress with a Ready environment while the local row remained Pending/Not observed.
Automated coverage proves entry refresh, bounded reread, default selection, Inspect/Close,
Customer isolation, provider-read-only behavior, safe response metadata, and stale Session
response rejection. Live acceptance must be rerun on this repaired head.
