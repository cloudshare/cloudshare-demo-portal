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

  it("persists legacy resource-sync diagnostics from the real route path", async () => {
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
    expect(await response.json()).toMatchObject({ synced: 2 });

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
        synced: 2,
        resourceCounts: { project: 1, region: 1, blueprint: 0, policy: 0 },
      },
      externalIds: { resourceType: "resource_sync" },
    });
  });
});
