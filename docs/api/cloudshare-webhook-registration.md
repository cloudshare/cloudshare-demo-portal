# CloudShare Webhook Registration Fallback

Use this when the optional CloudShare v3 webhook auto-registration path has not been verified on the
live tenant. This keeps Slice 9 operable without inventing an unproven endpoint contract.

## What the portal exposes

After a Helios admin saves a CloudShare Connection, `GET /api/admin/cloudshare` returns:

- `webhookPathToken`
- `webhookPath`

`webhookPath` is only the portal path, for example:

```text
/api/webhooks/cloudshare/<opaque-token>
```

The host is intentionally not stored because the public tunnel or deployment URL is environment-
specific.

## Manual registration steps

1. Start the portal locally on `localhost:3000`.
2. Start or confirm the current QA tunnel:

```text
https://treasurer-computer-mailed-anderson.trycloudflare.com
```

This tunnel must forward to local `localhost:3000`.

3. Verify the public tunnel reaches the local portal **before** registering a CloudShare webhook:
   - open [https://treasurer-computer-mailed-anderson.trycloudflare.com](https://treasurer-computer-mailed-anderson.trycloudflare.com)
   - confirm the portal responds, or at minimum that the request reaches the local app instead of a
     Cloudflare/TLS error page

4. Read the current `webhookPath` from `GET /api/admin/cloudshare` while logged in as the Helios
   admin.
5. Build the full callback URL from:

```text
<current-public-base-url><webhookPath>
```

Example for live QA only:

```text
https://treasurer-computer-mailed-anderson.trycloudflare.com/api/webhooks/cloudshare/<opaque-token>
```

6. Register that full callback URL in the CloudShare webhook UI for the Helios CloudShare
   account/project, selecting **only** these environment lifecycle events:
   - `environment.created`
   - `environment.suspended`
   - `environment.resumed`
   - `environment.deleted`
   - `environment.extended`
   - `environment.archived`
7. Trigger a CloudShare environment lifecycle event and confirm:
   - the webhook request hits the portal route
   - invalid signatures return `401`
   - duplicate deliveries return `200`
   - accepted deliveries trigger the authoritative poll/reconcile path
   - support log entries appear without exposing the webhook secret, API key, sponsored link, or auth headers

## Notes

- The Cloudflare URL above is temporary QA context only. Do not store or commit it.
- The opaque token is the Customer-routing key. The handler resolves the Customer first, then selects
  that Customer's stored webhook secret before verifying the HMAC.
- CloudShare's current documented webhook contract is v3 Integration Hub / account-level webhooks.
  Do not assume a v4 experience webhook contract unless live evidence proves one.
- The receiver intentionally accepts only environment lifecycle events. Class, student, and assistance
  webhooks do not carry the environment state transition this slice reconciles.
- Webhooks remain a hint only. The authoritative state change still comes from the poll/reconcile
  flow.
