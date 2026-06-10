# CloudShare API Gap Report

Living document tracking observed gaps between the CloudShare API's behaviour and the
requirements of a high-integrity certification/proctoring integration. Seeded from
discovery sessions and implementation experience; later slices should append new gaps
in the format below.

**How to append a gap:** copy the [gap template](#gap-template) at the bottom, assign
the next `GAP-N` identifier, and fill in the five fields. Commit alongside the slice
PR that surfaced the gap.

---

## GAP-1 — Dual, inconsistent authentication schemes

| Field | Detail |
|---|---|
| **Status** | Confirmed — implemented in `src/integrations/cloudshare/` |
| **Verified live** | No (modelled from documentation) |

**Observed behaviour**

The CloudShare platform exposes two distinct API surfaces with incompatible
authentication:

- **v4 (Accelerate)** uses OAuth 2.0 `client_credentials` and expects a short-lived
  Bearer JWT (`Authorization: Bearer <token>`, ~5-minute TTL).
- **v3 (Production/Classic)** uses a proprietary per-call HMAC signature scheme
  (`cs_sha1`): each request is signed with four query parameters — `UserApiId`,
  `Token` (random nonce), `Timestamp`, and `Cs_sig` (lowercase-hex SHA-1 of the
  concatenation `apiKey + fullUrl + timestamp + token`). The API key is folded into
  the hash and never sent on the wire.

Both surfaces are required for a full integration: v4 for lab provisioning
(`/experiences`, `/students`, `/sponsoredLinks`); v3 for environment state polling
(`/environments`) and resource sync (`/regions`).

**Impact on certification use**

- The portal must maintain two separate credential stores, token-refresh loops, and
  signing paths.
- The token cache for v4 must refresh aggressively (before 300 s) to avoid mid-session
  expiry during a proctored exam.
- Any future API migration that consolidates onto a single scheme requires changes
  isolated in `src/integrations/cloudshare/client.ts`, `v4-auth.ts`, and `signing.ts`.

**Code reference:** `src/integrations/cloudshare/client.ts:15-16`,
`src/integrations/cloudshare/v4-auth.ts`, `src/integrations/cloudshare/signing.ts`

---

## GAP-2 — Webhook secret is account-level and cannot be rotated

| Field | Detail |
|---|---|
| **Status** | Confirmed — noted in discovery |
| **Verified live** | No |

**Observed behaviour**

CloudShare issues a single webhook signing secret at the account level. There is no
documented API endpoint or portal UI to rotate or regenerate the secret after initial
provisioning.

**Impact on certification use**

- Secret compromise requires a support ticket or account-level intervention, not a
  self-serve rotation — creating a window of exposure in a high-integrity exam context.
- Because all environments in the account share the same secret, a compromise affects
  every integration simultaneously.
- The portal stores the secret as `CLOUDSHARE_WEBHOOK_SECRET` and never logs it; if
  rotation becomes possible, the secret can be swapped via environment variable without
  code changes.

**Code reference:** `src/integrations/cloudshare/webhooks.ts:26`,
`src/config/index.ts:27`

---

## GAP-3 — Webhooks are unreliable: no custom headers, no unique event ID

| Field | Detail |
|---|---|
| **Status** | Confirmed — design decision in Slice 6 |
| **Verified live** | No (modelled from documentation) |

**Observed behaviour**

CloudShare webhook deliveries have three known reliability problems:

1. **No unique event ID per delivery.** There is no `eventId` or idempotency key in
   the payload or headers, so the receiver cannot deduplicate retries without tracking
   its own hash of the payload fields (`event + environmentExternalId + createdAt`).
2. **No custom header support.** Callers cannot add custom metadata headers (e.g., a
   per-tenant routing key or a delivery ID). The only authentication signal is the
   HMAC signature in `x-cloudshare-signature` (header name unverified — assumption).
3. **Delivery is best-effort.** Missed events are not replayed; the portal must treat
   webhooks as "hints" and treat the result of polling `GET /environments` as the
   authoritative state.

**Impact on certification use**

- A proctored exam session that misses a `suspended` or `resumed` event risks the
  Kryterion timer going out of sync with the lab state.
- The portal mitigates this by making webhooks hints only: all state changes are
  confirmed by a follow-up poll of `GET /environments`, which is the source of truth.
- Duplicate/out-of-order events are safe because reconciliation is idempotent.

**Code reference:** `src/integrations/cloudshare/webhooks.ts`,
`src/domain/environment-reconcile.ts`

---

## GAP-4 — Close-tab or browser logout does not suspend the environment

| Field | Detail |
|---|---|
| **Status** | Confirmed — mitigated by heartbeat in Slice 8 |
| **Verified live** | Yes (observed during discovery) |

**Observed behaviour**

When a candidate closes the browser tab containing the CloudShare lab, or when the
sponsored-link session expires/logs out, the CloudShare environment continues running.
CloudShare does not expose a server-side callback or idle-detection mechanism that the
portal can rely on to trigger an automatic suspend.

**Impact on certification use**

- An unattended running environment during a proctored exam breaks the suspend/resume
  contract the Kryterion timer depends on: the timer would be paused but the lab would
  remain live.
- Resource leak: environments left running consume capacity and incur billing.
- The portal mitigates this with a client-side heartbeat (`POST /api/heartbeat` every
  15 s) and a `sendBeacon` call on `pagehide`/`visibilitychange`. A server-side
  `HeartbeatAutoSuspend` service triggers `suspendEnvironment` after 60 s without a
  heartbeat.

**Code reference:** `src/web/lab-launcher.tsx`,
`src/domain/heartbeat-auto-suspend.ts`, `src/api/heartbeat.ts`

---

## GAP-5 — Suspended environments are preserved for approximately 2 hours only

| Field | Detail |
|---|---|
| **Status** | Confirmed — noted in discovery |
| **Verified live** | No (figure from discovery session; exact value not confirmed via API) |

**Observed behaviour**

CloudShare preserves the state of a suspended environment for approximately 2 hours.
After that window, the environment is archived or deleted and resume is no longer
possible.

**Impact on certification use**

- A certification exam that requires a candidate to pause and return later (break,
  connection loss, proctor hold) risks environment loss if the gap exceeds ~2 hours.
- The portal must inform the candidate of this constraint at the point of suspend and
  must surface an appropriate error if resume is attempted against an archived
  environment.
- Exact retention policy (whether 2 hours is configurable per account/blueprint) should
  be verified with CloudShare before GA.

---

## GAP-6 — Labs cannot be embedded in a third-party portal via `<iframe>`

| Field | Detail |
|---|---|
| **Status** | Confirmed — observed via browser developer tools |
| **Verified live** | Yes (observed during discovery) |

**Observed behaviour**

CloudShare's lab UI sets `Content-Security-Policy: frame-ancestors 'none'` (or
equivalent `X-Frame-Options: DENY`), preventing the lab from being embedded in an
`<iframe>` hosted on a third-party origin such as this portal.

