# CloudShare API Reference Sources

This project keeps local CloudShare API exports so implementation agents do not infer endpoint
paths from memory or from earlier slices.

## Source and implementation status (2026-10-23)

**PUBLISHED CONTRACT:** The [current official Infrastructure OpenAPI source](https://cloudshare.stoplight.io/api/v1/projects/cloudshare/AccelerateAPI/nodes/reference/infrastructure-Public-API.openapi.json?branch=main)
identifies Infrastructure 4.0 and documents v4 Projects, Policies and environment operations.
The July Experience export listed below has a different scope; its lack of Infrastructure paths
is not evidence that those v4 contracts are absent. The preserved October 12 Infrastructure export
and current official source are assessed in the [dated contract-readiness report](../discovery/2026-10-23-cloudshare-v4-contract-readiness.md),
including pagination, permissions, identity, timing and command limitations.

**SHIPPED MAIN:** At `dc8ec6a5`, #454/#455 share environment and resource-discovery seams but
retain existing v3 provider traffic. Published replacements are not shipped migrations.
**LIVE VERIFIED:** This documentation assessment adds no live tenant verification.
**PENDING:** A Project/Policy read-only migration is conditional on separate scope agreement and
exact live acceptance; #453 authorizes no transport migration. Unmerged PR448 and its Preparing
acceptance gate remain independent; see the report for evidence boundaries.

## Local Reference Files

- `docs/api/assets/cloudshare-public-api-v4-2026-07-10.json`
  - Exported CloudShare Accelerate API OpenAPI 3.1 bundle.
  - Source date: 2026-07-10.
  - API title/version in export: `Accelerate API` / `v4`.
- `docs/api/assets/cloudshare-guided-journey-progress-2026-07-10.yml`
  - Exported Guided Journey Progress OpenAPI 3.0.1 bundle.
  - Source date: 2026-07-10.
  - API title/version in export: `CloudShare Guided Journey APIs` / `1.0.0`.

When changing CloudShare v4 integration code, check these local exports first. If the live tenant
contradicts the export, update `docs/api/cloudshare-gap-report.md` with the live evidence and keep
the adapter isolated behind `src/integrations/cloudshare`.

## Accelerate v4 Training Contract Inventory

The July exported v4 bundle lists the following training paths relevant to the MVP. This is a
published-contract inventory, not a claim that every operation is shipped or live verified:

| Capability | Method | Path |
| --- | --- | --- |
| Create/list trainings | `GET`, `POST` | `/trainings` |
| Read/update/delete training | `GET`, `PUT`, `DELETE` | `/trainings/{id}` |
| Add/list students | `GET`, `POST` | `/trainings/{id}/students` |
| Edit student | `PUT` | `/trainings/{trainingId}/students/{studentId}` |
| Add/list instructors | `GET`, `POST` | `/trainings/{id}/instructors` |
| Edit instructor | `PUT` | `/trainings/{trainingId}/instructors/{instructorId}` |
| Sponsored link | `POST` | `/trainings/{id}/sponsored-link` |
| Training user-property definitions | `GET`, `POST`, `DELETE` | `/trainings/{trainingId}/users/properties` |
| Specific training user-property definition | `PUT`, `DELETE` | `/trainings/{trainingId}/users/properties/{propertyId}` |
| Student environment correlation | `POST` | `/trainings/{trainingId}/students/{studentId}/environment` |
| Create student unassigned environment | `POST` | `/trainings/{trainingId}/students/unassigned-environment` |
| Read/delete student unassigned environment | `GET`, `DELETE` | `/trainings/{trainingId}/students/{studentId}/unassigned-environment` |

Important: training user-property definitions use `/trainings/{trainingId}/users/properties`, not
`/trainings/{trainingId}/user-properties`.

For training user-property definitions, `GET /trainings/{trainingId}/users/properties` returns all
definitions for the Experience; it is not filterable by key. Treat a `null` or empty array response
as no definitions, then compare keys locally. `POST /trainings/{trainingId}/users/properties` takes
an array body such as `[{ "name": "certalisExamAttemptId" }]` and returns an array of created
definitions.

## Guided Journey Progress Paths

The Guided Journey export lists:

| Capability | Method | Path |
| --- | --- | --- |
| Experience aggregated progress | `GET` | `/guided-journey/progress/{experienceId}` |
| Participant progress | `GET` | `/guided-journey/progress/{experienceId}/{participantId}` |

These endpoints are v4 Accelerate endpoints and use the same base URL:
`https://api.accelerate.cloudshare.com/v4`.

## Guardrails For Future Changes

## Production v3 Sales Environment Observation

Live verification for Sales monitoring confirmed that the v4 roster `envId` is a numeric roster
reference, not the opaque identifier accepted by v3 Environment actions. The supported observation
chain is `GET /envs?ownerEmail=<server-side email>&brief=false`, an exact server-side Project match,
then `GET /envs/actions/getextended?envId=<opaque v3 id>`. Only one same-Project match is accepted;
zero or multiple matches are an explicit needs-attention condition. Numeric status codes accepted by
the portal are `2`, `3`, `4`, `5`, `7`, `8`, and `9`.

- Do not use `/api/v3/class/*` endpoints for Accelerate Experience user properties.
- Do not invent v4 endpoint paths from surrounding naming patterns; verify them in the local export.
- Preserve typed request/response models at the `integrations/cloudshare` boundary.
- Keep failed CloudShare calls supportable with redacted method/path/status/request/response evidence.
- When CloudShare docs and live behavior differ, prefer the live-safe adapter behavior and record the
  discrepancy in `docs/api/cloudshare-gap-report.md`.
