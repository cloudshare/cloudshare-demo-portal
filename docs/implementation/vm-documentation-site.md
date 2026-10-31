# VM documentation site (#493)

This is a build-only static site for the existing Windows and Ubuntu Nginx HTTPS
hosts. It adds no portal API, listener, login, or live CloudShare operation.

## Reviewed publication scope

Only these Markdown files are published. URLs are relative to `/docs/`.

| Repository source | Output URL |
|---|---|
| `docs/flows/README.md` | `index.html` |
| `docs/flows/authentication.md` | `authentication.html` |
| `docs/flows/certification-admin.md` | `certification-admin.html` |
| `docs/flows/certification-candidate.md` | `certification-candidate.html` |
| `docs/flows/coverage.md` | `coverage.html` |
| `docs/flows/endpoints.md` | `endpoints.html` |
| `docs/flows/operations.md` | `operations.html` |
| `docs/flows/sales-configuration.md` | `sales-configuration.html` |
| `docs/flows/sales-sessions.md` | `sales-sessions.html` |
| `docs/flows/sales-trial.md` | `sales-trial.html` |
| `docs/flows/trial-administration.md` | `trial-administration.html` |
| `docs/implementation/two-os-installation.md` | `installation.html` |

The audit found placeholder identities and source-level integration traces, not
real credentials or tenant identifiers, in the selected flow pages. Their 14
Mermaid blocks remain readable code fences; ordered tables carry the same traces.
There are no selected image assets. The installation guide is dated rehearsal
evidence, not a claim about the current VM checkout or completion of #489.

Root `README.md` is excluded: it includes workstation-specific credential-file
locations, a named local tunnel, disposable QA key examples, and internal agent
workflow. Source files, ADRs, API exports, discovery/evidence documents and every
other unselected file are excluded even when a selected page links to them.

## Rendering and links

The fixed CLI `npm run build:docs` reads only the twelve sources above and writes
`build/docs-site`: twelve HTML files and one stylesheet. It accepts no source or
output arguments. The artifact works independently of its checkout. Rebuilding
replaces stale output; deploy only this artifact, never a repository directory.