**Impact on certification use**

- The portal cannot render the lab inline alongside a proctoring UI element; the
  candidate must work in a separate browser window/tab.
- The `LabLauncher` component uses `window.open` to launch the sponsored link in a
  child window and polls `childWindow.closed` for close detection; `sendBeacon` is
  used on `pagehide`/`visibilitychange` as a fallback.
- Any design that assumes embedded lab rendering (e.g., side-by-side proctor + lab
  view) must be redesigned to work with a separate window model.

**Code reference:** `src/web/lab-launcher.tsx`, `src/web/lab-window.ts`

---

## GAP-7 — Certification scoring is weak: bitmap checkpoints, end-state only

| Field | Detail |
|---|---|
| **Status** | Confirmed — implemented in `src/integrations/cloudshare/guided-journey.ts` |
| **Verified live** | Partially (feature exists; limitations from documentation and Q3 2026 roadmap) |

**Observed behaviour**

CloudShare Guided Journey scoring has three significant limitations:

1. **Bitmap checkpoints only.** Scoring uses visual-state comparison (screenshot diff)
   rather than process-level or OS-level capture. A candidate can reach the correct
   visual state by an unintended method and still receive credit.
2. **End-state verification only.** Intermediate steps and the approach taken are not
   assessed. Only the final state of the environment matters for scoring.
3. **Deterministic script-based verification is not generally available until Q3 2026.**
   Per CloudShare roadmap, a more reliable script-driven verification mode is not GA
   until Q3 2026.

**Impact on certification use**

- The scoring API (`GET /experiences/{id}/journey/participants`) returns
  `completedTasks / totalTasks` and a `progress` percentage; the portal surfaces these
  directly to the candidate.
