# Private Blueprint capture plan — not executed

## Evidence and scope

This is a static contract audit and proposed operator plan for #489. No provider
request, guest sanitation, Snapshot, clone, Blueprint or privacy change was
executed for it. #493's deployment was accepted and merged in #494 on 2026-10-31;
this documentation merge is not permission to alter that deployment. Earlier
install/build, HTTPS/authentication, reboot and source-sync evidence remains
historical, not a current inventory. #493 adds documentation/browser evidence;
do not equate that with complete #489 portal-browser or maintenance acceptance.

A Blueprint is an object associated with Projects; multiple Projects can point
to the same object. Project-nested reads demonstrate availability, not exclusive
ownership. The desired result is a reusable private Blueprint associated with
the authorized testing Project without unintentionally affecting other users of
the object. No capture is authorized by this plan.

## Exact published contracts

Sources: the checked-in [v3 OpenAPI](../api/assets/cloudshare-api-v3-2026-10-29.json)
and [Infrastructure v4 OpenAPI](../api/assets/cloudshare-infrastructure-v4-2026-10-26.json).
v3 uses `cs_sha1` at `https://use.cloudshare.com/api/v3`; v4 uses Bearer auth at
`https://api.accelerate.cloudshare.com`. They are not interchangeable. A successful
credential ping does not establish subscription actor/ownership.

| Purpose | Exact contract | Limitation |
|---|---|---|
| Environment correlation | v4 `GET /v4/environments/{id}` →200 | Read `projectId`, `blueprintId`, source `snapshotId`, status and exact owner/name. Blueprint IDs can exist before a first Snapshot. |
| Available Blueprints | v3 `GET /projects/{projectId}/blueprints` →200 | Optional `regionId`, `defaultSnapshot`; default-only results omit other versions. |
| Blueprint detail | v3 `GET /projects/{projectId}/blueprints/{blueprintId}` →200 | `createFromVersions` lists Snapshot versions, not privacy/exclusive ownership. |
| Environment Snapshots | v3 `GET /snapshots/actions/getforenv?envId=...` →200 | Contract warns at most five Snapshots are retained; a new one can displace the oldest. |
| Snapshot detail | v3 `GET /snapshots/{snapshotId}` →200 | Identity/name/time/default/regions; no explicit completion-status field. |
| Capture | v3 `POST /snapshots/actions/takesnapshot` →204 empty | No new Snapshot ID or operation token. Errors include400/401/403/404/500; never blindly replay an ambiguous write. |
| Change default | v3 `PUT /snapshots/actions/markdefault?id=...` →204 empty | Separate mutation, not Blueprint privacy/Overview/rename/association management. |

v3 `components.schemas.TakeSnapshotRequest` requires `envId` and `name` (maximum
32 characters). Nullable optional fields: `description`, `newBlueprintName`,
`otherBlueprintId`, `setAsDefault`, `otherProjectId`, `regions`. Regions must be
objects such as `[{"id":"RE..."}]`, not strings. **`setAsDefault` defaults true**;
an approved request must choose it explicitly instead of changing a default by
omission.

`newBlueprintName` and `otherBlueprintId` are mutually exclusive and **both must
be null if the environment's default Blueprint has no Snapshots yet**. A first
capture therefore cannot assume it can directly create a separately named
Blueprint. `otherProjectId` applies only with `newBlueprintName`, is ignored with
`otherBlueprintId`, and does not prove exclusive association or privacy. Read the
current first-Snapshot state and agree the target before writing.

No standalone Blueprint create/update/privacy/Project-association management
route was found in these inspected bundles. Do not invent a Blueprint POST/PUT/
PATCH from the capture option. Environment PATCH changes an Environment;
Infrastructure public-cloud Snapshot allowed-region changes do not configure
this VMware capture. Overview, privacy, associations and any required naming
changes need verified UI controls or additional documented contracts. `VC*.json`
names in customization sync alone do not establish Blueprint mapping.

The exact `paths` entries above and v3 `TakeSnapshotRequest`, `Snapshot`,
`Blueprint` plus Infrastructure `EnvironmentResponse` are the primary references.
These are contract findings, not fresh live-tenant verification.

