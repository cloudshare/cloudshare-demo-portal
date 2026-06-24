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
      labLaunches: {
        findByCustomerIdAndEnvironmentExternalId: vi.fn().mockResolvedValue(null),
        findPendingEnvironmentCorrelation: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
      },
      examAttempts: {
        findById: vi.fn().mockResolvedValue(null),
      },
      diagnosticRecorder: {
        record: vi.fn(),
      },
    };

    mockCreateCloudShareEnvironmentSource.mockReturnValue(customerSource);
    mockReconcileEnvironment.mockResolvedValue(null);
    mockHandleCloudShareWebhook.mockImplementation(async (deps) => {
      await deps.reconcile(customerConnection, "env-ext-1", {
        event: "environment.created",
        environmentExternalId: "env-ext-1",
        ownerEmail: null,
        environmentName: null,
        createdAt: "2026-06-08T10:00:00Z",
      });
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
    expect(services.labLaunches.findByCustomerIdAndEnvironmentExternalId).toHaveBeenCalledWith(
      "customer-helios",
      "env-ext-1",
    );
    expect(mockReconcileEnvironment).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: globalSource }),
      "env-ext-1",
    );
  });

  it("persists the first CloudShare environment ID on a pending LabLaunch using webhook owner and environment name", async () => {
    const customerConnection = {
      customerId: "customer-helios",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "whsec",
      webhookPathToken: "whk-helios",
      connectedAt: new Date("2026-06-01T00:00:00Z"),
      verifiedAt: null,
    };
    const pendingLaunch = {
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate4@myplace.demo",
      trainingId: "EX3s7GRuHHng7ozvYmj3GmIA2",
      experienceId: "EX3s7GRuHHng7ozvYmj3GmIA2",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/token",
      status: "launched",
      createdAt: new Date("2026-06-24T17:33:03.249Z"),
    };
    const services = {
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      cloudshareConnections: {},
      webhookIdempotency: {},
      logger: {},
      eventLog: {},
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue({ kind: "customer-client" }),
      },
      environments: {},
      labLaunches: {
        findByCustomerIdAndEnvironmentExternalId: vi.fn().mockResolvedValue(null),
        findPendingEnvironmentCorrelation: vi.fn().mockResolvedValue(pendingLaunch),
        save: vi.fn().mockResolvedValue(undefined),
      },
      examAttempts: {
        findById: vi.fn().mockResolvedValue({
          id: "attempt-1",
          customerId: "customer-helios",
          examId: "exam-windows",
        }),
      },
      diagnosticRecorder: {
        record: vi.fn(),
      },
    };

    mockCreateCloudShareEnvironmentSource.mockReturnValue({ kind: "customer-source" });
    mockReconcileEnvironment.mockResolvedValue({ environmentExternalId: "ENybZr43dp5ClmLagSs6qdJg2", status: "created" });
    mockHandleCloudShareWebhook.mockImplementation(async (deps) => {
      const event = {
        event: "environment.created",
        environmentExternalId: "ENybZr43dp5ClmLagSs6qdJg2",
        ownerEmail: "candidate4@myplace.demo",
        environmentName: "Windows Boxes",
        createdAt: "2026-06-19T21:09:52.4912512",
      } as const;
      const correlation = await deps.resolveCorrelation(customerConnection, event);
      const reconcile = await deps.reconcile(customerConnection, event.environmentExternalId, event);
      return { status: 202, body: { status: "accepted", correlation, reconcile } };
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
    expect(services.labLaunches.findPendingEnvironmentCorrelation).toHaveBeenCalledWith({
      customerId: "customer-helios",
      participantEmail: "candidate4@myplace.demo",
      environmentName: "Windows Boxes",
    });
    expect(services.labLaunches.save).toHaveBeenCalledWith({
      ...pendingLaunch,
      environmentExternalId: "ENybZr43dp5ClmLagSs6qdJg2",
      environmentId: "ENybZr43dp5ClmLagSs6qdJg2",
    });
    expect(services.examAttempts.findById).toHaveBeenCalledWith("attempt-1");
    expect(mockReconcileEnvironment).toHaveBeenCalledWith(
      expect.any(Object),
      "ENybZr43dp5ClmLagSs6qdJg2",
    );
  });
});
