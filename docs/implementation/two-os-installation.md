# Install the portal on Windows and Linux

This procedure installs a private copy of the portal with a fresh SQLite database
and local fixture accounts. It covers the steps verified on Windows Server 2025
and Ubuntu 26.04 LTS on 2026-10-30. Configure public HTTPS and persistent startup
separately before using the installation through CloudShare Web Access.

## Verified versions and results

| Component | Windows | Linux |
| --- | --- | --- |
| Operating system | Windows Server 2025 Standard, build 26100 | Ubuntu 26.04 LTS, x86_64 |
| Node.js | 24.22.2 | 24.22.2 |
| npm | 11.19.1 | 11.19.1 |
| Git | 2.56.0.windows.4 | 2.53.0 |
| Application commit | `0d5794a20532735d8d0f80bffb533ae541c7b4a9` | Same commit |
| Dependency installation, Prisma generation and migrations | Passed | Passed |
| Production build | Passed | Passed |
| Private health and admin API login, session and logout | Passed | Passed |

The private API checks kept credentials and cookies inside each VM. They do not
establish browser cookie behavior or public HTTPS access. Both production servers
currently run temporarily on `127.0.0.1:3000`; persistent startup, public HTTPS and
reboot verification remain unfinished.

## Install the prerequisites

Download Node.js for the appropriate operating system from the
[official release directory](https://nodejs.org/dist/v24.22.2/), verify the archive
or installer against its published SHA256, and install it. The Windows rehearsal
also installed [Git for Windows](https://gitforwindows.org/). The Linux template
already included Git, curl, tar, xz and Python 3.

Open a terminal inside the target VM and confirm `node --version`, `npm --version`
and `git --version`. The rehearsal used these executable locations:

- Windows: `C:\Program Files\nodejs` and `C:\Program Files\Git\cmd`.
- Linux: `$HOME/.local/node-v24.22.2-linux-x64/bin` and `/usr/bin/git`.

On Windows, the installers completed without requesting a reboot. Linux used a
user-local Node archive installation without changing system packages or shell
profiles. For that layout, add Node to the current terminal's path:

```sh
export PATH="$HOME/.local/node-v24.22.2-linux-x64/bin:$PATH"
```

## Transfer the private source

Windows PowerShell 5.1 does not automatically stop when a native command fails.
Define this helper once in a PowerShell terminal for the checked commands below:

```powershell
function Invoke-Checked {
  param([string]$Program, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  $global:LASTEXITCODE = 1
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed; stop and inspect its output." }
}
```

Create a bundle on a trusted computer that already has authorized access to the
private repository. Record the intended commit and the resulting bundle's hash:

```sh
set -eu
git fetch origin main
git rev-parse origin/main
git bundle create portal-source.bundle refs/remotes/origin/main
git bundle verify portal-source.bundle
git bundle list-heads portal-source.bundle
```

In PowerShell, prefix each of those Git commands with `Invoke-Checked`, for
example `Invoke-Checked git fetch origin main`.

Use `Get-FileHash -Algorithm SHA256` on Windows or `sha256sum` on Linux to record
the bundle hash. Recompute it inside each destination VM and require an exact
match before importing source. A newly generated bundle can have different bytes;
use the hash recorded for the particular transferred file.

Use CloudShare Viewer's file upload for the private transfer. Its
[upload instructions](https://support.cloudshare.com/hc/en-us/articles/360052304751-Upload-Files-to-a-VM)
describe the Uploads folder and successful-upload indicator. Verify the actual
destination path inside the VM. In this rehearsal, the paths were
`C:\Uploads\portal-source.bundle` and
`/home/sysadmin/Uploads/portal-source.bundle`.

The bundle transfers source and Git history without placing GitHub credentials
inside either VM. It does not grant access for subsequent remote pulls. Later
updates require a new bundle or separately authorized GitHub authentication.

## Import the recorded commit

The bundle above advertises `refs/remotes/origin/main`, rather than
`refs/heads/main`. A plain clone reports an empty repository even though the
bundle contains the source. Import that reference explicitly before checkout.
The rehearsal's first Windows attempt stopped at this point; an explicit fetch
repaired the existing unborn repository without resetting or cloning again.

For a new installation, use an empty destination and substitute the commit
recorded when creating the bundle. Stop on any failed command. If the destination
already contains configuration, a database or an earlier attempt, inspect that
state before proceeding rather than overwriting it.

Windows PowerShell:

```powershell
$env:Path = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;' + $env:Path
$bundle = (Resolve-Path 'C:\Uploads\portal-source.bundle').Path
$target = 'C:\CloudShareDemoPortal'
$commit = 'REPLACE_WITH_RECORDED_COMMIT'
if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'Supply the recorded commit before proceeding.' }
Invoke-Checked git clone --no-checkout -- $bundle $target
Invoke-Checked git -C $target fetch -- $bundle 'refs/remotes/origin/main:refs/remotes/origin/main'
$imported = Invoke-Checked git -C $target rev-parse refs/remotes/origin/main
if ($imported -cne $commit) { throw 'Imported commit does not match the recorded source.' }
Invoke-Checked git -C $target checkout -b main $commit
Invoke-Checked git -C $target remote set-url origin https://github.com/cloudshare/cloudshare-demo-portal.git
Invoke-Checked git -C $target config --replace-all remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
Invoke-Checked git -C $target branch --set-upstream-to=origin/main main
Set-Location $target
```

Linux:

```sh
set -eu
umask 077
bundle="$HOME/Uploads/portal-source.bundle"
target="$HOME/cloudshare-demo-portal"
commit=REPLACE_WITH_RECORDED_COMMIT
printf '%s\n' "$commit" | grep -Eq '^[0-9a-f]{40}$'
git clone --no-checkout -- "$bundle" "$target"
git -C "$target" fetch -- "$bundle" refs/remotes/origin/main:refs/remotes/origin/main
[ "$(git -C "$target" rev-parse refs/remotes/origin/main)" = "$commit" ]
git -C "$target" checkout -b main "$commit"
git -C "$target" remote set-url origin https://github.com/cloudshare/cloudshare-demo-portal.git
git -C "$target" config --replace-all remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git -C "$target" branch --set-upstream-to=origin/main main
cd "$target"
```

Verify the checkout before adding local configuration:

```sh
git rev-parse HEAD
git branch --show-current
git rev-parse --abbrev-ref 'main@{upstream}'
git remote get-url origin
git status --porcelain
```

Require the recorded commit, branch `main`, upstream `origin/main`, a
credential-free HTTPS origin, and an empty status output. The clean origin and
tracking branch prepare ordinary future Git updates; they do not supply credentials.
Use `Invoke-Checked git ...` for these verification commands in PowerShell too.

## Generate independent local configuration

Create a new `.env` inside each VM. Keep the same master key with its database
for the lifetime of that installation. Do not copy another installation's database
or environment file, and do not use the example master key for this procedure.

Save the following code as `fresh-env.cjs` beside the received installation files,
then run `node <path-to-fresh-env.cjs>` from the repository root. It refuses an
existing `.env`, generates new secrets inside the VM, and prints none of them.

```javascript
const fs = require('node:fs');
const crypto = require('node:crypto');
const random = () => crypto.randomBytes(32).toString('base64');
fs.writeFileSync('.env', [
  `PORTAL_MASTER_KEY=${random()}`,
  'PORTAL_MODE=fixture',
  'PORTAL_BACKGROUND_JOBS=disabled',
  'PORTAL_SEED_SOURCE=env',
  'DATABASE_URL="file:./dev.db"',
  'HELIOS_ADMIN_EMAIL=helios-admin@example.invalid',
  `HELIOS_ADMIN_PASSWORD=${random()}`,
  'HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID=fixture-instructor',
  'HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME=Fixture Instructor',
  'CERTALIS_SALES_ADMIN_EMAIL=sales-admin@example.invalid',
  `CERTALIS_SALES_ADMIN_PASSWORD=${random()}`,
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
```

On Linux, use `umask 077` before creating the checkout and local files. On
Windows, Node's `mode: 0o600` does not set NTFS permissions. Before public access,
restrict the new `.env`, SQLite directory and sidecars, logs, and any TLS private
keys to the identities that operate the installation. The Windows rehearsal found
inherited read access for local Users; that permissions correction remains pending.

These fixture accounts and the synthetic instructor require no CloudShare API
credentials. An admin supplies a real Customer-scoped CloudShare Connection later
through the portal's normal workflow. Read generated login values privately inside
the VM when needed; keep them out of logs, source control and shared images.

## Install dependencies and build

From the repository root, run each command and require a zero exit code before
continuing. Retain the output privately to diagnose the first failed stage.

```sh
set -eu
npm ci
npm run prisma:generate
node node_modules/prisma/build/index.js migrate deploy
npm run build
```

In PowerShell, use checked native invocations:

```powershell
Invoke-Checked npm.cmd ci
Invoke-Checked npm.cmd run prisma:generate
Invoke-Checked node node_modules/prisma/build/index.js migrate deploy
Invoke-Checked npm.cmd run build
```

Both platforms completed all four stages. The relative SQLite URL places
`dev.db` under `prisma` for this schema; protect that directory and SQLite
sidecars together.

Stop if a migration or build fails. Preserve its output and the database state;
do not reset a database or replay the whole installation as a generic repair.

## Private runtime checks and the remaining HTTPS work

The verified temporary production command is:

```sh
npm start -- --hostname 127.0.0.1 --port 3000
```

Run it only inside the target VM after checking that the port is free. Port 3000
is a conventional private HTTP port, not an application requirement. Changing
`next start` to port 443 does not enable TLS. Next.js 15's
[CLI](https://nextjs.org/docs/15/app/api-reference/cli/next) offers experimental
HTTPS for development; a production HTTPS listener needs a separate deployment
configuration.

Both private checks passed persistence-backed health, the login page, local admin
API login and session validation, and logout. A form-login probe with the intended
public Host and HTTPS forwarding headers returned a redirect to
`https://localhost:3000/login` on both platforms. Public HTTPS deployment must
correct and verify that origin, including successful browser login and logout.
The proxy versus direct HTTPS startup choice is still pending.

CloudShare's [Web Access documentation](https://support.cloudshare.com/hc/en-us/articles/200701625-Connect-to-Your-Application-via-Web-Access)
lists supported HTTP and HTTPS ports, including HTTPS 443. The intended public
configuration uses the generated Web Access hostname with HTTPS and no URL suffix;
public reachability and browser behavior remain unverified. A new VM or
Blueprint clone receives its own hostname; supply that deployment's hostname
explicitly rather than retaining an earlier VM's setting.

Persistent startup, controlled reboot checks and trusted public HTTPS browser
verification must complete before this is a prepared image. Snapshot or Blueprint
capture also requires a separate audit of local passwords, master keys, database
state, TLS keys, logs, source history and any retained authentication. No prepared
image has been captured during this rehearsal.
