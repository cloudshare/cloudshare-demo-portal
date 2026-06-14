import { describe, expect, it, vi } from "vitest";
import {
  handleCreateDraftExam,
  handleGetBlueprintDetail,
  handleGetExamAuthoringBootstrap,
  handleGetExamCatalog,
  handleGetProjectResources,
  handlePublishExam,
  handleUnpublishExam,
  handleUpdateDraftExam,
} from "./admin-exams";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { Logger } from "@/observability/logger";
import { createInMemoryExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import type {
  CloudShareBlueprintDetail,
  CloudShareExamAuthoringSource,
} from "@/integrations/cloudshare/resources";
import { CloudShareRequestError } from "@/integrations/cloudshare";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeConnectionRecord(): CloudShareConnectionRecord {
  return {
    customerId: "customer-1",
    apiId: "api-id",
    apiKey: "api-key",
    webhookSecret: "whsec",
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
    markVerified: vi.fn(),
  };
}

function makeAuthoringSource(
  overrides: Partial<CloudShareExamAuthoringSource> = {},
): CloudShareExamAuthoringSource {
  return {
    listProjects: vi.fn().mockResolvedValue([{ id: "project-1", name: "Helios CX Project" }]),
    listRegions: vi.fn().mockResolvedValue([
      { id: "region-1", name: "eu-west", friendlyName: "EU West" },
    ]),
    listProjectBlueprints: vi.fn().mockResolvedValue([
      {
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
      },
    ]),
    listProjectPolicies: vi.fn().mockResolvedValue([
      { id: "policy-1", name: "Standard Exam Policy", runtimeLeaseMinutes: 240 },
    ]),
    getBlueprintDetail: vi.fn().mockResolvedValue({
      id: "bp-1",
      name: "Helios Exam Blueprint",
      description: "Blueprint-backed description",
      defaultSnapshotId: "snap-1",
      snapshots: [
        { id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["region-1"] },
        { id: "snap-2", name: "Older Snapshot", isDefault: false, regionIds: ["region-2"] },
      ],
    } satisfies CloudShareBlueprintDetail),
    ...overrides,
  };
}

function makeCloudShareFactory(
  source: CloudShareExamAuthoringSource,
): CloudShareClientFactory {
  return {
    forConnection: vi.fn().mockReturnValue(source),
  } as unknown as CloudShareClientFactory;
}

async function seedAuthoringCache(
  cache: ReturnType<typeof createInMemoryExamAuthoringCacheRepository>,
) {
  await cache.saveBootstrap("customer-1", {
    projects: [{ id: "project-1", name: "Helios CX Project" }],
    regions: [{ id: "region-1", name: "eu-west", friendlyName: "EU West" }],
  });
  await cache.saveProjectResources("customer-1", "project-1", {
    blueprints: [
      { id: "bp-1", name: "Helios Exam Blueprint", description: "Blueprint-backed description" },
    ],
    policies: [{ id: "policy-1", name: "Standard Exam Policy", runtimeLeaseMinutes: 240 }],
  });
  await cache.saveBlueprintDetail("customer-1", "project-1", "bp-1", {
    id: "bp-1",
    name: "Helios Exam Blueprint",
    description: "Blueprint-backed description",
    defaultSnapshotId: "snap-1",
    snapshots: [
      { id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["region-1"] },
      { id: "snap-2", name: "Older Snapshot", isDefault: false, regionIds: ["region-2"] },
    ],
  });
}

describe("admin exam authoring handlers", () => {
  it("lists projects and global regions and caches them", async () => {
    const source = makeAuthoringSource();
    const cache = createInMemoryExamAuthoringCacheRepository();

    const result = await handleGetExamAuthoringBootstrap(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        logger: makeLogger(),
      },
      { customerId: "customer-1", refresh: false },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      source: "live",
      projects: [{ id: "project-1", name: "Helios CX Project" }],
      regions: [{ id: "region-1", name: "eu-west", friendlyName: "EU West" }],
    });

    const cached = await handleGetExamAuthoringBootstrap(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        logger: makeLogger(),
      },
      { customerId: "customer-1", refresh: false },
    );

    expect(cached.body).toMatchObject({ source: "cache" });
    expect(source.listProjects).toHaveBeenCalledTimes(1);
    expect(source.listRegions).toHaveBeenCalledTimes(1);
  });

  it("lists project-scoped blueprints and policies for the selected project", async () => {
    const source = makeAuthoringSource();

    const result = await handleGetProjectResources(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        logger: makeLogger(),
      },
      { customerId: "customer-1", projectId: "project-1", refresh: true },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      source: "live",
      projectId: "project-1",
      blueprints: [
        {
          id: "bp-1",
          name: "Helios Exam Blueprint",
          description: "Blueprint-backed description",
        },
      ],
      policies: [{ id: "policy-1", name: "Standard Exam Policy", runtimeLeaseMinutes: 240 }],
    });
    expect(source.listProjectBlueprints).toHaveBeenCalledWith("project-1");
    expect(source.listProjectPolicies).toHaveBeenCalledWith("project-1");
  });

  it("returns blueprint-detail snapshot choices with the default preselected", async () => {
    const source = makeAuthoringSource();

    const result = await handleGetBlueprintDetail(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        logger: makeLogger(),
      },
      { customerId: "customer-1", projectId: "project-1", blueprintId: "bp-1", refresh: true },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      source: "live",
      projectId: "project-1",
      blueprint: {
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
        defaultSnapshotId: "snap-1",
        snapshots: [
          { id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["region-1"] },
          { id: "snap-2", name: "Older Snapshot", isDefault: false, regionIds: ["region-2"] },
        ],
      },
    });
  });

  it("returns support diagnostics when a CloudShare project resource call fails", async () => {
    const source = makeAuthoringSource({
      listProjectPolicies: vi
        .fn()
        .mockRejectedValue(
          new CloudShareRequestError("403 forbidden", 403, {
            method: "GET",
            requestHeaders: { authorization: "cs_sha1 [REDACTED]" },
            responseBody: "{\"error\":\"forbidden\"}",
          }),
        ),
    });

    const result = await handleGetProjectResources(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        logger: makeLogger(),
      },
      { customerId: "customer-1", projectId: "project-1", refresh: true },
    );

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      error: "CloudShare resource request failed.",
      correlationId: expect.any(String),
      occurredAt: expect.any(String),
      diagnostic: {
        operation: "list_project_policies",
        integrationSurface: "cloudshare.v3.projects.policies",
        method: "GET",
        path: "/projects/project-1/policies",
        failureMode: "http_status",
        responseStatus: 403,
      },
    });
  });
});

