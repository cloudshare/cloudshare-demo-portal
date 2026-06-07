# CloudShare Demo Portal

Working repository for the CloudShare demo portal discovery, requirements, architecture notes and implementation artefacts.

## Project structure

- docs/discovery/ - meeting transcripts, follow-up emails and source discovery material
- docs/requirements/ - functional and non-functional requirements
- docs/architecture/ - system design and integration notes
- docs/decisions/ - architecture decision records
- docs/api/ - API notes, payloads and integration contracts
- docs/meeting-notes/ - ongoing meeting notes

## Source layout

- `src/config` — typed, Zod-validated runtime configuration (fails fast at boot)
- `src/observability` — structured logging with secret redaction
- `src/persistence` — repository interfaces over Prisma
- `src/domain` — framework-agnostic business logic
- `src/auth` — candidate authentication seam (see below)
- `src/integrations/cloudshare` — CloudShare adapter (see below)
- `src/integrations/kryterion` — Kryterion simulator (mints candidate exam tokens)
- `src/composition.ts` — composition root wiring the modules together

## CloudShare integration

All CloudShare access goes through the typed adapter seam in
`src/integrations/cloudshare`; no other layer touches CloudShare HTTP, auth, or
wire formats directly. Build a client with `createCloudShareIntegration`:

```ts
import { createCloudShareIntegration } from "@/integrations/cloudshare";

const cloudshare = createCloudShareIntegration({
  mode: config.runtime.mode, // "live" | "fixture"
  v4: { clientId, clientSecret },
  v3: { apiId, apiKey },
});

const projects = await cloudshare.requestV4({
  method: "GET",
  path: "/projects",
  schema: projectsSchema, // Zod schema validated at the boundary
});
```

- **v4 (Accelerate):** Bearer JWT via `client_credentials`, cached and refreshed
  before the ~5-minute expiry.
- **v3 (Production):** per-call `cs_sha1` request signing (single-use token).
- **Live vs fixture:** chosen by `mode`. Fixture mode replays recorded JSON from
  `src/integrations/cloudshare/fixtures/` through the identical code path, so
  contract tests and demos run with no live calls.
- Every response is Zod-validated; every failure is a typed `CloudShareError`.

## Candidate identity

Candidates authenticate without a password. The Kryterion simulator mints a
short-lived, single-use signed token (`KRYTERION_TOKEN_SECRET`, HMAC-SHA256)
pinned to exactly one `ExamAttempt` when an exam starts. The `auth` layer
validates it and admits the candidate to that attempt only:

- `verifyExamToken` checks signature, schema, and expiry.
- The `CandidateAuthenticator` seam enforces **single-use** (a consumed-token
  store denies replay) and mints a session bound to the token's `ExamAttempt`.
- The session is stored and resumable by id, so it survives a page reload
  (`POST /api/candidate/admit` sets an httpOnly cookie; `GET /api/candidate/session` resumes).
- Token verification lives behind the `auth` interface so a real IdP/OIDC can
  replace the token scheme without touching callers.

Stores are in-memory for the demo (swappable for Prisma-backed adapters).
