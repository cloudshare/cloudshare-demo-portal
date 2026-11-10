# Maintain the two rehearsal VMs

These are operator procedures for [the installed guests](two-os-installation.md),
not actions executed by this documentation change. Install/build, ordinary startup,
reboot recovery and a documentation-only Git-bundle update were verified on
2026-10-30. The maintenance stop/backup/reset and runtime-update sequences below
are statically reviewed proposals; execution and human acceptance are outstanding.

**Coordinate a maintenance window before touching the guests.** #493's deployment
was accepted and merged in #494 on 2026-10-31. Read its
[deployment record](vm-documentation-site.md) and preserve its static files,
VS Code/workspace settings and human-authored Overview/native pages. Its current
thirteen-page artifact is independent of the checkout; merging this runbook does
not refresh that artifact or add these maintenance/capture pages to its allowlist.
Run commands inside the chosen guest, never the workstation checkout. This guide
does not authorize a reset or any other guest changes.

## Installation and preconditions

Preserve the installation guide's [current retained layout](two-os-installation.md#current-retained-layout),
which distinguishes Ubuntu's verified relocation from deferred Windows consolidation.
Windows commands below use the configured original paths. Independently verify Windows
recovery and native startup references before running them; the failed cutover's
rollback report has not yet been independently confirmed.
Historical directory names alone do not establish that a directory is disposable.

| Item | Windows | Ubuntu |
|---|---|---|
| Checkout | `C:\CloudShareDemoPortal` | `/home/sysadmin/cloudshare-demo-portal` |
| App startup | Scheduled task `issue489-next` | `issue489-next.service` |
| HTTPS startup | Scheduled task `issue489-nginx` | Stock `nginx.service` |
| Nginx config | `C:\CloudShareDemoPortal-nginx\conf\nginx.conf` | `/etc/nginx/sites-available/issue489-portal` |
| Database | Checkout `prisma\dev.db` and sidecars | Checkout `prisma/dev.db` and sidecars |
| Documentation alias | `C:\CloudSharePortalDocs` | `/var/www/cloudshare-portal-docs` |
| Workspace | `C:\CloudSharePortalWorkspaces\Windows.code-workspace` | `/home/sysadmin/cloudshare-demo-portal/runtime/workspaces/CloudSharePortal.code-workspace` |
| App startup/logs | `C:\CloudShareDemoPortal-nginx\run.ps1` used by both scheduled tasks | `/etc/systemd/system/issue489-next.service`, output to checkout `runtime/logs/next.log` |

Keep operational temporary files within one bounded checkout `runtime/tmp` directory
and clean them up after the operation. Do not relocate standard OS/tooling directories
or treat the old Ubuntu log/certificate directory as authorized for deletion.

Use elevated PowerShell on Windows. Define `Invoke-Checked` from the installation
guide's [source-transfer section](two-os-installation.md#transfer-the-private-source)
for native commands. On Ubuntu use the installation user's shell, `sudo` for
administration, and the installed Node PATH:

```sh
export PATH="$HOME/.local/node-v24.22.2-linux-x64/bin:$PATH"
cd /home/sysadmin/cloudshare-demo-portal
```

On Windows first `Set-Location C:\CloudShareDemoPortal`. Record `git rev-parse HEAD`
and `git status --porcelain`; stop on unexpected changes. Resolve `DATABASE_URL`
to this guest's SQLite file. For reset, privately verify `.env` has fixture mode,
disabled background jobs, env seeding and no provider credentials. Disabled jobs
alone do not block explicit provider calls. Never print secret values.

For existing administrator access, follow [Quick start](../quick-start.md): use
that same VM's configured credentials and distinguish Helios CX Certification
admin from Certalis Sales admin, not a provider-wide super-admin. This runbook is
not password recovery. The proposed reset below covers the original env-seeded
fixture setup only; do not switch a file/off-seeded installation to env to fit it.
Such installations need a separately reviewed reset/seed decision with the owner.

## Stop and confirm quiescence

Windows: temporarily disable both startup tasks, gracefully stop Nginx with its
configured prefix, and stop the tasks:

```powershell
Disable-ScheduledTask -TaskName issue489-nginx | Out-Null
Disable-ScheduledTask -TaskName issue489-next | Out-Null
Invoke-Checked 'C:\CloudShareDemoPortal-nginx\nginx-1.31.8\nginx.exe' -p 'C:/CloudShareDemoPortal-nginx/' -c conf/nginx.conf -s quit
Stop-ScheduledTask -TaskName issue489-next
Stop-ScheduledTask -TaskName issue489-nginx
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(80,443,3000)
```

Require no listeners. A task stop does not prove every child exited. If one
remains, stop this procedure and inspect that listener's current PID, executable,
command line and task relationship. Only stop a positively identified process
from this installation; never reuse historical PIDs or kill all Node/Nginx
processes. Resolve it before backup/reset; keep tasks disabled on failure.

Ubuntu:

```sh
sudo systemctl stop nginx issue489-next
for unit in nginx issue489-next; do systemctl show "$unit" -p ActiveState -p MainPID; done
sudo ss -ltnp '( sport = :80 or sport = :443 or sport = :3000 )'
```

