import { describe, expect, it, vi } from "vitest";
import {
  buildAdminExamAuthoringDeps,
  buildAdminDraftExamDeps,
  buildAdminDraftExamUpdateDeps,
  buildAdminExamCatalogListDeps,
  buildAdminExamPublishDeps,
  buildAdminExamUnpublishDeps,
  handleArchiveExam,
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
import { createDiagnosticRecorder, type DiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
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

function makeAuthoringSource(
  overrides: Partial<CloudShareExamAuthoringSource> = {},
): CloudShareExamAuthoringSource {
  return {
    listProjects: vi.fn().mockResolvedValue([{ id: "project-1", name: "Helios CX Project" }]),
    listRegions: vi.fn().mockResolvedValue([
      { id: "region-1", name: "eu-west", friendlyName: "EU West" },
      { id: "region-2", name: "us-east", friendlyName: "US East" },
      { id: "region-3", name: "ap-south", friendlyName: "AP South" },
    ]),
    listProjectBlueprints: vi.fn().mockResolvedValue([
      {
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
      },
    ]),
    listProjectPolicies: vi.fn().mockResolvedValue([
      {
        id: "policy-1",
        name: "Standard Exam Policy",
        runtimeLeaseMinutes: 240,
        storageLeaseMinutes: 2880,
      },
    ]),
    getBlueprintDetail: vi.fn().mockResolvedValue({
      id: "bp-1",
      name: "Helios Exam Blueprint",
      description: "Blueprint-backed description",
      defaultSnapshotId: "snap-1",
      diagnosticResponse: {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
        body: {
          id: "bp-1",
          name: "Helios Exam Blueprint",
          description: "Blueprint-backed description",
          type: "VmBlueprint",
          creationDate: "2026-06-14T11:00:00.000Z",
          resources: { ram: 16, cpu: 8 },
          numberOfMachines: 1,
          imageUrl: {
            path: "/bp-1.png",
            imageToken: "[REDACTED]",
          },
          createFromVersions: [
            {
              id: "snap-1",
              name: "Default Snapshot",
              isDefault: true,
              isLatest: true,
              type: "snapshot",
              regions: [{ id: "region-1" }, { id: "region-2" }],
              resources: { ram: 8, cpu: 4 },
              machines: [
                {
                  id: "machine-1",
                  name: "Primary VM",
                  osTypeName: "Windows Server 2022",
                  resources: { ram: 8, cpu: 4 },
                  isSaaS: false,
                  httpAccessEnabled: true,
                  resumeType: "resume",
                  bootOrder: 1,
                  canAddMultipleInstances: false,
                },
              ],
            },
            {
              id: "snap-2",
              name: "Older Snapshot",
              isDefault: false,
              isLatest: false,
              type: "snapshot",
              regions: [{ id: "region-3" }],
              resources: { ram: 4, cpu: 2 },
              machines: [],
            },
          ],
        },
      },
      diagnosticSummary: {
        blueprintId: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
        type: "VmBlueprint",
        creationDate: "2026-06-14T11:00:00.000Z",
        resources: { ram: 16, cpu: 8 },
        numberOfMachines: 1,
        imageUrl: { present: true, path: "/bp-1.png" },
        defaultSnapshotId: "snap-1",
        snapshotCount: 2,
        snapshots: [
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
            isLatest: true,
            type: "snapshot",
            regions: [{ id: "region-1" }, { id: "region-2" }],
            resources: { ram: 8, cpu: 4 },
            machineCount: 1,
            machines: [
              {
                id: "machine-1",
                name: "Primary VM",
                osTypeName: "Windows Server 2022",
                resources: { ram: 8, cpu: 4 },
                isSaaS: false,
                httpAccessEnabled: true,
                resumeType: "resume",
                bootOrder: 1,
                canAddMultipleInstances: false,
              },
            ],
          },
          {
            id: "snap-2",
            name: "Older Snapshot",
            isDefault: false,
            isLatest: false,
            type: "snapshot",
            regions: [{ id: "region-3" }],
            resources: { ram: 4, cpu: 2 },
            machineCount: 0,
            machines: [],
          },
        ],
      },
      snapshots: [
        {
          id: "snap-1",
          name: "Default Snapshot",
          isDefault: true,
          regionIds: ["region-1", "region-2"],
        },
        { id: "snap-2", name: "Older Snapshot", isDefault: false, regionIds: ["region-3"] },
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
      { id: "region-3", name: "ap-south", friendlyName: "AP South" },
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
      { id: "snap-2", name: "Older Snapshot", isDefault: false, regionIds: ["region-3"] },
    ],
  });
}

describe("admin exam authoring handlers", () => {
  it("lists projects and global regions and caches them", async () => {
    const source = makeAuthoringSource();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnostics = makeDiagnostics();

    const result = await handleGetExamAuthoringBootstrap(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
      },
      { customerId: "customer-1", refresh: false },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      source: "live",
      projects: [{ id: "project-1", name: "Helios CX Project" }],
      regions: [
        { id: "region-1", name: "eu-west", friendlyName: "EU West" },
        { id: "region-2", name: "us-east", friendlyName: "US East" },
        { id: "region-3", name: "ap-south", friendlyName: "AP South" },
      ],
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

    const entries = await diagnostics.repository.query({ customerId: "customer-1" });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.operation).sort()).toEqual([
      "cloudshare.resource_sync.projects.read",
      "cloudshare.resource_sync.regions.read",
    ]);
    expect(entries.find((entry) => entry.operation === "cloudshare.resource_sync.projects.read")).toMatchObject({
      customerId: "customer-1",
      source: "admin-exams",
      operation: "cloudshare.resource_sync.projects.read",
      outcome: "success",
      externalIds: { resourceType: "project" },
      request: { method: "GET", path: "/projects" },
      response: { itemCount: 1, resourceIds: ["project-1"] },
    });
    expect(entries.find((entry) => entry.operation === "cloudshare.resource_sync.regions.read")).toMatchObject({
      customerId: "customer-1",
      source: "admin-exams",
      operation: "cloudshare.resource_sync.regions.read",
      outcome: "success",
      externalIds: { resourceType: "region" },
      request: { method: "GET", path: "/regions" },
      response: { itemCount: 3, resourceIds: ["region-1", "region-2", "region-3"] },
    });
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
      policies: [
        {
          id: "policy-1",
          name: "Standard Exam Policy",
          runtimeLeaseMinutes: 240,
          storageLeaseMinutes: 2880,
        },
      ],
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
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
            regionIds: ["region-1", "region-2"],
          },
          { id: "snap-2", name: "Older Snapshot", isDefault: false, regionIds: ["region-3"] },
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
            responseBody: JSON.stringify({
              error: "forbidden",
              signature: "sig-secret",
            }),
          }),
        ),
    });
    const diagnostics = makeDiagnostics();

    const result = await handleGetProjectResources(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        diagnostics: diagnostics.recorder,
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
        operation: "cloudshare.resource_sync.policies.read",
        integrationSurface: "cloudshare.v3.projects.policies",
        method: "GET",
        path: "/projects/project-1/policies",
        failureMode: "http_status",
        responseStatus: 403,
      },
    });

    const [entry] = await diagnostics.repository.query({
      customerId: "customer-1",
      operation: "cloudshare.resource_sync.policies.read",
    });
    expect(entry).toMatchObject({
      customerId: "customer-1",
      source: "admin-exams",
      operation: "cloudshare.resource_sync.policies.read",
      outcome: "failure",
      externalIds: { resourceType: "policy", projectId: "project-1" },
      request: {
        method: "GET",
        path: "/projects/project-1/policies",
        headers: { authorization: "[REDACTED]" },
      },
      response: {
        status: 403,
        body: {
          error: "forbidden",
        signature: "sig-secret",
        },
      },
    });
  });

  it("maps name-only CloudShare response errors to supportable 502s", async () => {
    const source = makeAuthoringSource({
      getBlueprintDetail: vi.fn().mockRejectedValue(
        Object.assign(
          new Error("schema mismatch"),
          {
            name: "CloudShareResponseError",
            context: {
              method: "GET",
              responseBody: "{\"regions\":[\"r-1\"]}",
            },
          },
        ),
      ),
    });

    const result = await handleGetBlueprintDetail(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        logger: makeLogger(),
      },
      { customerId: "customer-1", projectId: "project-1", blueprintId: "bp-1", refresh: true },
    );

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      error: "CloudShare resource request failed.",
      diagnostic: {
        operation: "cloudshare.resource_sync.blueprint_detail.read",
        integrationSurface: "cloudshare.v3.projects.blueprint_detail",
        method: "GET",
        path: "/projects/project-1/blueprints/bp-1",
        failureMode: "unexpected_response",
      },
    });
  });
});

