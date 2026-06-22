# ADR-002: The sponsored link is a server-only bearer credential, reached via a server-side redirect in a child window

**Status:** accepted (2026-06-12)

## Decision

The CloudShare sponsored-link `loginUrl` is treated as a **bearer credential**: it encodes the
experience and the user's access in a single token, so anyone holding it can enter that user's
environment while the experience window and policy are live. The portal therefore:

- Stores the `loginUrl` **server-side only** on the `LabLaunch`. It is **never returned to the
  client** or rendered in the portal UI.
- Lets the Candidate reach it only via a **portal endpoint opened in a child window**
  (`window.open("/api/exam/{attemptId}/enter")`). That endpoint recomputes entitlement, enforces
  the **launch-window time gate**, then issues a **302 redirect** to the `loginUrl`.
- Keeps the opener portal page alive with the **retained child-window handle**, which drives the
  heartbeat and `childWindow.closed` liveness/auto-suspend.
- May retain the `loginUrl` in **admin-only diagnostic logs** as support evidence. That does not
  weaken the server-only rule: the URL is still never returned to Candidate/client-facing APIs or
  rendered in the portal UI.

## Why

Three requirements collide: (1) hide the sponsored link from the user, (2) keep the exam session
monitorable, (3) the lab cannot be iframed (`frame-ancestors` CSP excludes the portal, and the lab
is cross-origin). A same-tab server redirect would hide the URL but navigate away from the portal,
killing the heartbeat. Handing the `loginUrl` to client JS to `window.open` (today's behaviour)
keeps liveness but exposes the credential. The server-302-in-a-child-window pattern satisfies all
three: the URL never enters client code or the portal UI, and the opener keeps monitoring.

## Consequences

- **Honest limitation:** the `loginUrl` is still visible in the **child window's own address bar
  and the browser network log** — unavoidable for any browser-followed redirect. "Hidden" means
  out of the portal UI and client code, not copy-pasteable from the portal. Fully hiding it would
  require proxying the lab through the portal, which is infeasible (cross-origin, CloudShare
  cookies/CSP).
- A production deployment for a real proctoring partner would instead need CloudShare R&D to add
  the partner's domain to the `frame-ancestors` allow-list, or a locked-down proctoring browser.
  Out of scope for the demo; recorded in the gap report.
