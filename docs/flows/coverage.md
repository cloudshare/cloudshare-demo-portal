# Coverage, evidence and maintenance

[Guide](README.md) · [Endpoint inventory](endpoints.md)

This matrix was built from `app` pages/routes, `src/web`, framework-independent `src/api` handlers, domain workflows, persistence and CloudShare adapters at **`0d5794a20532735d8d0f80bffb533ae541c7b4a9`**. It describes implemented behavior rather than treating the older MVP outline as a feature inventory.

## Persona and action coverage

| Persona / surface | Implemented actions and significant variants | Guide |
|---|---|---|
| Anonymous / shared | Login, Candidate registration, Trial registration/login, role/workspace routing, safe return target, invalid credentials | [Authentication](authentication.md) |
| All signed-in users | Session read/expiry, logout; Candidate suspension side effect vs other roles | [Authentication](authentication.md), [operations](operations.md) |
| Trial participant | Available Offering list, initial/server data vs browser GET, empty list, popup reuse/blocking, entry eligibility | [Sales Trial](sales-trial.md) |
| Trial participant | New registration vs existing exact enrollment; missing definitions, paginated roster, duplicate/same-email/propertyless/conflicting mapping; reservation/partial failure | [Sales Trial](sales-trial.md#the-entry-request-exactly-in-order) |
| Trial participant | Sponsored 302, subsequent visits, unpublished/ending retained access, expiry/concluded states | [Sales Trial](sales-trial.md#subsequent-visits-and-failure-recovery) |
| Trial participant | In-card RDP status, Windows selector, download, explicit guest credentials, preparing/unavailable/provider failure, no connectivity guarantee | [Sales Trial](sales-trial.md#optional-rdp-and-guest-credentials) |
| Sales Admin / records | Account/Opportunity/Contact create/edit/archive, hierarchy/search, local-only CRM context | [Sales configuration](sales-configuration.md#local-records-and-defaults) |
| Sales Admin / setup | Naming template, timezone cache/preference, Project member/Sales Pro choices | [Sales configuration](sales-configuration.md#local-records-and-defaults) |
| Sales Admin / Items | Catalog/detail, live authoring resource controls, save/edit/archive, default Snapshot/Region/Policy validation | [Sales configuration](sales-configuration.md#item-authoring-and-control-population) |
| Sales Admin / sessions | Local queue/workspace, demo API alias, creation reservation, provider provisioning, safe partial outcomes | [Sales sessions](sales-sessions.md#read-controls-provision-verify-and-cancel) |
| Sales Admin / sessions | Verify/reconcile existing active mapping, targeted queue refresh, stale/incomplete observations, deferred PUT; unsupported PATCH | [Sales sessions](sales-sessions.md#read-controls-provision-verify-and-cancel) |
| Sales Admin / cancellation | Authoritative future Start/timezone DELETE gate vs archive/End update, durable command and readback/partial result | [Sales sessions](sales-sessions.md#read-controls-provision-verify-and-cancel) |
| Sales Admin / participants | Local search/page, remote discovery/refresh, existing Contact/ad hoc add, explicit legacy repair, uncertain-add reconciliation | [Sales sessions](sales-sessions.md#participant-workspace-reads-addition-and-invitation) |
| Sales Admin / invitation | Capability, target/revision guards, invite/resend command ledger, accepted-unconfirmed/readback/no blind resend | [Sales sessions](sales-sessions.md#participant-workspace-reads-addition-and-invitation) |
| Sales Admin / participant access | Generate/regenerate/revoke local capability; recipient redirect and denial recovery contacts | [Sales sessions](sales-sessions.md#launch-links) |
| Sales Admin / extension | Multi-target environment extension, canonical owner/Project identity, durable dispatch/readback, coordinated Sales End | [Sales sessions](sales-sessions.md#extend-participants) |
| Sales Admin / Trial Offerings | Draft, publish, open-ended validation, uncertainty/needs-attention, local unpublish | [Trial administration](trial-administration.md#create-and-publish) |
| Sales Admin / Trial participants | History/live/stale monitoring, retained enrollment mapping, one-participant extension | [Trial administration](trial-administration.md#unpublish-monitor-and-extend) |
| Sales Admin / Trial End | Close admission, retained expiry buffers, leased ending reconciliation, request/background triggers | [Trial administration](trial-administration.md#end-and-retained-environments) |
| Customer admin / Connection | Read/save encrypted configuration, test v3 ping, distinction from v4 permission | [Certification admin](certification-admin.md#connection-and-resource-controls) |
| Customer admin / resources | Sync, cache/bootstrap/project/detail reads, default Snapshot guard, v3/v4 split | [Certification admin](certification-admin.md#connection-and-resource-controls) |
| Customer admin / Exams | List/create/edit/publish/unpublish/archive, existing attempts confirmation, active cohort archive gate, timing fields | [Certification admin](certification-admin.md#exam-authoring-and-lifecycle) |
| Customer admin / Candidates | Roster/search/detail/history, account creation with local-only scope | [Certification admin](certification-admin.md#candidates) |
| Customer admin / cohorts | Draft/list/detail/publication, parent publication, unknown-outcome fence, close admission, retire | [Certification admin](certification-admin.md#cohort-session-configuration-and-admission) |
| Candidate / admission | Catalog and own history, future individual schedule with admin-configured Regions, per-attempt training provisioning, partial steps | [Candidate](certification-candidate.md#schedule-an-individual-exam) |
| Candidate / cohort admission | Existing training join, provider Start gate, properties/student/link, no second training | [Candidate](certification-candidate.md#join-a-cohort-session) |
| Candidate / entry | Start/status/open-period/lease/ownership gates, server-only URL, persisted clock start, environment discovery | [Candidate](certification-candidate.md#enter-and-discover-the-environment) |
| Candidate / runtime | Status/heartbeat, child window, suspend/resume, durable command and observation, automatic completion/expiry | [Candidate](certification-candidate.md#runtime-clock-suspend-and-completion) |
| Candidate / completion/results | Archive-before-end, local completion failure recovery, disabled/no-score/provider failure, score/history | [Candidate](certification-candidate.md#score-and-history) |
| Support / monitoring | Certification current state, attempt diagnostic context, Sales workspace/Trial history, stale observations | [Operations](operations.md#find-one-action-end-to-end) |
| Support / evidence | Diagnostic queries, exchange/correlation IDs, semantic vs HTTP evidence, audit vs events, protected payload limits | [Operations](operations.md#find-one-action-end-to-end) |
| Operator / automatic work | Session watchdog, heartbeat/sweep, Trial ending interval, local seed/health, background-disabled limits | [Operations](operations.md#automatic-work-and-request-triggered-work) |
| Provider / webhook | Opaque Customer path, raw-body HMAC, payload variants, diagnostic fingerprint/correlation; repeated valid hints reconcile, authoritative read, rejection/202 semantics | [Operations](operations.md#webhook-receipt-and-correlation) |

## Page inventory

| Page source route | Purpose / chapter |
|---|---|
| `/` | Session-aware home routing → [authentication](authentication.md) |
| `/login` | Shared login and registration choices → [authentication](authentication.md) |
| `/register` | Candidate registration → [authentication](authentication.md) |
| `/admin` | Certification admin shell and its catalog/Candidates/cohort/monitoring/Support sections → [admin](certification-admin.md), [operations](operations.md) |
| `/candidate` | Catalog, scheduling/join and attempt history → [Candidate](certification-candidate.md) |
| `/candidate/lab` | Attempt launcher/runtime → [Candidate](certification-candidate.md) |
| `/candidate/score` | Attempt result → [Candidate](certification-candidate.md#score-and-history) |
| `/sales` | Sales records, Items, session queue/configuration → [configuration](sales-configuration.md), [sessions](sales-sessions.md) |
| `/sales/sessions/{sessionId}` | Session and participant workspace → [sessions](sales-sessions.md) |
| `/sales/diagnostics` | Sales Customer support evidence → [operations](operations.md) |
| `/sales/trial-offerings` | Offering lifecycle and participant administration → [Trial administration](trial-administration.md) |
| `/sales-trial` | Participant catalog and RDP controls → [Sales Trial](sales-trial.md) |
| `/sales-trial/login` | Trial-only sign in → [authentication](authentication.md) |
| `/sales-trial/register` | Trial account registration → [Sales Trial](sales-trial.md) |

All **89 route files** are listed in the [endpoint index](endpoints.md), including compatibility aliases and explicit unsupported credentials methods. These 14 pages plus 89 routes account for the 103 route/page files in the baseline. Layouts, CSS, test fixtures, migrations and development scripts are supporting implementation rather than additional user flows.

## Intentional exclusions and unavailable behavior

General Sales Session editing is explicitly deferred (valid PUT 409; invalid PUT 400; unsupported PATCH 405). Automatic CloudShare webhook registration is not a verified implemented operational flow. An actual desktop RDP connection is not tested by the Portal's download/readiness checks. Full Certification journeys beyond Exams, external CRM integrations, and speculative provider endpoints are not presented as shipped features. Unused compatibility adapter operations are identified in the [contract discrepancy record](endpoints.md#contract-and-implementation-discrepancies), not promoted to current flow calls.

No runtime/UI features, new product site, screenshots of protected data or live provider mutations are part of this documentation change. It is a repository guide rendered with Markdown/Mermaid. Tests that merely repeat prose were not added; validation targets source agreement, route completeness, links and diagrams.

## Evidence and maintenance

**Code/contract evidence:** route exports, UI requests, handler call order, domain guards/persistence and provider adapter paths were inspected at the source commit above. v4 paths were checked against the API reference and bundled public/Infrastructure exports; Guided Journey against its separate YAML; v3 exceptions `/users` and archive are explicitly flagged. Independent documentation QA checks routes/links and renders the diagrams. This proves the guide describes source, not that all provider states are reproducible on every tenant.

**Live evidence:** no new live CloudShare calls or mutations were performed for this guide. Existing [gap report](../api/cloudshare-gap-report.md), [environment migration evidence](../discovery/2026-10-26-environment-v4-migration.md) and [extension migration evidence](../discovery/2026-10-27-default-extension-v4-migration.md) remain historical evidence with their own limits. Do not relabel their observations as a new end-to-end pass. UI descriptions above are source-based; this task's rendered browser QA is documentation rendering, not new portal/live integration QA.

**Repository checks for this change:** lint and typecheck passed. The parent task ran the suite: 296 test files passed and one baseline file, `src/web/candidate-home-route-focus.test.tsx`, failed with four assertions; 2,645 tests passed. Isolated rerun reproduced four failures (seven passed). The launcher suite's 14 tests passed. Runtime/app/test/package/Prisma content was unchanged relative to the baseline; no application fix is bundled into the guide. The PR records exact documentation review/render results and final head separately from the source baseline.

**When to update:** a change to a page action, route method/path, control-population request, permission gate, lifecycle/command state, polling trigger, correlation rule, provider adapter or contract must update its chapter and endpoint/coverage entries in the same PR. Re-run local link/anchor checks and render every changed Mermaid block; independently review call order and secret boundaries. Record the new source commit and distinguish automated, code/contract and live observations. Keep graphs focused; link to a related flow rather than merging all personas into one diagram.
