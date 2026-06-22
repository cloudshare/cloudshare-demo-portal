import { describe, it, expect, vi } from "vitest";
import {
  handleGetAuditTrail,
  handleSyncResources,
  handleGetEventLog,
  handleGetSupportLog,
} from "./admin";
import type { AuditRepository, AuditRecord } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";
import type { SupportLogRepository } from "@/domain/support-log";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { CloudShareClient } from "@/integrations/cloudshare";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemoryResourceRepository } from "@/persistence/resource-repository";
import type { Logger } from "@/observability/logger";
import { createDiagnosticRecorder, type DiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeRecord(partial: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "r-1",
    examAttemptId: "attempt-1",
    action: "lab_launched",
    outcome: "success",
    occurredAt: new Date(),
    ...partial,
  };
}

function makeEventLog(records: unknown[] = []): EventLogRepository {
  return {
    append: vi.fn(),
    listFailureEventsByExamAttemptIds: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue(records),
  };
}

function makeConnectionRecord(
  partial: Partial<CloudShareConnectionRecord> = {},
): CloudShareConnectionRecord {
  return {
    customerId: "customer-1",
    apiId: "api-id",
    apiKey: "api-key",
    webhookSecret: "webhook-secret",
    webhookPathToken: "whk-customer-1",
    connectedAt: new Date("2026-06-14T00:00:00Z"),
    verifiedAt: null,
    ...partial,
  };
}

function makeConnections(
  connection: CloudShareConnectionRecord | null = makeConnectionRecord(),
): CloudShareConnectionRepository {
  return {
    save: vi.fn(),
    findByCustomerId: vi.fn().mockResolvedValue(connection),
    findByWebhookPathToken: vi.fn().mockResolvedValue(connection),
    markVerified: vi.fn(),
  };
}

function makeCloudShareFactory(
  client: CloudShareClient,
): CloudShareClientFactory {
  return {
    forConnection: vi.fn().mockReturnValue(client),
  };
}

