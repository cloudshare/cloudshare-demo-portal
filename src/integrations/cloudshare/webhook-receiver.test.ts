import { describe, it, expect } from "vitest";
import { receiveWebhook } from "./webhook-receiver";
import { computeWebhookSignature } from "./webhooks";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";

const SECRET = "account-webhook-secret";

const body = JSON.stringify({
  Event: "environment.suspended",
  EnvironmentExternalId: "env-ext-1",
  CreatedAt: "2026-06-08T10:00:00Z",
});

function deps() {
  return { secret: SECRET, idempotency: createInMemoryWebhookIdempotencyStore() };
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

  it("rejects an invalid signature without parsing or recording it", async () => {
    const d = deps();
    const result = await receiveWebhook(d, { rawBody: body, signature: "wrong" });

    expect(result.kind).toBe("invalid_signature");
    // The key for this event must still be free afterwards (it was never recorded).
    expect(await d.idempotency.markIfNew("env-ext-1:environment.suspended:2026-06-08T10:00:00Z")).toBe(true);
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
