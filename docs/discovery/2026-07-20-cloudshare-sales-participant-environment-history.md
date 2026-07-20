# CloudShare Sales participant environment-history contract finding

**Date:** 2026-07-20
**Scope:** documented ways to identify a Sales participant's Environment(s), particularly after an Environment has been deleted. This is a contract-and-observation finding, not a proposal to use undocumented endpoints.

## Conclusion

The documented v4 Sales participant roster is the best available documented source for the
participant's roster-associated Sales Environment context: it exposes `envStatus` and nullable
`envId`, including `Deleted` in the status enum. However, the published model does **not** state
that it is an Environment history, does not expose an Environment count, and does not specify a
relationship from a participant to every prior Environment when multiple activations are allowed.

The portal's current documented v3 fallback (`GET /envs?ownerEmail=…&brief=false`, then an exact
Project match) is an observation of listable environments, not a historical ledger. A successful
empty list is therefore a semantic result—"no currently listable matching Environment"—rather than
proof of an HTTP failure or proof that the participant never consumed an Environment.

## Documented contract

### v4 Sales participant roster

- `GET /sales/{id}/participants` is documented as **Get Sales Participants List** and returns a
  `count` plus `participants`; it supports `offset` and `limit` pagination.
  [Repository OpenAPI export, `/paths/~1sales~1{id}~1participants/get`](../api/assets/cloudshare-public-api-v4-2026-07-10.json)
- Each item is `Sales_Participants_Response`. Its documented fields include participant identity,
  invitation and participation state, `envStatus`, and nullable `envId`.
  [Repository OpenAPI export, `/components/schemas/Sales_Participants_Response`](../api/assets/cloudshare-public-api-v4-2026-07-10.json)
- The `envStatus` enum explicitly includes `Ready`, `Suspended`, `Archived`, `Deleted`, `Preparing`,
  and `CreationFailed` (among other states). The model documents no array, count, timestamps, or
  historical-environment field.
  [Repository OpenAPI export, `/components/schemas/Sales_Participants_Response/properties/envStatus`](../api/assets/cloudshare-public-api-v4-2026-07-10.json)
- The Sales Experience request model has `allowMultipleEnvironmentActivations`, described as
  allowing participants to access multiple sequential Environment instances. That setting makes a
  single roster `envId` insufficient to establish a complete Environment history; this is an
  inference from the two published schemas, not an explicit provider guarantee about which instance
  the roster returns.
  [Repository OpenAPI export, `/components/schemas/Sales_Experience/properties/allowMultipleEnvironmentActivations`](../api/assets/cloudshare-public-api-v4-2026-07-10.json)

### Documented v3 observation used by Certalis

- The portal's approved Sales monitoring chain is the Customer-credential-scoped
  `GET /api/v3/envs?ownerEmail=<participant>&brief=false`, exact match to the Session Item's
  Project, then `GET /api/v3/envs/actions/getextended?envId=<opaque-v3-id>`.
  [Local API reference](../api/cloudshare-api-reference.md), lines 63–70; [Sales Session requirement](../requirements/sales-demo-sessions.md), lines 59–69.
- The local contract deliberately accepts exactly one same-Project result. Zero or multiple results
  are an explicit participant-level `needs_attention` condition sourced as
  `cloudshare_v3_owner_email_item_project`; the v4 `envId` is retained only as a roster reference,
  not treated as a v3 Environment identifier.
  [Sales Session requirement](../requirements/sales-demo-sessions.md), lines 61–69; [implementation](../../src/integrations/cloudshare/sales-environment.ts), lines 23–55.

## Live-tenant observation supplied during QA

The QA case reported on 2026-07-20 returned HTTP 200 with an empty array from the documented v3
owner-email list lookup after the relevant Environment had been deleted. This establishes the
behavior of that tenant/query at that time; it does **not** establish a general CloudShare contract
that `/envs` returns only active Environments, because the local v3 reference does not make that
claim.

It explains the portal's observed participant-level `environment_not_found_for_project` result:
the request completed successfully, but the current resolver could not identify exactly one
listable Environment in the Item Project. The status must remain a Certalis correlation exception,
not be represented as a provider transport failure or as a claim that no historical Environment
existed.

## Explicit non-findings

- The reviewed v4 participant contract does **not** document a complete per-participant
  Environment-history list or count for a Sales Experience.
- The reviewed local v3 documentation does **not** document a class/Experience-scoped historical
  Environment query that would fill that gap.
- `environmentsGrid` was intentionally not evaluated or adopted: it is not a documented contract
  in the repository reference and must not become a portal integration path on this evidence.
- The documentation does not establish whether `envId` always identifies the latest Environment,
  merely one current roster-associated value, or something else when multiple activations are
  enabled. That requires an official CloudShare clarification or controlled live evidence.

## Operational rule and follow-up

For the current product, show the v4 roster's `envStatus`/`envId` only as roster-provided context
and label its source. Continue to use the documented v3 chain only for a current, exact
owner-and-Project correlation. When it returns zero matches with HTTP success, retain the protected
exchange and say that no matching Environment was currently listable; do not label it a failed
CloudShare request.

Record this as a provider-contract gap for CloudShare support: request an official, documented,
Customer-scoped endpoint or field that returns (a) all Environment instances consumed by a named
Sales participant in one Sales Experience, (b) their terminal/current statuses and timestamps, and
(c) a reliable count when multiple sequential activations are enabled.
