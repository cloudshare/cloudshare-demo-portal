# Quick start: sign in as an administrator

Use either VM's portal. Windows and Ubuntu have independent local accounts and
data; use credentials from the same VM as the portal you are opening.

## New instance: required manual setup

The owner of each new instance must run setup before its first portal sign-in.
This means the person preparing that instance, not every Candidate or admin who
later logs in. Setup resets only the portal app's data and credentials; it does
not reset the VM, install software, or change TLS, SSH, workspaces or services.

Use Node.js 24 and the installed dependencies in the VM checkout:
`C:\CloudShareDemoPortal` on Windows or
`/home/sysadmin/cloudshare-demo-portal` on Ubuntu. Complete the
[installation prerequisites](implementation/two-os-installation.md) first,
including `npm ci` and `npm run prisma:generate`. Use this setup command in place
of manually copying private seed credentials or running an initial migration. Stop
the portal app using its existing startup procedure before running setup; keep
Nginx and the documentation site in place. Setup does not stop or start services.

In a terminal opened in that checkout, run:

```sh
npm run setup:instance
```

Setup creates a fresh portal database with the two Customer/admin defaults,
generates a new private master key and two private admin passwords, and writes
the supported private configuration. It prints no password or key values.
The master key is in `.env`; admin credentials are in
`config/portal-seed.local.json`. Read them privately in VS Code inside the same
VM. Runtime files contain that instance's values and must remain uncommitted.

If setup reports existing instance data, it stops without resetting it. An
inherited initialized database is still existing data: no copied marker causes
setup to silently keep another instance's credentials. For an approved fresh
baseline, first back up the database and matching private configuration to a
protected location **outside the VM and any future image**, then run:

```sh
npm run setup:instance -- --reset
```

**This deletes the existing portal accounts and history and generates a new key
and both admin passwords.** It is not ordinary sign-in or password recovery.
Saved CloudShare connections cause setup to refuse the reset; inspect the
installation with its owner rather than deleting provider state or changing a
master key independently. Stop on any error and inspect the safe explanation.
Do not retry a reset as a generic repair.

After successful setup, start the portal through its existing startup procedure,
then sign in with each new admin account using the steps below. Ordinary
sign-ins do not rerun setup. The existing lazy seed behavior reapplies configured
admin credentials once per app process, so keep the private seed file consistent
with this instance.

## Initialized instance: sign in without resetting

1. Inside the VM, open its checkout in VS Code: `C:\CloudShareDemoPortal` on Windows
   or `/home/sysadmin/cloudshare-demo-portal` on Ubuntu. Inspect `.env` privately
   for `PORTAL_SEED_SOURCE`.
2. For `env`, read the credential fields below in `.env`. For `file`, read the JSON
   named by `PORTAL_SEED_CONFIG_PATH` (default `./config/portal-seed.local.json`,
   relative to the checkout). For `off`, ask the installation owner for existing
   credentials; do not turn seeding on to reset them.
3. Open `/login` on this VM's deployed hostname, for example
   `https://<this-VM-hostname>/login`. Sign in with the desired admin.

Do not copy passwords into chat, screenshots, documentation or another VM.

| Administrator | Credentials in `env` / JSON `file` | Sign-in and landing |
|---|---|---|
| Helios CX Certification admin | `HELIOS_ADMIN_EMAIL`, `HELIOS_ADMIN_PASSWORD` / `heliosAdminEmail`, `heliosAdminPassword` | `/login`, then `/admin` |
| Certalis Sales admin | `CERTALIS_SALES_ADMIN_EMAIL`, `CERTALIS_SALES_ADMIN_PASSWORD` / `certalisSalesAdminEmail`, `certalisSalesAdminPassword` | `/login`, then `/sales` |

The Certalis account administers the Sales Customer workspace; it is not a
provider-wide super-admin console. Sign out before switching accounts. Public
registration creates participant accounts, not administrators.
These are portal accounts, separate from CloudShare API credentials. Setup does
not generate CloudShare API keys; each Customer supplies those separately when
connecting CloudShare.

If configured credentials fail, inspect with the installation owner rather than
reseed, edit passwords or assume the other VM's credentials apply.

## Preparing a reusable image

A reusable source/image must contain no initialized private `.env`, local seed
credentials, runtime database or private backups. Git ignore rules do not exclude
files from a VM filesystem copy. Preparing and capturing an image is a separate,
owner-approved operation; running setup prepares the current instance, not an
image safe to copy with its new credentials still present. Each new instance's
owner must run the manual setup above. No automatic first-boot hook is installed.
