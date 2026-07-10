# CloudShare API Reference Sources

This project keeps local CloudShare API exports so implementation agents do not infer endpoint
paths from memory or from earlier slices.

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

## Accelerate v4 Paths Currently Used By The Portal

The exported v4 bundle lists the following training paths relevant to the MVP:

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

## Guided Journey Progress Paths

The Guided Journey export lists:

| Capability | Method | Path |
| --- | --- | --- |
| Experience aggregated progress | `GET` | `/guided-journey/progress/{experienceId}` |
| Participant progress | `GET` | `/guided-journey/progress/{experienceId}/{participantId}` |

These endpoints are v4 Accelerate endpoints and use the same base URL:
`https://api.accelerate.cloudshare.com/v4`.

## Guardrails For Future Changes

- Do not use `/api/v3/class/*` endpoints for Accelerate Experience user properties.
- Do not invent v4 endpoint paths from surrounding naming patterns; verify them in the local export.
- Preserve typed request/response models at the `integrations/cloudshare` boundary.
- Keep failed CloudShare calls supportable with redacted method/path/status/request/response evidence.
- When CloudShare docs and live behavior differ, prefer the live-safe adapter behavior and record the
  discrepancy in `docs/api/cloudshare-gap-report.md`.
