import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCloudShareWebhook } from "./cloudshare-webhook";
import {
  buildCloudShareWebhookRouteDeps,
  handleCloudShareWebhookRoute,
} from "./cloudshare-webhook-route";
import type { CloudShareWebhookRouteServices } from "./cloudshare-webhook-route";
import { POST } from "../../app/api/webhooks/cloudshare/[webhookPathToken]/route";

const {
  mockGetServices,
  mockCreateCloudShareEnvironmentSource,
  mockReconcileEnvironment,
} = vi.hoisted(() => ({
  mockGetServices: vi.fn(),
  mockCreateCloudShareEnvironmentSource: vi.fn(),
  mockReconcileEnvironment: vi.fn(),
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

vi.mock("./cloudshare-webhook", async () => {
  const actual = await vi.importActual<typeof import("./cloudshare-webhook")>("./cloudshare-webhook");
  return {
    ...actual,
    handleCloudShareWebhook: vi.fn(actual.handleCloudShareWebhook),
  };
});

vi.mock("@/integrations/cloudshare/environment", () => ({
  createCloudShareEnvironmentSource: mockCreateCloudShareEnvironmentSource,
}));

vi.mock("@/domain/environment-reconcile", () => ({
  reconcileEnvironment: mockReconcileEnvironment,
}));

function createRouteServices(
  overrides: Partial<CloudShareWebhookRouteServices> = {},
): CloudShareWebhookRouteServices {
  return {
    cloudshareConnections: {
      save: vi.fn(),
      findByCustomerId: vi.fn(),
      findByWebhookPathToken: vi.fn(),
      markVerified: vi.fn(),
    },
    webhookIdempotency: {
      markIfNew: vi.fn(),
    },
    logger: {} as never,
    eventLog: {
      append: vi.fn(),
      listFailureEventsByExamAttemptIds: vi.fn(),
      listAll: vi.fn(),
    },
    diagnosticRecorder: {
      record: vi.fn(),
    },
    cloudshareClientFactory: {
      forConnection: vi.fn(),
    },
    environments: {
      findByExternalId: vi.fn(),
      save: vi.fn(),
    },
    labLaunches: {
      save: vi.fn(),
      findById: vi.fn(),
      findByExamAttemptId: vi.fn(),
      findByCustomerIdAndEnvironmentExternalId: vi.fn(),
      findPendingEnvironmentCorrelation: vi.fn(),
    },
    examAttempts: {
      findById: vi.fn(),
    },
    ...overrides,
  };
}

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

    const services = createRouteServices({
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
      labLaunches: {
        findById: vi.fn(),
        findByExamAttemptId: vi.fn(),
        findByCustomerIdAndEnvironmentExternalId: vi.fn().mockResolvedValue(null),
        findPendingEnvironmentCorrelation: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
      },
      examAttempts: {
        findById: vi.fn().mockResolvedValue(null),
      },
    });

    mockCreateCloudShareEnvironmentSource.mockReturnValue(customerSource);
    mockReconcileEnvironment.mockResolvedValue(null);
    const deps = buildCloudShareWebhookRouteDeps(services, {
      now: () => new Date("2026-06-08T10:00:00Z"),
    });

    await deps.reconcile(customerConnection, "env-ext-1", {
      event: "environment.created",
      environmentExternalId: "env-ext-1",
      ownerEmail: null,
      environmentName: null,
      createdAt: "2026-06-08T10:00:00Z",
    });

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
    const services = createRouteServices({
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue({ kind: "customer-client" }),
      },
      labLaunches: {
        findById: vi.fn(),
        findByExamAttemptId: vi.fn(),
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
    });

    mockCreateCloudShareEnvironmentSource.mockReturnValue({ kind: "customer-source" });
    mockReconcileEnvironment.mockResolvedValue({
      environmentExternalId: "ENybZr43dp5ClmLagSs6qdJg2",
      status: "created",
    });

    const deps = buildCloudShareWebhookRouteDeps(services, {
      now: () => new Date("2026-06-08T10:00:00Z"),
    });
    const event = {
      event: "environment.created",
      environmentExternalId: "ENybZr43dp5ClmLagSs6qdJg2",
      ownerEmail: "candidate4@myplace.demo",
      environmentName: "Windows Boxes",
      createdAt: "2026-06-19T21:09:52.4912512",
    } as const;

    const correlation = await deps.resolveCorrelation?.(customerConnection, event);
    const reconcile = await deps.reconcile(
      customerConnection,
      event.environmentExternalId,
      event,
    );

    expect(correlation).toEqual(
      expect.objectContaining({
        customerId: "customer-helios",
        examAttemptId: "attempt-1",
        examId: "exam-windows",
        candidateEmail: "candidate4@myplace.demo",
      }),
    );
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
    expect(reconcile).toEqual(
      expect.objectContaining({
        environmentExternalId: "ENybZr43dp5ClmLagSs6qdJg2",
        status: "created",
        correlation: expect.objectContaining({
          customerId: "customer-helios",
          examAttemptId: "attempt-1",
          examId: "exam-windows",
          candidateEmail: "candidate4@myplace.demo",
        }),
      }),
    );
    expect(mockReconcileEnvironment).toHaveBeenCalledWith(
      expect.any(Object),
      "ENybZr43dp5ClmLagSs6qdJg2",
    );
  });

  it("passes the built framework-agnostic deps into the webhook handler", async () => {
    const customerConnection = {
      customerId: "customer-helios",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "whsec",
      webhookPathToken: "whk-helios",
      connectedAt: new Date("2026-06-01T00:00:00Z"),
      verifiedAt: null,
    };
    const services = createRouteServices({
      cloudshareConnections: {
        save: vi.fn(),
        findByCustomerId: vi.fn(),
        findByWebhookPathToken: vi.fn().mockResolvedValue(customerConnection),
        markVerified: vi.fn(),
      },
      webhookIdempotency: { markIfNew: vi.fn() },
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue({ kind: "customer-client" }),
      },
      environments: {
        findByExternalId: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
      },
      labLaunches: {
        findById: vi.fn(),
        findByExamAttemptId: vi.fn(),
        findByCustomerIdAndEnvironmentExternalId: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
      },
      examAttempts: {
        findById: vi.fn().mockResolvedValue(null),
      },
    });
    const handlerSpy = vi.mocked(handleCloudShareWebhook);
    handlerSpy.mockResolvedValue({ status: 202, body: { status: "accepted" } });

    const response = await handleCloudShareWebhookRoute(
      services,
      { webhookPathToken: "whk-helios", rawBody: "{\"Event\":\"environment.created\"}", signature: "sig" },
      { now: () => new Date("2026-06-08T10:00:00Z") },
    );

    expect(response).toEqual({ status: 202, body: { status: "accepted" } });
    expect(handlerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        connections: services.cloudshareConnections,
        idempotency: services.webhookIdempotency,
        logger: services.logger,
        eventLog: services.eventLog,
        diagnostics: services.diagnosticRecorder,
        resolveCorrelation: expect.any(Function),
        reconcile: expect.any(Function),
      }),
      { webhookPathToken: "whk-helios", rawBody: "{\"Event\":\"environment.created\"}", signature: "sig" },
    );
  });

  it("keeps the Next route focused on request extraction, seeding, handler invocation, and NextResponse adaptation", async () => {
    const handlerSpy = vi.mocked(handleCloudShareWebhook);
    const services = {
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      cloudshareConnections: {
        findByWebhookPathToken: vi.fn().mockResolvedValue(null),
      },
      webhookIdempotency: { markIfNew: vi.fn() },
      logger: {} as never,
      eventLog: { append: vi.fn() },
      diagnosticRecorder: { record: vi.fn() },
      cloudshareClientFactory: {
        forConnection: vi.fn(),
      },
      environments: {
        findByExternalId: vi.fn(),
        save: vi.fn(),
      },
      labLaunches: {
        findByCustomerIdAndEnvironmentExternalId: vi.fn(),
        save: vi.fn(),
      },
      examAttempts: {
        findById: vi.fn(),
      },
    };
    mockGetServices.mockReturnValue(services);
    handlerSpy.mockResolvedValue({
      status: 202,
      body: { status: "accepted" },
    });

    const response = await POST(
      new Request("http://localhost:3000/api/webhooks/cloudshare/whk-helios", {
        method: "POST",
        body: JSON.stringify({ Event: "environment.created" }),
        headers: { "x-cloudshare-signature": "sig" },
      }),
      { params: Promise.resolve({ webhookPathToken: "whk-helios" }) },
    );

    expect(services.ensurePortalSeeded).toHaveBeenCalledTimes(1);
    expect(handlerSpy).toHaveBeenCalledWith(
      expect.any(Object),
      {
        webhookPathToken: "whk-helios",
        rawBody: JSON.stringify({ Event: "environment.created" }),
        signature: "sig",
      },
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "accepted" });
  });
});
