import { describe, expect, it, vi } from "vitest";
import { handleGetSupportWorkbench } from "./support-workbench";
import type { SupportLogRepository } from "@/domain/support-log";
import type { Logger } from "@/observability/logger";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeSupportLog(records: Awaited<ReturnType<SupportLogRepository["listAll"]>>): SupportLogRepository {
  return {
    append: vi.fn(),
    listAll: vi.fn().mockResolvedValue(records),
  };
}

describe("handleGetSupportWorkbench", () => {
  it("returns a minimal recent webhook diagnostics view for the tracer bullet", async () => {
    const supportLog = makeSupportLog([
      {
        timestamp: new Date("2026-06-20T10:00:00.000Z"),
        level: "warn",
        message: "cloudshare webhook rejected: missing signature",
        fields: {
          operation: "receive_webhook",
          integrationSurface: "cloudshare.v3.webhook",
          customerId: "customer-helios",
          webhookPathFingerprint: "sha256:abcd1234",
          method: "POST",
          path: "/api/webhooks/cloudshare/whk-helios",
          requestBodyBytes: 123,
          rawBodySha256: "abc123",
          signaturePresent: false,
          trustGateReason:
            "CloudShare signature header x-cloudshare-signature was absent.",
        },
      },
    ]);

    const result = await handleGetSupportWorkbench(
      { supportLog, logger: makeLogger() },
      { query: {} },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      diagnostics: [
        {
          timestamp: new Date("2026-06-20T10:00:00.000Z"),
          level: "warn",
          message: "cloudshare webhook rejected: missing signature",
          operation: "receive_webhook",
          integrationSurface: "cloudshare.v3.webhook",
          customerId: "customer-helios",
          webhookPathFingerprint: "sha256:abcd1234",
          method: "POST",
          path: "/api/webhooks/cloudshare/whk-helios",
          requestBodyBytes: 123,
          rawBodySha256: "abc123",
          signaturePresent: false,
          trustGateReason:
            "CloudShare signature header x-cloudshare-signature was absent.",
        },
      ],
    });
  });

  it("redacts raw request bodies for unknown webhook targets while preserving safe metadata", async () => {
    const supportLog = makeSupportLog([
      {
        timestamp: new Date("2026-06-20T10:05:00.000Z"),
        level: "warn",
        message: "cloudshare webhook rejected: unknown webhook target",
        fields: {
          operation: "receive_webhook",
          integrationSurface: "cloudshare.v3.webhook",
          webhookPathFingerprint: "sha256:def45678",
          method: "POST",
          path: "/api/webhooks/cloudshare/unknown-token",
          requestBodyBytes: 88,
          rawBodySha256: "def456",
          signaturePresent: false,
        },
      },
    ]);

    const result = await handleGetSupportWorkbench(
      { supportLog, logger: makeLogger() },
      { query: {} },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      diagnostics: [
        {
          timestamp: new Date("2026-06-20T10:05:00.000Z"),
          level: "warn",
          message: "cloudshare webhook rejected: unknown webhook target",
          operation: "receive_webhook",
          integrationSurface: "cloudshare.v3.webhook",
          customerId: null,
          webhookPathFingerprint: "sha256:def45678",
          method: "POST",
          path: "/api/webhooks/cloudshare/unknown-token",
          requestBodyBytes: 88,
          rawBodySha256: "def456",
          signaturePresent: false,
          trustGateReason: null,
        },
      ],
    });
  });
});