function makeCloudShareClient(overrides: {
  requestV3?: CloudShareClient["requestV3"];
  requestV4?: CloudShareClient["requestV4"];
} = {}): CloudShareClient {
  const requestV3 =
    overrides.requestV3 ??
    vi.fn().mockImplementation(({ path }: { path: string }) => {
      if (path === "/projects") {
        return Promise.resolve([{ id: "p-1", name: "Demo Project" }]);
      }
      if (path === "/regions") {
        return Promise.resolve([{ id: "r-1", name: "EU West" }]);
      }
      if (path === "/projects/p-1/blueprints") {
        return Promise.resolve([{ id: "bp-1", name: "Blueprint 1" }]);
      }
      if (path === "/projects/p-1/policies") {
        return Promise.resolve([{ id: "pol-1", name: "Policy 1" }]);
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

  return {
    requestV3,
    requestV4: overrides.requestV4 ?? vi.fn(),
    requestV3Text: vi.fn(),
  };
}

function makeSupportLog(records: unknown[] = []): SupportLogRepository {
  return {
    append: vi.fn(),
    listAll: vi.fn().mockResolvedValue(records),
  };
}

function makeDiagnostics(): {
  recorder: DiagnosticRecorder;
  repository: ReturnType<typeof createInMemoryDiagnosticLogRepository>;
} {
  const repository = createInMemoryDiagnosticLogRepository();
  const recorder = createDiagnosticRecorder({ repository, secrets: ["api-id", "api-key"] });
  return { recorder, repository };
}

describe("handleGetAuditTrail", () => {
  it("returns 200 with records for a specific examAttemptId", async () => {
    const audit = createInMemoryAuditRepository();
    await audit.write(makeRecord({ examAttemptId: "a-1", id: "r-1" }));
    await audit.write(makeRecord({ examAttemptId: "a-2", id: "r-2" }));

    const result = await handleGetAuditTrail(
      { audit, logger: makeLogger() },
      { query: { examAttemptId: "a-1" } },
    );

    expect(result.status).toBe(200);
    const body = result.body as { records: AuditRecord[] };
    expect(body.records).toHaveLength(1);
    expect(body.records[0].id).toBe("r-1");
  });

  it("returns all records when examAttemptId is absent", async () => {
    const audit = createInMemoryAuditRepository();
    await audit.write(makeRecord({ id: "r-1" }));
    await audit.write(makeRecord({ id: "r-2" }));

    const result = await handleGetAuditTrail(
      { audit, logger: makeLogger() },
      { query: {} },
    );

    expect(result.status).toBe(200);
    const body = result.body as { records: AuditRecord[] };
    expect(body.records).toHaveLength(2);
  });
});

describe("handleSyncResources", () => {
  it("returns 200 with sync counts on success", async () => {
    const resources = createInMemoryResourceRepository();
    const connections = makeConnections();
    const cloudshare = makeCloudShareFactory(makeCloudShareClient());
    const diagnostics = makeDiagnostics();

    const result = await handleSyncResources(
      { connections, cloudshare, resources, diagnostics: diagnostics.recorder, logger: makeLogger() },
      { customerId: "customer-1" },
    );

    expect(result.status).toBe(200);
    const body = result.body as { synced: number };
    expect(body.synced).toBe(4);
    expect(cloudshare.forConnection).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "customer-1" }),
    );

    const [entry] = await diagnostics.repository.query({
      customerId: "customer-1",
      operation: "cloudshare.resource_sync.legacy_sync.read",
    });
    expect(entry).toMatchObject({
      customerId: "customer-1",
      source: "admin",
      operation: "cloudshare.resource_sync.legacy_sync.read",
      outcome: "success",
      request: { method: "POST", path: "/api/admin/sync-resources" },
      response: { synced: 4, resourceCounts: { project: 1, region: 1, blueprint: 1, policy: 1 } },
      externalIds: { resourceType: "resource_sync" },
    });
  });

  it("returns 502 when CloudShare is unavailable", async () => {
    const resources = createInMemoryResourceRepository();
    const connections = makeConnections();
    const diagnostics = makeDiagnostics();
    const cloudshare = makeCloudShareFactory(
      makeCloudShareClient({
        requestV3: vi.fn().mockRejectedValue(new Error("timeout")),
      }),
    );

    const result = await handleSyncResources(
      { connections, cloudshare, resources, diagnostics: diagnostics.recorder, logger: makeLogger() },
      { customerId: "customer-1" },
    );

    expect(result.status).toBe(502);
    const [entry] = await diagnostics.repository.query({
      customerId: "customer-1",
      operation: "cloudshare.resource_sync.legacy_sync.read",
    });
    expect(entry).toMatchObject({
      customerId: "customer-1",
      source: "admin",
      operation: "cloudshare.resource_sync.legacy_sync.read",
      outcome: "failure",
      request: { method: "POST", path: "/api/admin/sync-resources" },
      details: { failureMode: "resource_sync_failed" },
      externalIds: { resourceType: "resource_sync" },
    });
    expect(JSON.stringify(entry)).not.toContain("timeout");
  });

  it("returns 404 when no CloudShare Connection exists for the customer", async () => {
    const resources = createInMemoryResourceRepository();

    const result = await handleSyncResources(
      {
        connections: makeConnections(null),
        cloudshare: makeCloudShareFactory(makeCloudShareClient()),
        resources,
        logger: makeLogger(),
      },
      { customerId: "customer-1" },
    );

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: "Save a CloudShare Connection before syncing resources.",
    });
  });
});

describe("handleGetEventLog", () => {
  it("returns 200 with event log entries", async () => {
    const eventLog = makeEventLog([
      { eventId: "e-1", type: "exam_attempt.created", occurredAt: new Date(), payload: {} },
    ]);

    const result = await handleGetEventLog(
      { eventLog, logger: makeLogger() },
      { query: {} },
    );

    expect(result.status).toBe(200);
    const body = result.body as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });
});

describe("handleGetSupportLog", () => {
  it("returns 200 with support log entries", async () => {
    const supportLog = makeSupportLog([
      {
        timestamp: new Date(),
        level: "warn",
        message: "cloudshare connection test failed",
        fields: {
          correlationId: "corr-123",
          integrationSurface: "cloudshare.v3.ping",
          responseStatus: 401,
        },
      },
    ]);

    const result = await handleGetSupportLog(
      { supportLog, logger: makeLogger() },
      { query: {} },
    );

    expect(result.status).toBe(200);
    const body = result.body as { records: unknown[] };
    expect(body.records).toHaveLength(1);
  });
});
