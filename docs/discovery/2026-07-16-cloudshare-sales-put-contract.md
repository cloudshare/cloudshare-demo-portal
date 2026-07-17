# CloudShare v4 Sales GET-to-PUT contract finding

**Date:** 2026-07-16
**Scope:** whether the documented v4 Sales `GET /sales/{id}` response can safely be replayed as a full `PUT /sales/{id}` request. This is a contract finding, not a live-tenant observation.

## Conclusion

The documented contract proves that `PUT /sales/{id}` exists, but it does **not** prove either a
partial/name-only update or a lossless GET-to-PUT round trip. The portal must therefore fail closed
unless a live `GET` supplies every value required by its deliberately limited PUT payload and that
payload can be validated against the documented request model. Do not infer that an omitted GET
property retains its existing value.

## Evidence

- The CloudShare v4 export defines `GET /sales/{id}` as returning
  `Sales_Experience_Response`, while `PUT /sales/{id}` accepts the distinct
  `Sales_Experience` schema. Its only PUT guidance is that invalid edits are not updated; it does
  not describe PATCH/partial-update semantics or name-only updates.
  [Repository export, `/paths/~1sales~1{id}/get` and `/paths/~1sales~1{id}/put`](../api/assets/cloudshare-public-api-v4-2026-07-10.json)
- `Sales_Experience` marks eleven fields required: `name`, `type`, `projectId`, `blueprintIds`,
  `cloudshareRegionIds`, `mainSalesPro`, `start`, `timeZone`, `policyId`, `opportunity`, and
  `registrationType`. A request containing only `name` consequently does not conform to the
  published request schema.
  [Repository export, `/components/schemas/Sales_Experience`](../api/assets/cloudshare-public-api-v4-2026-07-10.json)
- `Sales_Experience_Response` has no `required` list and is not the request schema. It also omits
  request properties such as `allowParticipantsSwitchSteps`, `sharedEnvBlueprintId`,
  `sharedEnvPolicyId`, and `isSharedLabViewAccessEnabled`; several common properties are marked
  `readOnly`. The `sendInvitations` enum also differs (`salesParticipantsOnly` in the request,
  `participantsOnly` in the response). The export therefore cannot guarantee reconstruction of a
  valid, behaviour-preserving PUT body from GET data.
  [Repository export, `/components/schemas/Sales_Experience_Response`](../api/assets/cloudshare-public-api-v4-2026-07-10.json)
- CloudShare’s public integration guidance confirms that v4 supports creating, editing and
  retrieving Sales experiences, but it supplies no stronger partial-update or round-trip guarantee.
  [CloudShare Help: Integrate CloudShare Using REST API](https://support.accelerate.cloudshare.com/hc/en-us/articles/32839141803921-Integrate-CloudShare-Using-REST-API)

## Operational rule

Treat a missing GET property as **unknown**, not as `null`, `false`, or a provider default. A
controlled portal edit may proceed only when the current GET response has been validated into the
specific supported PUT model being sent; otherwise return a supportable, correlated failure and do
not call CloudShare. A live response can establish that a particular tenant exposes the required
subset, but it cannot expand the documented contract to partial updates.
