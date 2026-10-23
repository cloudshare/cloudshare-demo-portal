# CloudShare v4 contract readiness — 2026-10-23

**PUBLISHED CONTRACT:** Assessment for #453 documentation closeout. Research involved public-document and preserved local-evidence reads; no live tenant request, provider mutation, asset cleanup or migration implementation occurred. The preserved untracked October files were read and not altered or tracked.

## Evidence and correction

The official [Infrastructure page](https://cloudshare.stoplight.io/docs/AccelerateAPI/9ypmdgjbuuh1k-infrastructure) returned HTTP 200 on 2026-10-23. Its public Stoplight metadata identified project 299551, Infrastructure branch node 822299963, snapshot 1344720750, and project updatedAt 2026-10-21T12:28:03.012367+00:00. These are documentation metadata, not runtime deployment versions.

The read-only official GraphQL query `branchNode(id:822299963) { id baseUri node { uri } branch { slug } }` resolved the source `/reference/infrastructure-Public-API.openapi.json`, branch `main`. The [current official OpenAPI source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/reference/infrastructure-Public-API.openapi.json?branch=main) returned Infrastructure / 4.0. This source, rather than guessed provider endpoint naming, supplied the contracts below.

The preserved `docs/api/assets/cloudshare-infrastructure-v4-2026-10-12.json` has SHA256 `C4EF5401EA7EDDC842F35CDFA3A3E989F7D9881E774074E61FEB82A306D618A0`, exactly matching its companion October research note. That note records official Stoplight Export > Bundled References provenance. This assessment verifies hash consistency, not independent reconstruction of the original download event.

Current source is not byte-identical to that bundled export: metadata, inherited server/security fields, parameter ordering and some unrelated schema details differ. The description strings for project list, project-policy list/detail, environment list/detail/delete, suspend, resume and extend compared exactly equal. Do not describe the complete exports as identical or claim no other drift.

Scope correction: the July Experience export's lack of Infrastructure routes did not establish current v4 absence. October evidence already contains replacement contracts. Current public workspace introductory metadata now explicitly describes v4 environments/projects/policies and retains v3 for users/invitations/teams/blueprints/snapshots. The October note's warning about an outdated Introduction is historical; do not repeat it as verified current wording without checking that page itself.

## Bounded replacement map

**LIVE VERIFIED:** No fresh live tenant verification was performed for this assessment. Every entry below is a published contract, not live tenant verification or shipped migration. Source: [current official OpenAPI](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/reference/infrastructure-Public-API.openapi.json?branch=main), cited JSON pointers.

| Existing capability | Published replacement | Constraint |
|---|---|---|
| Project discovery | `GET /v4/projects` (`#/paths/~1v4~1projects/get`) | `{count, items}`; offset default 0; limit default/cap 100; count only populated when requested; visible-project scope. Preserve complete discovery, not just first page. |
| Project Policy list/detail | `GET /v4/projects/{projectId}/policies` and `/{policyId}` | List returns brief id/name/projectId/allowEnvironmentCreation, not durations. Fetch detail for runtimeMinutes/storageMinutes. Unlike project/environment list, policy list has no default or cap and omitted limit returns all. List may be empty without Team Member role; detail requires Team Member and verifies project membership. |
| Environment list/detail | `GET /v4/environments`, `GET /v4/environments/{id}` | Only live/nonexpired environments; list excludes expired projects. ownerEmail is substring matching; page through results, then verify exact owner/project and unique correlation. Detail requires view permission. |
| Suspend/resume | `POST /v4/environments/{id}/suspend`, `/resume` | 204 has no JSON body; resume asynchronous, requires authoritative polling. Resume ready/preparing is a no-op; suspend suspended is a no-op. Other unsupported states can return 400. Omit staff-only immediate parameter. |
| Extend | `POST /v4/environments/{id}/extend` | 204; default extends by full policy runtime/storage; custom amounts both-or-neither, `[d.]hh:mm[:ss]`, bounded by policy and runtime <= storage. Preserve ambiguous-write no-blind-replay safeguards. |
| Archive | No archive operation in this Infrastructure source | DELETE starts deletion and can remove an end-user owner's project membership if this was their last active environment. It is not an archive replacement. The archived status enum does not establish an archive operation or Preparing-state archive eligibility. |

## Cross-cutting migration requirements

- `#/info/description`, `#/servers`, `#/security`: production root is `https://api.accelerate.cloudshare.com`; paths already contain `/v4`. Existing v4 client base-path composition must avoid double `/v4`. OAuth client credentials uses `/v4/oauth/token` and form encoding; Bearer token is opaque and expires according to expires_in. Continue per-Customer encrypted credentials and isolation.
- `#/components/schemas/EnvironmentResponse`: opaque typed external ids (`EN`, `PR`, `PO`, etc.) are documented. This does not prove existing numeric Sales roster envId parity with opaque ids, or v3/v4 cross-version identity compatibility. Verify against exact live correlation before changing readers; no first-match fallback.
- Environment status is a string enum: ready, suspended, preparing, publishing, archived, inGrace, futureAllocationScheduled, allocationScheduledNoRun, deleted, creationFailed, editingNetworks, stopping, unknown. Explicitly map it to current adapter/domain projections without changing workflow eligibility.
- Environment startTime and expirationTime are RFC 1123 UTC. expirationTime is storage deletion time, not remaining runtime or Experience End. Normalize at the adapter, retain ISO display and ADR-005 timing distinctions.
- Actions require environment edit permission (default Project Manager+, together with environment role); ownership alone is insufficient. Suspend and Extend have further permission constraints. Verify permissions on the actual Customer connection rather than assuming v3 permissions suffice.
- `#/components/schemas/FieldErrors`, `LegacyError`, action responses: handle field-to-string-array errors, empty-key general errors, legacy message/code errors and empty 403/404 bodies. Successful 204 must not be JSON parsed. Preserve correlated Support diagnostics and ADR-004 direction-aware admin evidence protections; no generic secret leakage.
- Project permissions expose canAddPolicy/canCreateEnvironmentFromScratch, not project-member active/logged-in eligibility. Environment list is not deleted/expired participant history. Neither resolves GAP-28, GAP-32 or GAP-33 by contract alone.

## Evidence boundaries and retained v3

**SHIPPED MAIN:** At `dc8ec6a5`, PR456/457 are merged behavior-preserving v3 refactors, not v4 migrations. Their shared observation/resource retrieval seams reduce implementation coupling but establish no v4 runtime parity. **UNMERGED PR448:** PR448 remains unmerged; Ready archive and future-Start DELETE evidence reported there belongs to that PR, not shipped main. Preparing archive acceptance remains open under its existing authorization and asset restrictions. None of these contract findings closes that gate.

The current Infrastructure source has no replacement for catalog Blueprint/Snapshot list/detail, general VMware Region discovery, timezones, teams, project-member eligibility or archive. Retain existing verified v3 seams until the applicable current primary contract and exact live evidence exist. A `/v4/snapshots/{snapshotId}/public-cloud-resources` route does not constitute Snapshot catalog discovery. This bounded assessment is not a claim that no other CloudShare specification contains any future replacement.

## PENDING: conditional next migration slice

If migration is prioritized after #351 closes, the smallest plausible candidate is existing Project and Policy read discovery behind the shared resource seam, leaving Blueprint/Snapshot/Region discovery and all environment runtime/cancellation commands on current transport. No new product capability, policy/project write UI, broader framework or broad environment migration is implied.

Before a ticket is committed, confirm the seam and exact acceptance against existing issues and docs. Proposed bounded acceptance: all visible Projects retrieved across pagination; per-project Policy summaries/detail retain domain ids and timing meanings; shared Exam/Sales authoring behavior and their distinct failure/cache rules remain; unsupported discovery stays v3; existing Customer-scoped diagnostics remain useful on empty/field/legacy provider errors. Contract/TDD checks should cover page traversal, incomplete summary/detail, permissions and id/timing mapping.

Live acceptance must use real UI with a real Customer connection: exercise Project/Policy selection in existing authoring workflows, verify same exact ids and durations against authoritative provider evidence, confirm no accidental writes or runtime change, and confirm protected Support diagnostics on an authorized safe error path. Record browser interaction plus console result and human QA on the exact reviewed head. Published schema and read-only research are not substitutes for that live acceptance.

#411 remains the proposed next product slice, not authorized implementation; its priority and acceptance must be checked against its existing issue by the parent. This assessment makes no priority change or scope expansion.
