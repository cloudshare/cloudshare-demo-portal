import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getBootstrap } from "../../app/api/admin/exam-authoring/route";
import { GET as getProjectResources } from "../../app/api/admin/exam-authoring/projects/[projectId]/route";
import { GET as getBlueprintDetail } from "../../app/api/admin/exam-authoring/projects/[projectId]/blueprints/[blueprintId]/route";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import type { CloudShareExamAuthoringSource } from "@/integrations/cloudshare/resources";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalAdminSession,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalAdminSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalAdminSession: mockGetPortalAdminSession,
}));

function makeConnection(): CloudShareConnectionRecord {
  return {
    customerId: "customer-helios",
    apiId: "api-id",
    apiKey: "api-key",
    webhookSecret: "webhook-secret",
    webhookPathToken: "whk-helios",
    connectedAt: new Date("2026-06-14T00:00:00.000Z"),
    verifiedAt: null,
  };
}

function makeAuthoringSource(): CloudShareExamAuthoringSource {
  return {
    listProjects: vi.fn().mockResolvedValue([{ id: "project-1", name: "Helios Project" }]),
    listRegions: vi.fn().mockResolvedValue([
      { id: "region-1", name: "eu-west", friendlyName: "EU West" },
    ]),
    listProjectBlueprints: vi.fn().mockResolvedValue([
      { id: "bp-1", name: "Helios Blueprint", description: "Blueprint-backed description" },
    ]),
    listProjectPolicies: vi.fn().mockResolvedValue([
      { id: "policy-1", name: "Timed Policy", runtimeLeaseMinutes: 240 },
    ]),
    getBlueprintDetail: vi.fn().mockResolvedValue({
      id: "bp-1",
      name: "Helios Blueprint",
      description: "Blueprint-backed description",
      defaultSnapshotId: "snap-1",
      diagnosticSummary: {
        blueprintId: "bp-1",
        name: "Helios Blueprint",
        description: "Blueprint-backed description",
        type: "VmBlueprint",
        defaultSnapshotId: "snap-1",
        snapshotCount: 1,
        imageUrl: { present: false },
        snapshots: [
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
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
          regionIds: ["region-1"],
        },
      ],
    }),
  };
}

describe("admin exam authoring routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });
  });

  it("records bootstrap project and region diagnostics through the real route path", async () => {
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnosticRecorder = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["api-id", "api-key"],
    });
    const cloudshareClient = makeAuthoringSource();

    mockGetServices.mockReturnValue({
      cloudshareConnections: {
        save: vi.fn(),
        findByCustomerId: vi.fn().mockResolvedValue(makeConnection()),
        findByWebhookPathToken: vi.fn(),
        markVerified: vi.fn(),
      },
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue(cloudshareClient),
      },
      examAuthoringCache: createInMemoryExamAuthoringCacheRepository(),
      diagnosticRecorder,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const response = await getBootstrap(
      new Request("http://localhost/api/admin/exam-authoring?refresh=true"),
    );

    expect(response.status).toBe(200);

    const entries = await diagnosticsRepository.query({
      customerId: "customer-helios",
    });
    expect(entries.map((entry) => entry.operation).sort()).toEqual([
      "cloudshare.resource_sync.projects.read",
      "cloudshare.resource_sync.regions.read",
    ]);
  });

  it("records project blueprint and policy diagnostics through the real route path", async () => {
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnosticRecorder = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["api-id", "api-key"],
    });
    const cloudshareClient = makeAuthoringSource();

    mockGetServices.mockReturnValue({
      cloudshareConnections: {
        save: vi.fn(),
        findByCustomerId: vi.fn().mockResolvedValue(makeConnection()),
        findByWebhookPathToken: vi.fn(),
        markVerified: vi.fn(),
      },
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue(cloudshareClient),
      },
      examAuthoringCache: createInMemoryExamAuthoringCacheRepository(),
      diagnosticRecorder,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const response = await getProjectResources(
      new Request("http://localhost/api/admin/exam-authoring/projects/project-1?refresh=true"),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(200);

    const entries = await diagnosticsRepository.query({
      customerId: "customer-helios",
    });
    expect(entries.map((entry) => entry.operation).sort()).toEqual([
      "cloudshare.resource_sync.blueprints.read",
      "cloudshare.resource_sync.policies.read",
    ]);
    expect(entries.find((entry) => entry.operation === "cloudshare.resource_sync.blueprints.read")).toMatchObject({
      request: { method: "GET", path: "/projects/project-1/blueprints" },
      externalIds: { resourceType: "blueprint", projectId: "project-1" },
    });
    expect(entries.find((entry) => entry.operation === "cloudshare.resource_sync.policies.read")).toMatchObject({
      request: { method: "GET", path: "/projects/project-1/policies" },
      externalIds: { resourceType: "policy", projectId: "project-1" },
    });
  });

  it("records blueprint-detail diagnostics through the real route path", async () => {
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnosticRecorder = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["api-id", "api-key"],
    });
    const cloudshareClient = makeAuthoringSource();

    mockGetServices.mockReturnValue({
      cloudshareConnections: {
        save: vi.fn(),
        findByCustomerId: vi.fn().mockResolvedValue(makeConnection()),
        findByWebhookPathToken: vi.fn(),
        markVerified: vi.fn(),
      },
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue(cloudshareClient),
      },
      examAuthoringCache: createInMemoryExamAuthoringCacheRepository(),
      diagnosticRecorder,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const response = await getBlueprintDetail(
      new Request(
        "http://localhost/api/admin/exam-authoring/projects/project-1/blueprints/bp-1?refresh=true",
      ),
      { params: Promise.resolve({ projectId: "project-1", blueprintId: "bp-1" }) },
    );

    expect(response.status).toBe(200);

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-helios",
      operation: "cloudshare.resource_sync.blueprint_detail.read",
    });
    expect(entry).toMatchObject({
      request: { method: "GET", path: "/projects/project-1/blueprints/bp-1" },
      response: {
        blueprintId: "bp-1",
        name: "Helios Blueprint",
        description: "Blueprint-backed description",
        type: "VmBlueprint",
        defaultSnapshotId: "snap-1",
        snapshotCount: 1,
        imageUrl: { present: false },
        snapshots: [
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
            machineCount: 0,
            machines: [],
          },
        ],
      },
      externalIds: {
        resourceType: "blueprint_detail",
        projectId: "project-1",
        blueprintId: "bp-1",
      },
    });
  });
});
