# Initialize or update from current main

The permanent **Initialize-Portal.cmd** desktop launcher on Windows and
`/home/sysadmin/initialize-portal.sh` on Ubuntu now handle both first setup and
later updates. Run them explicitly when you want the latest merged release.
They remain available after success. Existing environments need a one-time copy
of these reviewed launchers; taking a new image does not update earlier clones.

**Windows:** right-click the desktop launcher and choose **Run as administrator**.
**Ubuntu:** run the launcher as `sysadmin`; normal sudo authorization may be required.
Node 24, Git, npm registry access and public GitHub access are prerequisites. The source
repository is public; no GitHub credential needs to be installed in the image.

Each invocation clones fixed repository `main` into a separate `.portal-maintenance-*`
directory in the operator's home, records its exact commit, and uses that one
release throughout. Full history permits fast-forward verification. Failed download
does not touch the installed app or its private data. Local tracked edits, divergent
history, partial private files and unsupported configuration require operator
resolution; the launcher never forces a checkout or resets data.

The workflow stops only the existing app task/service before changing the installed
release. Windows disables the scheduled task during maintenance so its trigger
cannot restart it. A remaining listener on port 3000 prevents maintenance. Nginx,
TLS, workspace configuration and unrelated documentation/Overview pages stay in
place; public portal access can temporarily return a proxy error.

A fresh instance gets locked dependencies, generated Prisma client, independent
private data and credentials, a production build and freshly built documentation.
An existing instance gets a verified private backup and the existing staged
migration/update workflow, preserving its encryption key, seed configuration,
credentials and database. The app is started only after builds and documentation
publication succeed. Read generated admin credentials privately in
`config/portal-seed.local.json` inside this VM's checkout using VS Code. The matching
master key is in `.env`. Do not copy these values into logs or screenshots.

## Failure and recovery

Stop at a nonzero result and use the reported phase. Do not initialize/reset as a
repair. Tooling and `.portal-recovery-*` material remain outside the app; successful
runs also report their locations. Private backups are protected by the backup CLI.
Retain them until the running portal is accepted; arrange private off-VM retention
with your own transfer tools. They must not be included in a reusable image.

For an update failure after backup, follow the matched original-source and backup
recovery procedure in [instance updates](https://github.com/cloudshare/cloudshare-demo-portal/blob/main/docs/implementation/instance-updates.md#explicit-recovery-after-failure).
The retained tooling checkout contains the recovery CLI and its dependencies.
Windows recovery must re-enable the `issue489-next` task before starting it after
successful recovery. If stopping failed, inspect the task and owned listener;
maintenance has not advanced the source. No process is killed indiscriminately.

If a fresh setup succeeded but its build failed, the generated private files now
form an initialized instance. A later invocation uses the update path and preserves
them. If private files are partial, resolve that failure explicitly; no automatic
reset repairs it. After any successful start, verify HTTPS sign-in, representative
saved state and logout before accepting the release. A start request alone does
not prove browser health.

## Image lifecycle

Copy only the reviewed launcher to the existing documented desktop/home path;
installation of a launcher does not invoke it. Keep the build VM app stopped and
its `.env`, `config/portal-seed.local.json` and `prisma/dev.db` absent when preparing
an uninitialized image. Inspect and remove identified temporary test/recovery
material only after its evidence is retained. Preserve existing proxy/TLS, native
pages and workspace settings.

Record launcher bytes, exact source, prerequisite checks, stopped-app/private-file
state and preservation evidence before claiming capture readiness. Snapshot capture
and later clone/revert verification are separate operator actions. Reverting an
environment loses changes made since its snapshot; an update preserves the current
instance's data and is not a replacement for backups.
