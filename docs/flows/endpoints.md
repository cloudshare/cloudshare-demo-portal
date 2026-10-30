# Endpoint-to-flow index

[Guide](README.md) · [Coverage and evidence](coverage.md)

## Portal HTTP routes

Inventory of every `app/**/route.ts` at the recorded baseline, including the two non-API redirect families and `/enter`. `{name}` represents the source route's `[name]` segment. Methods are exported application handlers; framework-generated HEAD/OPTIONS behavior is not an additional product action. The credentials route's explicit 405 exports are listed separately. Read the linked chapter for **ordered, conditional** operations: the provider column is a dispatch summary, not a claim that every call always runs. Page routes and server-rendered initial data are inventoried in [coverage](coverage.md).

| Method | Portal path | Flow | Provider/local dispatch summary | Source |
|---|---|---|---|---|
| `GET` | `/api/admin/audit` | [operations](operations.md) | Local protected diagnostic/audit/event read | [route](../../app/api/admin/audit/route.ts) |
| `GET` | `/api/admin/candidates/{candidateId}` | [certification-admin](certification-admin.md) | Local account/roster/attempt evidence; no provider participant create | [route](../../app/api/admin/candidates/[candidateId]/route.ts) |
| `GET, POST` | `/api/admin/candidates` | [certification-admin](certification-admin.md) | Local account/roster/attempt evidence; no provider participant create | [route](../../app/api/admin/candidates/route.ts) |
| `GET, PUT` | `/api/admin/cloudshare` | [certification-admin](certification-admin.md) | Local encrypted Connection configuration | [route](../../app/api/admin/cloudshare/route.ts) |
| `POST` | `/api/admin/cloudshare/test` | [certification-admin](certification-admin.md) | v3 GET /ping | [route](../../app/api/admin/cloudshare/test/route.ts) |
| `GET` | `/api/admin/diagnostics/attempts/{examAttemptId}` | [operations](operations.md) | Local protected diagnostic/audit/event read | [route](../../app/api/admin/diagnostics/attempts/[examAttemptId]/route.ts) |
| `GET` | `/api/admin/diagnostics` | [operations](operations.md) | Local protected diagnostic/audit/event read | [route](../../app/api/admin/diagnostics/route.ts) |
| `GET` | `/api/admin/events` | [operations](operations.md) | Local protected diagnostic/audit/event read | [route](../../app/api/admin/events/route.ts) |
| `GET` | `/api/admin/exam-authoring/projects/{projectId}/blueprints/{blueprintId}` | [certification-admin](certification-admin.md) | Resource discovery R; cached authoring reads unless refresh | [route](../../app/api/admin/exam-authoring/projects/[projectId]/blueprints/[blueprintId]/route.ts) |
| `GET` | `/api/admin/exam-authoring/projects/{projectId}` | [certification-admin](certification-admin.md) | Resource discovery R; cached authoring reads unless refresh | [route](../../app/api/admin/exam-authoring/projects/[projectId]/route.ts) |
| `GET` | `/api/admin/exam-authoring` | [certification-admin](certification-admin.md) | Resource discovery R; cached authoring reads unless refresh | [route](../../app/api/admin/exam-authoring/route.ts) |
| `POST` | `/api/admin/exams/{examId}/archive` | [certification-admin](certification-admin.md) | Local lifecycle guards/change | [route](../../app/api/admin/exams/[examId]/archive/route.ts) |
| `POST` | `/api/admin/exams/{examId}/cohort-sessions/{sessionId}/close-admission` | [certification-admin](certification-admin.md) | Local admission closure | [route](../../app/api/admin/exams/[examId]/cohort-sessions/[sessionId]/close-admission/route.ts) |
| `POST` | `/api/admin/exams/{examId}/cohort-sessions/{sessionId}/publish` | [certification-admin](certification-admin.md) | Snapshot guard; v3 teams; v4 training POST and user properties | [route](../../app/api/admin/exams/[examId]/cohort-sessions/[sessionId]/publish/route.ts) |
| `POST` | `/api/admin/exams/{examId}/cohort-sessions/{sessionId}/retire` | [certification-admin](certification-admin.md) | v4 students; training GET/PUT and conditional readback | [route](../../app/api/admin/exams/[examId]/cohort-sessions/[sessionId]/retire/route.ts) |
| `GET` | `/api/admin/exams/{examId}/cohort-sessions/{sessionId}` | [certification-admin](certification-admin.md) | Local detail; v4 training students and conditional aggregate Guided Journey GET | [route](../../app/api/admin/exams/[examId]/cohort-sessions/[sessionId]/route.ts) |
| `GET, POST` | `/api/admin/exams/{examId}/cohort-sessions` | [certification-admin](certification-admin.md) | Local session list/draft create | [route](../../app/api/admin/exams/[examId]/cohort-sessions/route.ts) |
| `POST` | `/api/admin/exams/{examId}/publish` | [certification-admin](certification-admin.md) | v3 Blueprint detail guard; local publish | [route](../../app/api/admin/exams/[examId]/publish/route.ts) |
| `PATCH` | `/api/admin/exams/{examId}` | [certification-admin](certification-admin.md) | GET/create/edit use local catalog and authoring cache; no training creation | [route](../../app/api/admin/exams/[examId]/route.ts) |
| `POST` | `/api/admin/exams/{examId}/unpublish` | [certification-admin](certification-admin.md) | Local lifecycle guards/change | [route](../../app/api/admin/exams/[examId]/unpublish/route.ts) |
| `GET, POST` | `/api/admin/exams` | [certification-admin](certification-admin.md) | GET/create/edit use local catalog and authoring cache; no training creation | [route](../../app/api/admin/exams/route.ts) |
| `GET` | `/api/admin/monitoring` | [operations](operations.md) | Local view plus conditional completion/external-lease reads | [route](../../app/api/admin/monitoring/route.ts) |
| `POST` | `/api/admin/sync-resources` | [certification-admin](certification-admin.md) | Resource discovery R; cached authoring reads unless refresh | [route](../../app/api/admin/sync-resources/route.ts) |
| `POST` | `/api/auth/login` | [authentication](authentication.md) | Local identity; Candidate logout conditionally uses runtime suspension | [route](../../app/api/auth/login/route.ts) |
| `POST` | `/api/auth/logout` | [authentication](authentication.md) | Local identity; Candidate logout conditionally uses runtime suspension | [route](../../app/api/auth/logout/route.ts) |
| `GET` | `/api/auth/session` | [authentication](authentication.md) | Local identity; Candidate logout conditionally uses runtime suspension | [route](../../app/api/auth/session/route.ts) |
| `POST` | `/api/candidate/exams/cohort-sessions/join` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/api/candidate/exams/cohort-sessions/join/route.ts) |
| `GET, POST` | `/api/candidate/exams` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/api/candidate/exams/route.ts) |
| `POST` | `/api/candidate/register` | [authentication](authentication.md) | Local identity; Candidate logout conditionally uses runtime suspension | [route](../../app/api/candidate/register/route.ts) |
| `POST` | `/api/candidate/runtime-diagnostics` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/api/candidate/runtime-diagnostics/route.ts) |
| `POST` | `/api/exam/complete` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/api/exam/complete/route.ts) |
| `POST` | `/api/exam/resume` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/api/exam/resume/route.ts) |
| `GET` | `/api/exam/score` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/api/exam/score/route.ts) |
| `GET` | `/api/exam/status` | [certification-candidate](certification-candidate.md) | Local elapsed-clock completion/status only; no provider calls or score capture | [route](../../app/api/exam/status/route.ts) |
| `POST` | `/api/exam/suspend` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/api/exam/suspend/route.ts) |
| `GET` | `/api/health` | [operations](operations.md) | Local application/persistence readiness | [route](../../app/api/health/route.ts) |
| `POST` | `/api/heartbeat` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/api/heartbeat/route.ts) |
| `POST` | `/api/sales/accounts/{accountId}/archive` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/accounts/[accountId]/archive/route.ts) |
| `PATCH` | `/api/sales/accounts/{accountId}` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/accounts/[accountId]/route.ts) |
| `GET, POST` | `/api/sales/accounts` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/accounts/route.ts) |
| `POST` | `/api/sales/contacts/{contactId}/archive` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/contacts/[contactId]/archive/route.ts) |
| `PATCH` | `/api/sales/contacts/{contactId}` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/contacts/[contactId]/route.ts) |
| `POST` | `/api/sales/contacts` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/contacts/route.ts) |
| `GET, POST` | `/api/sales/demo-sessions` | [sales-sessions](sales-sessions.md) | GET local; POST resource/member validation then v4 POST /sales | [route](../../app/api/sales/demo-sessions/route.ts) |
| `GET` | `/api/sales/diagnostics` | [operations](operations.md) | Local protected evidence read | [route](../../app/api/sales/diagnostics/route.ts) |
| `GET, POST` | `/api/sales/enablement-sessions/{sessionId}/cancel` | [sales-sessions](sales-sessions.md) | Sales/roster + environment reads; conditional Sales DELETE, v3 archive, Sales End PUT/readback | [route](../../app/api/sales/enablement-sessions/[sessionId]/cancel/route.ts) |
| `POST, DELETE` | `/api/sales/enablement-sessions/{sessionId}/participants/{participantId}/launch-link` | [sales-sessions](sales-sessions.md) | Local capability generate/revoke | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/[participantId]/launch-link/route.ts) |
| `POST` | `/api/sales/enablement-sessions/{sessionId}/participants/add/reconcile` | [sales-sessions](sales-sessions.md) | Conditional Sales roster/properties/participant or environment calls; see action trace | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/add/reconcile/route.ts) |
| `POST` | `/api/sales/enablement-sessions/{sessionId}/participants/add` | [sales-sessions](sales-sessions.md) | Conditional Sales roster/properties/participant or environment calls; see action trace | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/add/route.ts) |
| `GET, POST` | `/api/sales/enablement-sessions/{sessionId}/participants/extend` | [sales-sessions](sales-sessions.md) | Sales/roster + environment reads; conditional v4 extend and Sales End PUT/readback | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/extend/route.ts) |
| `POST` | `/api/sales/enablement-sessions/{sessionId}/participants/invite` | [sales-sessions](sales-sessions.md) | Sales capability/roster reads; conditional POST invite; roster reconciliation | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/invite/route.ts) |
| `GET` | `/api/sales/enablement-sessions/{sessionId}/participants/page` | [sales-sessions](sales-sessions.md) | Local workspace/query projection | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/page/route.ts) |
| `GET` | `/api/sales/enablement-sessions/{sessionId}/participants/provider` | [sales-sessions](sales-sessions.md) | Conditional Sales roster/properties/participant or environment calls; see action trace | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/provider/route.ts) |
| `POST` | `/api/sales/enablement-sessions/{sessionId}/participants/refresh` | [sales-sessions](sales-sessions.md) | Conditional Sales roster/properties/participant or environment calls; see action trace | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/refresh/route.ts) |
| `GET` | `/api/sales/enablement-sessions/{sessionId}/participants` | [sales-sessions](sales-sessions.md) | Local workspace/query projection | [route](../../app/api/sales/enablement-sessions/[sessionId]/participants/route.ts) |
| `POST` | `/api/sales/enablement-sessions/{sessionId}/reconcile` | [sales-sessions](sales-sessions.md) | v4 GET /sales/{id}; persist observation | [route](../../app/api/sales/enablement-sessions/[sessionId]/reconcile/route.ts) |
| `PUT` | `/api/sales/enablement-sessions/{sessionId}` | [sales-sessions](sales-sessions.md) | Valid PUT deferred: 409; invalid input: 400; PATCH unsupported: 405; no provider call | [route](../../app/api/sales/enablement-sessions/[sessionId]/route.ts) |
| `POST` | `/api/sales/enablement-sessions/{sessionId}/verify` | [sales-sessions](sales-sessions.md) | v4 GET /sales/{id}; persist observation | [route](../../app/api/sales/enablement-sessions/[sessionId]/verify/route.ts) |
| `GET` | `/api/sales/enablement-sessions/{sessionId}/workspace` | [sales-sessions](sales-sessions.md) | Local workspace/query projection | [route](../../app/api/sales/enablement-sessions/[sessionId]/workspace/route.ts) |
| `GET` | `/api/sales/enablement-sessions/project-members` | [sales-configuration](sales-configuration.md) | v3 GET /users (export gap) | [route](../../app/api/sales/enablement-sessions/project-members/route.ts) |
| `POST` | `/api/sales/enablement-sessions/refresh` | [sales-sessions](sales-sessions.md) | v4 GET /sales with bounded ID filter/pagination | [route](../../app/api/sales/enablement-sessions/refresh/route.ts) |
| `GET, POST` | `/api/sales/enablement-sessions` | [sales-sessions](sales-sessions.md) | GET local; POST resource/member validation then v4 POST /sales | [route](../../app/api/sales/enablement-sessions/route.ts) |
| `GET` | `/api/sales/item-authoring/projects/{projectId}` | [sales-configuration](sales-configuration.md) | Cached or live resource discovery (R group below) | [route](../../app/api/sales/item-authoring/projects/[projectId]/route.ts) |
| `GET` | `/api/sales/item-authoring` | [sales-configuration](sales-configuration.md) | Cached or live resource discovery (R group below) | [route](../../app/api/sales/item-authoring/route.ts) |
| `POST` | `/api/sales/items/{itemId}/archive` | [sales-configuration](sales-configuration.md) | Reads/archive local; create/edit live resource validation | [route](../../app/api/sales/items/[itemId]/archive/route.ts) |
| `GET, PUT` | `/api/sales/items/{itemId}` | [sales-configuration](sales-configuration.md) | Reads/archive local; create/edit live resource validation | [route](../../app/api/sales/items/[itemId]/route.ts) |
| `GET, POST` | `/api/sales/items` | [sales-configuration](sales-configuration.md) | Reads/archive local; create/edit live resource validation | [route](../../app/api/sales/items/route.ts) |
| `POST` | `/api/sales/opportunities/{opportunityId}/archive` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/opportunities/[opportunityId]/archive/route.ts) |
| `PATCH` | `/api/sales/opportunities/{opportunityId}` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/opportunities/[opportunityId]/route.ts) |
| `POST` | `/api/sales/opportunities` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/opportunities/route.ts) |
| `GET, PUT` | `/api/sales/session-configuration` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/session-configuration/route.ts) |
| `GET` | `/api/sales/session-opportunities` | [sales-configuration](sales-configuration.md) | Local record/configuration read or mutation; no CloudShare | [route](../../app/api/sales/session-opportunities/route.ts) |
| `GET, PUT` | `/api/sales/timezones` | [sales-configuration](sales-configuration.md) | GET cached or v3 GET /timezones; PUT local preference | [route](../../app/api/sales/timezones/route.ts) |
| `POST` | `/api/sales/trial-offerings/{id}/end` | [trial-administration](trial-administration.md) | Draft/list/unpublish local; publish Sales create; end/monitor/extend conditional Sales + environment calls | [route](../../app/api/sales/trial-offerings/[id]/end/route.ts) |
| `POST` | `/api/sales/trial-offerings/{id}/participants/{participantId}/extend` | [trial-administration](trial-administration.md) | Draft/list/unpublish local; publish Sales create; end/monitor/extend conditional Sales + environment calls | [route](../../app/api/sales/trial-offerings/[id]/participants/[participantId]/extend/route.ts) |
| `GET` | `/api/sales/trial-offerings/{id}/participants` | [trial-administration](trial-administration.md) | Draft/list/unpublish local; publish Sales create; end/monitor/extend conditional Sales + environment calls | [route](../../app/api/sales/trial-offerings/[id]/participants/route.ts) |
| `POST` | `/api/sales/trial-offerings/{id}/publish` | [trial-administration](trial-administration.md) | Draft/list/unpublish local; publish Sales create; end/monitor/extend conditional Sales + environment calls | [route](../../app/api/sales/trial-offerings/[id]/publish/route.ts) |
| `POST` | `/api/sales/trial-offerings/{id}/unpublish` | [trial-administration](trial-administration.md) | Draft/list/unpublish local; publish Sales create; end/monitor/extend conditional Sales + environment calls | [route](../../app/api/sales/trial-offerings/[id]/unpublish/route.ts) |
| `GET, POST` | `/api/sales/trial-offerings` | [trial-administration](trial-administration.md) | Draft/list/unpublish local; publish Sales create; end/monitor/extend conditional Sales + environment calls | [route](../../app/api/sales/trial-offerings/route.ts) |
| `POST` | `/api/sales-trial/login` | [authentication](authentication.md) | Local identity; Candidate logout conditionally uses runtime suspension | [route](../../app/api/sales-trial/login/route.ts) |
| `POST` | `/api/sales-trial/offerings/{offeringId}/rdp/{selector}/credentials` | [sales-trial](sales-trial.md) | Trial entry/RDP conditional Sales + environment + VM calls; offering list local | [route](../../app/api/sales-trial/offerings/[offeringId]/rdp/[selector]/credentials/route.ts) |
| `GET, PUT, PATCH, DELETE, HEAD, OPTIONS` | `/api/sales-trial/offerings/{offeringId}/rdp/{selector}/credentials` | [sales-trial](sales-trial.md) | Explicit 405 only; no provider call | [route](../../app/api/sales-trial/offerings/[offeringId]/rdp/[selector]/credentials/route.ts) |
| `GET` | `/api/sales-trial/offerings/{offeringId}/rdp/{selector}` | [sales-trial](sales-trial.md) | Trial entry/RDP conditional Sales + environment + VM calls; offering list local | [route](../../app/api/sales-trial/offerings/[offeringId]/rdp/[selector]/route.ts) |
| `GET` | `/api/sales-trial/offerings/{offeringId}/rdp` | [sales-trial](sales-trial.md) | Trial entry/RDP conditional Sales + environment + VM calls; offering list local | [route](../../app/api/sales-trial/offerings/[offeringId]/rdp/route.ts) |
| `GET` | `/api/sales-trial/offerings` | [sales-trial](sales-trial.md) | Trial entry/RDP conditional Sales + environment + VM calls; offering list local | [route](../../app/api/sales-trial/offerings/route.ts) |
| `POST` | `/api/sales-trial/register` | [authentication](authentication.md) | Local identity; Candidate logout conditionally uses runtime suspension | [route](../../app/api/sales-trial/register/route.ts) |
| `POST` | `/api/webhooks/cloudshare/{webhookPathToken}` | [operations](operations.md) | Inbound HMAC/diagnostic fingerprint; repeated valid hints reconcile; authoritative v4 environment GET reconciliation | [route](../../app/api/webhooks/cloudshare/[webhookPathToken]/route.ts) |
| `GET` | `/enter` | [certification-candidate](certification-candidate.md) | Candidate admission/runtime/score conditional provider calls; see ordered action trace | [route](../../app/enter/route.ts) |
| `GET` | `/sales/launch/{token}` | [sales-sessions](sales-sessions.md) | v4 POST /sales/{id}/sponsored-link; conditional Sales Pro recovery read | [route](../../app/sales/launch/[token]/route.ts) |
| `GET` | `/sales-trial/offerings/{offeringId}/enter` | [sales-trial](sales-trial.md) | Trial entry/RDP conditional Sales + environment + VM calls; offering list local | [route](../../app/sales-trial/offerings/[offeringId]/enter/route.ts) |

