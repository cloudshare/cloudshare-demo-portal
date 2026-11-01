# Update an existing private installation

This is an explicit operator workflow for the existing Windows and Ubuntu
installations. It updates source, dependencies, generated client and production
build while preserving the matched database, original `.env`/encryption key and
seed JSON. It does not initialize/reset an instance or manage native services.
The [installation layout](two-os-installation.md#current-retained-layout) remains
unchanged, including proxy, TLS, documentation and workspace configuration.

## Prepare the pinned release and recovery tools

Use Node 24, Git and npm. The installation must use the canonical file-mode
configuration supported by [instance backup and restore](instance-backup-restore.md).
Resolve tracked edits before updating; unrelated untracked files are allowed.
The release must fast-forward the installed source. There is no force mode.

On the maintainer's authorized machine, create a credential-free Git bundle
containing the approved target commit and its advertised reference. Record:

- Installed base SHA and approved target SHA, both full 40-character commits.
- Bundle reference and SHA256, obtained through a separately trusted channel.
- The approved tooling source SHA and original source needed for recovery.

Use the installation guide's [private source transfer](two-os-installation.md#transfer-the-private-source)
procedure. Verify transferred bytes; never place maintainer GitHub credentials
on the VM. A bundle hash detects changed bytes, not an untrusted release.

Retain a clean checkout of the approved tooling release **outside** the active
installation and any public web root. In that tooling checkout, install its
locked dependencies with `npm ci` and run `npm run prisma:generate`. Keep it
available until update/recovery acceptance. Do not copy only the backup `.mjs`:
it imports configuration/security source and uses Next/Prisma dependencies.
Its source and dependencies must survive an installation rollback to a release
that predates the backup CLI. Record `git rev-parse HEAD` and clean tracked status
for this retained checkout. Do not use a user workspace or private native-config
directory as disposable tooling space.

## Preflight, stop and back up

From the **installation** checkout, invoke the retained tool by absolute path:

```text
node <tools>/scripts/update-instance.mjs preflight <bundle> <sha256> <base-sha> <target-sha>
```

Preflight verifies the hash, exact base, clean tracked source, advertised pinned
target and fast-forward ancestry. It rejects targets that track canonical
private instance/runtime paths. It may import Git objects and `FETCH_HEAD`, but
does not advance source or change instance files. It needs no backup yet.

Arrange the maintenance window. Stop **only the owned portal application**:

- Windows: use the existing `issue489-next` scheduled task. Temporarily disable
  its startup trigger and stop the task. Confirm its current child process and
  private port 3000 listener have exited; task status alone is insufficient.
- Ubuntu: stop `issue489-next.service`, confirm inactive state/MainPID zero and
  no owned app listener. Prevent any configured automatic restart during maintenance.

Check current executable, command line and installation path before stopping any
remaining child. Do not kill all Node processes or reuse historical PIDs. Leave
Nginx, HTTPS, native definitions and documentation in place. A temporary proxy
error while the app is stopped is expected. Do not reboot during maintenance.

Still from the installation, create a new private local backup outside it:

```text
node <tools>/scripts/instance-backup.mjs create <new-private-backup-directory>
node <tools>/scripts/instance-backup.mjs verify <new-private-backup-directory>
```

The verified local artifact is the update prerequisite. Its manifest source SHA
must equal the installed base; `.env` and seed bytes must match the installation.
Retain it privately. Off-VM retention is recommended through the operator's own
storage/transfer tools; it is not an upload integration or update execution gate.
Do not edit manifest metadata to make a stale backup appear current.

## Apply and accept

```text
node <tools>/scripts/update-instance.mjs apply <bundle> <sha256> <base-sha> <target-sha> <private-backup-directory> --app-stopped
```

`--app-stopped` is the operator's confirmation, not automatic process detection.
The CLI repeats preflight, verifies the backup through #499 and its source/config
pairing, then advances source, runs `npm ci`, generates the Prisma client, restores
the matched artifact with `--migrate`, and builds. Restore applies compatible
migrations to staged data before replacing working state. Do not permit new
application writes between backup and apply. No fresh setup, reset or reseeding
command belongs in this sequence.

Run as the installation owner; preserve the existing service's read/execute
access. Windows native commands must have their exit status checked using
`Invoke-Checked` from the installation guide; POSIX shells should use `set -eu`.
Stop on any nonzero result. The CLI suppresses raw subprocess output to keep
private configuration out of terminal diagnostics, and reports the failed phase.

After success, record the printed exact source and confirm `git rev-parse HEAD`.
Start the existing app using its original task/service, restoring the startup
trigger if disabled. Verify the private listener identity and public HTTPS
health, authentication, authenticated navigation and logout. Check preserved
credentials, representative records and saved Connection decryptability; capture
browser warnings/errors. Confirm native proxy/TLS/service settings and ownership
remain correct. A prepared build alone is not acceptance of the running service.

## Explicit recovery after failure

Keep the app stopped. The failure diagnostic identifies the original matched
source SHA once source advance has been attempted. Inspect unexpected tracked
changes before recovery; do not discard operator work. With the original verified
artifact and original source available, run the following in the installation:

```text
git status --porcelain --untracked-files=no
git checkout --detach <original-manifest-source-sha>
npm ci
npm run prisma:generate
node <tools>/scripts/instance-backup.mjs verify <original-private-backup-directory>
node <tools>/scripts/instance-backup.mjs restore <original-private-backup-directory>
npm run build
git rev-parse HEAD
```

Check every exit status. Do not add `--migrate` when restoring the original
source/artifact pair. Git rollback alone does not undo migrations or restore
database state. If restore refuses SQLite sidecars, keep the app stopped and
inspect their origin; do not blindly delete journals. Start only after the
matching source/dependencies/client/database/key/seed/build are restored, then
repeat public HTTPS and state acceptance. No automatic rollback or service start
is performed. Retain recovery material until accepted and remove only identified
temporary tooling/transfer/test artifacts before preparing a delivery image.

## Existing squashed-history installation

Static repository inspection found that historical source
`87acb9c1e68a6217aac9e7994eb81de2e1abf48e` and its merged squash
`b0721da6627780d55c9b8119ce5b0f8bf9872030` share the complete Git tree
`2b69e108344d9b9f2a977876959e930863d05b9e`, but have different ancestry.
Strict preflight therefore refuses a non-fast-forward update from the former.

This observation is not authorization to change a guest. A separately approved
operator alignment must freshly verify its actual HEAD, clean tracked checkout
and complete tree equality, retain an explicit ref to the original commit, and
select the reviewed equivalent squash without force/reset. Stop if any evidence
differs. Create the update backup **after** actual alignment so its recorded
source is truthful; never relabel an old artifact. The updater does not normalize
history automatically.

## Evidence and remaining acceptance

At code commit `5130c4809b5b4f6a95f4f34d05bed852b4b73208`, three CLI scenarios
passed on both native OSs in disposable synthetic installations:

- Wrong bundle hash, wrong base, dirty tracked source and divergent-release refusal.
- Pinned release preparation with real #499 backup/restore and current migrations,
  preserving account/password verification, key, seed and decryptable Connection.
- Deliberately failed fixture build, safe phase/source guidance and explicit
  source/dependencies/client/restore/build recovery preserving the same state.

Ubuntu execution: `SRsLgH2qG6D22qiaD1nuflIw2`; Windows execution:
`SRcpFqF597ucct6AL2IPOtxw2`. Both returned provider exit 0 and Node test exit 0,
3/3 passed. Tests use zero-dependency fixture releases with controlled generate/
build programs; retained tooling uses actual locked dependencies and Prisma.
They do not start services, contact CloudShare or claim public HTTPS acceptance.

A real historical migration (`c605217f59b25f8e10c11556415222ce448f3421`
to the later runtime-command migrations) is identified for a separately released
temporary rehearsal; no artificial product migration was added. Historical
migration, installed native-app upgrade/recovery and public HTTPS/browser
acceptance remain unproven by these synthetic results.