describe("admin exam catalog handlers", () => {
  const configuredInstructor = {
    id: "instructor-1",
    name: "Helios Service Account",
  };
  const adminActor = {
    type: "admin",
    id: "admin-1",
    email: "admin@helioscx.demo",
  } as const;

  it("builds exam authoring resource dependencies from composed services", () => {
    const connections = makeConnections();
    const cloudshare = makeCloudShareFactory(makeAuthoringSource());
    const cache = createInMemoryExamAuthoringCacheRepository();
    const { recorder } = makeDiagnostics();
    const logger = makeLogger();

    expect(
      buildAdminExamAuthoringDeps({
        cloudshareConnections: connections,
        cloudshareClientFactory: cloudshare,
        examAuthoringCache: cache,
        diagnosticRecorder: recorder,
        logger,
      }),
    ).toEqual({
      connections,
      cloudshare,
      cache,
      diagnostics: recorder,
      logger,
    });
  });

  it("builds catalog list dependencies from composed services", () => {
    const repository = createInMemoryExamCatalogRepository();
    const logger = makeLogger();

    expect(
      buildAdminExamCatalogListDeps({
        exams: repository,
        logger,
      }),
    ).toEqual({
      repository,
      logger,
    });
  });

  it("builds draft exam dependencies from composed services", () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const { recorder } = makeDiagnostics();
    const logger = makeLogger();

    expect(
      buildAdminDraftExamDeps({
        exams: repository,
        examAuthoringCache: cache,
        config: {
          seed: {
            heliosInstructor: configuredInstructor,
          },
        },
        diagnosticRecorder: recorder,
        logger,
      }),
    ).toEqual({
      repository,
      cache,
      instructor: configuredInstructor,
      diagnostics: recorder,
      logger,
    });
  });

  it("builds draft update dependencies from composed services", () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const { recorder } = makeDiagnostics();
    const logger = makeLogger();

    expect(
      buildAdminDraftExamUpdateDeps({
        exams: repository,
        examAuthoringCache: cache,
        diagnosticRecorder: recorder,
        logger,
      }),
    ).toEqual({
      repository,
      cache,
      diagnostics: recorder,
      logger,
    });
  });

  it("builds publish dependencies from composed services", () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const connections = makeConnections();
    const cloudshare = makeCloudShareFactory(makeAuthoringSource());
    const { recorder } = makeDiagnostics();
    const logger = makeLogger();

    expect(
      buildAdminExamPublishDeps({
        exams: repository,
        examAuthoringCache: cache,
        cloudshareConnections: connections,
        cloudshareClientFactory: cloudshare,
        diagnosticRecorder: recorder,
        logger,
      }),
    ).toEqual({
      repository,
      connections,
      cloudshare,
      cache,
      diagnostics: recorder,
      logger,
    });
  });

  it("builds unpublish dependencies from composed services", () => {
    const repository = createInMemoryExamCatalogRepository();
    const { recorder } = makeDiagnostics();
    const logger = makeLogger();

    expect(
      buildAdminExamUnpublishDeps({
        exams: repository,
        diagnosticRecorder: recorder,
        logger,
      }),
    ).toEqual({
      repository,
      diagnostics: recorder,
      logger,
    });
  });

  it("creates a draft exam and returns it", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnostics = makeDiagnostics();
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    await seedAuthoringCache(cache);

    const result = await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        diagnostics: diagnostics.recorder,
        audit,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
        newAuditId: () => "audit-exam-create-1",
      },
      {
        customerId: "customer-1",
        actor: adminActor,
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 5,
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
        openPeriodMinutes: 720,
        projectName: "Helios CX Project",
        allowedRegions: [
          { id: "region-1", name: "EU West" },
          { id: "region-2", name: "US East" },
        ],
        instructorId: "instructor-1",
        instructorName: "Helios Service Account",
      },
    });

    const [entry] = await diagnostics.repository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "exam.create",
    });
    expect(entry).toMatchObject({
      customerId: "customer-1",
      actor: adminActor,
      examId: "exam-1",
      operation: "exam.create",
      outcome: "success",
      subject: { type: "exam", id: "exam-1" },
      details: {
        changedFields: [
          "title",
          "description",
          "scoreRetrievalEnabled",
          "deliveryAvailability",
          "policyId",
          "openPeriodMinutes",
          "allowedRegions",
          "status",
        ],
      },
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-exam-create-1",
        customerId: "customer-1",
        actorType: "admin",
        actorId: "admin-1",
        actorEmail: "admin@helioscx.demo",
        action: "exam.created",
        subjectType: "exam",
        subjectId: "exam-1",
        outcome: "success",
        examId: "exam-1",
        details: {
          changedFields: [
            "title",
            "description",
            "scoreRetrievalEnabled",
            "deliveryAvailability",
            "policyId",
            "openPeriodMinutes",
            "allowedRegions",
            "status",
          ],
        },
      }),
    );
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
        actor: adminActor,
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "   ",
          timeLimitMinutes: 5,
          scoreRetrievalEnabled: true,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      exam: {
        id: "exam-1",
        description: "",
        timeLimitMinutes: 240,
        openPeriodMinutes: 720,
      },
    });
  });

  it("rejects draft creation when the allowed Region set is empty", async () => {
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
          allowedRegionIds: [],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "Select at least one allowed Region from the Blueprint default Snapshot.",
    });
  });

  it("rejects draft creation when the default snapshot is not deployed to any Regions", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);
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
          regionIds: [],
        },
      ],
    });

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
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "The selected Blueprint default Snapshot is not deployed to any Regions yet.",
    });
  });

  it("rejects draft creation when any selected Region is not supported by the default snapshot", async () => {
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
          allowedRegionIds: ["region-1", "region-3"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "Selected allowed Regions are not deployed for the Blueprint default Snapshot.",
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
          allowedRegionIds: ["region-1"],
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
          allowedRegionIds: ["region-1"],
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
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
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
          allowedRegionIds: ["region-1", "region-2"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    const publish = await handlePublishExam(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(makeAuthoringSource()),
        cache,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:30:00.000Z"),
      },
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
      activeExams: [
        expect.objectContaining({
          id: "exam-1",
          status: "published",
          scoreRetrievalEnabled: false,
        }),
      ],
      archivedExams: [],
    });
  });

  it("keeps archived Individual Exams out of the active catalog while returning them for history views", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
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
          title: "Active Exam",
          description: "Current catalog entry.",
          timeLimitMinutes: 90,
          scoreRetrievalEnabled: false,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          allowedRegionIds: ["region-1", "region-2"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
          deliveryAvailability: "individual",
        },
      },
    );
    await handlePublishExam(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(makeAuthoringSource()),
        cache,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:30:00.000Z"),
      },
      { customerId: "customer-1", examId: "exam-1" },
    );

    await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T13:00:00.000Z"),
        newId: () => "exam-2",
      },
      {
        customerId: "customer-1",
        body: {
          title: "Archived Exam",
          description: "Support-only entry.",
          timeLimitMinutes: 90,
          scoreRetrievalEnabled: false,
          projectId: "project-1",
          blueprintId: "bp-1",
          snapshotId: "snap-1",
          allowedRegionIds: ["region-1", "region-2"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
          deliveryAvailability: "individual",
        },
      },
    );
    await handlePublishExam(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(makeAuthoringSource()),
        cache,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T13:30:00.000Z"),
      },
      { customerId: "customer-1", examId: "exam-2" },
    );
    await handleArchiveExam(
      {
        repository,
        diagnostics,
        attempts: {
          listByExamId: vi.fn().mockResolvedValue([]),
        },
        audit: { write: vi.fn().mockResolvedValue(undefined) },
        logger: makeLogger(),
        now: () => new Date("2026-06-14T14:00:00.000Z"),
        newAuditId: () => "audit-archive-2",
      },
      {
        customerId: "customer-1",
        actor: {
          type: "admin",
          id: "admin-1",
          email: "admin@helioscx.demo",
        },
        examId: "exam-2",
        body: { confirmArchive: true },
      },
    );

    const catalog = await handleGetExamCatalog(
      { repository, logger: makeLogger() },
      { customerId: "customer-1" },
    );

    expect(catalog.status).toBe(200);
    expect(catalog.body).toEqual({
      activeExams: [
        expect.objectContaining({
          id: "exam-1",
          status: "published",
        }),
      ],
      archivedExams: [
        expect.objectContaining({
          id: "exam-2",
          status: "archived",
        }),
      ],
    });
  });

  it("rejects publish when current default Snapshot no longer supports the draft allowed Regions", async () => {
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
          allowedRegionIds: ["region-1", "region-2"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );
    const source = makeAuthoringSource({
      getBlueprintDetail: vi.fn().mockResolvedValue({
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
        defaultSnapshotId: "snap-1",
        snapshots: [
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
            regionIds: ["region-1"],
          },
        ],
      } satisfies CloudShareBlueprintDetail),
    });

    const publish = await handlePublishExam(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:30:00.000Z"),
      },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(publish.status).toBe(400);
    expect(publish.body).toEqual({
      error:
        "Selected allowed Regions are no longer deployed for the Blueprint default Snapshot. Refresh CloudShare authoring resources and reselect supported Regions.",
    });
    expect(source.getBlueprintDetail).toHaveBeenCalledWith("project-1", "bp-1");
    await expect(repository.findById("exam-1")).resolves.toMatchObject({ status: "draft" });
  });

  it("rejects publish when the current Blueprint default Snapshot changed", async () => {
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
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );
    const source = makeAuthoringSource({
      getBlueprintDetail: vi.fn().mockResolvedValue({
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
        defaultSnapshotId: "snap-2",
        snapshots: [
          { id: "snap-1", name: "Previous Snapshot", isDefault: false, regionIds: ["region-1"] },
          { id: "snap-2", name: "New Default Snapshot", isDefault: true, regionIds: ["region-2"] },
        ],
      } satisfies CloudShareBlueprintDetail),
    });

    const publish = await handlePublishExam(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:30:00.000Z"),
      },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(publish.status).toBe(400);
    expect(publish.body).toEqual({
      error:
        "The selected Blueprint default Snapshot has changed. Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
    });
    await expect(repository.findById("exam-1")).resolves.toMatchObject({ status: "draft" });
  });

  it("does not expose diagnostic-only blueprint detail metadata from publish-time cache refreshes", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await seedAuthoringCache(cache);
    const source = makeAuthoringSource();
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
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    const publish = await handlePublishExam(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:30:00.000Z"),
      },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(publish.status).toBe(200);

    const cachedDetail = await handleGetBlueprintDetail(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        logger: makeLogger(),
      },
      { customerId: "customer-1", projectId: "project-1", blueprintId: "bp-1", refresh: false },
    );

    expect(cachedDetail.status).toBe(200);
    expect(cachedDetail.body).toEqual({
      source: "cache",
      projectId: "project-1",
      blueprint: {
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
          { id: "snap-2", name: "Older Snapshot", isDefault: false, regionIds: ["region-3"] },
        ],
      },
    });
  });

  it("updates an existing draft exam", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnostics = makeDiagnostics();
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
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
    await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        diagnostics: diagnostics.recorder,
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
          allowedRegionIds: ["region-1"],
          policyId: "policy-1",
          openPeriodMinutes: 720,
        },
      },
    );

    const update = await handleUpdateDraftExam(
      {
        repository,
        cache,
        diagnostics: diagnostics.recorder,
        audit,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:45:00.000Z"),
        newAuditId: () => "audit-exam-update-1",
      },
      {
        customerId: "customer-1",
        actor: adminActor,
        examId: "exam-1",
        body: {
          title: "Helios Blueprint Exam",
          description: "Updated description.",
          timeLimitMinutes: 5,
          scoreRetrievalEnabled: true,
          allowedRegionIds: ["region-2"],
          policyId: "policy-2",
          openPeriodMinutes: 360,
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
        timeLimitMinutes: 120,
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
      customerId: "customer-1",
      examId: "exam-1",
      actor: adminActor,
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
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-exam-update-1",
        customerId: "customer-1",
        actorType: "admin",
        actorId: "admin-1",
        actorEmail: "admin@helioscx.demo",
        action: "exam.updated",
        subjectType: "exam",
        subjectId: "exam-1",
        outcome: "success",
        examId: "exam-1",
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
      }),
    );
  });

  it("unpublishes an existing published exam", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnostics = makeDiagnostics();
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    await seedAuthoringCache(cache);
    await handleCreateDraftExam(
      {
        repository,
        cache,
        instructor: configuredInstructor,
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        actor: adminActor,
        body: {
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 240,
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
    await handlePublishExam(
      {
        repository,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(makeAuthoringSource()),
        cache,
        diagnostics: diagnostics.recorder,
        audit,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:30:00.000Z"),
        newAuditId: () => "audit-exam-publish-1",
      },
      { customerId: "customer-1", actor: adminActor, examId: "exam-1" },
    );

    const unpublish = await handleUnpublishExam(
      {
        repository,
        diagnostics: diagnostics.recorder,
        audit,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:45:00.000Z"),
        newAuditId: () => "audit-exam-unpublish-1",
      },
      { customerId: "customer-1", actor: adminActor, examId: "exam-1" },
    );

    expect(unpublish.status).toBe(200);
    expect(unpublish.body).toMatchObject({
      exam: {
        id: "exam-1",
        status: "draft",
        publishedAt: null,
      },
    });

    const publishEntry = (
      await diagnostics.repository.query({
        customerId: "customer-1",
        examId: "exam-1",
        operation: "exam.publish",
      })
    )[0];
    expect(publishEntry).toMatchObject({
      customerId: "customer-1",
      examId: "exam-1",
      actor: adminActor,
      operation: "exam.publish",
      outcome: "success",
    });

    const blueprintDetailEntry = (
      await diagnostics.repository.query({
        customerId: "customer-1",
        operation: "cloudshare.resource_sync.blueprint_detail.read",
      })
    )[0];
    expect(blueprintDetailEntry).toMatchObject({
      customerId: "customer-1",
      operation: "cloudshare.resource_sync.blueprint_detail.read",
      outcome: "success",
      externalIds: {
        resourceType: "blueprint_detail",
        projectId: "project-1",
        blueprintId: "bp-1",
      },
      response: {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
        body: {
          id: "bp-1",
          name: "Helios Exam Blueprint",
          description: "Blueprint-backed description",
          type: "VmBlueprint",
          creationDate: "2026-06-14T11:00:00.000Z",
          resources: { ram: 16, cpu: 8 },
          numberOfMachines: 1,
          imageUrl: {
            path: "/bp-1.png",
            imageToken: "[REDACTED]",
          },
          createFromVersions: [
            {
              id: "snap-1",
              name: "Default Snapshot",
              isDefault: true,
              isLatest: true,
              type: "snapshot",
              regions: [{ id: "region-1" }, { id: "region-2" }],
              resources: { ram: 8, cpu: 4 },
              machines: [
                {
                  id: "machine-1",
                  name: "Primary VM",
                  osTypeName: "Windows Server 2022",
                  resources: { ram: 8, cpu: 4 },
                  isSaaS: false,
                  httpAccessEnabled: true,
                  resumeType: "resume",
                  bootOrder: 1,
                  canAddMultipleInstances: false,
                },
              ],
            },
            {
              id: "snap-2",
              name: "Older Snapshot",
              isDefault: false,
              isLatest: false,
              type: "snapshot",
              regions: [{ id: "region-3" }],
              resources: { ram: 4, cpu: 2 },
              machines: [],
            },
          ],
        },
      },
    });

    const unpublishEntry = (
      await diagnostics.repository.query({
        customerId: "customer-1",
        examId: "exam-1",
        operation: "exam.unpublish",
      })
    )[0];
    expect(unpublishEntry).toMatchObject({
      customerId: "customer-1",
      examId: "exam-1",
      actor: adminActor,
      operation: "exam.unpublish",
      outcome: "success",
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-exam-publish-1",
        customerId: "customer-1",
        actorType: "admin",
        actorId: "admin-1",
        actorEmail: "admin@helioscx.demo",
        action: "exam.published",
        subjectType: "exam",
        subjectId: "exam-1",
        outcome: "success",
        examId: "exam-1",
        details: { changedFields: ["status", "publishedAt"] },
      }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-exam-unpublish-1",
        customerId: "customer-1",
        actorType: "admin",
        actorId: "admin-1",
        actorEmail: "admin@helioscx.demo",
        action: "exam.unpublished",
        subjectType: "exam",
        subjectId: "exam-1",
        outcome: "success",
        examId: "exam-1",
        details: { changedFields: ["status", "publishedAt"] },
      }),
    );
  });
});
