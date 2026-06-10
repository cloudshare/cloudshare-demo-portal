import { describe, it, expect, vi } from "vitest";
import { handleCloudShareWebhook } from "./cloudshare-webhook";
import { createCloudShareEnvironmentSimulator } from "@/integrations/cloudshare/environment-simulator";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";
import { createLogger } from "@/observability/logger";

const SECRET = "account-webhook-secret";
const at = new Date("2026-06-08T10:00:00Z");

function setup() {
  const sim = createCloudShareEnvironmentSimulator({ secret: SECRET });
  const reconcile = vi.fn(async (_id: string) => {});
  const logger = createLogger({ secrets: [], sink: () => {} });
  const deps = {
    secret: SECRET,
    idempotency: createInMemoryWebhookIdempotencyStore(),
    reconcile,
    logger,
  };
  return { sim, reconcile, deps };
}

describe("handleCloudShareWebhook", () => {
  it("accepts a signed event (202) and triggers a reconcile for its environment", async () => {
    const { sim, reconcile, deps } = setup();
    const signed = sim.emit({ environmentExternalId: "env-1", event: "environment.suspended", at });

    const res = await handleCloudShareWebhook(deps, signed);

    expect(res.status).toBe(202);
    expect(reconcile).toHaveBeenCalledWith("env-1");
  });

  it("rejects an invalid signature with 401 and never reconciles", async () => {
    const { reconcile, deps } = setup();

    const res = await handleCloudShareWebhook(deps, {
      rawBody: JSON.stringify({ Event: "environment.created", EnvironmentExternalId: "x", CreatedAt: "t" }),
      signature: "wrong",
    });

    expect(res.status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload with 400 and never reconciles", async () => {
    const { reconcile, deps } = setup();
    const { computeWebhookSignature } = await import("@/integrations/cloudshare/webhooks");
    const rawBody = JSON.stringify({ Event: "garbage" });

    const res = await handleCloudShareWebhook(deps, {
      rawBody,
      signature: computeWebhookSignature(rawBody, SECRET),
    });

    expect(res.status).toBe(400);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate with 200 and reconciles only once across replays", async () => {
    const { sim, reconcile, deps } = setup();
    const signed = sim.emit({ environmentExternalId: "env-1", event: "environment.created", at });

    const first = await handleCloudShareWebhook(deps, signed);
    const second = await handleCloudShareWebhook(deps, signed);

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("returns a deliberate 500 (not a bare exception) when a backing store throws before reconcile", async () => {
    const { sim, reconcile, deps } = setup();
    deps.idempotency = {
      markIfNew: vi.fn(async () => {
        throw new Error("idempotency store DB timeout");
      }),
      reset: vi.fn(),
    };
    const signed = sim.emit({ environmentExternalId: "env-1", event: "environment.created", at });

    const res = await handleCloudShareWebhook(deps, signed);

    expect(res.status).toBe(500);
    expect(res.body.status).toBe("internal_error");
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("still acknowledges (202) when the reconcile poll fails — the next poll recovers", async () => {
    const { sim, deps } = setup();
    deps.reconcile = vi.fn(async () => {
      throw new Error("CloudShare GET environment timed out");
    });
    const signed = sim.emit({ environmentExternalId: "env-1", event: "environment.resumed", at });

    const res = await handleCloudShareWebhook(deps, signed);

    expect(res.status).toBe(202);
  });
});
