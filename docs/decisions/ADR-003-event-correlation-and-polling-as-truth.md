# ADR-003: Environment correlation via a portal-owned mapping; polling is truth, webhooks optional

**Status:** accepted (2026-06-13) — revises the `environmentExternalId`-in-webhook correlation
assumed by `webhooks.ts` / `labs.ts`.

## Decision

The CloudShare environment webhook payload carries CloudShare's own **environmentId**, an event
type, and a timestamp — but **no reference to the experience/training** it belongs to, and the
portal does **not** mint environment IDs (environments are bound from a standby at login). So:

- **The portal owns the correlation mapping:** `trainingId ↔ Candidate (email / studentId) ↔
  environmentId`, stored on/around the `LabLaunch`. The `environmentId` is unknown until login.
- **Environment IDs are discovered/reconciled via the v4 _list students in a training experience_
  endpoint**, which returns each participant and their `environmentId`.
- **Polling is the authoritative source of truth; webhooks are an optional, best-effort hint.**
  Because correlation already requires the list-students poll, the demo works **with no public
  tunnel**: poll list-students / environment state to observe created → running → suspended →
  resumed. Webhooks are shown only when a tunnel is available.
- **Webhook routing is per-Customer:** a per-Customer/per-project webhook **URL path** (opaque
  token) identifies the Customer so the receiver can select that Customer's secret to verify with
  (CloudShare allows no custom headers, and the body can't be trusted pre-verification). The webhook
  may be registered via the **v3 POST webhook** endpoint during "Connect CloudShare", with manual
  registration as the fallback.
- Idempotency key becomes `(environmentId, event, createdAt)`.

## Why

Self-set `environmentExternalId` correlation can't work: we don't create the environment and the
webhook doesn't name the experience. A portal-owned mapping reconciled by polling is the only
reliable correlation, and since we must poll anyway, leaning on polling (not webhooks) keeps demos
deterministic and tunnel-free — consistent with "fixtures for the show."

## Consequences

- `webhooks.ts` must drop the `EnvironmentExternalId` payload field in favour of CloudShare's
  `environmentId`; the receiver gains a Customer-resolution step from the URL.
- New gap-report items: webhook payload omits the experience; v3 webhook auto-registration is
  unverified (only done manually to date); list-students is the de-facto correlation source.
- A long candidate gap can still hit the ~2h suspended-state preservation limit (separate gap).
