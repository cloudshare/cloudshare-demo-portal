import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * CloudShare environment webhook contract: signature verification, payload
 * validation, and idempotency-key synthesis. This is the only place that knows
 * CloudShare's webhook wire format; every other layer works with the normalised
 * {@link CloudShareEnvironmentEvent}.
 *
 * Signing scheme: HMAC-SHA256 of the *raw* request body, encoded base64, keyed by
 * the resolved Customer's account-level webhook secret. The raw body must be
 * verified before any JSON re-serialisation, which would change the bytes.
 *
 * NOTE:
 *  - The primary shape below follows the live CloudShare v3 Integration Hub webhook
 *    shape: top-level `Event` + `CreatedAt`, with event-specific data under
 *    `Payload`. Live deliveries may send `Payload` as a JSON string with PascalCase
 *    keys, despite the docs presenting it as an object.
 *  - Only environment lifecycle events are useful to this portal. Other documented
 *    webhook events, such as class or student events, are rejected at this boundary.
 *  - CloudShare cannot send custom headers and the payload carries no unique event
 *    id, so dedupe uses a key synthesised from (environmentExternalId, Event,
 *    CreatedAt) rather than a header or body id.
 *  - The signature is delivered in the {@link CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER}
 *    request header (the route reads it and passes it here).
 */

/** Request header carrying the base64 HMAC signature. Assumption — verify live. */
export const CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER = "x-cloudshare-signature";

/** The environment lifecycle events the portal ingests. */
export const CLOUDSHARE_ENVIRONMENT_EVENT_TYPES = [
  "environment.created",
  "environment.suspended",
  "environment.resumed",
  "environment.deleted",
  "environment.extended",
  "environment.archived",
] as const;

export type CloudShareEnvironmentEventType =
  (typeof CLOUDSHARE_ENVIRONMENT_EVENT_TYPES)[number];

/** A validated, normalised environment webhook event. */
export interface CloudShareEnvironmentEvent {
  readonly event: CloudShareEnvironmentEventType;
  readonly environmentExternalId: string;
  readonly ownerEmail: string | null;
  readonly environmentName: string | null;
  /** The event timestamp as CloudShare sent it; used verbatim in the idempotency key. */
  readonly createdAt: string;
}

const documentedWebhookPayloadSchema = z.object({
  Event: z.enum(CLOUDSHARE_ENVIRONMENT_EVENT_TYPES),
  CreatedAt: z.string().min(1),
  Payload: z.unknown(),
}).passthrough();

/** Compute the base64 HMAC-SHA256 signature of a raw body. Used by the simulator. */
export function computeWebhookSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

/**
 * Verify a webhook signature against the raw body in constant time. Returns false
 * (never throws) for a missing, malformed, or mismatched signature.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeWebhookSignature(rawBody, secret), "base64");
  const provided = Buffer.from(signature, "base64");
  // timingSafeEqual requires equal-length buffers; a length mismatch is itself a
  // rejection, checked first so the comparison never throws.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export type ParseWebhookResult =
  | { readonly ok: true; readonly event: CloudShareEnvironmentEvent }
  | { readonly ok: false; readonly issues: string[] };

/** Parse and validate a raw webhook body into a normalised event. */
export function parseWebhookEvent(rawBody: string): ParseWebhookResult {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { ok: false, issues: ["body is not valid JSON"] };
  }

  const documented = documentedWebhookPayloadSchema.safeParse(json);
  if (documented.success) {
    const payload = parsePayloadObject(documented.data.Payload);
    if (!payload.ok) {
      return { ok: false, issues: payload.issues };
    }

    const environmentExternalId = firstNonEmptyString(
      payload.value.environmentExternalId,
      payload.value.EnvironmentExternalId,
      payload.value.environmentId,
      payload.value.EnvironmentId,
    );
    if (!environmentExternalId) {
      return {
        ok: false,
        issues: ["Payload.environmentExternalId/EnvironmentExternalId/EnvironmentId: Required"],
      };
    }

    return {
      ok: true,
      event: {
        event: documented.data.Event,
        environmentExternalId,
        ownerEmail: firstNonEmptyString(payload.value.ownerEmail, payload.value.OwnerEmail),
        environmentName: firstNonEmptyString(
          payload.value.environmentName,
          payload.value.EnvironmentName,
        ),
        createdAt: documented.data.CreatedAt,
      },
    };
  }

  return {
    ok: false,
    issues: documented.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

function parsePayloadObject(
  payload: unknown,
): { readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly issues: string[] } {
  const parsedPayload = typeof payload === "string" ? parseJsonPayloadString(payload) : payload;
  if (parsedPayload === null || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
    return { ok: false, issues: ["Payload: Expected an object or JSON object string"] };
  }
  return { ok: true, value: parsedPayload as Record<string, unknown> };
}

function parseJsonPayloadString(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Synthesise a stable idempotency key. CloudShare sends no unique event id, so the
 * key is the tuple that uniquely identifies one logical event: the environment, the
 * event type, and the moment it occurred.
 */
export function synthesiseIdempotencyKey(event: CloudShareEnvironmentEvent): string {
  // JSON-encode the tuple rather than join on a raw delimiter: a value that itself
  // contains the delimiter (e.g. an id with a ':') could otherwise let two distinct
  // events collide onto one key and silently dedupe one away. Encoding keeps the
  // component boundaries unambiguous.
  return JSON.stringify([event.environmentExternalId, event.event, event.createdAt]);
}
