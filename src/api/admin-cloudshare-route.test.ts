import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "../../app/api/admin/cloudshare/route";
import { POST } from "../../app/api/admin/cloudshare/test/route";

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

function makeServices(overrides?: Record<string, unknown>) {
  return {
    cloudshareConnections: {
      save: vi.fn(),
      markVerified: vi.fn().mockResolvedValue(undefined),
      findByCustomerId: vi.fn().mockResolvedValue(null),
      findByWebhookPathToken: vi.fn(),
    },
    cloudshareClientFactory: {},
    examAuthoringCache: {
      clearCustomer: vi.fn().mockResolvedValue(undefined),
    },
    diagnosticRecorder: {
      record: vi.fn().mockResolvedValue(undefined),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
}

describe("admin CloudShare routes", () => {
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

  it("reads the Helios CX CloudShare Connection status through the admin GET route", async () => {
    mockGetServices.mockReturnValue(
      makeServices({
        cloudshareConnections: {
          save: vi.fn(),
          markVerified: vi.fn().mockResolvedValue(undefined),
          findByWebhookPathToken: vi.fn(),
          findByCustomerId: vi.fn().mockResolvedValue({
            customerId: "customer-helios",
            apiId: "api-id",
            apiKey: "api-key",
            webhookSecret: "whsec",
            webhookPathToken: "whk-helios",
            connectedAt: new Date("2026-06-13T20:30:00.000Z"),
            verifiedAt: new Date("2026-06-13T21:00:00.000Z"),
          }),
        },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hasConnection: true,
      connectedAt: "2026-06-13T20:30:00.000Z",
      verifiedAt: "2026-06-13T21:00:00.000Z",
      webhookPathToken: "whk-helios",
      webhookPath: "/api/webhooks/cloudshare/whk-helios",
    });
  });

  it("saves the Helios CX CloudShare Connection through the admin PUT route", async () => {
    const save = vi.fn(async (connection) => ({
      ...connection,
      webhookPathToken: "whk-helios",
      connectedAt: new Date("2026-06-13T20:30:00.000Z"),
      verifiedAt: null,
    }));

    mockGetServices.mockReturnValue(
      makeServices({
        cloudshareConnections: {
          save,
          markVerified: vi.fn().mockResolvedValue(undefined),
          findByCustomerId: vi.fn().mockResolvedValue(null),
          findByWebhookPathToken: vi.fn(),
        },
      }),
    );

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
      webhookPathToken: "whk-helios",
      webhookPath: "/api/webhooks/cloudshare/whk-helios",
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
      webhookPathToken: "whk-helios",
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

    mockGetServices.mockReturnValue(
      makeServices({
        cloudshareConnections: {
          save,
          markVerified: vi.fn().mockResolvedValue(undefined),
          findByCustomerId,
          findByWebhookPathToken: vi.fn(),
        },
      }),
    );

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
      webhookPathToken: "whk-helios",
      connectedAt: new Date("2026-06-13T20:30:00.000Z"),
      verifiedAt: null,
    }));

    mockGetServices.mockReturnValue(
      makeServices({
        cloudshareConnections: {
          save,
          markVerified: vi.fn().mockResolvedValue(undefined),
          findByCustomerId: vi.fn().mockResolvedValue(null),
          findByWebhookPathToken: vi.fn(),
        },
        examAuthoringCache: cache,
      }),
    );

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

  it("tests the stored CloudShare Connection through the admin test route", async () => {
    mockGetServices.mockReturnValue(
      makeServices({
        cloudshareConnections: {
          save: vi.fn(),
          markVerified: vi.fn().mockResolvedValue(undefined),
          findByWebhookPathToken: vi.fn(),
          findByCustomerId: vi.fn().mockResolvedValue({
            customerId: "customer-helios",
            apiId: "api-id",
            apiKey: "api-key",
            webhookSecret: "whsec",
            webhookPathToken: "whk-helios",
            connectedAt: new Date("2026-06-13T20:30:00.000Z"),
            verifiedAt: null,
          }),
        },
        cloudshareClientFactory: {
          forConnection: vi.fn().mockReturnValue({
            requestV3Text: vi.fn().mockResolvedValue("{\"result\":\"Pong\"}"),
            requestV3: vi.fn(),
            requestV4: vi.fn(),
          }),
        },
      }),
    );

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      message: "pong",
      verifiedAt: expect.any(String),
      correlationId: expect.any(String),
      occurredAt: expect.any(String),
    });
  });

  it("rejects anonymous admin route access", async () => {
    mockGetServices.mockReturnValue(makeServices());
    mockGetPortalAdminSession.mockResolvedValue(null);

    const [getResponse, putResponse, postResponse] = await Promise.all([
      GET(),
      PUT(
        new Request("http://localhost:3000/api/admin/cloudshare", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            apiId: "api-id",
            apiKey: "api-key",
            webhookSecret: "whsec",
          }),
        }),
      ),
      POST(),
    ]);

    await expect(getResponse.json()).resolves.toEqual({ error: "unauthorized" });
    await expect(putResponse.json()).resolves.toEqual({ error: "unauthorized" });
    await expect(postResponse.json()).resolves.toEqual({ error: "unauthorized" });
    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
  });
});
