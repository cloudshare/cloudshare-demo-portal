import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalAdminSession,
  mockHandleListSalesTrialOfferingParticipants,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalAdminSession: vi.fn(),
  mockHandleListSalesTrialOfferingParticipants: vi.fn(),
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

vi.mock("@/api/sales-trial-enrollment", () => ({
  handleListSalesTrialOfferingParticipants: mockHandleListSalesTrialOfferingParticipants,
}));

vi.mock("@/api/portal-auth", () => ({
  PORTAL_SESSION_COOKIE: "portal_session",
}));

import { GET } from "../../app/api/sales/trial-offerings/[id]/participants/route";

describe("Sales Trial offering participants route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetServices.mockReturnValue({
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      prisma: {},
      cloudshareConnections: {},
      cloudshareClientFactory: {},
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
    mockHandleListSalesTrialOfferingParticipants.mockResolvedValue({
      status: 200,
      body: {
        participants: [
          {
            id: "enrollment-1",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            participationStatus: "inProgress",
            firstJoined: "2026-08-30T10:05:00.000Z",
            envStatus: "Ready",
            environment: {
              dimension: "cloudshare_environment",
              value: "Ready",
              source: "cloudshare_v4_sales_participant_roster",
            },
          },
        ],
      },
    });

    const response = await GET(
      new Request("http://localhost:3025/api/sales/trial-offerings/offering-1/participants"),
      { params: Promise.resolve({ id: "offering-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      participants: [
        expect.objectContaining({
          id: "enrollment-1",
          email: "visitor@example.test",
        }),
      ],
    });
    expect(mockHandleListSalesTrialOfferingParticipants).toHaveBeenCalledWith(
      expect.objectContaining({
        connections: expect.any(Object),
      }),
      {
        customerId: "customer-certalis",
        offeringId: "offering-1",
        actor: {
          type: "admin",
          id: "admin-1",
          email: "sales-admin@certalis.demo",
        },
      },
    );
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
    expect(mockHandleListSalesTrialOfferingParticipants).not.toHaveBeenCalled();
  });
});
