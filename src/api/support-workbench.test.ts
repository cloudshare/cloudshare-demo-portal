import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildSupportWorkbenchDeps,
  handleGetSupportWorkbench,
  type SupportWorkbenchServices,
} from "./support-workbench";
import type { DiagnosticLogEntry, DiagnosticLogRepository } from "@/domain/diagnostic-log";
import type { Logger } from "@/observability/logger";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDiagnostics(records: DiagnosticLogEntry[]): DiagnosticLogRepository {
  return {
    append: vi.fn(),
    query: vi.fn().mockResolvedValue(records),
  };
}

function diagnostic(overrides: Partial<DiagnosticLogEntry>): DiagnosticLogEntry {
  return {
    id: "diagnostic-1",
    occurredAt: new Date("2026-06-20T10:00:00.000Z"),
    level: "warn",
    source: "cloudshare-webhook",
    operation: "cloudshare.webhook.receive",
    outcome: "failure",
    customerId: null,
    actor: null,
    subject: null,
    message: "CloudShare webhook rejected",
    correlationId: null,
    candidateEmail: null,
    examId: null,
    examAttemptId: null,
    externalIds: null,
    request: null,
    response: null,
    details: null,
    ...overrides,
  };
}

describe("handleGetSupportWorkbench", () => {
  it("maps Support Workbench dependencies from composed portal services", () => {
    const services = {
      diagnostics: makeDiagnostics([]),
      logger: makeLogger(),
    } satisfies SupportWorkbenchServices;

    const deps = buildSupportWorkbenchDeps(services);

    expect(deps).toEqual({
      diagnostics: services.diagnostics,
      logger: services.logger,
    });
  });

  it("keeps the Next route adapter from inlining diagnostic-log wiring", () => {
    const routeSource = readFileSync("app/api/admin/support-workbench/route.ts", "utf8");

    expect(routeSource).toContain("buildSupportWorkbenchDeps");
    expect(routeSource).not.toContain("diagnostics: services.diagnostics");
  });

  it("returns a minimal recent webhook diagnostics view for the tracer bullet", async () => {
    const diagnostics = makeDiagnostics([
      diagnostic({
        customerId: "customer-helios",
        message: "CloudShare webhook rejected: missing signature",
        externalIds: {
          webhookPathFingerprint: "sha256:abcd1234",
        },
        request: {
          method: "POST",
          path: "/api/webhooks/cloudshare/whk-helios",
          requestBodyBytes: 123,
          rawBodySha256: "abc123",
        },
        details: {
          signaturePresent: false,
          signatureHeader: { present: false },
          trustGateOutcome: "missing_signature",
        },
      }),
    ]);

    const result = await handleGetSupportWorkbench(
      { diagnostics, logger: makeLogger() },
      { query: {} },
    );

    expect(diagnostics.query).toHaveBeenCalledWith({
      source: "cloudshare-webhook",
      operation: "cloudshare.webhook.receive",
      limit: 20,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      diagnostics: [
        {
          timestamp: new Date("2026-06-20T10:00:00.000Z"),
          level: "warn",
          message: "CloudShare webhook rejected: missing signature",
          operation: "cloudshare.webhook.receive",
          integrationSurface: "cloudshare.v3.webhook",
          customerId: "customer-helios",
          webhookPathFingerprint: "sha256:abcd1234",
          method: "POST",
          path: "/api/webhooks/cloudshare/whk-helios",
          requestBodyBytes: 123,
          rawBodySha256: "abc123",
          signaturePresent: false,
          trustGateReason: "missing_signature",
        },
      ],
    });
  });

  it("redacts raw request bodies for unknown webhook targets while preserving safe metadata", async () => {
    const diagnostics = makeDiagnostics([
      diagnostic({
        id: "diagnostic-2",
        occurredAt: new Date("2026-06-20T10:05:00.000Z"),
        message: "CloudShare webhook rejected: unknown target",
        externalIds: {
          webhookPathFingerprint: "sha256:def45678",
        },
        request: {
          method: "POST",
          path: "/api/webhooks/cloudshare/unknown-token",
          requestBodyBytes: 88,
          rawBodySha256: "def456",
        },
        details: {
          signaturePresent: true,
          signatureHeader: { present: true },
          trustGateOutcome: "unknown_target",
        },
      }),
    ]);

    const result = await handleGetSupportWorkbench(
      { diagnostics, logger: makeLogger() },
      { query: {} },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      diagnostics: [
        {
          timestamp: new Date("2026-06-20T10:05:00.000Z"),
          level: "warn",
          message: "CloudShare webhook rejected: unknown target",
          operation: "cloudshare.webhook.receive",
          integrationSurface: "cloudshare.v3.webhook",
          customerId: null,
          webhookPathFingerprint: "sha256:def45678",
          method: "POST",
          path: "/api/webhooks/cloudshare/unknown-token",
          requestBodyBytes: 88,
          rawBodySha256: "def456",
          signaturePresent: true,
          trustGateReason: "unknown_target",
        },
      ],
    });
  });

  it("does not import the retired support-log domain module", () => {
    const source = readFileSync(new URL("./support-workbench.ts", import.meta.url), "utf8");

    expect(source).not.toContain("@/domain/" + "support-log");
  });
});
