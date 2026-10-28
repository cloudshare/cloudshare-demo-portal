# Integration Slice Protocol

Use this protocol for any slice that touches CloudShare or any future live external integration.
It exists because Slice 1 exposed that "tests exist" is not enough for integration quality.

## Non-negotiables

- Build API-first: define the portal HTTP API route, typed request/response contract, and
  framework-agnostic `src/api/*` handler before or alongside the UI. UI components must call the
  same API a script or E2E test can call.
- Build through the real integration adapter seam. Mock CloudShare only at `integrations/cloudshare`, never inside `domain`.
- Verify protocol details against the local CloudShare API exports documented in
  `docs/api/cloudshare-api-reference.md`, the CloudShare docs, the known-good Postman implementation
  where available, and the live tenant before relying on them.
- Treat local live credentials in `.env.e2e.local` as the development evidence path. Do not commit real credentials.
  In Codex worktrees where `.env.e2e.local` is absent, the user's seed credential file is
  `D:\Code_projects\cloudshare-demo-portal\config\portal-seed.local.json`. Generate a temporary,
  ignored `.env.e2e.local` from that JSON without printing secret values, run the live check, then
  delete the generated env file.
- Add support diagnostics with the feature, not after the failure. Every CloudShare API diagnostic
  must include the attempted operation, integration surface, correlation ID where useful, and
  structured HTTP evidence: request method, path, query parameters, fail-closed request headers with only the explicit operational allowlist visible,
  verbatim request body when present, response status, response headers, verbatim provider response
  body, and transport failure details when no response was received. Body fields are never scrubbed
  by name or value pattern; this protected evidence is Customer-scoped admin-only data.
- Update `docs/api/cloudshare-gap-report.md` immediately when CloudShare behavior confirms or contradicts an assumption.
- Keep fixture tests and live E2E tests separate: `npm test` must stay deterministic and offline; `npm run test:e2e:live` may call CloudShare.

## Before coding

1. Read the issue acceptance criteria and classify each criterion as automated, live E2E, manual UI verification, or documentation.
2. Define the portal API endpoint(s) first: method, path, auth/session requirement, request body,
   response body, status codes, redaction rules, and idempotency / retry behavior.
3. Identify every CloudShare endpoint, auth scheme, response shape, and failure mode the slice depends on.
   For v4 Accelerate endpoints, verify paths in `docs/api/cloudshare-api-reference.md` and the
   corresponding export under `docs/api/assets/`; do not infer paths from adjacent endpoint names.
4. For any uncertain CloudShare behavior, write or run the smallest live probe at the integration seam before building UI or domain behavior around it.
5. Decide the support diagnostic payload before implementation, so failures are supportable from the first live run. For CloudShare API calls, retain request/query and provider-response bodies verbatim in protected Customer-scoped admin diagnostics, preserve only the explicit safe operational request-header allowlist and mask every other header, and keep bodies out of generic traces and ordinary client surfaces.

## During implementation

1. Use `/tdd` one behavior at a time. Start with the API handler seam unless the behavior is purely
   presentational.
2. Keep the domain layer free of CloudShare wire details. Put request signing, bearer-token handling, endpoint paths, schemas, and error mapping in `integrations/cloudshare`.
3. Preserve a fixture/offline path for deterministic tests and demos.
4. Add a live E2E check when local credentials can exercise the behavior safely and cheaply.
5. Record confirmed live-tenant behavior in the gap report while the evidence is fresh.

## Browser persona isolation for CloudShare QA

CloudShare permits one logged-in CloudShare persona per browser session. Cookies are shared
across tabs and normal windows in the same Chrome profile; two Incognito windows in one profile
also share their Incognito session. Separate tabs or windows therefore do not isolate personas.

Use a dedicated Chrome profile for each persona, creating additional dedicated profiles when
needed. A Sales Trial launch into CloudShare must not share a profile/session already holding a
different CloudShare persona. Preserve unrelated sessions: do not sign them out, reset them or
repurpose their profiles to make a QA flow fit. Before persona-sensitive actions, verify both the
portal Customer/role and the actual CloudShare viewer identity. A portal role, profile alias or
tab title alone does not establish the CloudShare identity.

For #474 the human-designated profile names are exactly **Candidate 1**, **Owner Admin** and
**Foreign Admin**. Record the actual profile/session binding alongside these names; keep earlier
tool metadata and QA labels as dated evidence rather than rewriting their history.

This is a human-provided operating constraint, not an established cause of earlier
`Runtime.evaluate` or screenshot timeouts. Diagnose such failures from their own evidence. The
#474 missing Blueprint fixture was a separately established cause of its admission-guard failure.

## Before review

Run and record:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e:live
```

For UI/integration slices, also run the real UI flow and record:

- what account/customer was used, without secrets
- which operation was attempted
- the observed CloudShare result
- the admin-visible diagnostic on success or failure
- any gap-report updates made

## PR / Review Checklist

The PR summary must explicitly state:

- automated tests added or updated
- API endpoint(s), request/response contract, and auth/session behavior added or changed
- live E2E verification performed, or why it is not possible for this slice
- UI/manual verification performed, if applicable
- support diagnostics verified
- CloudShare assumptions confirmed, contradicted, or still open
- docs updated, especially `docs/api/cloudshare-gap-report.md`

If GitHub/Copilot/Codex review is unavailable, do not block the slice. Use this protocol, local checks,
live verification, manual PR notes, and issue acceptance-criteria reconciliation as the fallback review path.