## CloudShare operations

Paths below are relative to the appropriate configured API base. v4 uses Bearer auth from conditional Customer-scoped `POST /oauth/token`; v3 uses `cs_sha1`. Lowercase Sales pagination (`offset`, `limit`) and uppercase Infrastructure pagination (`Count`, `Offset`, `Limit`) are intentional.

| Group | Version, method and exact path | Consumers / purpose | Contract and implementation |
|---|---|---|---|
| A | v4 `POST /oauth/token` | Conditional token acquisition for all v4 operations; reusable token cache | [auth adapter](../../src/integrations/cloudshare/v4-auth.ts), [v4 export](../api/assets/cloudshare-public-api-v4-2026-07-10.json) |
| R | v3 `GET /ping` | Connection test only | [ping](../../src/integrations/cloudshare/ping.ts), [v3 export](../api/assets/cloudshare-api-v3-2026-10-29.json) |
| R | v4 `GET /projects` | All Project pages, `Count=true&Offset={n}&Limit=100` | [resources](../../src/integrations/cloudshare/resources.ts), [Infrastructure export](../api/assets/cloudshare-infrastructure-v4-2026-10-26.json) |
| R | v4 `GET /projects/{projectId}/policies` | Project Policy list, `Count=true`; require completeness | [resources](../../src/integrations/cloudshare/resources.ts), Infrastructure export |
| R | v4 `GET /projects/{projectId}/policies/{policyId}` | Runtime/storage lease detail and Project identity validation | resources, Infrastructure export |
| R | v3 `GET /regions` | Authoring/sync Region choices | resources, v3 export |
| R | v3 `GET /projects/{projectId}/blueprints` | Authoring/sync Blueprint choices | resources, v3 export |
| R | v3 `GET /projects/{projectId}/blueprints/{blueprintId}` | Default Snapshot/Region guard and authoring detail | resources, v3 export |
| R | v3 `GET /teams` | Training creation's Project team lookup | [labs](../../src/integrations/cloudshare/labs.ts), [cohorts](../../src/integrations/cloudshare/cohort-experiences.ts), v3 export |
| R | v3 `GET /timezones` | Sales cached timezone choices | [timezones](../../src/integrations/cloudshare/timezones.ts), v3 export |
| R | v3 `GET /users` | Project Sales Pro choices | [members](../../src/integrations/cloudshare/project-members.ts); **not in bundled v3 export**, see discrepancy below |
| S | v4 `GET /sales` | Targeted session status refresh with `field`, `offset`, `limit` | [Sales delivery](../../src/integrations/cloudshare/sales-delivery.ts), v4 export |
| S | v4 `POST /sales` | Enablement Session/Trial Offering provisioning | Sales delivery, v4 export |
| S | v4 `GET /sales/{id}` | Status, invitation capability, guarded update pre-read, Trial/RDP access | Sales delivery, v4 export |
| S | v4 `PUT /sales/{id}` | Conditional controlled End/cancel-label update preserving returned mutable fields; not the disabled Portal general edit | Sales delivery, v4 export |
| S | v4 `DELETE /sales/{id}` | Conditional future-session cancellation, gated by freshly read Start/timezone | Sales delivery, v4 export |
| S | v4 `GET /sales/{id}/salespros` | Launch denial recovery contacts; bounded pages | Sales delivery, v4 export |
| S | v4 `GET`, `POST /sales/{id}/users/properties` | Read then create missing correlation definitions | Sales delivery, v4 export |
| S | v4 `GET /sales/{id}/participants` | Complete roster via `offset`/`limit`; registration/invite/monitor/access proof | Sales delivery, v4 export |
| S | v4 `POST /sales/{id}/participants` | Register selected contacts or Trial enrollment; authoritative roster readback follows | Sales delivery, v4 export |
| S | v4 `PUT /sales/{id}/participants/{participantId}` | Explicit Sales Admin legacy correlation repair | Sales delivery, v4 export |
| S | v4 `POST /sales/{id}/participants/invite` | Explicit native invitation with provider participant ID array | Sales delivery, v4 export |
| S | v4 `POST /sales/{id}/sponsored-link` | Trial entry and Certalis capability redirect | Sales delivery, v4 export |
| T | v4 `POST /trainings` | Individual schedule or cohort publication | [training delivery](../../src/integrations/cloudshare/training-delivery.ts), [labs](../../src/integrations/cloudshare/labs.ts), v4 export |
| T | v4 `GET /trainings/{id}` | Cohort start, external lease, retirement pre-read/readback | labs, [external lease](../../src/integrations/cloudshare/external-lease.ts), v4 export |
| T | v4 `PUT /trainings/{id}` | Cohort retirement End update | [retirement](../../src/integrations/cloudshare/cohort-experience-retirement.ts), v4 export |
| T | v4 `GET`, `POST /trainings/{id}/users/properties` | Certalis attempt correlation definitions | labs, v4 export |
| T | v4 `POST /trainings/{id}/students` | Individual/cohort Candidate admission | labs, v4 export |
| T | v4 `GET /trainings/{id}/students` | Participant/environment correlation and monitoring | [participants](../../src/integrations/cloudshare/participants.ts), v4 export |
| T | v4 `POST /trainings/{id}/sponsored-link` | Server-side launch URL at scheduling/join | labs, v4 export |
| E | v4 `GET /environments` | Sales/Trial owner resolution; `OwnerEmail`, `Count`, `Offset`, `Limit`; Project checked against observations | [v4 observations](../../src/integrations/cloudshare/environments-v4.ts), Infrastructure export |
| E | v4 `GET /environments/{id}` | Certification/Sales/Trial state and lease; command readback; webhook reconciliation | [environment source](../../src/integrations/cloudshare/environment.ts), v4 observations, Infrastructure export |
| E | v4 `POST /environments/{id}/suspend` | Candidate manual/automatic/logout suspension | [controller](../../src/integrations/cloudshare/environment-controller.ts), Infrastructure export |
| E | v4 `POST /environments/{id}/resume` | Candidate resume | controller, Infrastructure export |
| E | v4 `POST /environments/{id}/extend` | Sales/Trial default extension, no body | [command](../../src/integrations/cloudshare/environment-command.ts), Infrastructure export |
| E | v3 `PUT /envs/actions/archive` | `envId` query; Candidate completion and Sales cancellation retention | controller; **not in bundled v3 export**, see discrepancy below |
| V | v4 `GET /environments/{id}/vms` | Paginated Windows VM discovery for Trial RDP | [Trial RDP](../../src/integrations/cloudshare/trial-rdp.ts), Infrastructure export |
| V | v4 `GET /environments/{id}/vms/{vmId}` | Revalidate selected VM; explicit guest credentials | Trial RDP, Infrastructure export |
| V | v3 `GET /vms/actions/getremoteaccessfile` | RDP download with `vmId`, `desktopWidth=1920`, `desktopHeight=1080` | Trial RDP, v3 export |
| G | v4 `GET /guided-journey/progress/{experienceId}/{participantId}` | Candidate score progress | [Guided Journey adapter](../../src/integrations/cloudshare/guided-journey.ts), [progress contract](../api/assets/cloudshare-guided-journey-progress-2026-07-10.yml) |
| G | v4 `GET /guided-journey/progress/{experienceId}` | Cohort session detail aggregate monitoring; not an extra call on every Candidate score request | Guided Journey adapter, progress contract |