The pinned build dependency [markdown-it 15.0.3](https://markdown-it.github.io/markdown-it/)
renders tables, lists and escaped fenced code with `html: false`. No browser
JavaScript, remote assets, plugins or Mermaid runtime are used. Raw HTML is text.
Images are text labels, never fetched. Heading IDs preserve selected page fragment
links and suffix repeated headings. Build fails for missing selected anchors.

Selected relative Markdown links become local HTML links. Other repository/file
references become nonclickable labels; a page notice explains their omission.
External HTTP(S) links without embedded credentials remain clickable. Other
schemes, protocol-relative URLs, absolute file paths and unselected paths are
nonclickable. Source links do not become GitHub links or cause files to be copied.

## Build and update

In the isolated source checkout with dependencies installed:

```sh
npm run test:docs
npm run build:docs
```

`test:docs` exercises the actual CLI in disposable fixture directories, including
the real allowlist/navigation, tables/fences, anchors, unsafe Markdown/links,
excluded-file sentinels and stale-output replacement. It opens no network listener.
The static test cannot prove Nginx routing; guest and browser checks remain separate.

Record the source commit and artifact archive SHA256 before transferring the same
artifact to both VMs. Extract into an empty deployment directory outside the
checkout (Windows `C:/CloudSharePortalDocs`, Linux `/var/www/cloudshare-portal-docs`).
Require exactly the twelve HTML files and `style.css`; copy no source, environment,
database, key, history, log or evidence files. Retain the previous artifact outside
the served directory for rollback. Updates repeat build, hash, transfer and replace.

## Existing Nginx HTTPS server

Add the following locations inside each existing HTTPS `server` block, leaving
its certificate, portal proxy, forwarding/redirect rules and private port intact.
Use the Linux alias below, or `C:/CloudSharePortalDocs/` on Windows. The trailing slash
is intentional. Do not point the alias at the checkout, its parent, or a directory
containing other files. Do not add a new server/listener.

```nginx
location = /docs { return 301 /docs/; }
location ^~ /docs/ {
    alias /var/www/cloudshare-portal-docs/;
    index index.html;
    autoindex off;
    types { text/html html; text/css css; }
    try_files $uri $uri/ =404;
}
```

On the target guest, back up its existing configuration, validate using its
installed `nginx -t`, then reload only that existing Nginx instance. On failure,
restore the previous configuration/artifact; do not restart or alter the portal.
Guest QA must confirm `/docs`, `/docs/`, all selected pages and fragments, CSS,
and 404 for `/docs/.env`, `/docs/.git/config`, `/docs/prisma/dev.db`,
`/docs/README.md`, `/docs/src/composition.ts` and an arbitrary missing path.
Test encoded traversal attempts as well, checking that no checkout content leaks.
Browser QA on both real HTTPS hosts must follow navigation/anchors, inspect
tables/fences and console output, then exercise portal login/logout. Record exact
head, guest checks, browser evidence and human acceptance separately before merge.

On the Windows rehearsal VM, the existing Nginx task runs as SYSTEM. An admin
API execution of `nginx -s reload` failed with `OpenEvent` error 5 (access denied);
the original configuration was restored before recovery. Reload under the
existing Nginx owner's SYSTEM identity, using its executable, prefix and
configuration paths. The rehearsal used a one-time SYSTEM scheduled task whose
only action was that reload: it exited 0 and was then removed. Do not kill Nginx,
replace its startup task, or restart the portal to work around the identity mismatch.

## Windows VS Code

Download the official x64 system installer inside the Windows guest from
`https://update.code.visualstudio.com/latest/win32-x64/stable`. Before running it,
record its SHA256 and require `Get-AuthenticodeSignature` to report `Valid` with
a Microsoft signer. Run the verified installer with
`/VERYSILENT /NORESTART /MERGETASKS=!runcode`, wait for completion, and record the
exit code and installed version. Open the existing portal checkout in VS Code
inside the guest to verify the actual result. Do not add accounts, credentials or
extensions. The rehearsal installed version `1.144.0`; the installer SHA256 was
`73110a3dad68b4ec32636cddf5693192a2058ab62fe159ea3d3a19368d6d7f76`.
Both installer and installed `Code.exe` had Valid Microsoft Corporation
Authenticode signatures, and the installer exited 0. A first API-launched
installer attempt failed with a registry-key-marked-for-deletion error; its cause
was not established. A separately reviewed one-time SYSTEM task ran the same
verified installer successfully and was removed after completion. No registry,
profile or security-policy change was made. Record interactive checkout-opening
evidence separately on the PR; installation metadata alone does not prove it.

## CloudShare environment Overview

Confirm the owned environment's exact identity in the real viewer, then open its
environment editor and the Overview tab's existing HTML field. Do not
select a customization file by name alone. A short content template is:

```html
<h1>{{Name}}</h1>
<p>Choose Windows or Ubuntu. Either VM works independently, with its own copy
of the Certalis demo portal and local data.</p>
<ul>
  <li><a href="WINDOWS_HTTPS_HOST/login">Windows portal</a> ·
      <a href="WINDOWS_HTTPS_HOST/docs/">Windows documentation</a></li>
  <li><a href="UBUNTU_HTTPS_HOST/login">Ubuntu portal</a> ·
      <a href="UBUNTU_HTTPS_HOST/docs/">Ubuntu documentation</a></li>
</ul>
<cs-viewer-start-button></cs-viewer-start-button>
```

Replace both host placeholders with the verified HTTPS origins for that exact
environment. Before Save, verify the environment-only scope. The current editor
offers a separate **Save To Snapshot** action; use normal **Save Changes** and
never select Snapshot propagation for this procedure. Leave Guided Journey and
unrelated customizations unchanged. Reopen the actual environment viewer, verify
the text, and check the four links.

The rehearsal confirmed the exact environment in the editor and viewer. Normal
Save Changes followed by its generic confirmation reported success; Save Changes
then became disabled. Fresh viewer readback showed the title, independent-VM text,
four correct HTTPS links and preserved VM-list button. The Windows documentation
link opened the published guide. Save To Snapshot was not selected. This is
environment customization evidence, not a Snapshot or image-capture claim.

## Verification record (2026-10-31)

The generated artifact was built from reviewed source
`e280809625891e08bc9998dbe96222566a16bfaa`; archive SHA256
`0f6b4b01d55e4a26102784d597bca488f1f88a9831a90ebe31a9eb1b50cb3142`.
Both application checkouts stayed clean at `3b0cfb31`; deploying static files did
not require an app build or database migration.

- Both existing HTTPS hosts returned all thirteen artifact files with identical
  hashes, HTML/CSS MIME types and HTTP 200. `/docs` redirected to `/docs/`, whose
  content matched the generated index.
- Both returned 404 for environment, Git, database, source, unselected Markdown,
  arbitrary missing and tested traversal paths. Environment-file and TLS-key
  hashes matched their recorded baselines; values stayed private.
- Login pages returned HTTP 200; health confirmed fixture mode and persistence.
- Browser interaction on both hosts followed the flow guide to the endpoint
  index/anchor, back to the guide and into the installation guide. Captured
  warning/error lists were empty, subject to capture limits; no HTTPS warning or
  bypass occurred. Certificate details were not independently inspected.
- Portal browser regression remains partial: registration/sign-in submissions
  were followed by browser attachment timeouts. Linux's guest-only HTTPS check
  passed admin login, session, admin home, logout and post-logout session rejection
  using its existing fixture credentials in memory. Windows's inline check
  returned a provider 500 without an execution ID; its outcome is unknown. Browser
  control detached before the file-based follow-up could be uploaded, so no
  further automated auth attempt was made. A possible extra Windows QA auth
  session must be considered in the later image audit. The synthetic Linux
  registration exists; do not repeat it blindly.
- Static CLI tests (4/4), lint and typecheck passed. The isolated Linux run
  passed 13 launcher tests with one Windows-only skip. Full Vitest finished with
  296 passing files and one failing file: 2,645 tests passed and four failed in
  the unchanged `candidate-home-route-focus.test.tsx` focus, scheduled-copy and
  card-label/order expectations. The same four failures reproduced at baseline
  `3b0cfb31f487faf15d9c4bc0d8d094b6dbd23d53`; a separate comparison installed that
  commit's original lockfile and again reported four failures and seven passes.
  These are pre-existing failures; the full suite is not green.
  The parent accepted this documented baseline exception for #493. The four names
  are:
  - keeps focus on the task control and announces route-backed task changes;
  - explains a scheduled current attempt without making the destination heading focusable;
  - renders every current Exam Attempt as a complete card with its own action target;
  - keeps current cards in place when background refresh changes their statuses.
- The environment Overview was saved and verified in the real viewer as above.
  VS Code installation passed as above. Interactive checkout opening and human
  acceptance must be recorded separately on the PR before merge.

The Windows GUI attempt stopped at the viewer's RDP connection screen; no desktop
interaction or README preview was verified. Human QA must open VS Code inside the
Windows VM, open `C:\CloudShareDemoPortal`, and preview `README.md` in Restricted
Mode. For the Windows portal regression, use `HELIOS_ADMIN_EMAIL` and
`HELIOS_ADMIN_PASSWORD` from that same VM's local `.env` inside the VM to sign in,
open the admin home and sign out. Do not copy those values into chat, edit the
file, use a real Customer credential, or add/reset an account. If the viewer
cannot connect, record the check as blocked rather than accepted.
