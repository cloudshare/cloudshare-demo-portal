# Verifying CloudShare Webhook HMAC Signatures

Verify an incoming CloudShare webhook signature before parsing or processing the
event. HMAC-SHA256 is calculated over the **exact raw HTTP request body bytes**:
do not parse and re-serialize JSON, trim the body, or otherwise alter its bytes
first.

> **Confirm the delivery details before use.** The signature header name,
> optional signature prefix, and digest encoding must be confirmed from current
> CloudShare documentation or an actual webhook delivery. The placeholder header
> in the receiver example is not a CloudShare fact.

## TypeScript / Node.js implementation

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Produces the HMAC-SHA256 signature for the exact webhook request bytes.
 */
export function createWebhookSignature(
  rawBody: Buffer,
  sharedSecret: string,
): string {
  return createHmac("sha256", sharedSecret).update(rawBody).digest("hex");
}

/**
 * Safely compares a supplied webhook signature with the expected signature.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  suppliedSignature: string,
  sharedSecret: string,
): boolean {
  const expectedSignature = createWebhookSignature(rawBody, sharedSecret);
  const normalizedSignature = suppliedSignature
    .trim()
    .replace(/^sha256=/i, "");

  if (!/^[0-9a-f]{64}$/i.test(normalizedSignature)) {
    return false;
  }

  const expected = Buffer.from(expectedSignature, "hex");
  const supplied = Buffer.from(normalizedSignature, "hex");

  return (
    expected.length === supplied.length &&
    timingSafeEqual(expected, supplied)
  );
}
```

The core operation is deliberately just these three lines: use the shared
secret as the HMAC key, update it with the unchanged raw bytes, and emit a hex
digest.

```ts
createHmac("sha256", sharedSecret)
  .update(rawBody)
  .digest("hex");
```

## Receiver usage

The following is a generic example for a Customer's own backend receiver.
Capture the raw body with that framework's supported raw-body mechanism, then
verify it before processing the event:

```ts
const isAuthentic = verifyWebhookSignature(
  rawRequestBody,
  request.headers["x-webhook-signature"], // Replace with the actual header.
  process.env.CLOUDSHARE_WEBHOOK_SECRET,
);

if (!isAuthentic) {
  // Reject the request before processing the webhook event.
}
```

For Certalis, this generic example is not the portal implementation: Certalis
must resolve the Customer from the opaque callback path and load/decrypt that
Customer's stored CloudShare Connection webhook secret at verification time. It
must never replace this with a global environment-secret lookup.

The header shown above is a placeholder, not a confirmed CloudShare header.
Confirm its name, whether the value has an optional prefix, and whether hex is
the delivered encoding before configuring a live receiver.

## Signature mismatches

Check these common causes before changing the verifier:

1. The receiver parsed and re-serialized JSON instead of signing the raw body.
2. A calculator or test tool added `\n` or `\r\n` to the body.
3. One side used Base64 while the other used hex.
4. The textual shared secret was treated as an encoded key instead of the
   literal secret text.
5. The supplied signature has a `sha256=` prefix that was not removed.
6. The receiver used ordinary equality rather than a constant-time comparison.

## Secret handling

Keep the shared secret in backend-only secret storage. Do not expose it to the
browser, put it in logs, include it in fixtures, or commit it to the repository.
Use only a Customer's own secret when verifying that Customer's callback.

## Safe console example

This synthetic example is safe to run locally. It does not establish any
unconfirmed CloudShare header, prefix, or encoding detail.

```ts
const body = Buffer.from('{"event":"created","id":123}', "utf8");
const signature = createWebhookSignature(
  body,
  "example-shared-secret",
);

console.log(signature);
console.log(
  verifyWebhookSignature(
    body,
    signature,
    "example-shared-secret",
  ),
);
```

For registration and callback setup, see
[CloudShare Webhook Registration Fallback](./cloudshare-webhook-registration.md).
