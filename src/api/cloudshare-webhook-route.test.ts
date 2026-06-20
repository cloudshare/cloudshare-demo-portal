import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/webhooks/cloudshare/[webhookPathToken]/route";

const {
  mockGetServices,
  mockHandleCloudShareWebhook,
  mockCreateCloudShareEnvironmentSource,
  mockReconcileEnvironment,
} = vi.hoisted(() => ({
  mockGetServices: vi.fn(),
  mockHandleCloudShareWebhook: vi.fn(),
  mockCreateCloudShareEnvironmentSource: vi.fn(),
  mockReconcileEnvironment: vi.fn(),
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

vi.mock("@/api/cloudshare-webhook", () => ({
  handleCloudShareWebhook: mockHandleCloudShareWebhook,
}));

vi.mock("@/integrations/cloudshare/environment", () => ({
  createCloudShareEnvironmentSource: mockCreateCloudShareEnvironmentSource,
}));

vi.mock("@/domain/environment-reconcile", () => ({
  reconcileEnvironment: mockReconcileEnvironment,
}));

describe("CloudShare webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the authoritative poll source from the resolved customer connection, not the global source", async () => {
    const customerConnection = {
      customerId: "customer-helios",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "whsec",
      webhookPathToken: "whk-helios",
      connectedAt: new Date("2026-06-01T00:00:00Z"),
      verifiedAt: null,
    };
    const customerClient = { kind: "customer-client" };
    const customerSource = { kind: "customer-source" };
    const globalSource = { kind: "global-source" };

    const services = {
      config: { runtime: { webhookDebugLogRawBody: false } },
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      cloudshareConnections: {},
      webhookIdempotency: {},
      logger: {},
      eventLog: {},
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
      environmentSource: globalSource,
      environments: {},
    };

    mockCreateCloudShareEnvironmentSource.mockReturnValue(customerSource);
    mockReconcileEnvironment.mockResolvedValue(null);
    mockHandleCloudShareWebhook.mockImplementation(async (deps) => {
      await deps.reconcile(customerConnection, "env-ext-1");
      return { status: 202, body: { status: "accepted" } };
    });
    mockGetServices.mockReturnValue(services);

    const response = await POST(
      new Request("http://localhost:3000/api/webhooks/cloudshare/whk-helios", {
        method: "POST",
        body: JSON.stringify({ Event: "environment.created" }),
        headers: { "x-cloudshare-signature": "sig" },
      }),
      { params: Promise.resolve({ webhookPathToken: "whk-helios" }) },
    );

    expect(response.status).toBe(202);
    expect(services.cloudshareClientFactory.forConnection).toHaveBeenCalledWith(customerConnection);
    expect(mockCreateCloudShareEnvironmentSource).toHaveBeenCalledWith(customerClient);
    expect(mockReconcileEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ source: customerSource }),
      "env-ext-1",
    );
    expect(mockReconcileEnvironment).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: globalSource }),
      "env-ext-1",
    );
  });
});
