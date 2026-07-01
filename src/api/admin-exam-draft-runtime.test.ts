import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@/observability/logger";
import { createDiagnosticRecorder, type DiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import {
  createAdminDraftExamRuntime,
  updateAdminDraftExamRuntime,
} from "./admin-exam-draft-runtime";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDiagnostics(): {
  recorder: DiagnosticRecorder;
  repository: ReturnType<typeof createInMemoryDiagnosticLogRepository>;
} {
  const repository = createInMemoryDiagnosticLogRepository();
  const recorder = createDiagnosticRecorder({
    repository,
    secrets: ["api-id", "api-key", "whsec"],
  });
  return { recorder, repository };
}

async function seedAuthoringCache(
  cache: ReturnType<typeof createInMemoryExamAuthoringCacheRepository>,
) {
  await cache.saveBootstrap("customer-1", {
    projects: [{ id: "project-1", name: "Helios CX Project" }],
    regions: [
      { id: "region-1", name: "eu-west", friendlyName: "EU West" },
      { id: "region-2", name: "us-east", friendlyName: "US East" },
    ],
  });
  await cache.saveProjectResources("customer-1", "project-1", {
    blueprints: [
      { id: "bp-1", name: "Helios Exam Blueprint", description: "Blueprint-backed description" },
    ],
    policies: [
      {
        id: "policy-1",
        name: "Standard Exam Policy",
        runtimeLeaseMinutes: 240,
        storageLeaseMinutes: 2880,
      },
      {
        id: "policy-2",
        name: "Extended Exam Policy",
        runtimeLeaseMinutes: 120,
        storageLeaseMinutes: 1440,
      },
    ],
  });
  await cache.saveBlueprintDetail("customer-1", "project-1", "bp-1", {
    id: "bp-1",
    name: "Helios Exam Blueprint",
    description: "Blueprint-backed description",
    defaultSnapshotId: "snap-1",
    snapshots: [
      {
        id: "snap-1",
        name: "Default Snapshot",
        isDefault: true,
        regionIds: ["region-1", "region-2"],
      },
    ],
  });
}

describe("admin draft exam runtime", () => {
  const instructor = {
    id: "instructor-1",
    name: "Helios Service Account",
  };
  const actor = {
    type: "admin",
    id: "admin-1",
    email: "admin@helioscx.demo",
  } as const;

  it("creates a draft exam from cached authoring resources", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnostics = makeDiagnostics();
    await seedAuthoringCache(cache);

    const result = await createAdminDraftExamRuntime(
      {
        repository,
        cache,
        instructor,
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        actor,
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          allowedRegionIds: ["region-1", "region-2"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      exam: {
        id: "exam-1",
        status: "draft",
        title: "Helios CloudShare Fundamentals",
        timeLimitMinutes: 240,
        storageLeaseMinutes: 2880,
        openPeriodMinutes: 720,
        projectName: "Helios CX Project",
        allowedRegions: [
          { id: "region-1", name: "EU West" },
          { id: "region-2", name: "US East" },
        ],
        instructorId: "instructor-1",
      },
    });

    const [entry] = await diagnostics.repository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "exam.create",
    });
    expect(entry).toMatchObject({
      actor,
      operation: "exam.create",
      outcome: "success",
      details: {
        changedFields: [
          "title",
          "description",
          "scoreRetrievalEnabled",
          "policyId",
          "openPeriodMinutes",
          "allowedRegions",
          "status",
        ],
      },
    });
  });

  it("updates a draft exam and records the changed draft fields", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnostics = makeDiagnostics();
    await seedAuthoringCache(cache);
    await createAdminDraftExamRuntime(
      {
        repository,
        cache,
        instructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          scoreRetrievalEnabled: false,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    const result = await updateAdminDraftExamRuntime(
      {
        repository,
        cache,
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:45:00.000Z"),
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {
          title: "Helios Blueprint Exam",
          description: "Updated description.",
          scoreRetrievalEnabled: true,
          allowedRegionIds: ["region-2"],
          policyId: "policy-2",
          openPeriodMinutes: 360,
        },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      exam: {
        id: "exam-1",
        title: "Helios Blueprint Exam",
        timeLimitMinutes: 120,
        storageLeaseMinutes: 1440,
        openPeriodMinutes: 360,
        scoreRetrievalEnabled: true,
        allowedRegions: [{ id: "region-2", name: "US East" }],
        policyId: "policy-2",
        policyName: "Extended Exam Policy",
      },
    });

    const [entry] = await diagnostics.repository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "exam.update",
    });
    expect(entry).toMatchObject({
      actor,
      operation: "exam.update",
      outcome: "success",
      details: {
        changedFields: [
          "title",
          "description",
          "scoreRetrievalEnabled",
          "policyId",
          "policyName",
          "timeLimitMinutes",
          "openPeriodMinutes",
          "storageLeaseMinutes",
          "allowedRegions",
        ],
      },
    });
  });

  it("persists a manual open period when the selected Policy lacks storage lease evidence", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);
    await cache.saveProjectResources("customer-1", "project-1", {
      blueprints: [
        { id: "bp-1", name: "Helios Exam Blueprint", description: "Blueprint-backed description" },
      ],
      policies: [
        {
          id: "policy-1",
          name: "Standard Exam Policy",
          runtimeLeaseMinutes: 240,
          storageLeaseMinutes: null,
        },
      ],
    });

    const result = await createAdminDraftExamRuntime(
      {
        repository,
        cache,
        instructor,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 360,
        },
      },
    );

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      exam: {
        timeLimitMinutes: 240,
        storageLeaseMinutes: null,
        openPeriodMinutes: 360,
      },
    });
  });

  it("rejects an open period shorter than the selected Policy runtime lease", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);

    const result = await createAdminDraftExamRuntime(
      {
        repository,
        cache,
        instructor,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 120,
        },
      },
    );

    expect(result).toEqual({
      status: 400,
      body: { error: "Open period must be at least the Policy runtime lease." },
    });
  });

  it("rejects an open period longer than available Policy storage retention", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);

    const result = await createAdminDraftExamRuntime(
      {
        repository,
        cache,
        instructor,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 3000,
        },
      },
    );

    expect(result).toEqual({
      status: 400,
      body: { error: "Open period must not exceed the Policy storage lease." },
    });
  });
});
