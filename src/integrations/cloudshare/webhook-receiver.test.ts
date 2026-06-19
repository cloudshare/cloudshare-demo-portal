import { describe, it, expect } from "vitest";
import { receiveWebhook } from "./webhook-receiver";
import { computeWebhookSignature } from "./webhooks";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";

const SECRET = "account-webhook-secret";

const body = JSON.stringify({
  Event: "environment.suspended",
  CreatedAt: "2026-06-08T10:00:00Z",
  Payload: {
    environmentExternalId: "env-ext-1",
  },
});

function deps() {
  return {
    secret: SECRET,
    idempotencyScope: "customer-helios",
    idempotency: createInMemoryWebhookIdempotencyStore(),
  };
}

describe("receiveWebhook", () => {
  it("accepts a correctly signed, first-seen event", async () => {
    const result = await receiveWebhook(deps(), {
      rawBody: body,
      signature: computeWebhookSignature(body, SECRET),
    });

    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.event.environmentExternalId).toBe("env-ext-1");
      expect(result.event.event).toBe("environment.suspended");
      expect(result.idempotencyKey).toContain("env-ext-1");
    }
  });

  it("rejects an invalid signature, records nothing, and accepts the same event when resent correctly", async () => {
    const d = deps();
    const rejected = await receiveWebhook(d, { rawBody: body, signature: "wrong" });
    expect(rejected.kind).toBe("invalid_signature");

    // Nothing was recorded for the rejected attempt, so the same event — correctly
    // signed — is still accepted (not mistaken for a duplicate).
    const accepted = await receiveWebhook(d, {
      rawBody: body,
      signature: computeWebhookSignature(body, SECRET),
    });
    expect(accepted.kind).toBe("accepted");
  });

  it("rejects a correctly signed but malformed payload", async () => {
    const malformed = JSON.stringify({ Event: "nope" });
    const result = await receiveWebhook(deps(), {
      rawBody: malformed,
      signature: computeWebhookSignature(malformed, SECRET),
    });

    expect(result.kind).toBe("invalid_payload");
    if (result.kind === "invalid_payload") expect(result.issues.length).toBeGreaterThan(0);
  });

  it("dedupes a replayed event: first accepted, second flagged duplicate", async () => {
    const d = deps();
    const signed = { rawBody: body, signature: computeWebhookSignature(body, SECRET) };

    const first = await receiveWebhook(d, signed);
    const second = await receiveWebhook(d, signed);

    expect(first.kind).toBe("accepted");
    expect(second.kind).toBe("duplicate");
    if (first.kind === "accepted" && second.kind === "duplicate") {
      expect(second.idempotencyKey).toBe(first.idempotencyKey);
    }
  });
});
