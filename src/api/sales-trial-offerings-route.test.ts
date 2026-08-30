import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalSession,
  mockCreateOfferingRepository,
  mockHandleListPublishedSalesTrialOfferings,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalSession: vi.fn(),
  mockCreateOfferingRepository: vi.fn(),
  mockHandleListPublishedSalesTrialOfferings: vi.fn(),
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

vi.mock("@/persistence/prisma-sales-trial-offering-repository", () => ({
  createPrismaSalesTrialOfferingRepository: mockCreateOfferingRepository,
}));

vi.mock("@/api/sales-trial-offerings", () => ({
  handleListPublishedSalesTrialOfferings: mockHandleListPublishedSalesTrialOfferings,
}));

import { GET } from "../../app/api/sales-trial/offerings/route";

describe("Sales Trial Offering publish route composition", () => {
  it("passes CloudShare delivery, validator, and project-member factories into publication", () => {
    const routeSource = readFileSync(
      "app/api/sales/trial-offerings/[id]/publish/route.ts",
      "utf8",
    );

    expect(routeSource).toContain("deliveryFactory");
    expect(routeSource).toContain("itemProvisioningValidatorFactory");
    expect(routeSource).toContain("projectMemberSourceFactory");
    expect(routeSource).toContain("createCloudShareSalesDelivery");
    expect(routeSource).toContain("createCloudShareSalesItemProvisioningValidator");
    expect(routeSource).toContain("createCloudShareProjectMemberSource");
  });
});

describe("Sales Trial Offering unpublish route composition", () => {
  it("passes diagnostics and the audit writer into unpublication", () => {
    const routeSource = readFileSync(
      "app/api/sales/trial-offerings/[id]/unpublish/route.ts",
      "utf8",
    );

    expect(routeSource).toContain("diagnostics: services.diagnosticRecorder");
    expect(routeSource).toContain("audit: services.audit");
  });
});

describe("Sales Trial Offering end route composition", () => {
  it("passes CloudShare delivery, diagnostics, and the audit writer into end-trial handling", () => {
    const routeSource = readFileSync(
      "app/api/sales/trial-offerings/[id]/end/route.ts",
      "utf8",
    );

    expect(routeSource).toContain("handleEndSalesTrialOffering");
    expect(routeSource).toContain("deliveryFactory");
    expect(routeSource).toContain("createCloudShareSalesDelivery");
    expect(routeSource).toContain("diagnostics: services.diagnosticRecorder");
    expect(routeSource).toContain("audit: services.audit");
  });
});

describe("sales trial offerings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetServices.mockReturnValue({
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      prisma: {},
    });
    mockCreateOfferingRepository.mockReturnValue({ repository: "offerings" });
  });

  it("returns uncached unauthorized responses", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns uncached participant offerings scoped to the signed-in sales trial participant", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      userId: "trial-user-1",
      email: "visitor@example.test",
      role: "sales_trial_participant",
      workspace: "sales",
    });
    mockHandleListPublishedSalesTrialOfferings.mockResolvedValue({
      status: 200,
      body: {
        offerings: [
          {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            start: "2026-08-30T20:42",
            end: "2026-08-30T21:42",
            timeZone: "UTC",
          },
        ],
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockHandleListPublishedSalesTrialOfferings).toHaveBeenCalledWith(
      { offerings: { repository: "offerings" } },
      { customerId: "customer-certalis" },
    );
    await expect(response.json()).resolves.toEqual({
      offerings: [
        {
          id: "offering-1",
          title: "Helios Trial",
          description: "Shared trial",
          start: "2026-08-30T20:42",
          end: "2026-08-30T21:42",
          timeZone: "UTC",
        },
      ],
    });
  });
});