describe("admin exam catalog handlers", () => {
  const configuredInstructor = {
    id: "instructor-1",
    name: "Helios Service Account",
  };

  it("creates a draft exam and returns it", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);

    const result = await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 5,
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          regionId: "region-1",
          policyId: "policy-1",
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
        projectName: "Helios CX Project",
        instructorId: "instructor-1",
        instructorName: "Helios Service Account",
      },
    });
  });

  it("creates a draft exam when the description is blank", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);

    const result = await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "   ",
          timeLimitMinutes: 5,
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          regionId: "region-1",
          policyId: "policy-1",
        },
      },
    );

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      exam: {
        id: "exam-1",
        description: "",
        timeLimitMinutes: 240,
      },
    });
  });

  it("rejects draft creation when the selected region is not supported by the default snapshot", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);

    const result = await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 240,
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          regionId: "region-2",
          policyId: "policy-1",
        },
      },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
    });
  });

  it("rejects draft creation when the seeded instructor is not explicitly configured", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);

    const result = await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: { id: "seeded-cloudshare-instructor", name: "Seeded CloudShare Instructor" },
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 90,
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          regionId: "region-1",
          policyId: "policy-1",
        },
      },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error:
        "Configure the seeded CloudShare instructor before creating Exams for this customer.",
    });
  });

  it("rejects draft creation when the tuple was not loaded from authoring resources", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);

    const result = await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 90,
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-not-in-cache",
          snapshotId: "snap-1",
          regionId: "region-1",
          policyId: "policy-1",
        },
      },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
    });
  });

  it("rejects draft creation when a non-default blueprint version is submitted", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);

    const result = await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 90,
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-2",
          regionId: "region-1",
          policyId: "policy-1",
        },
      },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
    });
  });

  it("publishes an existing draft exam and lists it in the catalog", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);
    await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 90,
          scoreRetrievalEnabled: false,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          regionId: "region-1",
          policyId: "policy-1",
        },
      },
    );

    const publish = await handlePublishExam(
      { repository, logger: makeLogger(), now: () => new Date("2026-06-14T12:30:00.000Z") },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(publish.status).toBe(200);
    expect(publish.body).toMatchObject({
      exam: { id: "exam-1", status: "published" },
    });

    const catalog = await handleGetExamCatalog(
      { repository, logger: makeLogger() },
      { customerId: "customer-1" },
    );

    expect(catalog.status).toBe(200);
    expect(catalog.body).toEqual({
      exams: [
        expect.objectContaining({
          id: "exam-1",
          status: "published",
          scoreRetrievalEnabled: false,
        }),
      ],
    });
  });

  it("updates an existing draft exam", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);
    await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 240,
          scoreRetrievalEnabled: false,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          regionId: "region-1",
          policyId: "policy-1",
        },
      },
    );

    const update = await handleUpdateDraftExam(
      { repository, logger: makeLogger(), now: () => new Date("2026-06-14T12:45:00.000Z") },
      {
        customerId: "customer-1",
        examId: "exam-1",
        body: {
          title: "Helios Blueprint Exam",
          description: "Updated description.",
          timeLimitMinutes: 5,
          scoreRetrievalEnabled: true,
        },
      },
    );

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({
      exam: {
        id: "exam-1",
        status: "draft",
        title: "Helios Blueprint Exam",
        description: "Updated description.",
        timeLimitMinutes: 240,
        scoreRetrievalEnabled: true,
      },
    });
  });

  it("unpublishes an existing published exam", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);
    await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 240,
          scoreRetrievalEnabled: false,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          regionId: "region-1",
          policyId: "policy-1",
        },
      },
    );
    await handlePublishExam(
      { repository, logger: makeLogger(), now: () => new Date("2026-06-14T12:30:00.000Z") },
      { customerId: "customer-1", examId: "exam-1" },
    );

    const unpublish = await handleUnpublishExam(
      { repository, logger: makeLogger(), now: () => new Date("2026-06-14T12:45:00.000Z") },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(unpublish.status).toBe(200);
    expect(unpublish.body).toMatchObject({
      exam: {
        id: "exam-1",
        status: "draft",
        publishedAt: null,
      },
    });
  });
});
