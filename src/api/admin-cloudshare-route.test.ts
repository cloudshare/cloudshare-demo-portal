import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "../../app/api/admin/cloudshare/route";

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

describe("admin CloudShare route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
  });

  it("saves the Helios CX CloudShare Connection through the admin API route", async () => {
    const save = vi.fn(async (connection) => ({
      ...connection,
      connectedAt: new Date("2026-06-13T20:30:00.000Z"),
      verifiedAt: null,
    }));

    mockGetServices.mockReturnValue({
      cloudshareConnections: { save, findByCustomerId: vi.fn().mockResolvedValue(null) },
      cloudshareClientFactory: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    const response = await PUT(
      new Request("http://localhost:3000/api/admin/cloudshare", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiId: "  api-id  ",
          apiKey: "  api-key  ",
          webhookSecret: "  whsec  ",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hasConnection: true,
      connectedAt: "2026-06-13T20:30:00.000Z",
      verifiedAt: null,
    });
    expect(save).toHaveBeenCalledWith({
      customerId: "customer-helios",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "whsec",
    });
  });

  it("preserves existing saved fields when a later admin update only changes one value", async () => {
    const existingConnection = {
      customerId: "customer-helios",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "whsec",
      connectedAt: new Date("2026-06-13T20:30:00.000Z"),
      verifiedAt: null,
    };
    const findByCustomerId = vi
      .fn()
      .mockResolvedValueOnce(existingConnection)
      .mockResolvedValueOnce({
        ...existingConnection,
        apiKey: "new-api-key",
      });
    const save = vi.fn(async (connection) => ({
      ...existingConnection,
      ...connection,
      connectedAt: new Date("2026-06-13T20:30:00.000Z"),
      verifiedAt: null,
    }));

    mockGetServices.mockReturnValue({
      cloudshareConnections: { save, findByCustomerId },
      cloudshareClientFactory: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    const response = await PUT(
      new Request("http://localhost:3000/api/admin/cloudshare", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiId: "",
          apiKey: " new-api-key ",
          webhookSecret: "",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith({
      customerId: "customer-helios",
      apiId: "api-id",
      apiKey: "new-api-key",
      webhookSecret: "whsec",
    });
  });

  it("clears cached authoring resources through the real PUT route after saving a connection", async () => {
    const cache = {
      clearCustomer: vi.fn().mockResolvedValue(undefined),
    };
    const save = vi.fn(async (connection) => ({
      ...connection,
      connectedAt: new Date("2026-06-13T20:30:00.000Z"),
      verifiedAt: null,
    }));

    mockGetServices.mockReturnValue({
      cloudshareConnections: { save, findByCustomerId: vi.fn().mockResolvedValue(null) },
      cloudshareClientFactory: {},
      examAuthoringCache: cache,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
    mockGetPortalAdminSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    const response = await PUT(
      new Request("http://localhost:3000/api/admin/cloudshare", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiId: "api-id",
          apiKey: "api-key",
          webhookSecret: "whsec",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(cache.clearCustomer).toHaveBeenCalledWith("customer-helios");
  });

  it("rejects anonymous admin save attempts", async () => {
    mockGetServices.mockReturnValue({
      cloudshareConnections: { save: vi.fn(), findByCustomerId: vi.fn().mockResolvedValue(null) },
      cloudshareClientFactory: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
    mockGetPortalAdminSession.mockResolvedValue(null);

    const response = await PUT(
      new Request("http://localhost:3000/api/admin/cloudshare", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiId: "api-id",
          apiKey: "api-key",
          webhookSecret: "whsec",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
