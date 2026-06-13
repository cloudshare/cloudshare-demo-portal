import { describe, it, expect, vi } from "vitest";
import { handleGetAuditTrail, handleSyncResources, handleGetEventLog, handleGetSupportLog } from "./admin";
import type { AuditRepository, AuditRecord } from "@/domain/audit-trail";
import type { CloudShareResourceLister } from "@/domain/resource-sync";
import type { EventLogRepository } from "@/domain/event-log";
import type { SupportLogRepository } from "@/domain/support-log";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemoryResourceRepository } from "@/persistence/resource-repository";
import type { Logger } from "@/observability/logger";

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

function makeLister(): CloudShareResourceLister {
  return {
    listProjects: vi.fn().mockResolvedValue([{ id: "p-1", name: "Demo Project" }]),
    listRegions: vi.fn().mockResolvedValue([{ id: "r-1", name: "EU West" }]),
    listBlueprints: vi.fn().mockResolvedValue([{ id: "bp-1", name: "Demo Blueprint" }]),
    listPolicies: vi.fn().mockResolvedValue([{ id: "pol-1", name: "Demo Policy" }]),
  };
}

function makeEventLog(records: unknown[] = []): EventLogRepository {
  return {
    append: vi.fn(),
    listAll: vi.fn().mockResolvedValue(records),
  };
}

function makeSupportLog(records: unknown[] = []): SupportLogRepository {
  return {
    append: vi.fn(),
    listAll: vi.fn().mockResolvedValue(records),
  };
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
    const lister = makeLister();
    const resources = createInMemoryResourceRepository();

    const result = await handleSyncResources(
      { lister, resources, logger: makeLogger() },
      {},
    );

    expect(result.status).toBe(200);
    const body = result.body as { synced: number };
    expect(body.synced).toBe(4);
  });

  it("returns 502 when CloudShare is unavailable", async () => {
    const lister: CloudShareResourceLister = {
      listProjects: vi.fn().mockRejectedValue(new Error("timeout")),
      listRegions: vi.fn().mockRejectedValue(new Error("timeout")),
      listBlueprints: vi.fn().mockRejectedValue(new Error("timeout")),
      listPolicies: vi.fn().mockRejectedValue(new Error("timeout")),
    };
    const resources = createInMemoryResourceRepository();

    const result = await handleSyncResources(
      { lister, resources, logger: makeLogger() },
      {},
    );

    expect(result.status).toBe(502);
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
