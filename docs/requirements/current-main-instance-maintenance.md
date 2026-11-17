# Explicit current-main instance maintenance

Issue #512 adds permanent Windows and Ubuntu entry points to the prepared VM
image. The existing `Initialize-Portal.cmd` and `initialize-portal.sh` names remain
compatible, but each invocation now selects initialization or update from the
instance's actual private files. Nothing runs automatically at boot or sign-in.

## Source and execution

The launcher obtains the public `cloudshare/cloudshare-demo-portal` repository's
`main` branch in a unique tooling checkout outside the active installation. It
uses the one exact commit obtained by that clone for the entire run. Full history
is retained so the existing updater can prove fast-forward ancestry. The remote
is fixed; credentials and arbitrary remote overrides are not launcher inputs.
The downloaded release contains the current maintenance logic. Download failure
leaves the installed source, service and private data unchanged.

The installation remains at its existing VM path and uses the existing native
app task/service. Nginx, TLS, workspace settings, Overview and native content pages
are preserved. Generated repository documentation is built and published without
deleting unrelated content in the existing documentation directory.

| Purpose | Windows | Ubuntu |
| --- | --- | --- |
| Installed checkout | `C:\CloudShareDemoPortal` | `/home/sysadmin/cloudshare-demo-portal` |
| Persistent launcher | `C:\Users\Public\Desktop\Initialize-Portal.cmd` | `/home/sysadmin/initialize-portal.sh` |
| Existing app | Scheduled task `issue489-next` | `issue489-next.service` |
| Published documentation | `C:\CloudSharePortalDocs` | `/var/www/cloudshare-portal-docs` |

The Windows launcher runs with the installation owner's administrator rights.
Ubuntu runs as `sysadmin`, using normal sudo authorization for existing service
control and documentation publication. Neither launcher provisions an OS runtime,
creates native services or changes proxy configuration.

## State selection and lifecycle

No canonical private files means a fresh instance. All three files (`.env`,
`config/portal-seed.local.json`, `prisma/dev.db`) means an existing instance.
Partial state, unsupported configuration, tracked local edits or non-fast-forward
source require operator resolution; there is no automatic reset or force mode.

Before changing the installation, prepare the pinned source and tooling. Stop only
the existing portal app and verify it has stopped before initialization, backup,
dependency replacement or migration. Preserve the proxy and documentation service.

Fresh initialization advances source, installs locked dependencies, generates the
Prisma client, invokes the existing initializer, builds the application and static
documentation, and starts the existing app. Initialization precedes the production
build because it supplies the instance configuration. Failed build after setup
does not authorize another initialization; retained private files select update.

Updates reuse the existing verified backup and update CLIs. Keep their tooling and
the matched backup outside the installation. Preserve configuration, encryption
key, credentials and database; apply supported migrations, build, publish selected
documentation and start the existing app only after successful preparation.

Failures identify the failed phase without printing secrets. After an update has
started, leave the app stopped and retain the original backup and tooling for the
documented explicit recovery procedure. Do not automatically roll back migrations.
Report the exact release commit. Launchers remain available after success.

## Verification and delivery

Public command-line tests use disposable repositories and instances. Cover fresh
initialization, preserved state during update, local edit refusal, download failure,
build failure and native service sequencing on Windows and Ubuntu. The operator confirmed these test seams before implementation. Automated evidence, native VM
execution and browser verification are separate acceptance records.

Confirmed public CLI seams:

- Execute the two real launcher files with disposable external command fixtures:
  verify download failure never invokes maintenance, success selects the downloaded
  release, exit failures propagate, and the launcher remains present.
- Execute the shared maintenance CLI from a disposable retained tooling checkout,
  targeting a disposable installation: verify fresh/update selection, clean-source
  and partial-state refusal, native stop/start sequencing, production/docs build
  outcomes and safe recovery guidance. Substitute OS service commands only at the
  external command boundary; use real Git repositories and the existing backup,
  update and setup CLI contracts.
- Retain existing setup authentication and backup/update preservation tests as
  regression evidence for generated credentials, matching key/configuration and
  decryptable saved Connections. These do not prove actual VM service/browser use.

Deploy reviewed launchers to the identified build environment and leave it
uninitialized. Report snapshot readiness with exact source and state evidence.
Snapshot capture and subsequent clone/revert verification are separate operator
gates; deployment does not prove either occurred. Existing environments require
one explicit launcher installation, not an automatic rollout.

Before declaring the build environment ready for capture, record:

- Exact reviewed source commit and deployed launcher paths/bytes on both OSs.
- Installed runtime, Git and public-source reachability prerequisites.
- App stopped, with no owned listener, and canonical private instance files absent.
- Existing proxy/TLS, documentation, Overview, native pages and workspaces preserved.
- Native launcher/CLI and browser evidence, distinguishing disposable rehearsal
  from the final deliberately uninitialized image state.
- Temporary fixture cleanup and any retained recovery material; no initialized
  credentials, databases or private backups included in the proposed image.

This document defines acceptance; it does not claim these checks have run.
