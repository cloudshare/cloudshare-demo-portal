# Sales Enablement Session provisioning

Issue #347 adds the first direct Sales Enablement delivery operation. An authenticated
Certalis Sales Admin creates one immutable local Sales Enablement Session for one active
Customer-scoped Opportunity and one active Demo Item. It maps one-to-one to a direct
CloudShare v4 Sales Experience; it does not add participants or send invitations.

## Portal contract

- `POST /api/sales/enablement-sessions` requires the authenticated Sales workspace Customer.
  `/api/sales/demo-sessions` remains a legacy-compatible alias while existing persisted history is
  migrated safely.
- Request: `opportunityId`, `itemId`, timezone-less ISO `start` and mandatory `end`, an
  explicit CloudShare `timeZone`, and optional editable `type` (`demo`, `poc`, `pov`,
  `trial`). The UI starts at now or a scheduled local CloudShare date-time and pre-fills
  `end` from the selected Item Policy storage lease.
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

## Deliberately deferred

No participant enrollment, native invitations, sponsored links, extension, cancellation,
Salesforce/Workato integration, email scheduling, or shared environments are included.
