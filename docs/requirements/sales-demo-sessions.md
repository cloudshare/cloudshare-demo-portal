# Sales Enablement Session provisioning

Issue #347 adds the first direct Sales Enablement delivery operation. An authenticated
Certalis Sales Admin creates one immutable local Sales Enablement Session for one active
Customer-scoped Opportunity and one active reusable Item. It maps one-to-one to a direct
CloudShare v4 Sales Experience; it does not add participants or send invitations.

## Portal contract

- `POST /api/sales/enablement-sessions` requires the authenticated Sales workspace Customer.
  `/api/sales/demo-sessions` remains a legacy-compatible alias while existing persisted history is
  migrated safely.
- Request: `opportunityId`, `itemId`, timezone-less ISO `start` and mandatory `end`, an
  explicit CloudShare `timeZone`, and the Session-level `type` (`demo`, `poc`, `pov`,
  `trial`, defaulting to `demo` for legacy callers). An Item does not own a delivery type;
  the UI starts at now or a scheduled local CloudShare date-time and pre-fills `end` from
  the selected Item Policy storage lease.
- Selecting an Item infers its Project and performs a fresh, non-cached active Project-member
  read. The Sales Admin selects the Main Sales Pro for this Session; the handler repeats that
  lookup immediately before `POST /sales` and blocks creation if the selection is absent or inactive.
  Selected display name and email are persisted on the immutable Session, never on the Item.
- The handler verifies that both selected local records belong to the Customer, are
  active, and that end is after start. It resolves the stored encrypted Certalis
  CloudShare Connection only at call time.
- The Sales Delivery module owns the direct v4 request shape. CloudShare validates the
  supplied main Sales Pro atomically during creation and Certalis maps that failure to
  a correlated, supportable response. The documented Sales-Pro lookup was unavailable;
  the authorised temporary Project-member GUI read is documented in GAP-28. The UI and
  domain never call CloudShare directly.
- The v4 creation request supplies the readable Opportunity name plus a bounded
  per-Session discriminator, a per-Session opaque 32-character external ID (the live
  v4 validator rejects the documented formatted `certalis:opp:<opportunity-id>` form),
  `registeredParticipantsOnly`, and `sendInvitations: "dontSend"`. Local state retains
  both the Sales Experience ID and Certalis correlation, so later Sessions for the same
  Opportunity remain independently traceable.
- Success, Sales-Pro validation failure, and CloudShare creation failure write
  correlated Customer-scoped audit and redacted diagnostic evidence. If CloudShare
  creates an Experience but the portal cannot persist its correlation, the operation is
  reported as needing support rather than silently retrying and risking a duplicate.
- The route-backed Sessions workspace has separate `Provision` and `Manage` views. `Manage`
  is the normal landing view for persisted Sessions; successful provisioning routes there
  with the new Session focused. Provisioning or ambiguous failures remain in `Provision`
  with their retry and protected-support guidance intact.
- The management read model keeps three independent dimensions: Certalis operation
  (`provisioning`, `correlated`, or `needs_attention` with a reason), CloudShare Sales
  Experience (`notStarted`, `inProgress`, or `ended`), and each participant's CloudShare
  Environment state. A fresh documented `GET /sales/{id}` observation is labelled as a
  CloudShare v4 read and is used for five minutes; otherwise Experience status is an
  explicitly labelled schedule prediction. These dimensions are never one filter union.
- `GET /api/sales/enablement-sessions` accepts independent bounded `operationStatus` and
  `experienceStatus` filters plus route-backed Customer-scoped Account and Opportunity
  filters. Primary management views are Upcoming (`notStarted`), In progress
  (`inProgress`), and Certalis Needs attention; Ended is secondary history.
- Participant name/email search is a local Customer-scoped read at the same route using
  `participantSearch`, `offset`, and `limit` (maximum 50). It searches the registered
  participant relation directly, returns a bounded page, and projects only the portal
  Session/participant identity and the correlated Environment display state. Provider IDs,
  access links, and protected diagnostic evidence remain server-only.
- `Verify CloudShare status` performs the documented v4 `GET /sales/{id}`, records protected
  diagnostic evidence, and persists the observed Experience status. Per-participant
  Environment display is sourced separately from documented v3 `GET /envs/{id}` numeric
  status codes and labels the source as `cloudshare_v3_environment`; the v4 participant
  roster's free-text environment field remains supporting context only.
- The documented CloudShare v3 timezone list is cached. Normal UI does not expose cache
  freshness jargon; a warning appears only for a stale fallback. The Sales Admin's last
  selected timezone and Session-level experience type are retained as preferences.

## Deliberately deferred

No participant enrollment, native invitations, sponsored links, extension, cancellation,
Salesforce/Workato integration, email scheduling, or shared environments are included.