- Final certification pass/fail weighting is determined by Genesys, not this portal.
- These limitations must be disclosed to the exam author when configuring checkpoints.

**Code reference:** `src/integrations/cloudshare/guided-journey.ts:26-31`

---

## GAP-8 — Documentation is fragmented; pre-provision SLA is ambiguous (UNVERIFIED)

| Field | Detail |
|---|---|
| **Status** | Unverified — conflicting data from discovery |
| **Verified live** | No — requires live API/support confirmation |

**Observed behaviour**

Two conflicting figures for environment pre-provisioning lead time appear in
CloudShare discovery materials:

- **5 hours** — stated in a follow-up email during discovery (2026-06-07).
- **1 hour** — stated in handwritten notes from the same discovery session.

Beyond the SLA conflict, the CloudShare API documentation is fragmented across
multiple portals (Accelerate v4 API reference, Classic/Production v3 reference,
and an Experience Portal guide), with no single unified reference. Endpoint paths,
field names, and auth schemes are documented in different places and may be
inconsistent.

**Impact on certification use**

- If the portal pre-provisions labs in advance to reduce candidate wait time, it
  must schedule provisioning with the correct lead time to avoid either wasted
  resource-hours (provisioning too early) or candidate-facing delays (too late).
- Known documentation gaps tracked as code assumptions in this codebase:
  - `x-cloudshare-signature` header name (webhooks) — unverified.
  - Webhook payload field names (`Event`, `EnvironmentExternalId`, `CreatedAt`) — unverified.
  - `GET /environments?externalId=...` path for resolving environment by external ID — unverified.
  - `POST /environments/{id}/actions/suspend` and `…/resume` paths — unverified.
  - `GET /experiences/{id}/journey/participants` response envelope — unverified.

**Action required:** Confirm the pre-provision SLA directly with CloudShare support or
by timing a live provisioning call. Update this entry with the confirmed value.

**Code reference:** `docs/discovery/2026-06-07-follow-up-email.txt`,
`src/integrations/cloudshare/environment.ts:11-15`,
`src/integrations/cloudshare/webhooks.ts:14-26`,
`src/integrations/cloudshare/environment-controller.ts:9-15`,
`src/integrations/cloudshare/guided-journey.ts:14-18`

---

## GAP-9 — Registration friction: "Registered Students Only" gate blocks direct login

| Field | Detail |
|---|---|
| **Status** | Confirmed — implemented in `src/integrations/cloudshare/labs.ts` |
| **Verified live** | No (modelled from documentation) |

**Observed behaviour**

CloudShare experiences created with `RegisteredStudentsOnly` visibility require that
each candidate's email address is explicitly added to the experience's student roster
via `POST /experiences/{id}/students` before the sponsored login link is generated via
`POST /experiences/{id}/sponsoredLinks`. Without this step, accessing the sponsored
link results in a login-denied or access-denied error.

**Impact on certification use**

- The portal must perform two sequential API calls per lab launch: add-student then
  create-sponsored-link. If add-student fails, the launch must be aborted before the
  link is ever generated.
- The `createCloudShareLabProvisioner` adapter implements this two-step flow; the
  `createSponsoredLink` use case runs add-student first.
- `RegisteredStudentsOnly` is the assumed visibility value for exam-scoped experiences;
  this must be confirmed against the live API.
- The student-registration step is idempotent on re-launch (the API should handle a
  duplicate add gracefully), but this behaviour should be confirmed.

**Code reference:** `src/integrations/cloudshare/labs.ts:18-20`,
`src/domain/use-cases/create-sponsored-link.ts`

---

## Gap template

Copy this section when appending a new gap discovered during implementation:

```markdown
## GAP-N — Short descriptive title

| Field | Detail |
|---|---|
| **Status** | Confirmed / Suspected / Unverified |
| **Verified live** | Yes / No / Partial |

**Observed behaviour**

[What CloudShare actually does, with enough detail to understand the deviation from
expected behaviour.]

**Impact on certification use**

[How this gap affects the proctoring portal, what risk it creates, and any mitigations
already in place.]

**Code reference:** (optional) `src/...`
```

---

*Last updated: 2026-06-10. Maintained by: portal team. Append new entries above the
gap template; do not renumber existing gaps.*
