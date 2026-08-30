import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalSession,
  mockHandleEnterSalesTrialOffering,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalSession: vi.fn(),
  mockHandleEnterSalesTrialOffering: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalSession: mockGetPortalSession,
}));

vi.mock("@/api/portal-auth", () => ({
  PORTAL_SESSION_COOKIE: "portal_session",
}));

vi.mock("@/api/sales-trial-enrollment", async () => {
  const actual = await vi.importActual<typeof import("./sales-trial-enrollment")>(
    "./sales-trial-enrollment",
  );
  return {
    ...actual,
    handleEnterSalesTrialOffering: mockHandleEnterSalesTrialOffering,
  };
});

import { GET } from "../../app/sales-trial/offerings/[offeringId]/enter/route";

describe("Sales Trial enter route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "sales-trial-session-1" }),
    });
    mockGetServices.mockReturnValue({
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      prisma: {},
      cloudshareConnections: {},
      cloudshareClientFactory: {},
      diagnosticRecorder: {},
      audit: {},
    });
  });

  it("redirects an authenticated Sales Trial participant through the server route without returning the sponsored link in the body", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "sales-trial-session-1",
      customerId: "customer-certalis",
      userId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      role: "sales_trial_participant",
      workspace: "sales",
    });
    mockHandleEnterSalesTrialOffering.mockResolvedValue({
      status: 302,
      redirect: "https://use.cloudshare.com/secret-sponsored-link",
    });

    const response = await GET(
      new Request("http://localhost:3025/sales-trial/offerings/offering-1/enter"),
      { params: Promise.resolve({ offeringId: "offering-1" }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://use.cloudshare.com/secret-sponsored-link");
    expect(await response.text()).toBe("");
    expect(mockHandleEnterSalesTrialOffering).toHaveBeenCalledWith(
      expect.objectContaining({
        connections: expect.any(Object),
        diagnostics: expect.any(Object),
        audit: expect.any(Object),
      }),
      expect.objectContaining({
        customerId: "customer-certalis",
        offeringId: "offering-1",
        participant: expect.objectContaining({
          userId: "trial-user-1",
          email: "visitor@example.test",
        }),
      }),
    );
  });

  it("returns a blocked fallback page for an ineligible launch without exposing the sponsored link", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "sales-trial-session-1",
      customerId: "customer-certalis",
      userId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      role: "sales_trial_participant",
      workspace: "sales",
    });
    mockHandleEnterSalesTrialOffering.mockResolvedValue({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: "corr-trial-1" },
    });

    const response = await GET(
      new Request("http://localhost:3025/sales-trial/offerings/offering-1/enter"),
      { params: Promise.resolve({ offeringId: "offering-1" }) },
    );
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Sales Trial entry unavailable");
    expect(html).toContain("window.opener.postMessage");
    expect(html).toContain("/sales-trial");
    expect(html).not.toContain("secret-sponsored-link");
  });

  it("rejects a non-Sales Trial session before calling the offering runtime", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "candidate-session-1",
      customerId: "customer-helios",
      userId: "candidate-1",
      email: "candidate@helioscx.demo",
      role: "candidate",
      workspace: "certification",
    });

    const response = await GET(
      new Request("http://localhost:3025/sales-trial/offerings/offering-1/enter"),
      { params: Promise.resolve({ offeringId: "offering-1" }) },
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized.");
    expect(mockHandleEnterSalesTrialOffering).not.toHaveBeenCalled();
  });
});
