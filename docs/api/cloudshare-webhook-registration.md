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

1. Start the portal locally.
2. Start the temporary public tunnel for the local server.
3. Read the current `webhookPath` from `GET /api/admin/cloudshare` while logged in as the Helios
   admin.
4. Build the full callback URL from:

```text
<current-public-base-url><webhookPath>
```

Example for live QA only:

```text
https://treasurer-computer-mailed-anderson.trycloudflare.com/api/webhooks/cloudshare/<opaque-token>
```

5. Register that full URL in the CloudShare webhook UI for the Helios CloudShare account/project.
6. Trigger a CloudShare environment lifecycle event and confirm:
   - the webhook request hits the portal route
   - invalid signatures return `401`
   - duplicate deliveries return `200`
   - accepted deliveries trigger the authoritative poll/reconcile path
   - support log entries appear without exposing the webhook secret, API key, sponsored link, or auth headers

## Notes

- The Cloudflare URL above is temporary QA context only. Do not store or commit it.
- The opaque token is the Customer-routing key. The handler resolves the Customer first, then selects
  that Customer's stored webhook secret before verifying the HMAC.
- Webhooks remain a hint only. The authoritative state change still comes from the poll/reconcile
  flow.
