# Quick start: sign in as an administrator

Use either VM's portal. Windows and Ubuntu have independent local accounts and
data; use credentials from the same VM as the portal you are opening.

## Existing rehearsal VMs: sign in without reseeding

1. Inside the VM, open its checkout in VS Code: `C:\CloudShareDemoPortal` on Windows
   or `/home/sysadmin/cloudshare-demo-portal` on Ubuntu. Inspect `.env` privately
   for `PORTAL_SEED_SOURCE`.
2. For `env`, read the credential fields below in `.env`. For `file`, read the JSON
   named by `PORTAL_SEED_CONFIG_PATH` (default `./config/portal-seed.local.json`,
   relative to the checkout). For `off`, ask the installation owner for existing
   credentials; do not turn seeding on to reset them.
3. Use **Open portal** in this documentation header, or the VM's native portal
   page in the CloudShare viewer, to open `/login`. Sign in with the desired admin.

Do not copy passwords into chat, screenshots, documentation or another VM.

| Administrator | Credentials in `env` / JSON `file` | Sign-in and landing |
|---|---|---|
| Helios CX Certification admin | `HELIOS_ADMIN_EMAIL`, `HELIOS_ADMIN_PASSWORD` / `heliosAdminEmail`, `heliosAdminPassword` | `/login`, then `/admin` |
| Certalis Sales admin | `CERTALIS_SALES_ADMIN_EMAIL`, `CERTALIS_SALES_ADMIN_PASSWORD` / `certalisSalesAdminEmail`, `certalisSalesAdminPassword` | `/login`, then `/sales` |

The Certalis account administers the Sales Customer workspace; it is not a
provider-wide super-admin console. Sign out before switching accounts. Public
registration creates participant accounts, not administrators.

If configured credentials fail, inspect with the installation owner rather than
reseed, edit passwords or assume the other VM's credentials apply.

## Optional: first seed for a fresh fixture installation only

Skip this on the existing rehearsal VMs. First complete the [installation guide's](implementation/two-os-installation.md)
prerequisites, database setup and private `.env` generation. Keep that installation's
master key, database URL and other runtime settings. Do not blindly copy `.env.example`.

From the new checkout, copy the seed template only when the destination is absent:

Windows PowerShell:

```powershell
[IO.File]::Copy((Join-Path $PWD 'config/portal-seed.example.json'), (Join-Path $PWD 'config/portal-seed.local.json'), $false)
```

Ubuntu shell:

```sh
(umask 077; set -C; cat config/portal-seed.example.json > config/portal-seed.local.json)
```

Stop on any copy error; do not overwrite an existing file. Edit the new JSON
privately in the VM:

- Set `heliosAdminEmail` and `certalisSalesAdminEmail` to two distinct valid emails.
- Set both password fields to private passwords of at least eight characters;
  replace all `replace-with-...` placeholders.
- For this fixture setup, set `heliosInstructor` to
  `{ "id": "fixture-instructor", "name": "Fixture Instructor" }`.
- Set `heliosCloudShareConnection` and `certalisSalesShareConnection` to `null`.
  Fixture onboarding needs no live CloudShare credentials.

In the existing fresh installation `.env`, set `PORTAL_MODE=fixture`,
`PORTAL_SEED_SOURCE=file` and
`PORTAL_SEED_CONFIG_PATH=./config/portal-seed.local.json`. Remove unused blank
`HELIOS_ADMIN_EMAIL`, `HELIOS_ADMIN_PASSWORD`, `CERTALIS_SALES_ADMIN_EMAIL` and
`CERTALIS_SALES_ADMIN_PASSWORD` lines: present-but-empty values are still validated
even in file mode. Preserve the generated master key and database/runtime settings.
Keep the seed file private and uncommitted.

Restart using that installation's existing service procedure, then open `/login`.
There is no `npm seed` command: normal login-page/auth/session handling initializes
seeding lazily once per process. Sign in with each configured account in turn.
Seeding upserts matching-email accounts, including password, role and Customer;
it can change existing access. Use this procedure only for the fresh installation,
not as password recovery. Existing CloudShare connections are not replaced by seeding.
