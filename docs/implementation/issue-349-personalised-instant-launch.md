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
