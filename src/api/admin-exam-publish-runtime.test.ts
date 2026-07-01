import { describe, expect, it, vi } from "vitest";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { createDiagnosticRecorder, type DiagnosticRecorder } from "@/domain/diagnostic-log";
import { createDraftExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type {
  CloudShareBlueprintDetail,
  CloudShareExamAuthoringSource,
} from "@/integrations/cloudshare/resources";
import type { Logger } from "@/observability/logger";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { publishAdminExamRuntime } from "./admin-exam-publish-runtime";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeConnectionRecord(): CloudShareConnectionRecord {
  return {
    customerId: "customer-1",
    apiId: "api-id",
    apiKey: "api-key",
    webhookSecret: "whsec",
    webhookPathToken: "whk-customer-1",
    connectedAt: new Date("2026-06-14T11:00:00.000Z"),
    verifiedAt: new Date("2026-06-14T11:05:00.000Z"),
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

function makeBlueprintDetail(
  overrides: Partial<CloudShareBlueprintDetail> = {},
): CloudShareBlueprintDetail {
  return {
    id: "bp-1",
    name: "Helios Exam Blueprint",
    description: "Blueprint-backed description",
    defaultSnapshotId: "snap-1",
    diagnosticResponse: {
      status: 200,
      body: { id: "bp-1", supportOnlyShape: true },
    },
    snapshots: [
      {
        id: "snap-1",
        name: "Default Snapshot",
        isDefault: true,
        regionIds: ["region-1", "region-2"],
      },
    ],
    ...overrides,
  };
}

function makeAuthoringSource(
  overrides: Partial<CloudShareExamAuthoringSource> = {},
): CloudShareExamAuthoringSource {
  return {
    listProjects: vi.fn(),
    listRegions: vi.fn(),
    listProjectBlueprints: vi.fn(),
    listProjectPolicies: vi.fn(),
    getBlueprintDetail: vi.fn().mockResolvedValue(makeBlueprintDetail()),
    ...overrides,
  };
}

function makeCloudShareFactory(source: CloudShareExamAuthoringSource): CloudShareClientFactory {
  return {
    forConnection: vi.fn().mockReturnValue(source),
  } as unknown as CloudShareClientFactory;
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

function makeExamInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-1",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on certification exam.",
    timeLimitMinutes: 240,
    openPeriodMinutes: 720,
    scoreRetrievalEnabled: false,
    projectId: "project-1",
    projectName: "Helios CX Project",
    blueprintId: "bp-1",
    blueprintName: "Helios Exam Blueprint",
    snapshotId: "snap-1",
    snapshotName: "Default Snapshot",
    allowedRegions: [
      { id: "region-1", name: "EU West" },
      { id: "region-2", name: "US East" },
    ],
    policyId: "policy-1",
    policyName: "Standard Exam Policy",
    instructorId: "instructor-1",
    instructorName: "Helios Service Account",
    ...overrides,
  };
}

describe("admin Exam publish runtime", () => {
  it("refreshes Blueprint detail, strips diagnostic-only cache metadata, and publishes a draft Exam", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnostics = makeDiagnostics();
    const source = makeAuthoringSource({
      getBlueprintDetail: vi.fn().mockResolvedValue(
        makeBlueprintDetail({
          diagnosticSummary: { supportOnlyShape: true },
        }),
      ),
    });
    await createDraftExam(
      {
        repository,
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      makeExamInput(),
    );

    const response = await publishAdminExamRuntime(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:30:00.000Z"),
      },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      exam: { id: "exam-1", status: "published" },
    });
    expect(source.getBlueprintDetail).toHaveBeenCalledWith("project-1", "bp-1");
    await expect(cache.getBlueprintDetail("customer-1", "project-1", "bp-1")).resolves.toEqual({
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
    expect(JSON.stringify(await cache.getBlueprintDetail("customer-1", "project-1", "bp-1"))).not.toContain(
      "supportOnlyShape",
    );
    await expect(
      diagnostics.repository.query({
        customerId: "customer-1",
        operation: "cloudshare.resource_sync.blueprint_detail.read",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: "success",
        externalIds: {
          resourceType: "blueprint_detail",
          projectId: "project-1",
          blueprintId: "bp-1",
        },
      }),
    ]);
    await expect(
      diagnostics.repository.query({
        customerId: "customer-1",
        examId: "exam-1",
        operation: "exam.publish",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: "success",
        details: { changedFields: ["status", "publishedAt"] },
      }),
    ]);
  });

  it("rejects publishing when the current Blueprint default Snapshot changed", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const source = makeAuthoringSource({
      getBlueprintDetail: vi.fn().mockResolvedValue(
        makeBlueprintDetail({
          defaultSnapshotId: "snap-2",
          snapshots: [
            { id: "snap-1", name: "Previous Snapshot", isDefault: false, regionIds: ["region-1"] },
            { id: "snap-2", name: "New Default Snapshot", isDefault: true, regionIds: ["region-2"] },
          ],
        }),
      ),
    });
    await createDraftExam(
      {
        repository,
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      makeExamInput({ allowedRegions: [{ id: "region-1", name: "EU West" }] }),
    );

    const response = await publishAdminExamRuntime(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        logger: makeLogger(),
      },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error:
        "The selected Blueprint default Snapshot has changed. Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
    });
    await expect(repository.findById("exam-1")).resolves.toMatchObject({ status: "draft" });
  });
});
