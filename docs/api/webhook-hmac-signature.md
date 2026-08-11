# Verifying CloudShare Webhook HMAC Signatures

Use this guide to verify an incoming CloudShare webhook with the shared secret
stored for the Customer that owns the callback URL. Verify the signature before
parsing or otherwise trusting the request body.

> **Important: confirm the delivery details first.** CloudShare's current
> documentation and a captured, real webhook must establish the signature header
> name, whether its value has a prefix, and its digest encoding. The placeholders
> below are deliberately not CloudShare facts. Do not deploy a receiver until
> they have been replaced with the confirmed values for the relevant CloudShare
> account and webhook configuration.

| Delivery detail | Value to confirm |
| --- | --- |
| Signature header name | `<confirmed-signature-header-name>` |
| Optional signature-value prefix | `<confirmed-prefix-or-none>` |
| Digest encoding | `<confirmed-base64-or-hex-or-other-encoding>` |

## What is signed

Compute HMAC-SHA256 over the **exact raw HTTP request body bytes** that arrived
at the receiver. Do not parse JSON, stringify it again, pretty-print it, trim
it, or change character encoding before verification: any of those operations
can change the bytes and make a valid signature fail.

For a Node.js receiver, retain the raw `Buffer` or `Uint8Array` supplied by the
HTTP framework. Decode or parse it only after the signature is accepted.

## TypeScript / Node.js implementation

This implementation compares decoded digest bytes with `timingSafeEqual`. Pass
the digest encoding that you confirmed with CloudShare; the examples use a
parameter so that `base64` is not accidentally presented as a confirmed
CloudShare detail.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

type ConfirmedDigestEncoding = "base64" | "hex";

export function computeWebhookSignature(
  rawBody: Uint8Array,
  sharedSecret: string,
  digestEncoding: ConfirmedDigestEncoding,
): string {
  // Core operation: HMAC-SHA256 of the exact raw request-body bytes.
  return createHmac("sha256", sharedSecret).update(rawBody).digest(digestEncoding);
}

export function verifyWebhookSignature(
  rawBody: Uint8Array,
  receivedSignature: string | null | undefined,
  sharedSecret: string,
  digestEncoding: ConfirmedDigestEncoding,
  confirmedPrefix = "",
): boolean {
  if (!receivedSignature) return false;

  const signatureValue = confirmedPrefix
    ? receivedSignature.startsWith(confirmedPrefix)
      ? receivedSignature.slice(confirmedPrefix.length)
      : ""
    : receivedSignature;

  const expected = Buffer.from(
    computeWebhookSignature(rawBody, sharedSecret, digestEncoding),
    digestEncoding,
  );
  const received = Buffer.from(signatureValue, digestEncoding);

  return received.length === expected.length && timingSafeEqual(received, expected);
}
```

If CloudShare confirms an encoding other than `base64` or `hex`, adapt the
encoding type and decoding consistently, then cover it with a safe fixture
before deployment. Never infer an encoding from its visual appearance.

## Receiver example

This Express example captures a raw body for this endpoint only. Replace each
`<confirmed-...>` placeholder with the value verified from current CloudShare
documentation or a real delivery. It does not claim a particular CloudShare
header, prefix, or encoding.

```ts
import express from "express";
import { verifyWebhookSignature } from "./verify-webhook-signature";

const app = express();
const signatureHeader = "<confirmed-signature-header-name>";
const signaturePrefix = "<confirmed-prefix-or-empty-string>";
const digestEncoding = "<confirmed-digest-encoding>" as "base64" | "hex";

app.post("/api/webhooks/cloudshare/:customerToken", express.raw({ type: "*/*" }), (req, res) => {
  const sharedSecret = lookupCustomerWebhookSecret(req.params.customerToken);
  const receivedSignature = req.get(signatureHeader);
  const rawBody = req.body as Buffer;

  if (!sharedSecret || !Buffer.isBuffer(rawBody) || !verifyWebhookSignature(
    rawBody,
    receivedSignature,
    sharedSecret,
    digestEncoding,
    signaturePrefix,
  )) {
    return res.status(401).json({ status: "invalid_signature" });
  }

  const event = JSON.parse(rawBody.toString("utf8"));
  // Validate the event, then trigger the authoritative poll/reconcile flow.
  return res.status(202).json({ status: "accepted", event: event.Event });
});
```
Do not attach a JSON body parser ahead of this route. If the framework has
already parsed the body, use its supported raw-body mechanism instead. The
callback path must identify the Customer before the receiver loads that
Customer's secret; the signature cannot select the Customer safely.

CloudShare webhooks remain a best-effort hint in this portal. A verified,
validated delivery should trigger the authoritative poll/reconcile path; it is
not itself the source of an environment state transition. See
[the webhook registration fallback](./cloudshare-webhook-registration.md) and
[ADR-003](../decisions/ADR-003-event-correlation-and-polling-as-truth.md).

## Mismatch troubleshooting

Work through these checks without logging the secret, signature, or full
webhook body:

1. Confirm the header name, optional prefix, and digest encoding against current
   CloudShare material or a real captured delivery. Header names are
   case-insensitive, but a signature value and its prefix are not.
2. Confirm the receiver received the raw bytes. Common failures are JSON/body
   middleware running first, `JSON.stringify`, line-ending changes, trimming,
   or converting bytes through the wrong text encoding.
3. Confirm the callback path resolved the intended Customer and its current
   webhook secret. Do not fall back to a global secret.
4. Confirm the secret was copied unchanged and has not been rotated in
   CloudShare without updating the Customer-scoped stored value.
5. Compare only safe metadata in diagnostics: request byte length, a body hash,
   the configured signature scheme identifier, and whether the comparison
   matched. Do not log the header value, secret, or bearer-style callback URL.

## Secret-storage rules

- Store one webhook secret per Customer, encrypted at rest; decrypt only while
  verifying an incoming request.
- Keep the secret server-only. Never send it to browser code, return it from an
  API, add it to source control, or include it in ordinary logs, error messages,
  screenshots, or support tickets.
- Read secrets from a managed secret store or the portal's encrypted
  Customer-scoped connection record, not a shared global environment variable.
- Rotate a secret deliberately: update CloudShare and the stored Customer value
  as one controlled operation, record only safe audit metadata, and test the
  new value with a disposable delivery.

## Safe local test example

Use a test-only secret and synthetic bytes. This proves the receiver preserves
raw bytes and rejects tampering; it does not prove any unconfirmed CloudShare
delivery detail.

```ts
import { expect, it } from "vitest";
import { computeWebhookSignature, verifyWebhookSignature } from "./verify-webhook-signature";

it("verifies the exact test body and rejects a changed byte", () => {
  const body = Buffer.from('{"Event":"environment.created"}', "utf8");
  const signature = computeWebhookSignature(body, "test-only-secret", "base64");

  expect(verifyWebhookSignature(body, signature, "test-only-secret", "base64")).toBe(true);
  expect(
    verifyWebhookSignature(
      Buffer.from('{"Event":"environment.deleted"}', "utf8"),
      signature,
      "test-only-secret",
      "base64",
    ),
  ).toBe(false);
});
```
