import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { CloudShareTransportError } from "@/integrations/cloudshare/errors";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalAdminSession,
  mockCreateOfferingRepository,
  mockCreateItemRepository,
  mockCreateEnrollmentRepository,
  mockCreateCloudShareSalesEnvironmentSource,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalAdminSession: vi.fn(),
  mockCreateOfferingRepository: vi.fn(),
  mockCreateItemRepository: vi.fn(),
  mockCreateEnrollmentRepository: vi.fn(),
  mockCreateCloudShareSalesEnvironmentSource: vi.fn(),
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

vi.mock("@/persistence/prisma-sales-trial-offering-repository", () => ({
  createPrismaSalesTrialOfferingRepository: mockCreateOfferingRepository,
}));

vi.mock("@/persistence/prisma-item-repository", () => ({
  createPrismaItemRepository: mockCreateItemRepository,
}));

vi.mock("@/persistence/prisma-sales-trial-enrollment-repository", () => ({
  createPrismaSalesTrialEnrollmentRepository: mockCreateEnrollmentRepository,
}));

vi.mock("@/integrations/cloudshare/sales-environment", async () => {
  const actual =
    await vi.importActual<typeof import("@/integrations/cloudshare/sales-environment")>(
      "@/integrations/cloudshare/sales-environment",
    );
  return {
    ...actual,
    createCloudShareSalesEnvironmentSource: mockCreateCloudShareSalesEnvironmentSource,
  };
});

vi.mock("@/api/portal-auth", () => ({
  PORTAL_SESSION_COOKIE: "portal_session",
}));

import { POST } from "../../app/api/sales/trial-offerings/[id]/participants/[participantId]/extend/route";

