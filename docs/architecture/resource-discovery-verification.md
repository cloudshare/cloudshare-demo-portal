# Resource discovery verification — issue #455

Scope: behavior-preserving resource discovery under #453, following #454. No endpoint, auth,
wire, request-count, UI/API contract, schema, v4 transport or capability change is intended.

The agreed seams are the shared discovery interface used by both authoring adapters and the
existing caller authoring/cache/failure interfaces. Existing adapter tests remain useful caller
contract tests; no private-helper test layer was added. External dependencies are mocked only at
the CloudShare client/HTTP seam. Existing real-client fixture tests cover malformed, missing-field
and PascalCase detail payloads through the same shared implementation.

Before moving code, resource characterization passed 21 tests, including Blueprint description
versus Item summary projection, provider ordering, request counts and distinct Policy failure
timing. The first discovery test failed because its factory did not exist, then passed with the
shared Project read. The authoring-tuple test failed because the remaining discovery operations
did not exist, then passed with Region, Blueprint/detail/Snapshot and Policy/detail discovery.
These are RED/GREEN interface checks, not live-provider evidence.

Additional checks preserve detailed exchange IDs, protected query/body evidence and existing
fallback synthetic responses; original parsed Policy detail evidence versus normalized list
identity; missing lease evidence; default Snapshot and Region order; grouped Blueprint completed
reads and first input failure; Exam's awaited list observer before detail fan-out, prompt rejection,
and successful sibling observers that finish after rejection. Item still waits for all siblings
before selecting the first input-order failure. Existing authoring runtime/route tests retain
cache, invalidation, validation and diagnostic contracts. No security sanitization logic changed.

Run `npm run lint`, `npm run typecheck` and `npm test`; the PR records exact-head totals,
independent review and focused QA. Local Prisma client generation is dependency setup only;
no database or schema change is part of this slice. The implementation performs no live calls.
Any lifecycle-owner read-only live checks and concrete authoring-path smoke are separate evidence,
not implied by fixture tests. No new tenant assumption is claimed, so the gap report is unchanged.

Human-QA exemption is conditional on clean independent review and concrete smoke evidence proving
this behavior-preserving path, with no UI or active CloudShare runtime change. Any observable
behavior change requires stronger real-UI/live and human acceptance. The primary issue #351
checkout, port 3000, retained CloudShare fixtures and database remain outside implementation scope.
