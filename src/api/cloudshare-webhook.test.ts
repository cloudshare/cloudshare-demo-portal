import { describe, it, expect, vi } from "vitest";
import { handleCloudShareWebhook } from "./cloudshare-webhook";
import { createCloudShareEnvironmentSimulator } from "@/integrations/cloudshare/environment-simulator";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";
import { createLogger } from "@/observability/logger";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";

const HELIOS_SECRET = "helios-webhook-secret";
const OTHER_SECRET = "other-webhook-secret";
const at = new Date("2026-06-08T10:00:00Z");

function setup() {
  const helios = createCloudShareEnvironmentSimulator({ secret: HELIOS_SECRET });
  const other = createCloudShareEnvironmentSimulator({ secret: OTHER_SECRET });
  const eventLog = createInMemoryEventLogRepository();
  const reconcile = vi.fn(async (_connection: unknown, _environmentExternalId: string) => {});
  const logger = createLogger({ secrets: [], sink: () => {} });
  const heliosConnection = {
    customerId: "customer-helios",
    apiId: "api-helios",
    apiKey: "key-helios",
    webhookSecret: HELIOS_SECRET,
    webhookPathToken: "whk-helios",
    connectedAt: new Date("2026-06-01T00:00:00Z"),
    verifiedAt: null,
  };
  const otherConnection = {
    customerId: "customer-other",
    apiId: "api-other",
    apiKey: "key-other",
    webhookSecret: OTHER_SECRET,
    webhookPathToken: "whk-other",
    connectedAt: new Date("2026-06-01T00:00:00Z"),
    verifiedAt: null,
  };
  const deps = {
    connections: {
      save: vi.fn(),
      findByCustomerId: vi.fn(),
      markVerified: vi.fn(),
      findByWebhookPathToken: vi.fn(async (webhookPathToken: string) => {
        if (webhookPathToken === "whk-helios") {
          return heliosConnection;
        }
        if (webhookPathToken === "whk-other") {
          return otherConnection;
        }
        return null;
      }),
    },
    idempotency: createInMemoryWebhookIdempotencyStore(),
    reconcile,
    logger,
    eventLog,
    now: () => at,
    newEventId: (() => {
      let counter = 0;
      return () => `webhook-event-${++counter}`;
    })(),
  };
  return { helios, other, eventLog, reconcile, deps, heliosConnection, otherConnection };
}

describe("handleCloudShareWebhook", () => {
  it("logs receipt and returns a deliberate 500 when a stale dependency object is missing webhook lookup", async () => {
    const lines: string[] = [];
    const { helios, deps } = setup();
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.created", at });
    const staleDeps = {
      ...deps,
      logger: createLogger({ secrets: [], sink: (line) => lines.push(line) }),
      connections: {
        save: vi.fn(),
        findByCustomerId: vi.fn(),
        markVerified: vi.fn(),
      },
    };

    const res = await handleCloudShareWebhook(staleDeps as never, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    expect(res.status).toBe(500);
    expect(lines.some((line) => line.includes("cloudshare webhook received"))).toBe(true);
    expect(lines.some((line) => line.includes("cloudshare webhook handler misconfigured"))).toBe(true);
  });

  it("logs only an allowlisted webhook body summary before signature verification", async () => {
    const lines: string[] = [];
    const { deps } = setup();
    const rawBody = JSON.stringify({
      Event: "environment.created",
      CreatedAt: at.toISOString(),
      token: "must-not-be-logged",
      apiKey: "must-not-be-logged",
      loginUrl: "https://example.test/bearer",
      Payload: JSON.stringify({
        EnvironmentId: "env-1",
        EnvironmentName: "Allowed Environment Name",
        token: "nested-must-not-be-logged",
      }),
    });
    await handleCloudShareWebhook(
      {
        ...deps,
        logger: createLogger({ secrets: [], sink: (line) => lines.push(line) }),
      },
      {
        webhookPathToken: "whk-helios",
        rawBody,
        signature: "invalid",
      },
    );

    const receivedLine = lines.find((line) => line.includes("cloudshare webhook received"));
    expect(receivedLine).toBeDefined();
    expect(receivedLine).toContain("Allowed Environment Name");
    expect(receivedLine).toContain("env-1");
    expect(receivedLine).not.toContain("must-not-be-logged");
    expect(receivedLine).not.toContain("nested-must-not-be-logged");
    expect(receivedLine).not.toContain("https://example.test/bearer");
  });

  it("accepts a signed event for the matched webhook token (202) and triggers a reconcile for its environment with the resolved customer connection", async () => {
    const { helios, reconcile, deps, heliosConnection } = setup();
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.suspended", at });

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    expect(res.status).toBe(202);
    expect(reconcile).toHaveBeenCalledWith(heliosConnection, "env-ext-1");
  });

  it("rejects an invalid signature with 401 and never reconciles", async () => {
    const { reconcile, deps } = setup();

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      rawBody: JSON.stringify({
        Event: "environment.created",
        CreatedAt: "t",
        Payload: { environmentExternalId: "env-ext-1" },
      }),
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
      webhookPathToken: "whk-helios",
      rawBody,
      signature: computeWebhookSignature(rawBody, HELIOS_SECRET),
    });

    expect(res.status).toBe(400);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate with 200 and reconciles only once across replays", async () => {
    const { helios, reconcile, deps } = setup();
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.created", at });

    const first = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });
    const second = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("scopes webhook idempotency by Customer so two Customers cannot suppress each other", async () => {
    const { reconcile, deps } = setup();
    const rawBody = JSON.stringify({
      Event: "environment.created",
      CreatedAt: at.toISOString(),
      Payload: {
        environmentExternalId: "shared-env-id",
      },
    });
    const { computeWebhookSignature } = await import("@/integrations/cloudshare/webhooks");

    const helios = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      rawBody,
      signature: computeWebhookSignature(rawBody, HELIOS_SECRET),
    });
    const other = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-other",
      rawBody,
      signature: computeWebhookSignature(rawBody, OTHER_SECRET),
    });

    expect(helios.status).toBe(202);
    expect(other.status).toBe(202);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("selects the secret from the webhook token before verification", async () => {
    const { helios, deps } = setup();
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.created", at });

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-other",
      ...signed,
    });

    expect(res.status).toBe(401);
  });

  it("returns a deliberate 500 (not a bare exception) when a backing store throws before reconcile", async () => {
    const { helios, reconcile, deps } = setup();
    deps.idempotency = {
      markIfNew: vi.fn(async () => {
        throw new Error("idempotency store DB timeout");
      }),
      reset: vi.fn(),
    };
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.created", at });

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    expect(res.status).toBe(500);
    expect(res.body.status).toBe("internal_error");
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("still acknowledges (202) when the reconcile poll fails — the next poll recovers", async () => {
    const { helios, deps } = setup();
    deps.reconcile = vi.fn(async () => {
      throw new Error("CloudShare GET environment timed out");
    });
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.resumed", at });

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    expect(res.status).toBe(202);
  });

  it("records webhook dispositions in the event log without secrets", async () => {
    const { helios, eventLog, deps } = setup();
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.created", at });

    await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    const events = await eventLog.listAll();
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "cloudshare.webhook.duplicate",
          payload: expect.objectContaining({
            customerId: "customer-helios",
          }),
        }),
        expect.objectContaining({
          type: "cloudshare.webhook.accepted",
          payload: expect.objectContaining({
            customerId: "customer-helios",
            environmentExternalId: "env-ext-1",
          }),
        }),
      ]),
    );
  });
});
