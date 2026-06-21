import { describe, it, expect, vi } from "vitest";
import { handleCloudShareWebhook } from "./cloudshare-webhook";
import { createCloudShareEnvironmentSimulator } from "@/integrations/cloudshare/environment-simulator";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";
import { createLogger } from "@/observability/logger";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import type { CloudShareWebhookDeps } from "./cloudshare-webhook";

const HELIOS_SECRET = "helios-webhook-secret";
const OTHER_SECRET = "other-webhook-secret";
const at = new Date("2026-06-08T10:00:00Z");

function setup() {
  const helios = createCloudShareEnvironmentSimulator({ secret: HELIOS_SECRET });
  const other = createCloudShareEnvironmentSimulator({ secret: OTHER_SECRET });
  const eventLog = createInMemoryEventLogRepository();
  const diagnostics = createInMemoryDiagnosticLogRepository();
  const reconcile = vi.fn<CloudShareWebhookDeps["reconcile"]>(async () => undefined);
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
    diagnostics: createDiagnosticRecorder({ repository: diagnostics }),
    now: () => at,
    newEventId: (() => {
      let counter = 0;
      return () => `webhook-event-${++counter}`;
    })(),
  };
  return {
    helios,
    other,
    eventLog,
    diagnostics,
    reconcile,
    deps,
    heliosConnection,
    otherConnection,
  };
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
    expect(lines.some((line) => line.includes("cloudshare webhook received"))).toBe(false);
    expect(lines.some((line) => line.includes("cloudshare webhook handler misconfigured"))).toBe(true);
  });

  it("logs safe request summary and parsed fields for known webhook targets without persisting raw bodies", async () => {
    const lines: string[] = [];
    const { deps } = setup();
    const rawBody = JSON.stringify({
      Event: "environment.created",
      CreatedAt: at.toISOString(),
      Payload: JSON.stringify({
        EnvironmentId: "env-1",
        EnvironmentName: "Allowed Environment Name",
        OwnerEmail: "owner@example.test",
        Cloud: ["cloudshare"],
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
    expect(receivedLine).not.toContain("rawRequestBody");
    expect(receivedLine).not.toContain('"x-cloudshare-signature"');
    expect(receivedLine).toContain('"webhookEnvelope"');
    expect(receivedLine).toContain('"webhookPayload"');
    expect(receivedLine).toContain('"webhookEvent":"environment.created"');
    expect(receivedLine).toContain('"webhookEnvironmentId":"env-1"');
    expect(receivedLine).toContain('"webhookEnvironmentName":"Allowed Environment Name"');
    expect(receivedLine).toContain('"webhookOwnerEmail":"owner@example.test"');
    expect(receivedLine).toContain("Allowed Environment Name");
    expect(receivedLine).toContain("env-1");
    expect(receivedLine).toContain("owner@example.test");
    expect(receivedLine).toContain("cloudshare");
  });

  it("logs signature diagnostics for known webhook targets without persisting raw signatures", async () => {
    const lines: string[] = [];
    const { deps } = setup();
    const rawBody = JSON.stringify({
      Event: "environment.created",
      CreatedAt: at.toISOString(),
      Payload: {
        environmentExternalId: "env-ext-1",
      },
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
    const diagnosticLine = lines.find((line) => line.includes("cloudshare webhook signature diagnostic"));
    expect(receivedLine).not.toContain("rawRequestBody");
    expect(diagnosticLine).not.toContain('"receivedSignature"');
    expect(diagnosticLine).not.toContain('"expectedSignature"');
    expect(diagnosticLine).toContain(`"storedWebhookSecretLength":${HELIOS_SECRET.length}`);
    expect(diagnosticLine).toContain('"signatureMatched":false');
    expect(diagnosticLine).toContain("update the stored CloudShare Connection webhook secret");
    expect(diagnosticLine).toContain("rawBodySha256");
  });

  it("rejects a missing signature deliberately, does not parse trusted webhook fields, and never reconciles", async () => {
    const lines: string[] = [];
    const { reconcile, deps, eventLog } = setup();
    const rawBody = JSON.stringify({
      Event: "environment.created",
      CreatedAt: at.toISOString(),
      Payload: JSON.stringify({
        EnvironmentId: "env-1",
        EnvironmentExternalId: "env-ext-1",
        OwnerEmail: "owner@example.test",
      }),
    });

    const res = await handleCloudShareWebhook(
      {
        ...deps,
        logger: createLogger({ secrets: [], sink: (line) => lines.push(line) }),
      },
      {
        webhookPathToken: "whk-helios",
        rawBody,
        signature: null,
      },
    );

    expect(res.status).toBe(401);
    expect(res.body.status).toBe("missing_signature");
    expect(reconcile).not.toHaveBeenCalled();

    const serialized = lines.join("\n");
    expect(serialized).toContain("cloudshare webhook rejected: missing signature");
    expect(serialized).toContain('"signaturePresent":false');
    expect(serialized).not.toContain("rawRequestBody");
    expect(serialized).not.toContain("cloudshare webhook received");
    expect(serialized).not.toContain('"webhookEnvelope"');
    expect(serialized).not.toContain('"webhookPayload"');
    expect(serialized).not.toContain('"webhookEvent"');

    await expect(eventLog.listAll()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "cloudshare.webhook.missing_signature",
        }),
      ]),
    );
  });

  it("does not log raw request bodies for unknown webhook targets", async () => {
    const lines: string[] = [];
    const { deps } = setup();
    const rawBody = JSON.stringify({
      Event: "environment.created",
      token: "must-not-be-logged",
      Payload: JSON.stringify({ EnvironmentId: "env-1" }),
    });

    await handleCloudShareWebhook(
      {
        ...deps,
        logger: createLogger({ secrets: [], sink: (line) => lines.push(line) }),
      },
      {
        webhookPathToken: "unknown-token",
        rawBody,
        signature: "invalid",
      },
    );

    const serialized = lines.join("\n");
    expect(serialized).toContain("cloudshare webhook rejected: unknown webhook target");
    expect(serialized).not.toContain("rawRequestBody");
    expect(serialized).not.toContain("must-not-be-logged");
  });

  it("logs only safe metadata for an unknown webhook target with a missing signature", async () => {
    const lines: string[] = [];
    const { deps } = setup();
    const rawBody = JSON.stringify({
      Event: "environment.created",
      bearerToken: "must-not-be-logged",
      Payload: JSON.stringify({ EnvironmentId: "env-1" }),
    });

    await handleCloudShareWebhook(
      {
        ...deps,
        logger: createLogger({ secrets: [], sink: (line) => lines.push(line) }),
      },
      {
        webhookPathToken: "unknown-token",
        rawBody,
        signature: null,
      },
    );

    const serialized = lines.join("\n");
    expect(serialized).toContain("cloudshare webhook rejected: unknown webhook target");
    expect(serialized).toContain('"signaturePresent":false');
    expect(serialized).toContain('"requestBodyBytes"');
    expect(serialized).toContain('"rawBodySha256"');
    expect(serialized).not.toContain("rawRequestBody");
    expect(serialized).not.toContain("must-not-be-logged");
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

  it("records safe typed diagnostics for receipt, signature verification, and later reconcile correlation", async () => {
    const { helios, diagnostics, deps } = setup();
    deps.reconcile = vi.fn(
      async (_connection: unknown, _environmentExternalId: string) => ({
        environmentExternalId: "env-ext-1",
        status: "running",
        correlation: {
          examAttemptId: "attempt-1",
          examId: "exam-1",
          candidateEmail: "candidate@helioscx.demo",
        },
      }),
    );
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.created", at });

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    expect(res.status).toBe(202);
    const entries = await diagnostics.query({ customerId: "customer-helios" });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cloudshare.webhook.receive",
          level: "info",
          outcome: "success",
          customerId: "customer-helios",
          externalIds: expect.objectContaining({
            webhookPathFingerprint: expect.stringMatching(/^sha256:/),
            environmentExternalId: "env-ext-1",
          }),
          details: expect.objectContaining({
            eventType: "environment.created",
            signaturePresent: true,
            trustGateOutcome: "accepted",
            webhookSummary: expect.objectContaining({
              parseStatus: "ok",
              envelope: expect.objectContaining({
                Event: "environment.created",
              }),
              payload: expect.objectContaining({
                EnvironmentId: "env-ext-1",
              }),
            }),
          }),
          request: expect.objectContaining({
            method: "POST",
            rawBodySha256: expect.any(String),
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.verify_signature",
          outcome: "success",
          customerId: "customer-helios",
          externalIds: expect.objectContaining({
            webhookPathFingerprint: expect.stringMatching(/^sha256:/),
          }),
          details: expect.objectContaining({
            signatureMatched: true,
            signatureScheme: "HMAC-SHA256 base64 over exact raw request body",
            storedWebhookSecretLength: HELIOS_SECRET.length,
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.reconcile",
          outcome: "success",
          customerId: "customer-helios",
          candidateEmail: "candidate@helioscx.demo",
          examId: "exam-1",
          examAttemptId: "attempt-1",
          externalIds: expect.objectContaining({
            webhookPathFingerprint: expect.stringMatching(/^sha256:/),
            environmentExternalId: "env-ext-1",
          }),
        }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain(signed.rawBody);
    expect(JSON.stringify(entries)).not.toContain(signed.signature ?? "");
    expect(JSON.stringify(entries)).not.toContain("whk-helios");
  });

  it("records rejected webhook diagnostics at warn level with safe signature header metadata and allowlisted body summary", async () => {
    const { diagnostics, deps } = setup();
    const rawBody = JSON.stringify({
      Event: "environment.created",
      CreatedAt: at.toISOString(),
      CreatedByEmail: "owner@example.test",
      Payload: JSON.stringify({
        EnvironmentId: "env-1",
        EnvironmentExternalId: "env-ext-invalid",
        EnvironmentName: "Helios Candidate Lab",
        BlueprintId: "bp-1",
        PolicyId: "policy-1",
        OwnerEmail: "owner@example.test",
        RegionId: "region-1",
      }),
    });

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      rawBody,
      signature: "invalid-signature-value",
    });

    expect(res.status).toBe(401);
    const entries = await diagnostics.query({ customerId: "customer-helios" });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cloudshare.webhook.receive",
          level: "warn",
          outcome: "failure",
          details: expect.objectContaining({
            trustGateOutcome: "invalid_signature",
            webhookSummary: expect.objectContaining({
              parseStatus: "ok",
              envelope: expect.objectContaining({
                Event: "environment.created",
                CreatedByEmail: "owner@example.test",
              }),
              payload: expect.objectContaining({
                EnvironmentId: "env-1",
                EnvironmentExternalId: "env-ext-invalid",
                EnvironmentName: "Helios Candidate Lab",
                BlueprintId: "bp-1",
                PolicyId: "policy-1",
                OwnerEmail: "owner@example.test",
                RegionId: "region-1",
              }),
            }),
            signatureHeader: expect.objectContaining({
              name: "x-cloudshare-signature",
              present: true,
              scheme: "hmac-sha256-base64",
              length: "invalid-signature-value".length,
              fingerprint: expect.stringMatching(/^sha256:/),
            }),
          }),
          request: expect.objectContaining({
            requestBodyBytes: expect.any(Number),
            rawBodySha256: expect.any(String),
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.verify_signature",
          level: "warn",
          outcome: "failure",
          details: expect.objectContaining({
            signatureMatched: false,
            signatureHeader: expect.objectContaining({
              name: "x-cloudshare-signature",
              present: true,
              scheme: "hmac-sha256-base64",
              length: "invalid-signature-value".length,
              fingerprint: expect.stringMatching(/^sha256:/),
            }),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain(rawBody);
    expect(JSON.stringify(entries)).not.toContain("invalid-signature-value");
  });

  it("records the full typed failure diagnostic matrix without raw body leakage", async () => {
    const { helios, diagnostics, deps } = setup();
    const invalidSignatureRawBody = JSON.stringify({
      Event: "environment.created",
      CreatedAt: at.toISOString(),
      Payload: { environmentExternalId: "env-ext-invalid" },
    });
    const unknownRawBody = JSON.stringify({
      Event: "environment.created",
      token: "must-not-be-logged",
      Payload: JSON.stringify({ EnvironmentId: "env-1" }),
    });
    await handleCloudShareWebhook(deps, {
      webhookPathToken: "unknown-token",
      rawBody: unknownRawBody,
      signature: "invalid",
    });

    const missingSignatureRawBody = JSON.stringify({
      Event: "environment.created",
      CreatedAt: at.toISOString(),
      Payload: JSON.stringify({ EnvironmentExternalId: "env-ext-missing" }),
    });
    await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      rawBody: missingSignatureRawBody,
      signature: null,
    });

    await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      rawBody: invalidSignatureRawBody,
      signature: "wrong",
    });

    const malformedRawBody = JSON.stringify({ Event: "garbage" });
    const { computeWebhookSignature } = await import("@/integrations/cloudshare/webhooks");
    await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      rawBody: malformedRawBody,
      signature: computeWebhookSignature(malformedRawBody, HELIOS_SECRET),
    });

    deps.reconcile = vi.fn(async () => {
      throw new Error("CloudShare GET environment timed out");
    });
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.created", at });
    await handleCloudShareWebhook(deps, { webhookPathToken: "whk-helios", ...signed });
    await handleCloudShareWebhook(deps, { webhookPathToken: "whk-helios", ...signed });

    const allEntries = await diagnostics.query();
    expect(allEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cloudshare.webhook.receive",
          outcome: "failure",
          customerId: "customer-helios",
          details: expect.objectContaining({
            trustGateOutcome: "missing_signature",
            signaturePresent: false,
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.verify_signature",
          outcome: "failure",
          customerId: "customer-helios",
          details: expect.objectContaining({
            signatureMatched: false,
            signaturePresent: false,
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.receive",
          outcome: "failure",
          customerId: "customer-helios",
          details: expect.objectContaining({
            trustGateOutcome: "invalid_signature",
            signaturePresent: true,
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.verify_signature",
          outcome: "failure",
          customerId: "customer-helios",
          details: expect.objectContaining({
            signatureMatched: false,
            signaturePresent: true,
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.receive",
          outcome: "failure",
          customerId: null,
          details: expect.objectContaining({
            trustGateOutcome: "unknown_target",
            signaturePresent: true,
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.receive",
          outcome: "failure",
          customerId: "customer-helios",
          details: expect.objectContaining({
            trustGateOutcome: "invalid_payload",
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.receive",
          outcome: "failure",
          customerId: "customer-helios",
          details: expect.objectContaining({
            trustGateOutcome: "duplicate",
          }),
        }),
        expect.objectContaining({
          operation: "cloudshare.webhook.reconcile",
          outcome: "failure",
          customerId: "customer-helios",
          externalIds: expect.objectContaining({
            environmentExternalId: "env-ext-1",
          }),
        }),
      ]),
    );
    expect(JSON.stringify(allEntries)).not.toContain("must-not-be-logged");
    expect(JSON.stringify(allEntries)).not.toContain(unknownRawBody);
    expect(JSON.stringify(allEntries)).not.toContain("wrong");
    expect(JSON.stringify(allEntries)).not.toContain("whk-helios");
    expect(JSON.stringify(allEntries)).not.toContain("unknown-token");
  });

  it("does not correlate another customer's launch when environment ids collide across customers", async () => {
    const { helios, diagnostics, deps } = setup();
    deps.reconcile = vi.fn(
      async (_connection: unknown, _environmentExternalId: string) => ({
        environmentExternalId: "shared-env",
        status: "running",
        correlation: {
          customerId: "customer-helios",
          examAttemptId: "attempt-helios",
          examId: "exam-helios",
          candidateEmail: "candidate@helioscx.demo",
        },
      }),
    );
    const signed = helios.emit({ environmentExternalId: "shared-env", event: "environment.created", at });

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    expect(res.status).toBe(202);
    const entries = await diagnostics.query({ customerId: "customer-helios" });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cloudshare.webhook.reconcile",
          examAttemptId: "attempt-helios",
          examId: "exam-helios",
          customerId: "customer-helios",
        }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain("customer-other");
  });

  it("swallows diagnostic recording failures so webhook behavior still succeeds", async () => {
    const { helios, deps } = setup();
    deps.diagnostics = {
      record: vi.fn(async () => {
        throw new Error("diagnostics unavailable");
      }),
    };
    const signed = helios.emit({ environmentExternalId: "env-ext-1", event: "environment.created", at });

    const res = await handleCloudShareWebhook(deps, {
      webhookPathToken: "whk-helios",
      ...signed,
    });

    expect(res.status).toBe(202);
  });
});
