import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getServices, type Services } from "./composition";
import { GET } from "../app/api/health/route";

// Only the external integration is replaced. Real composition, workers, domain,
// repositories and SQLite participate, including per-Customer connection loading.
const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/integrations/cloudshare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/integrations/cloudshare")>();
  const record = async (spec: { method: string; path: string }) => {
    calls.push(`${spec.method} ${spec.path}`);
    throw new Error("Recording provider: dispatch stopped at external integration seam");
  };
  return { ...actual, createCloudShareIntegrationForConnection: () => ({
    requestV4: record, requestV4Detailed: record,
    requestV3: record, requestV3Detailed: record, requestV3Text: record,
  }) };
});

let services: Services | undefined;
let customerId: string | undefined;
let healthHeartbeatId: string | undefined;
afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  if (services) {
    services.heartbeatAutoSuspend.stop();
    if (healthHeartbeatId) await services.prisma.heartbeat.delete({ where: { id: healthHeartbeatId } });
    if (customerId) {
      await services.prisma.salesTrialOffering.deleteMany({ where: { customerId } });
      await services.prisma.diagnosticLogEntry.deleteMany({ where: { customerId } });
      await services.prisma.auditTrailEntry.deleteMany({ where: { customerId } });
      await services.prisma.customer.delete({ where: { id: customerId } });
    }
    services.dispose();
    await services.prisma.$disconnect();
  }
  delete (globalThis as { __portalServices?: Services }).__portalServices;
  services = undefined;
  customerId = undefined;
  healthHeartbeatId = undefined;
  calls.length = 0;
  vi.unstubAllEnvs();
});

async function start(backgroundJobs?: string) {
  vi.stubEnv("PORTAL_MODE", "live");
  vi.stubEnv("PORTAL_SEED_SOURCE", "off");
  vi.stubEnv("HEARTBEAT_TIMEOUT_MS", "60000");
  vi.stubEnv("PORTAL_MASTER_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("PORTAL_BACKGROUND_JOBS", backgroundJobs);
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
  services = getServices();
  customerId = `jobs-${randomUUID()}`;
  const prisma = services.prisma;
  const now = new Date();
  await prisma.customer.create({ data: { id: customerId, slug: customerId, name: "Synthetic QA" } });
  await services.cloudshareConnections.save({ customerId, apiId: "synthetic-id", apiKey: "synthetic-key", webhookSecret: "synthetic-secret" });
  await prisma.item.create({ data: { id: customerId, customerId, name: "QA", description: "", projectId: "synthetic", projectName: "QA", blueprintsJson: "[]", policyId: "synthetic", policyName: "QA", regionsJson: "[]", defaultDurationMinutes: 60, status: "published", createdAt: now, updatedAt: now } });
  await prisma.salesTrialOffering.create({ data: { id: customerId, customerId, itemId: customerId, title: "QA", description: "", cloudShareSalesExperienceId: "synthetic-sales", externalId: "synthetic-external", start: "2026-10-22T12:00", timeZone: "UTC", salesProEmail: "qa@example.test", status: "ending", createdAt: now, updatedAt: now } });
  await prisma.exam.create({ data: { id: customerId, customerId, title: "QA", description: "", timeLimitMinutes: 60, openPeriodMinutes: 120, scoreRetrievalEnabled: false, status: "published", createdAt: now, updatedAt: now, projectId: "synthetic", projectName: "QA", blueprintId: "synthetic", blueprintName: "QA", snapshotId: "synthetic", snapshotName: "QA", allowedRegionsJson: "[]", policyId: "synthetic", policyName: "QA", instructorId: "synthetic", instructorName: "QA" } });
  await prisma.examAttempt.create({ data: { id: customerId, customerId, candidateId: "synthetic-candidate", examId: customerId, status: "in_progress", scheduledFor: now, createdAt: now } });
  await prisma.labLaunch.create({ data: { id: customerId, examAttemptId: customerId, candidateId: "synthetic-candidate", participantEmail: "qa@example.test", trainingId: "EXsyntheticTraining", experienceId: "EXsyntheticTraining", loginUrl: "https://example.test", status: "ready", createdAt: now } });
  services.heartbeatAutoSuspend.recordHeartbeat(customerId);
  return services;
}

// Timer callbacks launch asynchronous DB work without awaiting it. A real-time
// event-loop barrier lets that work settle while scheduler time stays controlled.
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function waitForDiagnostic(operation: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const entries = await services!.diagnostics.query({ customerId, operation });
    if (entries.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Worker did not complete: ${operation}`);
}

describe("service composition background jobs", () => {
  it("disables automatic dispatch on initialization, health reads and elapsed intervals", async () => {
    await start("disabled");
    expect(vi.getTimerCount()).toBe(0);
    await settle();
    expect(calls).toEqual([]);
    const response = await GET();
    const health = await response.json();
    healthHeartbeatId = health.heartbeatId;
    expect(response.status).toBe(200);
    expect(getServices()).toBe(services);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await settle();
    expect(calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, "enabled"])("keeps heartbeat and Trial-ending dispatch with setting %s", async (setting) => {
    await start(setting);
    expect(vi.getTimerCount()).toBe(2);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    await waitForDiagnostic("exam_attempt.heartbeat_auto_suspend");
    expect(calls).toContain("GET /trainings/EXsyntheticTraining/students");
    services!.heartbeatAutoSuspend.removeHeartbeat(customerId!);
    calls.length = 0;
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await waitForDiagnostic("sales.trial_offering.end");
    expect(calls).toContain("GET /sales/synthetic-sales");
    expect(calls).toContain("GET /sales/synthetic-sales/participants");
  });
});
