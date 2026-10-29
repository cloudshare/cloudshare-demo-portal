# #487 guest credential contract and verification plan

The deliberate `POST /api/sales-trial/offerings/{offeringId}/rdp/{selector}/credentials`
uses the existing authenticated Sales Trial RDP gate and a same-origin check. No body is required.
Success is exactly `{ username, password }`; all outcomes carry `Cache-Control: no-store`.
Failures use controlled participant messages (401/403/404/409/502/503), never provider evidence.
The RDP attachment GET and sponsored launch remain independent.

The current Infrastructure 4.0 export (`cloudshare-infrastructure-v4-2026-10-26.json`)
defines `GET /v4/environments/{envId}/vms/{vmId}` (`EnvironmentsV4_GetVm`) and `VmResponse`
with nullable string `username` and `password`. A dedicated detail schema validates these fields
and fresh VM identity, Windows OS, Running status, completed progress and configured FQDN.
The existing list projection remains credential-free. Missing/empty credentials fail closed.
Only the two required values leave the adapter on this action; no v3 file call is made.

Each action repeats own active enrollment, Customer, Experience, complete participant roster,
exact enrollment custom-properties/participant ID and email, and owner/Project Environment checks.
The selector binds Customer, enrollment, Environment and VM; fresh listing and detail revalidate it.
Numeric roster Environment references remain distinct from Infrastructure EN identifiers.

Fanout per action: one Experience GET, complete roster read, paginated Environment list plus one
Environment detail, paginated VM list (existing maximum 1000 records), one VM detail. All are reads;
no file/provision/resume/network operation. One-page fanout is six provider GETs plus one OAuth
request for a fresh client. Pagination and the existing single safe GET-429 retry count as physical
requests; existing token acquisition/renewal remains client-owned.
Live requests need a separately approved disposable asset/window and physical request/auth budget.
No live calls are authorized by this implementation plan.

Protected Customer-admin diagnostics reuse `sales-trial-rdp` and existing request observer, preserving
provider bodies and masking authorization headers. Ordinary errors/audits contain no credentials.
The credential action records controlled failure reasons for denied/stale/unavailable checks.

The UI starts with both values masked per the human instruction. Explicit Show/Hide and Copy controls
are scoped to one selected VM. Hide/dismissal clears fetched values; a later show fetches fresh.
Page exit/unmount invalidates pending responses and clears state. No storage, prefetch or logging.

Approved automated seams: existing handler, adapter, HTTP and UI. TDD covers owner success,
cross-Customer/participant denial, stale/unavailable/missing data, no-store, no-prefetch and secret-safe
errors. Independent browser QA must interact with Show/Hide/Copy and navigation and inspect console.
Live portal retrieval, protected support evidence and human native-RDP connection acceptance remain
separate required gates before merge.

## Initial automated evidence

Isolated physical worktree dependencies and Prisma client; its own `prisma/test.db`; no live secrets.
Red/green commands: `npx vitest run src/integrations/cloudshare/trial-rdp.test.ts` initially failed
for missing credential retrieval; handler test initially returned a file instead of credentials;
HTTP tests initially failed for the absent action/response; UI test initially lacked the action.
Each passed after the corresponding bounded implementation.
Final focused command: `npx vitest run src/api/sales-trial-rdp.test.ts src/api/sales-trial-rdp-http.test.ts src/integrations/cloudshare/trial-rdp.test.ts src/web/sales-trial-rdp.test.tsx` — 72 passed.
`npm run typecheck` passed. Full-suite, build, independent review, browser and live acceptance
are lifecycle-orchestrator gates, not claimed by this implementation evidence.
