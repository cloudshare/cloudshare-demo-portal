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

| Item | Windows | Ubuntu |
|---|---|---|
| Checkout | `C:\CloudShareDemoPortal` | `/home/sysadmin/cloudshare-demo-portal` |
| App startup | Scheduled task `issue489-next` | `issue489-next.service` |
| HTTPS startup | Scheduled task `issue489-nginx` | Stock `nginx.service` |
| Nginx config | `C:\CloudShareDemoPortal-nginx\conf\nginx.conf` | `/etc/nginx/sites-available/issue489-portal` |
| Database | Checkout `prisma\dev.db` and sidecars | Checkout `prisma/dev.db` and sidecars |

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

After a verified stop, copy `.env` **with its current master key**, SQLite and any
`-wal`, `-shm`, `-journal` sidecars, source SHA, native startup/Nginx configuration,
TLS material and #493's documentation artifact/configuration when present. Use a
new backup directory outside the checkout and every Nginx alias. Protect it as
secrets: Windows SYSTEM/Administrators only; Linux directory0700/files0600. Do not
include this backup in a reusable image or public evidence.

Windows example for application data, from the checkout:

```powershell
$backup = Join-Path $env:USERPROFILE ('portal-maintenance-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
if (!(Test-Path -LiteralPath 'prisma\dev.db' -PathType Leaf)) { throw 'Main database missing' }
New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
Invoke-Checked icacls.exe $backup /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
Copy-Item -LiteralPath .env -Destination (Join-Path $backup 'portal.env') -ErrorAction Stop
foreach ($name in @('dev.db','dev.db-wal','dev.db-shm','dev.db-journal')) {
  $file = Join-Path 'prisma' $name
  if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination $backup -ErrorAction Stop }
}
```

Ubuntu example for application data:

```sh
(
  set -eu
  umask 077
  backup="$HOME/portal-maintenance-$(date -u +%Y%m%dT%H%M%SZ)"
  [ -f prisma/dev.db ]
  mkdir -m 700 "$backup"
  install -m 600 .env "$backup/portal.env"
  for file in prisma/dev.db prisma/dev.db-wal prisma/dev.db-shm prisma/dev.db-journal; do
    if [ -f "$file" ]; then install -m 600 "$file" "$backup/"; fi
  done
  printf 'Backup directory: %s\n' "$backup"
)
```

Check each exit status and verify the main database was copied. Add the listed
configuration/TLS copies under the same protected backup and record source SHA.
Retained encrypted database records require the matching `PORTAL_MASTER_KEY`;
changing that key is not an ordinary maintenance operation.

## Update from a private Git bundle

Review the exact target SHA and diff. The verified 2026-10-30 update changed only
Markdown and needed no rebuild, migration or restart. Never assume a newer main
commit is documentation-only. A runtime/schema/dependency change needs a reviewed
maintenance window, stopped services and the matched backup above.

Transfer a credential-free bundle, compare its SHA256 to a separately trusted
value, and run `git bundle verify` inside the checkout. Check advertised refs and
required base. Do not install personal GitHub credentials on either guest.
After successful hash verification, replace these example values explicitly:

```powershell
$bundle = 'C:\Uploads\REPLACE_WITH_APPROVED_BUNDLE.bundle'
$target = 'REPLACE_WITH_REVIEWED_40_CHARACTER_COMMIT'
if (Invoke-Checked git.exe status --porcelain) { throw 'Checkout is not clean' }
Invoke-Checked git.exe bundle verify $bundle
Invoke-Checked git.exe fetch -- $bundle refs/remotes/origin/main:refs/remotes/origin/main
Invoke-Checked git.exe merge --ff-only $target
$actual = Invoke-Checked git.exe rev-parse HEAD
if ($actual -cne $target) { throw 'Target HEAD mismatch' }
if (Invoke-Checked git.exe status --porcelain) { throw 'Updated checkout is not clean' }
```

```sh
(
  set -eu
  bundle=/home/sysadmin/Uploads/REPLACE_WITH_APPROVED_BUNDLE.bundle
  target=REPLACE_WITH_REVIEWED_40_CHARACTER_COMMIT
  dirty=$(git status --porcelain)
  [ -z "$dirty" ]
  git bundle verify "$bundle"
  git fetch -- "$bundle" refs/remotes/origin/main:refs/remotes/origin/main
  git merge --ff-only "$target"
  actual=$(git rev-parse HEAD)
  [ "$actual" = "$target" ]
  dirty=$(git status --porcelain)
  [ -z "$dirty" ]
)
```

Check each exit status; require exact target HEAD and a clean checkout. Stop on
missing history, dirty state or non-fast-forward; never force/reset it into place.
Retain `.env`, DB, TLS and native startup configuration. For a runtime update run
the installation guide's checked `npm ci`, `npm run prisma:generate`,
`node node_modules/prisma/build/index.js migrate deploy`, and `npm run build`.
Do not use `migrate dev` or reset to repair a migration. Rebuild/redeploy published
docs through #493's reviewed procedure when their selected source changes.

On failure retain private output and keep services stopped. Rolling back Git
alone does not undo migrations: recovery needs matching source/build/dependencies,
database backup and environment/key. Review that recovery before restoring into
the stopped installation.

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