describe("Sales Trial participant extend route", () => {
  const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
  const diagnosticRecorder = createDiagnosticRecorder({ repository: diagnosticsRepository });
  const auditWrite = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    diagnosticsRepository.reset();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetServices.mockReturnValue({
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      prisma: {},
      cloudshareConnections: {
        findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-certalis" }),
      },
      cloudshareClientFactory: { forConnection: vi.fn() },
      diagnosticRecorder,
      audit: { write: auditWrite },
    });
    mockCreateOfferingRepository.mockReturnValue({
      findById: vi.fn().mockResolvedValue({
        id: "offering-1",
        customerId: "customer-certalis",
        title: "Trial 1",
        itemId: "item-1",
        status: "ended",
        cloudShareSalesExperienceId: "sales-1",
        start: "2026-08-30T08:00:00.000Z",
        end: "2026-08-30T18:00:00.000Z",
        timeZone: "UTC",
        createdAt: new Date("2026-08-30T08:00:00.000Z"),
        updatedAt: new Date("2026-08-30T08:00:00.000Z"),
      }),
    });
    mockCreateItemRepository.mockReturnValue({
      findById: vi.fn().mockResolvedValue({
        id: "item-1",
        customerId: "customer-certalis",
        name: "Trial Item",
        description: "",
        project: { id: "project-1", name: "Project 1" },
        blueprints: [{ id: "bp-1", name: "Blueprint 1" }],
        policy: { id: "policy-1", name: "Policy 1" },
        regions: [{ id: "region-1", name: "Region 1" }],
        defaultDurationMinutes: 60,
        status: "active",
        archivedAt: null,
        createdAt: new Date("2026-08-30T08:00:00.000Z"),
        updatedAt: new Date("2026-08-30T08:00:00.000Z"),
      }),
    });
    mockCreateEnrollmentRepository.mockReturnValue({
      save: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue({
        id: "enrollment-1",
        customerId: "customer-certalis",
        salesTrialOfferingId: "offering-1",
        portalUserId: "trial-user-1",
        email: "visitor@example.test",
        firstName: "Ari",
        lastName: "Visitor",
        cloudShareParticipantId: "remote-1",
        invitationStatus: "sent",
        participationStatus: "inProgress",
        cloudShareRosterEnvironmentReference: "roster-env-1",
        environmentStatus: "Archived",
        observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
        firstJoined: "2026-08-30T10:05:00.000Z",
        status: "active",
        attentionReason: null,
        lastLaunchedAt: new Date("2026-08-30T10:05:00.000Z"),
        lastReconciledAt: new Date("2026-08-30T10:05:00.000Z"),
        createdAt: new Date("2026-08-30T09:00:00.000Z"),
        updatedAt: new Date("2026-08-30T10:05:00.000Z"),
      }),
    });
    mockCreateCloudShareSalesEnvironmentSource.mockReturnValue({
      extendById: vi.fn().mockResolvedValue({
        environmentId: "opaque-v3-env-1",
        exchange: {
          request: { method: "PUT", path: "/api/v3/envs/actions/extend", query: { envId: "opaque-v3-env-1" } },
          response: { status: 200, body: "" },
        },
      }),
      observe: vi.fn().mockResolvedValue({
        environmentId: "opaque-v3-env-1",
        statusCode: 4,
        expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
        exchanges: [
          {
            request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
            response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
          },
          {
            request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
            response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
          },
        ],
      }),
      observeById: vi
        .fn()
        .mockResolvedValueOnce({
          environmentId: "opaque-v3-env-1",
          statusCode: 4,
          expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
          exchanges: [
            {
              request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
              response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" } },
            },
          ],
        }),
    });
  });

  it("extends a retained environment for the sales workspace and keeps the response non-disclosing", async () => {
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      userId: "admin-1",
      email: "sales-admin@certalis.demo",
      role: "admin",
      workspace: "sales",
    });

    const response = await POST(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants/enrollment-1/extend", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "offering-1", participantId: "enrollment-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      participant: expect.objectContaining({
        id: "enrollment-1",
        envStatus: "Archived",
      }),
      correlationId: expect.any(String),
    });
  });

  it("records protected provider diagnostics through the real route wiring when extend readback is unavailable", async () => {
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      userId: "admin-1",
      email: "sales-admin@certalis.demo",
      role: "admin",
      workspace: "sales",
    });
    mockCreateCloudShareSalesEnvironmentSource.mockReturnValue({
      extendById: vi.fn().mockResolvedValue({
        environmentId: "opaque-v3-env-1",
        exchange: {
          request: { method: "PUT", path: "/api/v3/envs/actions/extend", query: { envId: "opaque-v3-env-1" } },
          response: { status: 200, body: "" },
        },
      }),
      observe: vi.fn().mockResolvedValue({
        environmentId: "opaque-v3-env-1",
        statusCode: 4,
        expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
        exchanges: [
          {
            request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
            response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
          },
          {
            request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
            response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
          },
        ],
      }),
      observeById: vi
        .fn()
        .mockRejectedValueOnce(
          new CloudShareTransportError("getextended timed out", {
            method: "GET",
            path: "/api/v3/envs/actions/getextended",
            requestQuery: { envId: "opaque-v3-env-1" },
            requestHeaders: { authorization: "cs_sha1 secret", "x-request-id": "req-1" },
            cause: "ETIMEDOUT",
            transport: "tcp",
          }),
        ),
    });

    const response = await POST(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants/enrollment-1/extend", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "offering-1", participantId: "enrollment-1" }) },
    );
    const body = await response.json();
    const [failure] = await diagnosticsRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: "Sales Trial environment extension could not be confirmed.",
      correlationId: expect.any(String),
    });
    expect(failure).toMatchObject({
      correlationId: body.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/api/v3/envs/actions/getextended",
        query: { envId: "opaque-v3-env-1" },
        headers: { authorization: "[REDACTED]", "x-request-id": "req-1" },
      }),
      details: expect.objectContaining({
        attemptedOperation: "observe_extended_environment",
        exchangeCount: 4,
      }),
    });
  });

  it("rejects an unauthenticated or participant caller before any provider access", async () => {
    mockGetPortalAdminSession.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants/enrollment-1/extend", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "offering-1", participantId: "enrollment-1" }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mockCreateCloudShareSalesEnvironmentSource).not.toHaveBeenCalled();
  });

  it("fails closed for a customer-scoped enrollment mismatch without disclosing provider identifiers", async () => {
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      userId: "admin-1",
      email: "sales-admin@certalis.demo",
      role: "admin",
      workspace: "sales",
    });
    mockCreateEnrollmentRepository.mockReturnValue({
      save: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue(null),
      listByOffering: vi.fn().mockResolvedValue([]),
    });

    const response = await POST(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants/enrollment-1/extend", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "offering-1", participantId: "enrollment-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "This Sales Trial environment cannot be extended.",
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("env-1");
    expect(mockCreateCloudShareSalesEnvironmentSource).not.toHaveBeenCalled();
  });

  it("rejects a non-sales admin session", async () => {
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      userId: "admin-1",
      email: "admin@helioscx.demo",
      role: "admin",
      workspace: "certification",
    });

    const response = await POST(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants/enrollment-1/extend", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "offering-1", participantId: "enrollment-1" }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mockCreateCloudShareSalesEnvironmentSource).not.toHaveBeenCalled();
  });
});