## Decisions required before approval

Record the exact actor, authorized Project, environment/VM identities, current
Blueprint, Snapshot inventory/default/regions, approved source and final #493
deployment. Confirm real visibility/associations in the UI, including whether
other Projects use the target default. Never treat a Project association as ownership.

The owner must select the first-Snapshot target/default behavior, private-source
distribution permission, retained fixture data, and a per-clone credential and
hostname setup method. Existing backend certificates and redirect rules name the
rehearsal hosts: copying them is not a working clone-hostname configuration.
No first-use provisioning feature is implemented or authorized by this plan.

## Sanitation manifest for separately approved guest work

Preserve evidence and matched private backups **outside the captured guests**
before clearing anything. Review Windows and Linux independently against #493's
accepted deployment record, including its instance-specific SSH/workspace state.

| Material | Required capture decision/check |
|---|---|
| `.env`, master key, seeded passwords | Do not distribute rehearsal secrets to clones. Decide removal or verified fresh per-clone generation before declaring reusable. |
| SQLite and all sidecars | Decide fresh schema versus approved fixture data. Remove sessions, QA users, unrelated diagnostics and Connections. Unlinking a file alone does not prove secrets are absent from disk. |
| Source, `.git`, Git config, bundles | Confirm private-source distribution permission; inspect history/config for credentials and keep only approved source/artifacts. No personal GitHub account/token/key. |
| Logs, uploads, task output, private evidence | Export required evidence privately, then exclude secret-bearing output and retired artifacts from the candidate image. |
| TLS keys and host-specific config | Resolve each clone's fresh key/certificate identity and real hostname; do not distribute the rehearsal private key as a shared identity. |
| OS/account state | Audit browser credentials/profiles, shell/PowerShell history, downloads and account access using supported image preparation. Do not invent OS generalization steps. |
| #493 additions | Audit VS Code account state, static docs, Nginx aliases and Overview links. Retain the reviewed publication artifact, not an accidentally exposed checkout. |

Include the Windows synthetic browser-QA Candidate and any subsequent QA records
in the database audit without publishing their raw identity values. The ordinary
[same-VM fixture reset](../implementation/two-os-maintenance.md) preserves env/key
and therefore does not sanitize a reusable image.

## Proposed bounded capture and verification

1. After a separately coordinated maintenance release, finish outstanding portal/browser/maintenance
   acceptance. Re-read identities and Snapshot inventory, freeze source/config,
   and record the approved sanitation and clone-setup decisions.
2. Obtain separate approval for concrete sanitation and the exact capture request.
   Stop writes, back up privately, perform only approved sanitation and inspect
   retained contents. Stop before capture while any secret/clone identity remains
   unresolved. This plan proposes no automated deletion.
3. Verify actual UI target/privacy/associations. Resolve first-Snapshot restrictions
   explicitly; do not silently capture twice or change a shared default.
4. Authorize **one** capture POST, with a unique≤32-character name, exact target/
   environment/regions and explicit default choice. Proposed future budget: at
   most20 readbacks,30 seconds apart, across exact Environment and relevant
   Snapshot/Blueprint endpoints. No call in that budget has been executed here.
5. Treat204 as acknowledgement, not completion. Reconcile before/after Snapshot
   IDs/metadata, Blueprint versions and environment status. The contract does not
   guarantee that any one readback proves completion. Unknown outcome, timeout,
   exhausted budget or identity mismatch means preserve evidence and stop without
   replay; absence from one list is not proof the write failed.
6. Verify intended Snapshot/default/Project availability and private visibility in
   the UI. A successful POST or Project-nested GET is not privacy proof.
7. Separately authorize a disposable clone to validate fresh identities/credentials,
   DB policy, real hostname binding, either OS alone, portal/docs HTTPS, browser
   navigation and reboot recovery. Record retention/cleanup decisions. No clone
   or cleanup is authorized by this document.

This reviewed plan can satisfy planning work in #489 while actual capture remains
a separately authorized operation. A documentation merge is not a sanitized image
or completed live-capture claim.
