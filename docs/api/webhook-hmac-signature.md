# Verifying CloudShare Webhook HMAC Signatures

Verify an incoming CloudShare webhook signature before parsing or processing the
event. HMAC-SHA256 is calculated over the **exact raw HTTP request body bytes**:
do not parse and re-serialize JSON, trim the body, or otherwise alter its bytes
first.

> **Current CloudShare contract evidence:** the official CloudShare article
> [Creating and Using Webhooks](https://support.cloudshare.com/hc/en-us/articles/6780768178459-Creating-and-Using-Webhooks)
> currently states that webhook deliveries use the
> `x-cloudshare-signature` header and that receivers should reproduce the
> value with **HMAC-SHA256 Base64 output** over the webhook content. The
> same page does **not** confirm any optional signature prefix, so treat prefix
> handling as unconfirmed until current docs or a real delivery prove it.

## Current CloudShare Base64 variant

If you are implementing against the currently documented CloudShare contract,
verify the exact raw request bytes against the `x-cloudshare-signature` header
using HMAC-SHA256 Base64 output. Keep any optional prefix logic out of the
implementation unless current docs or an actual webhook delivery confirm it.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER = "x-cloudshare-signature";

function decodeCanonicalBase64(value: string): Buffer | null {
  const trimmed = value.trim();

  if (trimmed.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return null;
  }

  const decoded = Buffer.from(trimmed, "base64");

  if (decoded.length === 0 || decoded.toString("base64") !== trimmed) {
    return null;
  }

  return decoded;
}

export function verifyCloudShareWebhookSignatureBase64(
  rawBody: Buffer,
  suppliedSignature: string,
  sharedSecret: string,
): boolean {
  const supplied = decodeCanonicalBase64(suppliedSignature);

  if (supplied === null) {
    return false;
  }

  const expected = Buffer.from(
    createHmac("sha256", sharedSecret).update(rawBody).digest("base64"),
    "base64",
  );

  return (
    expected.length === supplied.length &&
    timingSafeEqual(expected, supplied)
  );
}
```

## TypeScript / Node.js implementation

The following hex-based implementation is the user-supplied generic reference.
Keep it only as a generic example. Do **not** copy it unchanged for the
currently documented CloudShare webhook contract above, because the official
CloudShare page currently documents `x-cloudshare-signature` with Base64 output
rather than hex.

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

In that generic hex example, the header is still a placeholder. For the
currently documented CloudShare contract, the official CloudShare page linked
above confirms `x-cloudshare-signature` plus Base64 output, while any optional
prefix remains unconfirmed and must be checked against the latest docs or an
actual webhook delivery before you add prefix logic.

## Signature mismatches

Check these common causes before changing the verifier:

1. The receiver parsed and re-serialized JSON instead of signing the raw body.
2. A calculator or test tool added `\n` or `\r\n` to the body.
3. One side used Base64 while the other used hex.
4. The textual shared secret was treated as an encoded key instead of the
   literal secret text.
5. The receiver assumed a prefix format that current CloudShare docs did not
   confirm, or a delivered prefix was not handled the same way on both sides.
6. The receiver used ordinary equality rather than a constant-time comparison.

## Secret handling

Keep the shared secret in backend-only secret storage. Do not expose it to the
browser, put it in logs, include it in fixtures, or commit it to the repository.
Use only a Customer's own secret when verifying that Customer's callback.

## Safe console example

This synthetic example is safe to run locally. It does not establish any
unconfirmed CloudShare prefix detail and does not override the currently
documented Base64 contract for `x-cloudshare-signature`.

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
