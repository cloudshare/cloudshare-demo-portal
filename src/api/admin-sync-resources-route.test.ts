import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/admin/sync-resources/route";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import type { CloudShareClient } from "@/integrations/cloudshare";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryResourceRepository } from "@/persistence/resource-repository";

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

function makeCloudShareClient(): CloudShareClient {
  return {
    requestV3: vi.fn().mockImplementation(({ path }: { path: string }) => {
      if (path === "/projects") {
        return Promise.resolve([{ id: "project-1", name: "Helios Project" }]);
      }
      if (path === "/regions") {
        return Promise.resolve([{ id: "region-1", name: "EU West" }]);
      }
      if (path === "/projects/project-1/blueprints") {
        return Promise.resolve([{ id: "bp-1", name: "Helios Blueprint" }]);
      }
      if (path === "/projects/project-1/policies") {
        return Promise.resolve([{ id: "policy-1", name: "Timed Policy" }]);
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    }),
    requestV4: vi.fn(),
    requestV3Text: vi.fn(),
  };
}

describe("admin sync resources route", () => {
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

  it("persists legacy resource-sync diagnostics for each underlying CloudShare read from the real route path", async () => {
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnosticRecorder = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["api-id", "api-key"],
    });
    const cloudshareClient = makeCloudShareClient();

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
      resources: createInMemoryResourceRepository(),
      diagnosticRecorder,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ synced: 4 });

    const entries = await diagnosticsRepository.query({
      customerId: "customer-helios",
    });

    expect(entries.map((entry) => entry.operation).sort()).toEqual([
      "cloudshare.resource_sync.blueprints.read",
      "cloudshare.resource_sync.legacy_sync.read",
      "cloudshare.resource_sync.policies.read",
      "cloudshare.resource_sync.projects.read",
      "cloudshare.resource_sync.regions.read",
    ]);

    expect(entries.find((entry) => entry.operation === "cloudshare.resource_sync.projects.read")).toMatchObject({
      customerId: "customer-helios",
      source: "admin",
      operation: "cloudshare.resource_sync.projects.read",
      outcome: "success",
      request: { method: "GET", path: "/projects" },
      response: { itemCount: 1, resourceIds: ["project-1"] },
      details: { integrationSurface: "cloudshare.v3.projects" },
      externalIds: { resourceType: "project" },
    });
    expect(entries.find((entry) => entry.operation === "cloudshare.resource_sync.regions.read")).toMatchObject({
      customerId: "customer-helios",
      source: "admin",
      operation: "cloudshare.resource_sync.regions.read",
      outcome: "success",
      request: { method: "GET", path: "/regions" },
      response: { itemCount: 1, resourceIds: ["region-1"] },
      details: { integrationSurface: "cloudshare.v3.regions" },
      externalIds: { resourceType: "region" },
    });
    expect(entries.find((entry) => entry.operation === "cloudshare.resource_sync.blueprints.read")).toMatchObject({
      customerId: "customer-helios",
      source: "admin",
      operation: "cloudshare.resource_sync.blueprints.read",
      outcome: "success",
      request: { method: "GET", path: "/projects/project-1/blueprints" },
      response: { itemCount: 1, resourceIds: ["bp-1"] },
      details: { integrationSurface: "cloudshare.v3.projects.blueprints" },
      externalIds: { resourceType: "blueprint", projectId: "project-1" },
    });
    expect(entries.find((entry) => entry.operation === "cloudshare.resource_sync.policies.read")).toMatchObject({
      customerId: "customer-helios",
      source: "admin",
      operation: "cloudshare.resource_sync.policies.read",
      outcome: "success",
      request: { method: "GET", path: "/projects/project-1/policies" },
      response: { itemCount: 1, resourceIds: ["policy-1"] },
      details: { integrationSurface: "cloudshare.v3.projects.policies" },
      externalIds: { resourceType: "policy", projectId: "project-1" },
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-helios",
      operation: "cloudshare.resource_sync.legacy_sync.read",
    });
    expect(entry).toMatchObject({
      customerId: "customer-helios",
      source: "admin",
      operation: "cloudshare.resource_sync.legacy_sync.read",
      outcome: "success",
      request: { method: "POST", path: "/api/admin/sync-resources" },
      response: {
        synced: 4,
        resourceCounts: { project: 1, region: 1, blueprint: 1, policy: 1 },
      },
      externalIds: { resourceType: "resource_sync" },
    });
  });
});
