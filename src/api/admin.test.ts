import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  buildAdminAuditDeps,
  buildAdminDiagnosticLogDeps,
  buildAdminEventLogDeps,
  handleGetAuditTrail,
  handleGetDiagnosticLog,
  handleSyncResources,
  handleGetEventLog,
  type AdminAuditServices,
  type AdminDiagnosticLogServices,
  type AdminEventLogServices,
} from "./admin";
import type { AuditRepository, AuditRecord } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";
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
    listByCustomerId: vi.fn().mockResolvedValue(records),
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

function makeDiagnostics(): {
  recorder: DiagnosticRecorder;
  repository: ReturnType<typeof createInMemoryDiagnosticLogRepository>;
} {
  const repository = createInMemoryDiagnosticLogRepository();
  const recorder = createDiagnosticRecorder({ repository, secrets: ["api-id", "api-key"] });
  return { recorder, repository };
}

describe("handleGetAuditTrail", () => {
  it("maps admin audit dependencies from composed portal services", () => {
    const services = {
      audit: createInMemoryAuditRepository(),
      logger: makeLogger(),
    } satisfies AdminAuditServices;

    const deps = buildAdminAuditDeps(services);

    expect(deps).toEqual({
      audit: services.audit,
      logger: services.logger,
    });
  });

  it("keeps the audit route adapter from inlining audit wiring", () => {
    const routeSource = readFileSync("app/api/admin/audit/route.ts", "utf8");

    expect(routeSource).toContain("buildAdminAuditDeps");
    expect(routeSource).not.toContain("const { audit, logger } = services");
    expect(routeSource).not.toContain("handleGetAuditTrail({ audit, logger }");
  });

  it("returns 200 with records for a specific examAttemptId", async () => {
    const audit = createInMemoryAuditRepository();
    await audit.write(makeRecord({ customerId: "customer-1", examAttemptId: "a-1", id: "r-1" }));
    await audit.write(makeRecord({ customerId: "customer-1", examAttemptId: "a-2", id: "r-2" }));

    const result = await handleGetAuditTrail(
      { audit, logger: makeLogger() },
      { customerId: "customer-1", query: { examAttemptId: "a-1" } },
    );

    expect(result.status).toBe(200);
    const body = result.body as { records: Array<{ id: string }> };
    expect(body.records).toHaveLength(1);
    expect(body.records[0].id).toBe("r-1");
  });

  it("returns customer-scoped records when examAttemptId is absent", async () => {
    const audit = createInMemoryAuditRepository();
    await audit.write(makeRecord({ id: "r-1", customerId: "customer-1" }));
    await audit.write(makeRecord({ id: "r-2", customerId: "customer-2" }));

    const result = await handleGetAuditTrail(
      { audit, logger: makeLogger() },
      { customerId: "customer-1", query: {} },
    );

    expect(result.status).toBe(200);
    const body = result.body as { records: Array<{ id: string; occurredAt: string }> };
    expect(body.records).toEqual([
      expect.objectContaining({
        id: "r-1",
        occurredAt: expect.any(String),
      }),
    ]);
  });

  it("filters audit records by admin and subject metadata", async () => {
    const audit = createInMemoryAuditRepository();
    await audit.write(
      makeRecord({
        id: "r-1",
        customerId: "customer-1",
        actorEmail: "admin@helioscx.demo",
        action: "exam.published",
        subjectType: "exam",
        subjectId: "exam-1",
        examId: "exam-1",
      }),
    );
    await audit.write(
      makeRecord({
        id: "r-2",
        customerId: "customer-1",
        actorEmail: "admin@helioscx.demo",
        action: "exam.unpublished",
        subjectType: "exam",
        subjectId: "exam-1",
        examId: "exam-1",
      }),
    );

    const result = await handleGetAuditTrail(
      { audit, logger: makeLogger() },
      {
        customerId: "customer-1",
        query: {
          actorEmail: " admin@helioscx.demo ",
          action: "exam.published",
          subjectType: "exam",
          subjectId: "exam-1",
          examId: "exam-1",
        },
      },
    );

    expect(result.status).toBe(200);
    const body = result.body as { records: Array<{ id: string; action: string }> };
    expect(body.records).toEqual([
      expect.objectContaining({
        id: "r-1",
        action: "exam.published",
      }),
    ]);
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
  it("maps admin event-log dependencies from composed portal services", () => {
    const services = {
      eventLog: makeEventLog(),
      logger: makeLogger(),
    } satisfies AdminEventLogServices;

    const deps = buildAdminEventLogDeps(services);

    expect(deps).toEqual({
      eventLog: services.eventLog,
      logger: services.logger,
    });
  });

  it("keeps the event route adapter from inlining event-log wiring", () => {
    const routeSource = readFileSync("app/api/admin/events/route.ts", "utf8");

    expect(routeSource).toContain("buildAdminEventLogDeps");
    expect(routeSource).not.toContain("const { eventLog, logger } = services");
    expect(routeSource).not.toContain("handleGetEventLog({ eventLog, logger }");
  });

  it("returns 200 with event log entries", async () => {
    const eventLog = makeEventLog([
      {
        eventId: "e-1",
        customerId: "customer-1",
        correlationId: "e-1",
        type: "exam_attempt.created",
        occurredAt: new Date(),
        payload: { operation: "exam_attempt.create", outcome: "success" },
      },
    ]);

    const result = await handleGetEventLog(
      { eventLog, logger: makeLogger() },
      { customerId: "customer-1", query: {} },
    );

    expect(result.status).toBe(200);
    const body = result.body as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });
});

describe("handleGetDiagnosticLog", () => {
  it("maps the admin diagnostics route dependencies from composed portal services", () => {
    const diagnostics = makeDiagnostics();
    const services = {
      diagnostics: diagnostics.repository,
      logger: makeLogger(),
    } satisfies AdminDiagnosticLogServices;

    const deps = buildAdminDiagnosticLogDeps(services);

    expect(deps).toEqual({
      diagnostics: services.diagnostics,
      logger: services.logger,
    });
  });

  it("keeps the Next route adapter on the typed diagnostic-log read API", () => {
    const routeSource = readFileSync("app/api/admin/diagnostics/route.ts", "utf8");

    expect(routeSource).toContain("buildAdminDiagnosticLogDeps");
    expect(routeSource).toContain("handleGetDiagnosticLog");
    expect(routeSource).not.toContain("supportLog");
  });

  it("returns typed diagnostic entries filtered by ExamAttempt ID", async () => {
    const diagnostics = makeDiagnostics();
    await diagnostics.recorder.record({
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "Exam resume failed",
      customerId: "customer-1",
      candidateEmail: "candidate@helioscx.demo",
      examId: "exam-1",
      examAttemptId: "attempt-1",
      correlationId: "corr-1",
      details: { integrationSurface: "cloudshare.v4.environment" },
    });
    await diagnostics.recorder.record({
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "success",
      message: "Other attempt resumed",
      customerId: "customer-1",
      examAttemptId: "attempt-2",
    });

    const result = await handleGetDiagnosticLog(
      { diagnostics: diagnostics.repository, logger: makeLogger() },
      { customerId: "customer-1", query: { examAttemptId: "attempt-1" } },
    );

    expect(result.status).toBe(200);
    const body = result.body as { entries: Array<{ examAttemptId: string; message: string }> };
    expect(body.entries).toEqual([
      expect.objectContaining({
        examAttemptId: "attempt-1",
        message: "Exam resume failed",
      }),
    ]);
  });

  it("returns only the authenticated Customer's selected participant diagnostics", async () => {
    const diagnostics = makeDiagnostics();
    for (const [customerId, subjectId, correlationId, message] of [
      ["customer-1", "participant-1", "corr-1", "selected first"],
      ["customer-1", "participant-1", "corr-2", "selected second"],
      ["customer-1", "participant-2", "corr-3", "other participant"],
      ["customer-2", "participant-1", "corr-4", "wrong Customer"],
    ] as const) {
      await diagnostics.recorder.record({ source: "sales-participant-launch", operation: "sales.demo_session.participant_launch.opened", outcome: "success", message, customerId, correlationId, subject: { type: "sales_session_participant", id: subjectId } });
    }

    const result = await handleGetDiagnosticLog(
      { diagnostics: diagnostics.repository, logger: makeLogger() },
      { customerId: "customer-1", query: { source: "sales-participant-launch", subjectId: "participant-1" } },
    );

    expect(result.status).toBe(200);
    const body = result.body as { entries: Array<{ message: string }> };
    expect(body.entries.map((entry) => entry.message).sort()).toEqual(["selected first", "selected second"]);
  });
});
