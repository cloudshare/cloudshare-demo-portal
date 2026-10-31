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

The command generates one random master key and two distinct random admin passwords for
this instance. Secrets live only in ignored private runtime files; terminal output identifies
the files and reports safe outcomes without printing credential values. There is no first-boot
service, marker-based skip, HTTP endpoint, listener, automatic provider call, or new dependency.

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

Operational acceptance separately verifies both demo VMs after backup and approved deployment:
fresh keys and passwords, both admin logins, expected basic defaults, and preserved surrounding
VM functionality. Automated CLI evidence does not substitute for that human acceptance.
