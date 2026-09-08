import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ forConnection: vi.fn().mockReturnValue({}), createSource: vi.fn().mockReturnValue({}), handle: vi.fn() }));
vi.mock("@/composition", () => ({ getServices: () => ({ ensurePortalSeeded: vi.fn(), cloudshareClientFactory: { forConnection: mocks.forConnection }, cloudshareConnections: {}, prisma: {}, diagnosticRecorder: {}, audit: {} }) }));
vi.mock("@/auth/portal-session", () => ({ getPortalAdminSession: vi.fn().mockResolvedValue({ workspace: "sales", customerId: "customer-a", userId: "admin-a", email: "admin@example.test" }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue({ value: "session" }) }) }));
vi.mock("@/persistence/prisma-sales-timezone-repository", () => ({ createPrismaSalesAdminPreferenceRepository: vi.fn().mockReturnValue({}), createPrismaSalesTimezoneCacheRepository: vi.fn().mockReturnValue({}) }));
vi.mock("@/integrations/cloudshare/timezones", () => ({ createCloudShareTimezoneSource: mocks.createSource }));
vi.mock("@/api/sales-timezones", () => ({ handleGetSalesTimezones: mocks.handle, handleSaveSalesPreference: vi.fn() }));

import { GET } from "../../app/api/sales/timezones/route";

describe("Sales timezones Next route", () => {
  it("passes the dedicated preflight reason to the CloudShare client", async () => {
    mocks.handle.mockImplementation(async (deps: { timezoneSourceFactory: { forConnection: (connection: unknown) => unknown } }) => {
      deps.timezoneSourceFactory.forConnection({ customerId: "customer-a" });
      return { status: 200, body: { timezones: [] } };
    });
    await GET();
    expect(mocks.forConnection).toHaveBeenCalledWith({ customerId: "customer-a" }, { scope: "customer_default", reason: "sales_timezone_preflight" });
  });
});
