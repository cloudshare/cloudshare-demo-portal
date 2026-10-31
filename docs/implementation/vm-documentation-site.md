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