## Contract and implementation discrepancies

The active paths were compared with the [API reference](../api/cloudshare-api-reference.md) and the three bundled OpenAPI exports above; Guided Journey uses its separate YAML contract. Path parameter names differ between source and export, so equivalence is by resource/method, not placeholder spelling.

- v3 `GET /users` (Project members) and `PUT /envs/actions/archive` are implemented but absent from the bundled v3 export. Existing [gap-report evidence](../api/cloudshare-gap-report.md) records the distinction, including GAP-19. This guide records current calls and historical evidence limits; it does not assert a newly published contract or newly verify those operations live.
- VM FQDN/public-RDP readiness is a tenant-observed signal, not a general OpenAPI guarantee; see GAP-36 in the [API reference](../api/cloudshare-api-reference.md). Ready UI means the implemented eligibility checks passed, not that a desktop client connection was tested.
- Compatibility `createExperience` / `addStudent` adapter methods contain `/experiences` paths. Active Certification orchestration uses `/trainings`; these are not additional current Portal flow calls. Do not copy unused adapter paths into an implementation plan as confirmed provider endpoints.
- Historical documents describe v3 environment observation/extend or pending RDP. Current source uses the v4 state/suspend/resume/extend operations above, with v3 archive and RDP-file exceptions. The [migration record](../discovery/2026-10-27-default-extension-v4-migration.md) separates prior live evidence from current contracts.

A provider write timeout is not permission to retry. The HTTP client has bounded handling for eligible safe GET failures; durable workflow command state determines write recovery. Inspect per-attempt exchange evidence and the relevant chapter rather than assuming all methods share a retry policy.
