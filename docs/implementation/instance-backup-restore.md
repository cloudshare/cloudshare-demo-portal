# Instance backup and restore

Issue #499 defines an offline operator workflow for preserving an existing portal
instance across a same-OS rebuild. Implementation and rehearsal are in progress;
the commands below describe the agreed contract, not completed verification.

## Interface and prerequisites

From the installation checkout, using Node 24:

```text
node scripts/instance-backup.mjs create <new-private-directory>
node scripts/instance-backup.mjs verify <private-directory>
node scripts/instance-backup.mjs restore <private-directory> [--migrate]
```

Before create or restore, stop the portal and its native startup services and
confirm quiescence using the [maintenance procedure](two-os-maintenance.md#stop-and-confirm-quiescence).
The CLI does not manage services, start HTTP listeners, contact CloudShare, or
run fresh-instance setup. It supports the canonical #496 file-mode installation:
`.env`, `prisma/dev.db`, and `config/portal-seed.local.json`. Resolve alternative
paths, environment override files and conflicting process configuration first.

Keep artifacts outside the checkout and every public web root or Nginx alias.
Use a new destination directory; never overwrite an existing backup. Directory
permissions must restrict access to the operator (plus Windows SYSTEM and
Administrators). The backup is private plaintext, not encrypted storage.

## Artifact inventory

| Artifact file | Preserved state |
|---|---|
| `database.sqlite` | Consistent SQLite snapshot including committed WAL state: users, password hashes, Customer Connections, portal records and protected diagnostics |
| `portal.env` | Exact `.env` bytes, including the original `PORTAL_MASTER_KEY` and runtime configuration |
| `portal-seed.json` | Exact active seed JSON bytes, including configured startup identities and credentials |
| `manifest.json` | Version 1 format, UTC creation time, OS, source SHA, package/schema/migration metadata and payload integrity hashes |

Do not copy a changing SQLite main file or concatenate journal files. Creation
uses SQLite's backup facility to produce one standalone consistent database.
The database and original master key form a pair; replacing the key prevents
decryption of stored CloudShare Connections.

Source, dependencies, generated Prisma client and build output are excluded.
The source SHA identifies the matching source; acquiring and preparing that
source is the operator's responsibility and the future #500 update workflow.
Native startup configuration, Nginx, TLS keys/certificates, OS settings,
documentation artifacts, workspaces and logs are also excluded. Inventory and
retain those separately when needed; restore does not overwrite newer machine
configuration. Cross-OS restoration is not claimed.

## Off-VM retention and restore

1. Create and verify the private artifact after stopping the source instance.
2. Transfer it through the approved private transport to storage **outside the
   VM**. Preserve restricted permissions and verify the received copy. Confirm
   that copy exists before reverting or rebuilding the VM.
3. Prepare the selected source, dependencies, generated client and build in the
   clean same-OS target. Keep native services stopped. Retain a verified off-VM
   backup of any target instance whose state will be replaced.
4. Verify the artifact. Restore without `--migrate` requires matching migration
   history; use `--migrate` deliberately for compatible forward migrations.
   Historical migrations must match. Migrations run against a private staged
   copy before any working instance file is replaced.
5. Start the prepared instance using its existing native service procedure.
   Sign in with the preserved account and check representative records and
   saved Connection decryptability. Do not initialize, reset, reseed, or create
   new passwords/keys as part of restoration.

Checksums detect corruption; they do not authenticate an untrusted backup.
Only restore an artifact from the trusted private retention location.

## Failure and recovery

Incomplete, corrupt or incompatible artifacts must fail before replacing any
working instance file. Invalid seed configuration, a mismatched encryption key,
failed or mismatched migration history, and stale target SQLite sidecars require
operator investigation. Do not delete sidecars from an active database.

A failed staged migration leaves working state unchanged. Final installation
uses three file replacements and is not an atomic transaction. If interruption
occurs during replacement, keep the portal stopped: mixed database/key/seed
state must not be started. Select the original recorded source SHA and matching
dependencies/client/build, then restore its original verified off-VM artifact.
Git rollback alone does not undo a database migration.

Keep CLI output free of credentials and raw parser/database/subprocess errors.
Retain private recovery artifacts off the VM; remove temporary transfer files,
staging remnants and test data before preparing a delivery image.

## Evidence

Windows and Ubuntu rehearsal evidence is pending. Record exact source SHA,
guest identity, artifact transfer/verification, restore/migration outcomes,
authenticated browser checks, saved Connection decryptability and matched-state
failure recovery separately for each OS. Distinguish fixture data from live
credentials and provider calls. No CloudShare provisioning is part of this
workflow.
