import { describe, it, expect } from "vitest";
import { createCloudShareEnvironmentSimulator } from "./environment-simulator";
import { parseWebhookEvent, verifyWebhookSignature } from "./webhooks";
import { receiveWebhook } from "./webhook-receiver";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";

const SECRET = "account-webhook-secret";
const at = new Date("2026-06-08T10:00:00Z");

describe("CloudShare environment simulator", () => {
  it("emits a payload signed and shaped identically to a real CloudShare webhook", () => {
    const sim = createCloudShareEnvironmentSimulator({ secret: SECRET });

    const { rawBody, signature } = sim.emit({
      environmentExternalId: "env-1",
      event: "environment.suspended",
      at,
    });

    expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(true);
    const parsed = parseWebhookEvent(rawBody);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.event).toEqual({
        event: "environment.suspended",
        environmentExternalId: "env-1",
        createdAt: "2026-06-08T10:00:00.000Z",
      });
    }
  });

  it("its emitted payload flows through the real receiver and is accepted", async () => {
    const sim = createCloudShareEnvironmentSimulator({ secret: SECRET });
    const signed = sim.emit({ environmentExternalId: "env-1", event: "environment.created", at });

    const outcome = await receiveWebhook(
      { secret: SECRET, idempotency: createInMemoryWebhookIdempotencyStore() },
      signed,
    );

    expect(outcome.kind).toBe("accepted");
  });

  it("acts as the authoritative GET-environment source, reflecting emitted events", async () => {
    const sim = createCloudShareEnvironmentSimulator({ secret: SECRET });

    sim.emit({ environmentExternalId: "env-1", event: "environment.created", at });
    expect((await sim.getEnvironmentState("env-1"))?.status).toBe("created");

    sim.emit({ environmentExternalId: "env-1", event: "environment.resumed", at });
    expect((await sim.getEnvironmentState("env-1"))?.status).toBe("running");

    sim.emit({ environmentExternalId: "env-1", event: "environment.suspended", at });
    expect((await sim.getEnvironmentState("env-1"))?.status).toBe("suspended");

    // Extension does not change the lifecycle status.
    sim.emit({ environmentExternalId: "env-1", event: "environment.extended", at });
    expect((await sim.getEnvironmentState("env-1"))?.status).toBe("suspended");

    sim.emit({ environmentExternalId: "env-1", event: "environment.deleted", at });
    expect((await sim.getEnvironmentState("env-1"))?.status).toBe("deleted");
  });

  it("returns null for an environment it has never seen", async () => {
    const sim = createCloudShareEnvironmentSimulator({ secret: SECRET });
    expect(await sim.getEnvironmentState("ghost")).toBeNull();
  });
});