Require both units inactive, MainPID zero and no listeners. Do not reboot during
maintenance: the enabled Linux services would start again.

## Matched private backup

After a verified stop, use the [instance backup workflow](instance-backup-restore.md).
Its private artifact contains a consistent SQLite snapshot, `.env` **with its
current master key**, the active `config/portal-seed.local.json`, and integrity/
source metadata. Do not copy a changing database or treat journal files as a
standalone backup. This replaces the earlier raw-copy proposal, which omitted
the active seed JSON. See the workflow's evidence section for rehearsal status.

Windows example for application data, from the checkout:

```powershell
$backup = Join-Path $env:USERPROFILE ('portal-maintenance-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
Invoke-Checked node.exe scripts/instance-backup.mjs create $backup
Invoke-Checked node.exe scripts/instance-backup.mjs verify $backup
```

Ubuntu example for application data:

```sh
(
  set -eu
  umask 077
  backup="$HOME/portal-maintenance-$(date -u +%Y%m%dT%H%M%SZ)"
  node scripts/instance-backup.mjs create "$backup"
  node scripts/instance-backup.mjs verify "$backup"
)
```

Check each exit status, transfer the private artifact OFF the VM, and verify
the received copy before reverting or rebuilding. Keep it outside the checkout,
public web roots and reusable delivery images. The CLI protects local files;
the operator must preserve privacy at the transfer destination.

Native startup/Nginx configuration, TLS material, documentation and workspaces
are separate operator-managed assets, not payloads in this three-file instance
backup. Inventory those separately if needed; restore leaves newer OS/service/TLS
settings unchanged. Source/dependencies/build matching remains the operator's
responsibility. Never replace the master key or run fresh-instance setup/reset
to restore an existing database.

## Update from a private Git bundle

Use the [pinned instance update workflow](instance-updates.md). It replaces the
older manual fetch/merge proposal with an explicit preflight/apply CLI and a
matched source/dependencies/client/database/configuration/build recovery sequence.
The CLI requires a verified local #499 backup before mutation; any off-VM retention
uses the operator's own tools and is guidance, not an update execution gate.

For an application update stop only the owned portal app, following that workflow;
leave Nginx, TLS and documentation in place. The broader stop/reset procedure in
this document remains separately scoped. See the update workflow's evidence
section for the distinction between synthetic native CLI checks and outstanding
historical migration, running-service and public HTTPS acceptance.
## Destructive fixture reset — separate approval

Reset removes Candidates, sessions, Attempts, catalog state and diagnostic
history. It does not revoke provider resources or sanitize an image. This reset
has **not** been exercised. Require specific reset approval, fixture-only/no
provider credentials, a verified private backup and both services stopped.

Confirm `.env` has `DATABASE_URL="file:./dev.db"`. Remove any terminal-only override
(`Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue` on Windows;
`unset DATABASE_URL` on Ubuntu). From the checkout run the installed CLI
interactively, inspecting its displayed datasource before confirmation:

```sh
node node_modules/prisma/build/index.js migrate reset --skip-seed
```

Use `Invoke-Checked node.exe ...` on Windows. This is the pinned Prisma6.19.3
command; [its source defines confirmation and `--skip-seed`](https://github.com/prisma/prisma/blob/6.19.3/packages/migrate/src/commands/MigrateReset.ts).
Do not add `--force`, bypass an agent confirmation check or continue after failure.
Keep the existing env/master key for this same-VM reset. Administrator fixture
records are recreated by [`ensurePortalSeeded`](../../src/composition.ts) on
session initialization using the existing env seed; there is no separate Prisma
seed script in this setup. New clone identities/keys require the separate
[capture plan](../discovery/2026-10-31-private-blueprint-capture-plan.md).

## Start and accept the result

```powershell
Enable-ScheduledTask -TaskName issue489-next | Out-Null
Enable-ScheduledTask -TaskName issue489-nginx | Out-Null
Start-ScheduledTask -TaskName issue489-next
Start-ScheduledTask -TaskName issue489-nginx
Get-ScheduledTask -TaskName issue489-next,issue489-nginx | Select-Object TaskName,State
```

```sh
sudo systemctl start issue489-next nginx
for unit in issue489-next nginx; do systemctl is-active "$unit"; done
```

Wait for actual readiness. Require `/api/health` to report `status=ok`,
`mode=fixture`, `persistenceVerified=true`; app3000 loopback-only, Nginx443 and
no portal on80. Check health/login/authenticated navigation/logout through the
guest's public HTTPS hostname without certificate bypass, plus `/docs/` once
#493 is deployed; inspect browser warnings/errors. After reset verify recreated
seed accounts and absence of old sessions/data. Record exact SHA/results/gaps
before accepting maintenance. Never publish passwords, cookies or keys.

References: [Windows task stop](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/stop-scheduledtask),
[Nginx Windows signals](https://nginx.org/en/docs/windows.html),
[Prisma6 reset source](https://github.com/prisma/prisma/blob/6.19.3/packages/migrate/src/commands/MigrateReset.ts).
