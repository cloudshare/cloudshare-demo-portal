# Manual per-instance initialization

Issue #496: Add manual per-instance initialization and safely rotate the demo VM master keys.
The approved application-only fresh baseline is recorded in
[the issue decision](https://github.com/cloudshare/cloudshare-demo-portal/issues/496#issuecomment-6548197760).

## Operator interface

Run `npm run setup:instance` from the repository root with Node 24 after installing
dependencies and generating the Prisma client (`npm ci`, then `npm run prisma:generate`).
Run `npm run setup:instance -- --reset` to replace an existing application baseline.
Stop the application first and make an external backup before reset. Backup/export and
deployment to the two demo VMs are separately reviewed operational steps.

The explicit prepared-VM entry points are `scripts/Initialize-Portal.cmd`, copied
to `C:\Users\Public\Desktop\Initialize-Portal.cmd`, and
`scripts/initialize-portal.sh`, copied executable to `/home/sysadmin/initialize-portal.sh`.
On Windows, the operator right-clicks the desktop file and chooses **Run as administrator**;
the launcher does not elevate itself.
They use the fixed VM checkout and installed Node path, call normal setup without
`--reset`, and reload only the existing owned app after setup exits successfully,
so generated configuration takes effect even when the app was already running.
Prepared launchers require no manual prestop. Windows stops a Running `issue489-next`
task, waits at most ten seconds for it to stop, then starts it; a Ready task starts
without a stop. Ubuntu restarts `issue489-next.service`. Setup failure leaves the
service alone; service reload failure returns nonzero. Windows pauses before
exiting with the saved result. After setup and service start both succeed, each
wrapper removes itself only at its exact deployed desktop/home path above; canonical
repository scripts remain. Setup/start failure retains the launcher, and deletion
failure is visible and returns nonzero. These wrappers do not install software, create
services, change policies, or initialize automatically at boot. The human runs
them after capture of the uninitialized image. Copy instructions are in the
[installation guide](../implementation/two-os-installation.md#prepared-vm-launchers).

The command generates one random master key and two distinct random admin passwords for
this instance. Secrets live only in ignored private runtime files; terminal output identifies
the files and reports safe outcomes without printing credential values. There is no first-boot
service, marker-based skip, HTTP endpoint, listener, automatic provider call, or new dependency.
On Windows, setup protects staging before writing secrets and applies explicit private ACLs
to the promoted files for the current operator, SYSTEM, and Administrators. Linux private
files use mode `0600`. Unrelated environment values must survive the actual Next.js parser;
representations that cannot preserve those values are refused before replacement.

## Baseline and preservation

The command creates a fresh SQLite database using the committed Prisma migrations and writes
valid `.env` and file-mode seed configuration. Existing portal seeding and password functions
create the Helios CX and Certalis Customers, their two admins, and the existing Sales Trial
portal default in the staged database before replacement. The initializer does not duplicate password
hashing, authentication, or seeding logic, and does not manufacture Exams or CloudShare assets.

Reset discards application history, including Candidates, sessions, diagnostics, and audit
records. VM/OS/software, workspaces, SSH, TLS, documentation, and the Overview remain intact.
Existing unrelated environment settings, including runtime mode and tunnel configuration, are
preserved. Existing configured admin email addresses and Instructor configuration are retained;
a new configuration defaults to fixture mode with fixture-only Instructor configuration.

Known legacy global CloudShare credentials, env-based seed credentials, and obsolete admin
password/token values are removed from the generated environment. The new seed file contains
no CloudShare credentials. Unknown environment variables are not indiscriminately removed.
Preparing a credential-free reusable image is a separate operational step.

Only the canonical `.env`, `config/portal-seed.local.json`, and `prisma/dev.db` runtime
paths are supported. Custom database and seed paths are refused rather than migrated or removed.
Environment override files, symbolic links at owned runtime paths, and SQLite sidecar files
also require operator resolution before setup; the command does not repair or remove them.

## Prepared VM support layout

The approved layout keeps the application checkout and initializer paths unchanged.
Repository-root `/runtime/` is Git-ignored: Windows targets `nginx`, `docs`, `workspaces`
and `tmp`; Ubuntu uses `logs`, `workspaces` and `tmp`. Ubuntu's log/workspace move
and updated unit reference were independently verified on 2026-11-01 at `a128a21e`,
with the app stopped and uninitialized. Windows consolidation is deferred after a
native Nginx quit failure before moves; its helper reported rollback, but independent
recovery verification remains pending. Its configured original support paths remain
documented in the installation guide. Stock Ubuntu Nginx, TLS,
systemd and documentation paths remain outside the checkout. Node, Git, VS Code,
`.local`, `.ssh` and `.vscode-server` stay in their standard locations.
Future operational checks use one bounded directory under `runtime/tmp` and remove
their temporary files afterward; they do not create permanent per-issue directories.
Git CLI tests check representative runtime exclusions and canonical source trackability.
Moving existing files and updating native consumers requires separate reviewed guest
operations and verification; this source change performs neither.

## Failure behavior

Before mutation, inspect an existing database read-only. Any persisted CloudShare Connection
blocks initialization, including explicit reset: replacing its encryption key would strand stored
credentials. An unreadable or incompatible existing database also blocks the command.

Validate prerequisites and stage the new database and private configuration before replacing
owned runtime files. A missing prerequisite or failed migration leaves the old runtime files
untouched. No generic backup or multi-file transaction framework is introduced. The operator's
external backup is the recovery source for interruption during final file replacement.

## Verification contract

The approved public test seam is the CLI subprocess with disposable real files and SQLite,
followed by compatibility checks through existing configuration, seeding, and password APIs.
Tests cover new setup, distinct instance credentials, explicit reset, preserved runtime settings,
connection refusal, and prerequisite/migration failures without replacement. No fixture test
contacts CloudShare or starts an application listener.

Launcher tests use the approved synthetic command seam: disposable copies with
exact fixed checkout/Node path substitutions, Windows task-cmdlet mocks executed
by native PowerShell, and Linux PATH command stubs. They verify running-app reload,
Ready-task start without an unnecessary stop, setup failure without service changes,
service failure with a nonzero exit, and success-only deployed-copy self-removal
while canonical scripts remain. Run
`npm run test:instance-launchers` in the isolated guest test checkout; these tests
do not run the real initializer or start the actual portal.

Operational acceptance separately verifies both demo VMs after backup and approved deployment:
fresh keys and passwords, both admin logins, expected basic defaults, and preserved surrounding
VM functionality. Automated CLI evidence does not substitute for that human acceptance.
