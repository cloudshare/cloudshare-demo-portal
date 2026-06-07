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
- `src/integrations/cloudshare` — CloudShare adapter (see below)
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
