# Issue #349: personalised Certalis instant launch

This implementation slice is tracked by GitHub issue #349. Its authoritative scope and acceptance
criteria remain in that issue and the Sales Enablement requirements linked from parent issue #343.

## Agreed test seams

- Typed Sales Admin HTTP handlers for launch-link lifecycle operations.
- The public instant-launch HTTP handler for validation and redirect behaviour.
- The persistence interface for opaque token lifecycle and Customer/Session/Participant ownership.
- The typed per-Customer CloudShare adapter for just-in-time sponsored-link creation.

Tests exercise observable behaviour through these interfaces. CloudShare is mocked only at the
integration seam; live verification remains separate.

## Deep-module design

`SalesSessionParticipant.id` is the participant row's global primary key and every row belongs to exactly one `SalesDemoSession`. Diagnostic `subjectId` therefore identifies the session participant without a redundant `sessionId`; every read remains independently Customer-scoped.

`sales-participant-launch` is the deep module at the launch-capability seam. Its small interface
creates, revokes, and resolves an opaque capability; callers never learn hashing, token generation,
ownership joins, timing checks, or CloudShare wire paths. The public redirect handler returns only a
generic denial for every invalid capability state. The sole CloudShare adapter call is the confirmed
`POST /v4/sales/{id}/sponsored-link` contract, with the registered participant's server-resolved
name and email and `preRegisteredStudent: false`; the v4 export states the link is valid for five
minutes. The adapter response remains server-only and the handler turns it into a redirect.
