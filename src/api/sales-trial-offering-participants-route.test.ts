import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { CloudShareTransportError } from "@/integrations/cloudshare/errors";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalAdminSession,
  mockCreateOfferingRepository,
  mockCreateEnrollmentRepository,
  mockCreateCloudShareSalesDelivery,
  mockHandleEndSalesTrialOffering,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalAdminSession: vi.fn(),
  mockCreateOfferingRepository: vi.fn(),
  mockCreateEnrollmentRepository: vi.fn(),
  mockCreateCloudShareSalesDelivery: vi.fn(),
  mockHandleEndSalesTrialOffering: vi.fn(),
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

vi.mock("@/persistence/prisma-sales-trial-enrollment-repository", () => ({
  createPrismaSalesTrialEnrollmentRepository: mockCreateEnrollmentRepository,
}));

vi.mock("@/integrations/cloudshare/sales-delivery", async () => {
  const actual =
    await vi.importActual<typeof import("@/integrations/cloudshare/sales-delivery")>(
      "@/integrations/cloudshare/sales-delivery",
    );
  return {
    ...actual,
    createCloudShareSalesDelivery: mockCreateCloudShareSalesDelivery,
  };
});

vi.mock("@/api/portal-auth", () => ({
  PORTAL_SESSION_COOKIE: "portal_session",
}));

vi.mock("@/api/sales-trial-offerings", () => ({
  handleEndSalesTrialOffering: mockHandleEndSalesTrialOffering,
}));

import { GET } from "../../app/api/sales/trial-offerings/[id]/participants/route";

