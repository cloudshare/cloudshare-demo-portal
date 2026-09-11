import { describe, expect, it, vi } from "vitest";
import { createCloudShareClientFactory } from "@/composition";
import type { CloudShareClient, CloudShareRequestObservation, V4RequestSpec, V4TokenAcquisitionEvent } from "@/integrations/cloudshare";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { handleGetSalesDiagnosticLog } from "./sales-diagnostics";
import { handleReconcileSalesSession } from "./sales-session-reconciliation";

const actor = { type: "admin" as const, id: "a", email: "a@certalis.demo" };
const request = { customerId: "certalis", sessionId: "s1", actor };
const activeSession = { id: "s1", operationalStatus: "active" as const, cloudShareSalesExperienceId: "remote-1" };
const connection = { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) };

describe("Sales Session reconciliation", () => {
  it("reads the persisted correlation and records protected exchange evidence", async () => {
    const recordExperienceObservations = vi.fn(); const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), recordExperienceObservations }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockResolvedValue({ id: "remote-1", status: "inProgress", request: { method: "GET", path: "/sales/remote-1" }, response: { status: 200 } }) }) }, diagnostics, audit }, request);
    expect(result).toMatchObject({ status: 200, body: { experienceStatus: "inProgress", correlationId: expect.any(String) } });
    expect(recordExperienceObservations).toHaveBeenCalledWith("certalis", [expect.objectContaining({ id: "s1", experienceStatus: "inProgress" })]);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", request: { method: "GET", path: "/sales/remote-1" }, response: { status: 200 } }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("keeps Verify now OAuth, Sales read, and semantic evidence in one Support workflow", async () => {
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    const connectionRecord: CloudShareConnectionRecord = {
      customerId: "certalis",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "webhook-secret",
      webhookPathToken: "webhook-path-token",
      connectedAt: new Date("2026-09-11T08:00:00.000Z"),
      verifiedAt: new Date("2026-09-11T08:01:00.000Z"),
    };
    const factory = createCloudShareClientFactory({
      diagnostics,
      mode: "fixture",
      newCorrelationId: () => "separate-customer-correlation",
      decorateClient: (client) => client,
      createIntegration: (input) => ({
        requestV4Detailed: async (spec: V4RequestSpec<unknown>) => {
          const oauthEvent: V4TokenAcquisitionEvent = {
            exchangeCorrelationId: "oauth-exchange",
            attemptStartSequence: input.attemptStartAllocator?.next(),
            occurredAt: "2026-09-11T09:00:00.000Z",
            completedAt: "2026-09-11T09:00:00.002Z",
            outcome: "success",
            status: 200,
            durationMs: 2,
            integrationSurface: "cloudshare.v4.oauth.token",
          };
          await input.observer.onAcquisition(oauthEvent);
          const data = { id: "remote-1", status: "ended" as const };
          const providerResult = {
            data,
            exchangeId: "sales-get-exchange",
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.sales",
            request: { method: spec.method, path: "/sales/remote-1" },
            response: { status: 200, body: data },
          };
          const requestEvent: CloudShareRequestObservation = {
            exchangeId: providerResult.exchangeId,
            attemptStartSequence: input.attemptStartAllocator?.next(),
            occurredAt: "2026-09-11T09:00:00.003Z",
            completedAt: "2026-09-11T09:00:00.006Z",
            outcome: "success",
            durationMs: 3,
            result: providerResult,
          };
          await input.observer.onRequest(requestEvent);
          return providerResult as never;
        },
      } as unknown as CloudShareClient),
    });

    const result = await handleReconcileSalesSession({
      sessions: {
        findById: vi.fn().mockResolvedValue(activeSession),
        recordExperienceObservations: vi.fn().mockResolvedValue(undefined),
      },
      connections: { findByCustomerId: vi.fn().mockResolvedValue(connectionRecord) },
      cloudshare: factory,
      diagnostics,
      audit: { write: vi.fn().mockResolvedValue(undefined) },
    }, request);
    const correlationId = (result.body as { correlationId: string }).correlationId;
    const support = await handleGetSalesDiagnosticLog({
      diagnostics: diagnosticRepository,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }, { customerId: "certalis", query: { correlationId, limit: "10" } });
    const entries = (support.body as { entries: Array<Record<string, unknown>> }).entries;

    expect(result).toMatchObject({ status: 200, body: { correlationId, experienceStatus: "ended" } });
    expect(entries.map((entry) => entry.operation)).toEqual([
      "cloudshare.oauth.token",
      "cloudshare.request",
      "sales.demo_session.reconciled",
    ]);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "cloudshare.oauth.token",
        correlationId,
        actor,
        subject: { type: "sales_demo_session", id: "s1" },
        details: expect.objectContaining({ evidenceKind: "transport", exchangeId: "oauth-exchange", attemptStartSequence: 1 }),
      }),
      expect.objectContaining({
        operation: "cloudshare.request",
        correlationId,
        actor,
        subject: { type: "sales_demo_session", id: "s1" },
        details: expect.objectContaining({ evidenceKind: "transport", exchangeId: "sales-get-exchange", attemptStartSequence: 3 }),
      }),
      expect.objectContaining({
        operation: "sales.demo_session.reconciled",
        correlationId,
        actor,
        subject: { type: "sales_demo_session", id: "s1" },
        details: expect.objectContaining({
          evidenceKind: "semantic",
          contributingExchangeIds: ["oauth-exchange", "sales-get-exchange"],
        }),
      }),
    ]));
  });

  it("fails closed and moves the operation to needs-attention for an invalid injected status", async () => {
    const recordExperienceObservations = vi.fn(); const diagnostics = { record: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), recordExperienceObservations }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockResolvedValue({ id: "remote-1", status: "active", request: { method: "GET", path: "/sales/remote-1" }, response: { status: 200, body: { id: "remote-1", status: "active" } } }) } as never) }, diagnostics }, request);
    expect(result.status).toBe(502);
    expect(recordExperienceObservations).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "sales_status_contract" }) }));
  });

  it("marks a failed CloudShare read needs-attention and records failure evidence", async () => {
    const recordExperienceObservations = vi.fn(); const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), recordExperienceObservations }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockRejectedValue(Object.assign(new Error("offline"), { context: { method: "GET", path: "/sales/remote-1", requestBody: { marker: "request-marker" }, responseStatus: 503, responseBody: { marker: "response-marker" } } })) }) }, diagnostics, audit }, request);
    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(recordExperienceObservations).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", request: expect.objectContaining({ path: "/sales/remote-1", body: { marker: "request-marker" } }), response: expect.objectContaining({ status: 503, body: { marker: "response-marker" } }) }));
  });

  it("keeps OAuth token failure evidence metadata-only during reconciliation", async () => {
    const recordExperienceObservations = vi.fn(); const diagnostics = { record: vi.fn() };
    const oauthFailure = Object.assign(new Error("wrapped OAuth token exchange returned 503"), { context: {
      method: "POST",
      path: "/oauth/token",
      integrationSurface: "cloudshare.v4.oauth.token",
      failureMode: "http_failure",
      status: 503,
      requestBody: { client_id: "private-client", client_secret: "private-secret" },
      responseBody: { access_token: "private-token" },
    } });
    const result = await handleReconcileSalesSession({
      sessions: { findById: vi.fn().mockResolvedValue(activeSession), recordExperienceObservations },
      connections: connection,
      deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockRejectedValue(oauthFailure) }) },
      diagnostics,
    }, request);
    const failure = diagnostics.record.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.operation === "sales.demo_session.reconciled" && entry.outcome === "failure");

    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(failure).toMatchObject({ request: null, response: null, details: expect.objectContaining({ failureMode: "http_failure" }) });
    const persisted = JSON.stringify(failure);
    expect(persisted).not.toContain("private-client");
    expect(persisted).not.toContain("private-secret");
    expect(persisted).not.toContain("private-token");
  });

  it("returns correlated failure diagnostics when local observation persistence is unavailable", async () => {
    const recordExperienceObservations = vi.fn().mockRejectedValue(new Error("database unavailable")); const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), recordExperienceObservations }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockResolvedValue({ id: "remote-1", status: "notStarted", request: { method: "GET", path: "/sales/remote-1" }, response: { status: 200 } }) }) }, diagnostics, audit }, request);
    expect(result.status).toBe(502);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "local_reconciliation_persistence" }) }));
  });

  it("rejects a provider response whose id does not match the persisted Experience", async () => {
    const recordExperienceObservations = vi.fn(); const diagnostics = { record: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), recordExperienceObservations }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockResolvedValue({ id: "other-1", status: "inProgress", request: { method: "GET", path: "/sales/remote-1", query: { marker: "q" }, headers: { "x-correlation": "corr" } }, response: { status: 200, headers: { "x-response": "r" }, network: { transport: "tcp" }, tls: { protocol: "TLSv1.3" } } }) }) }, diagnostics }, request);
    expect(result.status).toBe(502);
    expect(recordExperienceObservations).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ failureMode: "sales_identity_contract" }), request: expect.objectContaining({ path: "/sales/remote-1", query: { marker: "q" }, headers: { "x-correlation": "corr" } }), response: expect.objectContaining({ status: 200, headers: { "x-response": "r" }, network: { transport: "tcp" }, tls: { protocol: "TLSv1.3" } }) }));
  });

  it.each([
    { operationalStatus: "provisioning", cloudShareSalesExperienceId: "pending:session-uuid" },
    { operationalStatus: "active", cloudShareSalesExperienceId: "unprovisioned" },
    { operationalStatus: "active", cloudShareSalesExperienceId: "pending:session-uuid" },
  ])("rejects an ineligible correlation before constructing a delivery", async (session) => {
    const forConnection = vi.fn();
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue({ id: "s1", ...session }), recordExperienceObservations: vi.fn() }, connections: connection, deliveryFactory: { forConnection } }, request);
    expect(result.status).toBe(409); expect(forConnection).not.toHaveBeenCalled();
  });
});
