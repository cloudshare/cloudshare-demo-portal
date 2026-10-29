# Issue 411 — authenticated Trial remote desktop downloads

## Contract and scope

Each existing Windows VM is shown by friendly name with its own explicit Download RDP link. There is no provisioning choice. Browser Trial launch remains independent. The participant may need guest credentials in their desktop client; Certalis does not generate a file or embed the provider's separate clear-text password.

- `GET /api/sales-trial/offerings/{offeringId}/rdp`: authenticated participant status and opaque VM selectors; no provider IDs or credentials.
- `GET /api/sales-trial/offerings/{offeringId}/rdp/{selector}`: fresh ownership, continued-enrollment lifecycle, participant correlation, exact Environment, and VM membership checks; provider file as an `application/rdp` attachment. All outcomes are `no-store`.
- Environment and VM discovery use v4. The narrowly authorized v3 `GET /vms/actions/getremoteaccessfile` uses the discovered MC ID and required 1920×1080 dimensions. The public-cloud EM-only v4 download operation is not used for these machines.
- Readiness requires a ready, unexpired Environment, completed VM preparation and a public external address. Known stopped/transitional VM states are unavailable. No resume, provisioning, ending reconciliation, or other provider mutation occurs.
- Protected Customer-scoped diagnostics retain provider evidence through the existing observer; ordinary responses and audit metadata exclude the separate password, raw provider bodies and provider IDs. The explicit attachment alone carries the provider's RDP content.

## Acceptance evidence

Automated seams: handler ownership/lifecycle and opaque selection; HTTP authorization/no-store/attachment; provider pagination, VM detail membership and signed v3 mapping; UI explicit availability check and native attachment link.

Live behavior, native-client opening, browser interaction/console evidence and protected Support diagnostics still require independent QA. Automated fixtures do not establish real network reachability or provider no-public-IP behavior. Human QA remains required before merge.

The Codex-owned server was stopped before source edits. No live assets, primary checkout, or port 3000 were changed during implementation.