describe("Sales Trial offering participants route", () => {
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
      cloudshareConnections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-certalis" }) },
      cloudshareClientFactory: { forConnection: vi.fn() },
      diagnosticRecorder,
      audit: { write: auditWrite },
    });
    mockCreateOfferingRepository.mockReturnValue({
      findById: vi.fn().mockResolvedValue({
        id: "offering-1",
        customerId: "customer-certalis",
        name: "Trial 1",
        status: "published",
        cloudShareSalesExperienceId: "sales-1",
        start: "2026-08-30T08:00:00.000Z",
        end: "2026-08-30T18:00:00.000Z",
        timeZone: "UTC",
        createdAt: new Date("2026-08-30T08:00:00.000Z"),
        updatedAt: new Date("2026-08-30T08:00:00.000Z"),
      }),
    });
    mockCreateEnrollmentRepository.mockReturnValue({
      listByOffering: vi.fn().mockResolvedValue([]),
    });
    mockHandleEndSalesTrialOffering.mockResolvedValue({
      status: 200,
      body: { offering: { id: "offering-1", status: "ended" } },
    });
  });

  it("returns admin monitoring participants for the sales workspace only", async () => {
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      userId: "admin-1",
      email: "sales-admin@certalis.demo",
      role: "admin",
      workspace: "sales",
    });
    mockCreateEnrollmentRepository.mockReturnValue({
      listByOffering: vi.fn().mockResolvedValue([
        {
          id: "enrollment-1",
          customerId: "customer-certalis",
          salesTrialOfferingId: "offering-1",
          portalUserId: "trial-user-1",
          email: "visitor@example.test",
          firstName: "Ari",
          lastName: "Visitor",
          cloudShareParticipantId: "remote-1",
          cloudShareRosterEnvironmentReference: "env-1",
          environmentStatus: "Ready",
          firstJoined: "2026-08-30T10:05:00.000Z",
          status: "active",
          attentionReason: null,
          lastLaunchedAt: null,
          lastReconciledAt: new Date("2026-08-30T10:05:00.000Z"),
          createdAt: new Date("2026-08-30T09:00:00.000Z"),
          updatedAt: new Date("2026-08-30T10:05:00.000Z"),
        },
      ]),
    });
    mockCreateCloudShareSalesDelivery.mockReturnValue({
      listParticipants: vi.fn().mockResolvedValue({
        participants: [
          {
            id: "remote-1",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            invitationStatus: "notSent",
            invitedBy: null,
            participationStatus: "inProgress",
            firstJoined: "2026-08-30T10:05:00.000Z",
            environmentId: "env-1",
            envStatus: "Ready",
            customProperties: {
              certalisSalesTrialEnrollmentId: "enrollment-1",
              certalisSalesTrialParticipantUserId: "trial-user-1",
            },
          },
        ],
        request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
        response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
      }),
    });

    const response = await GET(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants"),
      { params: Promise.resolve({ id: "offering-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      offering: {
        id: "offering-1",
        status: "published",
      },
      observation: {
        freshness: "live",
        source: "cloudshare_v4_sales_participant_roster",
        observedAt: "2026-08-30T10:05:00.000Z",
      },
      participants: [
        expect.objectContaining({
          id: "enrollment-1",
          email: "visitor@example.test",
        }),
      ],
      correlationId: expect.any(String),
    });
  });

  it("records protected provider diagnostics through the real route wiring when the roster read fails", async () => {
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      userId: "admin-1",
      email: "sales-admin@certalis.demo",
      role: "admin",
      workspace: "sales",
    });
    mockCreateCloudShareSalesDelivery.mockReturnValue({
      listParticipants: vi.fn().mockRejectedValue(
        new CloudShareTransportError("participant roster timed out", {
          method: "GET",
          path: "/sales/sales-1/participants",
          requestQuery: { offset: "0", limit: "100" },
          requestHeaders: { authorization: "Bearer secret", "x-request-id": "req-1" },
          cause: "ETIMEDOUT",
          transport: "tcp",
          network: { remoteAddress: "203.0.113.10" },
          tls: { protocol: "TLSv1.3", authorized: true },
        }),
      ),
    });

    const response = await GET(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants"),
      { params: Promise.resolve({ id: "offering-1" }) },
    );
    const body = await response.json();
    const [failure] = await diagnosticsRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.monitoring.read_participants",
      outcome: "failure",
    });

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: "Sales Trial participant monitoring is unavailable.",
      correlationId: expect.any(String),
    });
    expect(failure).toMatchObject({
      customerId: "customer-certalis",
      correlationId: body.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/sales/sales-1/participants",
        query: { offset: "0", limit: "100" },
        headers: { authorization: "[REDACTED]", "x-request-id": "req-1" },
      }),
      response: expect.objectContaining({
        transport: "tcp",
        network: { remoteAddress: "203.0.113.10" },
        tls: { protocol: "TLSv1.3", authorized: true },
      }),
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales.participants",
        attemptedOperation: "list_participants",
      }),
    });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.monitoring.read_participants",
        correlationId: body.correlationId,
        outcome: "failure",
      }),
    );
  });

  it("keeps participant monitoring available when the route-end reconciliation moves an offering from ending to ended", async () => {
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      userId: "admin-1",
      email: "sales-admin@certalis.demo",
      role: "admin",
      workspace: "sales",
    });
    const findById = vi.fn()
      .mockResolvedValueOnce({
        id: "offering-1",
        customerId: "customer-certalis",
        name: "Trial 1",
        status: "ending",
        cloudShareSalesExperienceId: "sales-1",
        start: "2026-08-30T08:00:00.000Z",
        end: "2026-08-30T18:00:00.000Z",
        timeZone: "UTC",
        createdAt: new Date("2026-08-30T08:00:00.000Z"),
        updatedAt: new Date("2026-08-30T08:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "offering-1",
        customerId: "customer-certalis",
        name: "Trial 1",
        status: "ended",
        cloudShareSalesExperienceId: "sales-1",
        start: "2026-08-30T08:00:00.000Z",
        end: "2026-08-30T18:00:00.000Z",
        timeZone: "UTC",
        createdAt: new Date("2026-08-30T08:00:00.000Z"),
        updatedAt: new Date("2026-08-30T18:01:00.000Z"),
      });
    mockCreateOfferingRepository.mockReturnValue({ findById });
    mockCreateEnrollmentRepository.mockReturnValue({
      listByOffering: vi.fn().mockResolvedValue([
        {
          id: "enrollment-1",
          customerId: "customer-certalis",
          salesTrialOfferingId: "offering-1",
          portalUserId: "trial-user-1",
          email: "visitor@example.test",
          firstName: "Ari",
          lastName: "Visitor",
          cloudShareParticipantId: "remote-1",
          cloudShareRosterEnvironmentReference: "env-1",
          environmentStatus: "Ready",
          firstJoined: "2026-08-30T10:05:00.000Z",
          status: "active",
          attentionReason: null,
          lastLaunchedAt: new Date("2026-08-30T10:05:00.000Z"),
          lastReconciledAt: new Date("2026-08-30T10:05:00.000Z"),
          createdAt: new Date("2026-08-30T09:00:00.000Z"),
          updatedAt: new Date("2026-08-30T10:05:00.000Z"),
        },
      ]),
    });
    mockCreateCloudShareSalesDelivery.mockReturnValue({
      listParticipants: vi.fn().mockResolvedValue({
        participants: [
          {
            id: "remote-1",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            invitationStatus: "notSent",
            invitedBy: null,
            participationStatus: "inProgress",
            firstJoined: "2026-08-30T10:05:00.000Z",
            environmentId: "env-1",
            envStatus: "Ready",
            customProperties: {
              certalisSalesTrialEnrollmentId: "enrollment-1",
              certalisSalesTrialParticipantUserId: "trial-user-1",
            },
          },
        ],
        request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
        response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
      }),
    });

    const response = await GET(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants"),
      { params: Promise.resolve({ id: "offering-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      offering: { status: "ended" },
      participants: [expect.objectContaining({ id: "enrollment-1" })],
    });
    expect(findById).toHaveBeenCalledTimes(2);
    expect(mockHandleEndSalesTrialOffering).toHaveBeenCalledOnce();
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

    const response = await GET(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants"),
      { params: Promise.resolve({ id: "offering-1" }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mockCreateCloudShareSalesDelivery).not.toHaveBeenCalled();
  });
});
