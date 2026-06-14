# ADR-001: CloudShare credentials are per-Customer, supplied into the portal

**Status:** accepted (2026-06-12) — supersedes the global-credential assumption in the original PRD/`.env`.

## Decision

Each **Customer** (e.g. Helios CX) owns its own CloudShare subscription and supplies its CloudShare
credentials — a single **API ID + API key** (used for both v3 and v4) plus the **webhook secret** —
into the portal via a "Connect CloudShare" screen. These are stored **per-Customer, encrypted at
rest** (a portal master key, the one CloudShare-related secret remaining in `.env`, encrypts them;
decryption happens only at call time; raw keys are never logged). The **Certification Provider
(Certalis) holds no CloudShare credentials of its own.** The CloudShare integration client is
therefore instantiated **per-Customer** from the stored connection, not from global config.

The demo seeds one Customer (Helios) and its connection through the same encrypted store/code path,
so it is pre-connected; the live "Connect CloudShare" path is still built (it is the realistic
onboarding flow). Connections are validated with the v3 `ping` → `pong` request.

## Why

The earlier design read CloudShare keys from global env vars, implying the Provider owned one
subscription all customers drew from. That is wrong: Helios is a customer of *both* Certalis and
CloudShare and brings its own subscription. Modelling credentials as per-Customer data (a) matches
reality, (b) makes the eventual multi-tenant story a data concern rather than a rewrite, and (c)
keeps the Provider out of the business of holding third-party secrets.

## Consequences

- Multi-tenant is deferred but seam-ready: a second Customer is new rows, not new code.
- Storing third-party secrets adds an encryption-at-rest and key-management requirement to the
  `config`/`persistence`/`auth` layers, and a "Test connection" action to the admin UI.
- The webhook receiver must resolve **which Customer** an inbound webhook belongs to (via
  `environmentExternalId`) before it can select the right secret to verify the signature.
- The global `CLOUDSHARE_V4_*` / `CLOUDSHARE_V3_*` / `CLOUDSHARE_WEBHOOK_SECRET` env vars are
  retired in favour of the per-Customer connection record.
