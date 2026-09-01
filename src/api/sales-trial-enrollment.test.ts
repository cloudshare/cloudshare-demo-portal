import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import type { SalesTrialOffering } from "@/domain/sales-trial-offering";
import type { SalesTrialEnrollment, SalesTrialEnrollmentRepository } from "@/domain/sales-trial-enrollment";
import {
  CloudShareRequestError,
  CloudShareTransportError,
} from "@/integrations/cloudshare/errors";
import { SalesEnvironmentResolutionError } from "@/integrations/cloudshare/sales-environment";
import {
  handleEnterSalesTrialOffering,
  handleListSalesTrialOfferingParticipants,
  handleExtendSalesTrialOfferingParticipant,
} from "./sales-trial-enrollment";

function createOffering(overrides: Partial<SalesTrialOffering> = {}): SalesTrialOffering {
  return {
    id: "offering-1",
    customerId: "customer-1",
    title: "Helios Trial",
    description: "Shared trial",
    itemId: "item-1",
    cloudShareSalesExperienceId: "sales-1",
    externalId: "opaque-1",
    start: "2026-08-30T09:00",
    end: "2026-08-30T17:00",
    timeZone: "UTC",
    salesProEmail: "owner@example.test",
    salesProDisplayName: "Owner",
    status: "published",
    createdAt: new Date("2026-08-29T10:00:00.000Z"),
    updatedAt: new Date("2026-08-29T10:00:00.000Z"),
    publishedAt: new Date("2026-08-29T10:00:00.000Z"),
    unpublishedAt: null,
    attentionReason: null,
    ...overrides,
  };
}

function createEnrollmentRepository(): SalesTrialEnrollmentRepository {
  const rows = new Map<string, SalesTrialEnrollment>();
  return {
    async save(enrollment) {
      rows.set(enrollment.id, enrollment);
    },
    async reserveForLaunch(enrollment) {
      const existing =
        [...rows.values()].find(
          (row) =>
            row.customerId === enrollment.customerId &&
            row.salesTrialOfferingId === enrollment.salesTrialOfferingId &&
            row.portalUserId === enrollment.portalUserId,
        ) ?? null;
      if (existing) {
        if (
          existing.status === "retryable_failure" &&
          existing.cloudShareParticipantId === null
        ) {
          const reclaimed = {
            ...existing,
            status: "provisioning" as const,
            attentionReason: null,
            lastReconciledAt: enrollment.lastReconciledAt,
            updatedAt: enrollment.updatedAt,
          };
          rows.set(existing.id, reclaimed);
          return { enrollment: reclaimed, created: false, reclaimed: true } as const;
        }
        return { enrollment: existing, created: false, reclaimed: false } as const;
      }
      rows.set(enrollment.id, enrollment);
      return { enrollment, created: true, reclaimed: false } as const;
    },
    async findByOfferingAndPortalUser(customerId, salesTrialOfferingId, portalUserId) {
      return (
        [...rows.values()].find(
          (row) =>
            row.customerId === customerId &&
            row.salesTrialOfferingId === salesTrialOfferingId &&
            row.portalUserId === portalUserId,
        ) ?? null
      );
    },
    async findById(customerId, enrollmentId) {
      const row = rows.get(enrollmentId);
      return row?.customerId === customerId ? row : null;
    },
    async listByOffering(customerId, salesTrialOfferingId) {
      return [...rows.values()].filter(
        (row) =>
          row.customerId === customerId && row.salesTrialOfferingId === salesTrialOfferingId,
      );
    },
    async listByPortalUser(customerId, portalUserId) {
      return [...rows.values()].filter(
        (row) => row.customerId === customerId && row.portalUserId === portalUserId,
      );
    },
  };
}

function createDeps(
  overrides: Partial<Parameters<typeof handleEnterSalesTrialOffering>[0]> = {},
) {
  const offering = createOffering();
  const enrollments = createEnrollmentRepository();
  const diagnosticRepository = createInMemoryDiagnosticLogRepository();
  const diagnostics = createDiagnosticRecorder({
    repository: diagnosticRepository,
  });
  const listParticipants = vi.fn().mockResolvedValue({
    participants: [],
    request: { method: "GET", path: "/sales/sales-1/participants" },
    response: { status: 200, body: { participants: [] } },
  });
  const readSession = vi.fn().mockResolvedValue({
    id: "sales-1",
    status: "inProgress",
    end: offering.end,
    request: { method: "GET", path: "/sales/sales-1" },
    response: { status: 200, body: { id: "sales-1", status: "inProgress", end: offering.end } },
  });
  const registerParticipants = vi.fn().mockResolvedValue({
    request: { method: "POST", path: "/sales/sales-1/participants" },
    response: { status: 201, body: {} },
  });
  const updateParticipantCorrelation = vi.fn().mockResolvedValue({
    request: { method: "PUT", path: "/sales/sales-1/participants/remote-1" },
    response: { status: 200, body: {} },
  });
  const createSponsoredLink = vi.fn().mockResolvedValue({
    loginUrl: "https://use.cloudshare.com/secret",
    request: { method: "POST", path: "/sales/sales-1/sponsored-link" },
    response: { status: 200, body: { loginUrl: "https://use.cloudshare.com/secret" } },
  });
  const extendById = vi.fn().mockResolvedValue({
    environmentId: "opaque-v3-env-1",
    exchange: {
      request: { method: "PUT", path: "/api/v3/envs/actions/extend", query: { envId: "opaque-v3-env-1" } },
      response: { status: 200, body: "" },
    },
  });
  const observe = vi.fn().mockResolvedValue({
    environmentId: "opaque-v3-env-1",
    statusCode: 4,
    expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
    exchanges: [
      {
        request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
        response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
      },
      {
        request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
        response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
      },
    ],
  });
  const observeById = vi.fn().mockResolvedValue({
    environmentId: "opaque-v3-env-1",
    statusCode: 4,
    expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
    exchanges: [
      {
        request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
        response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" } },
      },
    ],
  });
  const deps = {
    offerings: { findById: vi.fn().mockResolvedValue(offering) },
    items: {
      findById: vi.fn().mockResolvedValue({
        id: "item-1",
        customerId: "customer-1",
        name: "Trial Item",
        description: "Shared trial item",
        project: { id: "project-1", name: "Project 1" },
        blueprints: [{ id: "bp-1", name: "Blueprint 1" }],
        policy: { id: "policy-1", name: "Policy 1" },
        regions: [{ id: "region-1", name: "Region 1" }],
        defaultDurationMinutes: 60,
        status: "active",
        archivedAt: null,
        createdAt: new Date("2026-08-29T10:00:00.000Z"),
        updatedAt: new Date("2026-08-29T10:00:00.000Z"),
      }),
    },
    enrollments,
    connections: { findByCustomerId: vi.fn().mockResolvedValue({ id: "connection-1" }) },
    deliveryFactory: {
      forConnection: vi.fn().mockReturnValue({
        readSession,
        ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue({
          requiredKeys: [
            "certalisSalesTrialEnrollmentId",
            "certalisSalesTrialParticipantUserId",
          ],
          availableKeys: [
            "certalisSalesTrialEnrollmentId",
            "certalisSalesTrialParticipantUserId",
          ],
          requests: [],
          responses: [],
          request: { method: "GET", path: "/sales/sales-1/users/properties" },
          response: { status: 200, body: [] },
        }),
        listParticipants,
        registerParticipants,
        updateParticipantCorrelation,
        createSponsoredLink,
      }),
    },
    diagnostics,
    audit: { write: vi.fn().mockResolvedValue(undefined) },
    salesEnvironmentFactory: {
      forConnection: vi.fn().mockReturnValue({
        observe,
        observeById,
        extendById,
      }),
    },
    now: () => new Date("2026-08-30T10:00:00.000Z"),
    newId: () => "enrollment-1",
    ...overrides,
  };
  return {
    deps,
    enrollments,
    diagnosticRepository,
    audit: deps.audit,
    readSession,
    listParticipants,
    registerParticipants,
    updateParticipantCorrelation,
    createSponsoredLink,
    observe,
    extendById,
    observeById,
  };
}

const request = {
  customerId: "customer-1",
  offeringId: "offering-1",
  participant: {
    userId: "trial-user-1",
    email: "visitor@example.test",
    firstName: "Ari",
    lastName: "Visitor",
  },
  actor: {
    type: "sales_trial_participant" as const,
    id: "trial-user-1",
    email: "visitor@example.test",
  },
};

describe("Sales Trial offering entry", () => {
  it("reopens an ended Trial Offering for the participant who already launched its environment", async () => {
    const { deps, enrollments, listParticipants, createSponsoredLink } = createDeps({
      offerings: { findById: vi.fn().mockResolvedValue(createOffering({ status: "unpublished", end: "2026-08-30T10:02" })) },
    });
    const launchedAt = new Date("2026-08-30T09:30:00.000Z");
    await enrollments.save({
      id: "enrollment-1", customerId: "customer-1", salesTrialOfferingId: "offering-1", portalUserId: "trial-user-1",
      email: "visitor@example.test", firstName: "Ari", lastName: "Visitor", cloudShareParticipantId: "remote-1",
      cloudShareRosterEnvironmentReference: "env-1", environmentStatus: "Ready", firstJoined: "2026-08-30T09:31:00.000Z",
      status: "active", attentionReason: null, lastLaunchedAt: launchedAt, lastReconciledAt: launchedAt,
      createdAt: launchedAt, updatedAt: launchedAt,
    });
    (deps.deliveryFactory!.forConnection as ReturnType<typeof vi.fn>).mockReturnValue({
      readSession: vi.fn().mockResolvedValue({
        id: "sales-1", status: "ended", end: "2026-08-30T10:02:00",
        request: { method: "GET", path: "/sales/sales-1" }, response: { status: 200, body: { id: "sales-1", status: "ended" } },
      }),
      ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue({
        requiredKeys: ["certalisSalesTrialEnrollmentId", "certalisSalesTrialParticipantUserId"],
        availableKeys: ["certalisSalesTrialEnrollmentId", "certalisSalesTrialParticipantUserId"], requests: [], responses: [],
        request: { method: "GET", path: "/sales/sales-1/users/properties" }, response: { status: 200, body: [] },
      }),
      listParticipants: listParticipants.mockResolvedValue({
        participants: [{ id: "remote-1", email: "visitor@example.test", firstName: "Ari", lastName: "Visitor", participationStatus: "inProgress", firstJoined: "2026-08-30T09:31:00.000Z", envStatus: "Ready", environmentId: "env-1", customProperties: { certalisSalesTrialEnrollmentId: "enrollment-1", certalisSalesTrialParticipantUserId: "trial-user-1" } }],
        request: { method: "GET", path: "/sales/sales-1/participants" }, response: { status: 200, body: {} },
      }),
      registerParticipants: vi.fn(), updateParticipantCorrelation: vi.fn(), createSponsoredLink,
    });

    const result = await handleEnterSalesTrialOffering(deps, request);

    expect(result).toMatchObject({ status: 302, redirect: "https://use.cloudshare.com/secret" });
    expect(createSponsoredLink).toHaveBeenCalledOnce();
  });

  it("fails closed before enrollment mutation when CloudShare reports the offering ended", async () => {
    const { deps, enrollments, diagnosticRepository, audit, readSession, registerParticipants, createSponsoredLink } =
      createDeps();
    readSession.mockResolvedValue({
      id: "sales-1",
      status: "ended",
      end: "2026-08-30T10:02",
      request: { method: "GET", path: "/sales/sales-1" },
      response: { status: 200, body: { id: "sales-1", status: "ended", end: "2026-08-30T10:02" } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.entered",
      outcome: "failure",
    });

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(persisted).toBeNull();
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      correlationId: result.body?.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/sales/sales-1",
      }),
      response: expect.objectContaining({
        status: 200,
        body: { id: "sales-1", status: "ended", end: "2026-08-30T10:02" },
      }),
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "launch_unavailable",
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.entered",
        outcome: "failure",
        details: expect.objectContaining({ failureMode: "launch_unavailable" }),
      }),
    );
  });

  it("fails closed before enrollment mutation when the CloudShare offering status check cannot confirm availability", async () => {
    const { deps, enrollments, diagnosticRepository, audit, readSession, registerParticipants, createSponsoredLink } =
      createDeps();
    readSession.mockRejectedValue(
      new CloudShareTransportError("sales read timed out", {
        method: "GET",
        path: "/sales/sales-1",
        cause: "ETIMEDOUT",
        transport: "tcp",
      }),
    );

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.entered",
      outcome: "failure",
    });

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(persisted).toBeNull();
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      correlationId: result.body?.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/sales/sales-1",
      }),
      response: expect.objectContaining({
        transport: "tcp",
      }),
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "provider_failure",
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.entered",
        outcome: "failure",
        details: expect.objectContaining({ failureMode: "provider_failure" }),
      }),
    );
  });

  it("fails closed before enrollment mutation when CloudShare reports the offering has not started", async () => {
    const { deps, enrollments, diagnosticRepository, audit, readSession, registerParticipants, createSponsoredLink } =
      createDeps();
    readSession.mockResolvedValue({
      id: "sales-1",
      status: "notStarted",
      end: "2026-08-30T17:00",
      request: { method: "GET", path: "/sales/sales-1" },
      response: { status: 200, body: { id: "sales-1", status: "notStarted", end: "2026-08-30T17:00" } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.entered",
      outcome: "failure",
    });

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(persisted).toBeNull();
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      correlationId: result.body?.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/sales/sales-1",
      }),
      response: expect.objectContaining({
        status: 200,
        body: { id: "sales-1", status: "notStarted", end: "2026-08-30T17:00" },
      }),
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "launch_unavailable",
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.entered",
        outcome: "failure",
        details: expect.objectContaining({ failureMode: "launch_unavailable" }),
      }),
    );
  });

  it("fails closed before enrollment mutation when provider end no longer matches a stale open-ended local offering", async () => {
    const { deps, enrollments, diagnosticRepository, audit, readSession, registerParticipants, createSponsoredLink } =
      createDeps({
        offerings: {
          findById: vi.fn().mockResolvedValue(
            createOffering({
              end: null,
            }),
          ),
        },
      });
    readSession.mockResolvedValue({
      id: "sales-1",
      status: "inProgress",
      end: "2026-08-30T10:02",
      request: { method: "GET", path: "/sales/sales-1" },
      response: { status: 200, body: { id: "sales-1", status: "inProgress", end: "2026-08-30T10:02" } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.entered",
      outcome: "failure",
    });

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(persisted).toBeNull();
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      correlationId: result.body?.correlationId,
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "launch_unavailable",
      }),
      response: expect.objectContaining({
        body: { id: "sales-1", status: "inProgress", end: "2026-08-30T10:02" },
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.entered",
        outcome: "failure",
        details: expect.objectContaining({ failureMode: "launch_unavailable" }),
      }),
    );
  });

  it("allows entry for an open-ended published offering after its start time", async () => {
    const { deps, enrollments, readSession, listParticipants, registerParticipants, createSponsoredLink } =
      createDeps({
        offerings: {
          findById: vi.fn().mockResolvedValue(
            createOffering({
              end: null,
            }),
          ),
        },
      });
    readSession.mockResolvedValue({
      id: "sales-1",
      status: "inProgress",
      end: null,
      request: { method: "GET", path: "/sales/sales-1" },
      response: { status: 200, body: { id: "sales-1", status: "inProgress", end: null } },
    });
    listParticipants
      .mockResolvedValueOnce({
        participants: [],
        request: { method: "GET", path: "/sales/sales-1/participants" },
        response: { status: 200, body: { participants: [] } },
      })
      .mockResolvedValueOnce({
        participants: [
          {
            id: "remote-1",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            invitationStatus: "notSent",
            invitedBy: null,
            participationStatus: "pending",
            firstJoined: null,
            environmentId: null,
            envStatus: null,
            customProperties: {
              certalisSalesTrialEnrollmentId: "enrollment-1",
              certalisSalesTrialParticipantUserId: "trial-user-1",
            },
          },
        ],
        request: { method: "GET", path: "/sales/sales-1/participants" },
        response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
      });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toEqual({
      status: 302,
      redirect: "https://use.cloudshare.com/secret",
    });
    expect(registerParticipants).toHaveBeenCalledTimes(1);
    expect(createSponsoredLink).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({
      id: "enrollment-1",
      cloudShareParticipantId: "remote-1",
      status: "active",
    });
  });

  it("registers the authenticated participant once, reconciles exactly, and redirects without a body", async () => {
    const { deps, enrollments, listParticipants, registerParticipants, createSponsoredLink } =
      createDeps();
    listParticipants
      .mockResolvedValueOnce({
        participants: [],
        request: { method: "GET", path: "/sales/sales-1/participants" },
        response: { status: 200, body: { participants: [] } },
      })
      .mockResolvedValueOnce({
        participants: [
          {
            id: "remote-1",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            invitationStatus: "notSent",
            invitedBy: null,
            participationStatus: "pending",
            firstJoined: null,
            environmentId: null,
            envStatus: null,
            customProperties: {
              certalisSalesTrialEnrollmentId: "enrollment-1",
              certalisSalesTrialParticipantUserId: "trial-user-1",
            },
          },
        ],
        request: { method: "GET", path: "/sales/sales-1/participants" },
        response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
      });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toEqual({
      status: 302,
      redirect: "https://use.cloudshare.com/secret",
    });
    expect(registerParticipants).toHaveBeenCalledTimes(1);
    expect(createSponsoredLink).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({
      id: "enrollment-1",
      cloudShareParticipantId: "remote-1",
      status: "active",
      email: "visitor@example.test",
    });
  });

  it("re-enters idempotently without duplicate provider registration", async () => {
    const { deps, enrollments, listParticipants, registerParticipants, createSponsoredLink } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
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
    });
    const remoteParticipant = {
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
    };
    listParticipants.mockResolvedValue({
      participants: [remoteParticipant],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });

    const first = await handleEnterSalesTrialOffering(deps, request);
    const second = await handleEnterSalesTrialOffering(deps, request);

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(createSponsoredLink).toHaveBeenCalledTimes(2);
  });

  it("fails closed when one exact correlated participant and another same-email row both exist in the authoritative roster", async () => {
    const { deps, enrollments, listParticipants, registerParticipants, updateParticipantCorrelation, createSponsoredLink } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
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
    });
    listParticipants.mockResolvedValue({
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
          envStatus: "FutureAllocationScheduled",
          customProperties: {
            certalisSalesTrialEnrollmentId: "enrollment-1",
            certalisSalesTrialParticipantUserId: "trial-user-1",
          },
        },
        {
          id: "remote-2",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "pending",
          firstJoined: null,
          environmentId: null,
          envStatus: null,
          customProperties: {},
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
      response: { status: 200, body: { participants: [{ id: "remote-1" }, { id: "remote-2" }] } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      status: "needs_attention",
      cloudShareParticipantId: "remote-1",
    });
  });

  it("reserves the first enrollment before provider mutation and blocks a concurrent duplicate launch without a second provider add", async () => {
    const enrollments = createEnrollmentRepository();
    const firstRosterGate: { release?: () => void } = {};
    const firstRosterRead = new Promise<void>((resolve) => {
      firstRosterGate.release = resolve;
    });
    const listParticipants = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstRosterRead;
        return {
          participants: [],
          request: { method: "GET", path: "/sales/sales-1/participants" },
          response: { status: 200, body: { participants: [] } },
        };
      })
      .mockResolvedValueOnce({
        participants: [
          {
            id: "remote-1",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            invitationStatus: "notSent",
            invitedBy: null,
            participationStatus: "pending",
            firstJoined: null,
            environmentId: null,
            envStatus: null,
            customProperties: {
              certalisSalesTrialEnrollmentId: "enrollment-1",
              certalisSalesTrialParticipantUserId: "trial-user-1",
            },
          },
        ],
        request: { method: "GET", path: "/sales/sales-1/participants" },
        response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
      });
    const registerParticipants = vi.fn().mockResolvedValue({
      request: { method: "POST", path: "/sales/sales-1/participants" },
      response: { status: 201, body: {} },
    });
    const createSponsoredLink = vi.fn().mockResolvedValue({
      loginUrl: "https://use.cloudshare.com/secret",
      request: { method: "POST", path: "/sales/sales-1/sponsored-link" },
      response: { status: 200, body: { loginUrl: "https://use.cloudshare.com/secret" } },
    });
    const deps = createDeps({
      enrollments,
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({
          readSession: vi.fn().mockResolvedValue({
            id: "sales-1",
            status: "inProgress",
            end: "2026-08-30T17:00",
            request: { method: "GET", path: "/sales/sales-1" },
            response: { status: 200, body: { id: "sales-1", status: "inProgress", end: "2026-08-30T17:00" } },
          }),
          ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue({
            requiredKeys: [
              "certalisSalesTrialEnrollmentId",
              "certalisSalesTrialParticipantUserId",
            ],
            availableKeys: [
              "certalisSalesTrialEnrollmentId",
              "certalisSalesTrialParticipantUserId",
            ],
            requests: [],
            responses: [],
            request: { method: "GET", path: "/sales/sales-1/users/properties" },
            response: { status: 200, body: [] },
          }),
          listParticipants,
          registerParticipants,
          updateParticipantCorrelation: vi.fn(),
          createSponsoredLink,
        }),
      },
      newId: vi.fn().mockReturnValueOnce("enrollment-1").mockReturnValueOnce("enrollment-2"),
    }).deps;

    const first = handleEnterSalesTrialOffering(deps, request);
    await Promise.resolve();
    const second = await handleEnterSalesTrialOffering(deps, request);
    if (firstRosterGate.release) {
      firstRosterGate.release();
    }
    const firstResult = await first;
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );
    const all = await enrollments.listByOffering("customer-1", "offering-1");

    expect(second).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(firstResult).toEqual({
      status: 302,
      redirect: "https://use.cloudshare.com/secret",
    });
    expect(registerParticipants).toHaveBeenCalledTimes(1);
    expect(createSponsoredLink).toHaveBeenCalledTimes(1);
    expect(all).toHaveLength(1);
    expect(persisted).toMatchObject({
      id: "enrollment-1",
      cloudShareParticipantId: "remote-1",
      status: "active",
    });
  });

  it("persists a retryable failure before reconciliation, then reclaims and succeeds on repeat entry", async () => {
    const { deps, enrollments, diagnosticRepository, audit, listParticipants, registerParticipants, createSponsoredLink } =
      createDeps();
    listParticipants
      .mockResolvedValueOnce({
        participants: [],
        request: { method: "GET", path: "/sales/sales-1/participants" },
        response: { status: 200, body: { participants: [] } },
      })
      .mockResolvedValueOnce({
        participants: [],
        request: { method: "GET", path: "/sales/sales-1/participants" },
        response: { status: 200, body: { participants: [] } },
      })
      .mockResolvedValueOnce({
        participants: [
          {
            id: "remote-1",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            invitationStatus: "notSent",
            invitedBy: null,
            participationStatus: "pending",
            firstJoined: null,
            environmentId: null,
            envStatus: null,
            customProperties: {
              certalisSalesTrialEnrollmentId: "enrollment-1",
              certalisSalesTrialParticipantUserId: "trial-user-1",
            },
          },
        ],
        request: { method: "GET", path: "/sales/sales-1/participants" },
        response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
      });
    registerParticipants
      .mockRejectedValueOnce(
        new CloudShareTransportError("CloudShare participant registration timed out.", {
          method: "POST",
          path: "/sales/sales-1/participants",
          requestBody: [{ email: "visitor@example.test" }],
          cause: "ETIMEDOUT",
          transport: "tcp",
        }),
      )
      .mockResolvedValueOnce({
        request: { method: "POST", path: "/sales/sales-1/participants" },
        response: { status: 201, body: {} },
      });

    const first = await handleEnterSalesTrialOffering(deps, request);
    const afterFirst = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );
    const second = await handleEnterSalesTrialOffering(deps, request);
    const afterSecond = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );
    const failures = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.entered",
      outcome: "failure",
    });

    expect(first).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(afterFirst).toMatchObject({
      id: "enrollment-1",
      status: "retryable_failure",
      cloudShareParticipantId: null,
      attentionReason: null,
    });
    expect(second).toEqual({
      status: 302,
      redirect: "https://use.cloudshare.com/secret",
    });
    expect(afterSecond).toMatchObject({
      id: "enrollment-1",
      status: "active",
      cloudShareParticipantId: "remote-1",
    });
    expect(registerParticipants).toHaveBeenCalledTimes(2);
    expect(createSponsoredLink).toHaveBeenCalledTimes(1);
    expect(failures[0]).toMatchObject({
      correlationId: first.body?.correlationId,
      request: expect.objectContaining({
        method: "POST",
        path: "/sales/sales-1/participants",
      }),
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales.participants",
        failureMode: "provider_failure",
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.entered",
        details: expect.objectContaining({ failureMode: "provider_failure" }),
      }),
    );
  });

  it("fails closed when a reclaimed local enrollment without a persisted provider id finds a single exact-correlated roster row", async () => {
    const { deps, enrollments, listParticipants, registerParticipants, updateParticipantCorrelation, createSponsoredLink } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: null,
      cloudShareRosterEnvironmentReference: null,
      environmentStatus: null,
      firstJoined: null,
      status: "retryable_failure",
      attentionReason: null,
      lastLaunchedAt: null,
      lastReconciledAt: new Date("2026-08-30T09:30:00.000Z"),
      createdAt: new Date("2026-08-30T09:00:00.000Z"),
      updatedAt: new Date("2026-08-30T09:30:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: [
        {
          id: "remote-1",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "pending",
          firstJoined: null,
          environmentId: null,
          envStatus: null,
          customProperties: {
            certalisSalesTrialEnrollmentId: "enrollment-1",
            certalisSalesTrialParticipantUserId: "trial-user-1",
          },
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      status: "needs_attention",
      cloudShareParticipantId: null,
    });
  });

  it("fails closed when CloudShare returns more than one exact roster match and never mints a sponsored link", async () => {
    const { deps, listParticipants, createSponsoredLink, enrollments } = createDeps();
    listParticipants.mockResolvedValue({
      participants: [
        {
          id: "remote-1",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "pending",
          firstJoined: null,
          environmentId: null,
          envStatus: null,
          customProperties: {
            certalisSalesTrialEnrollmentId: "enrollment-1",
            certalisSalesTrialParticipantUserId: "trial-user-1",
          },
        },
        {
          id: "remote-2",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "pending",
          firstJoined: null,
          environmentId: null,
          envStatus: null,
          customProperties: {
            certalisSalesTrialEnrollmentId: "enrollment-1",
            certalisSalesTrialParticipantUserId: "trial-user-1",
          },
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }, { id: "remote-2" }] } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      status: "needs_attention",
    });
  });

  it("fails closed when a persisted CloudShare participant id returns without the required trial correlations", async () => {
    const { deps, enrollments, listParticipants, registerParticipants, updateParticipantCorrelation, createSponsoredLink } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      cloudShareRosterEnvironmentReference: null,
      environmentStatus: null,
      firstJoined: null,
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T09:30:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T09:30:00.000Z"),
      createdAt: new Date("2026-08-30T09:00:00.000Z"),
      updatedAt: new Date("2026-08-30T09:30:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: [
        {
          id: "remote-1",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "pending",
          firstJoined: null,
          environmentId: null,
          envStatus: null,
          customProperties: {
            certalisSalesTrialEnrollmentId: "someone-else",
            certalisSalesTrialParticipantUserId: "different-user",
          },
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      status: "needs_attention",
    });
  });

  it("fails closed when a persisted CloudShare participant id is missing from the authoritative roster", async () => {
    const { deps, enrollments, listParticipants, registerParticipants, updateParticipantCorrelation, createSponsoredLink } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      cloudShareRosterEnvironmentReference: null,
      environmentStatus: null,
      firstJoined: null,
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T09:30:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T09:30:00.000Z"),
      createdAt: new Date("2026-08-30T09:00:00.000Z"),
      updatedAt: new Date("2026-08-30T09:30:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: [
        {
          id: "remote-2",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "pending",
          firstJoined: null,
          environmentId: null,
          envStatus: null,
          customProperties: {},
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
      response: { status: 200, body: { participants: [{ id: "remote-2" }] } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      status: "needs_attention",
    });
  });

  it("fails closed when a persisted CloudShare participant id is absent and another roster row reuses the trial correlation keys", async () => {
    const { deps, enrollments, listParticipants, registerParticipants, updateParticipantCorrelation, createSponsoredLink } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      cloudShareRosterEnvironmentReference: null,
      environmentStatus: null,
      firstJoined: null,
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T09:30:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T09:30:00.000Z"),
      createdAt: new Date("2026-08-30T09:00:00.000Z"),
      updatedAt: new Date("2026-08-30T09:30:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: [
        {
          id: "remote-2",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "pending",
          firstJoined: null,
          environmentId: null,
          envStatus: null,
          customProperties: {
            certalisSalesTrialEnrollmentId: "enrollment-1",
            certalisSalesTrialParticipantUserId: "trial-user-1",
          },
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
      response: { status: 200, body: { participants: [{ id: "remote-2" }] } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      status: "needs_attention",
    });
  });

  it("fails closed on a sole propertyless same-email roster row and records protected provider evidence", async () => {
    const { deps, diagnosticRepository, enrollments, listParticipants, registerParticipants, updateParticipantCorrelation, createSponsoredLink } = createDeps();
    listParticipants.mockResolvedValue({
      participants: [
        {
          id: "remote-1",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "pending",
          firstJoined: null,
          environmentId: null,
          envStatus: null,
          customProperties: {},
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
      response: { status: 200, body: { participants: [{ id: "remote-1", email: "visitor@example.test" }] } },
    });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      outcome: "failure",
    });

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      id: "enrollment-1",
      status: "needs_attention",
    });
    expect(failure).toMatchObject({
      correlationId: result.body?.correlationId,
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales.participants",
      }),
      request: expect.objectContaining({
        method: "GET",
        path: "/sales/sales-1/participants",
      }),
      response: expect.objectContaining({
        body: { participants: [{ id: "remote-1", email: "visitor@example.test" }] },
      }),
    });
  });

  it("fails closed after registration when the authoritative roster adds another same-email participant alongside one exact correlated match", async () => {
    const { deps, enrollments, listParticipants, registerParticipants, updateParticipantCorrelation, createSponsoredLink } = createDeps();
    listParticipants
      .mockResolvedValueOnce({
        participants: [],
        request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
        response: { status: 200, body: { participants: [] } },
      })
      .mockResolvedValueOnce({
        participants: [
          {
            id: "remote-1",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            invitationStatus: "notSent",
            invitedBy: null,
            participationStatus: "pending",
            firstJoined: null,
            environmentId: null,
            envStatus: null,
            customProperties: {
              certalisSalesTrialEnrollmentId: "enrollment-1",
              certalisSalesTrialParticipantUserId: "trial-user-1",
            },
          },
          {
            id: "remote-2",
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            invitationStatus: "notSent",
            invitedBy: null,
            participationStatus: "pending",
            firstJoined: null,
            environmentId: null,
            envStatus: null,
            customProperties: {},
          },
        ],
        request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
        response: { status: 200, body: { participants: [{ id: "remote-1" }, { id: "remote-2" }] } },
      });

    const result = await handleEnterSalesTrialOffering(deps, request);
    const persisted = await enrollments.findByOfferingAndPortalUser(
      "customer-1",
      "offering-1",
      "trial-user-1",
    );

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(registerParticipants).toHaveBeenCalledTimes(1);
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      status: "needs_attention",
      cloudShareParticipantId: null,
    });
  });

  it("records the sponsored-link integration surface when the redirect mint fails", async () => {
    const { deps, diagnosticRepository, enrollments, listParticipants, createSponsoredLink } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
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
    });
    const remoteParticipant = {
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
    };
    listParticipants.mockResolvedValue({
      participants: [remoteParticipant],
      request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });
    createSponsoredLink.mockRejectedValue(
      new CloudShareTransportError("CloudShare sponsored link request timed out.", {
        method: "POST",
        path: "/sales/sales-1/sponsored-link",
        requestBody: { firstName: "Ari" },
        cause: "ETIMEDOUT",
        transport: "tcp",
        network: { remoteAddress: "203.0.113.7" },
        tls: { protocol: "TLSv1.3" },
      }),
    );

    const result = await handleEnterSalesTrialOffering(deps, request);
    const [failure] = await diagnosticRepository.query({ source: "sales-trial-enrollment", outcome: "failure" });

    expect(result).toMatchObject({
      status: 404,
      body: { error: "This Sales Trial launch is unavailable.", correlationId: expect.any(String) },
    });
    expect(failure).toMatchObject({
      operation: "sales_trial.offering.entered",
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales.sponsored_link",
      }),
      request: expect.objectContaining({
        method: "POST",
        path: "/sales/sales-1/sponsored-link",
      }),
      response: expect.objectContaining({
        transport: "tcp",
        network: { remoteAddress: "203.0.113.7" },
      }),
    });
  });
});

describe("Sales Trial offering monitoring", () => {
  it("fails closed when the roster has duplicate exact correlations", async () => {
    const { deps, enrollments, audit, listParticipants } = createDeps();
    await enrollments.save({
      id: "enrollment-1", customerId: "customer-1", salesTrialOfferingId: "offering-1", portalUserId: "trial-user-1",
      email: "visitor@example.test", firstName: "Ari", lastName: "Visitor", cloudShareParticipantId: null,
      participationStatus: "pending", cloudShareRosterEnvironmentReference: null, environmentStatus: null, firstJoined: null,
      status: "active", attentionReason: null, lastLaunchedAt: null, lastReconciledAt: new Date("2026-08-30T10:00:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"), updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: ["remote-1", "remote-2"].map((id) => ({
        id, firstName: "Ari", lastName: "Visitor", email: "visitor@example.test", invitationStatus: "notSent",
        invitedBy: null, participationStatus: "inProgress", firstJoined: null, environmentId: null, envStatus: null,
        customProperties: { certalisSalesTrialEnrollmentId: "enrollment-1", certalisSalesTrialParticipantUserId: "trial-user-1" },
      })),
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }, { id: "remote-2" }] } },
    });

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1", offeringId: "offering-1", actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });

    expect(result).toEqual({
      status: 502,
      body: { error: "Sales Trial participant monitoring is unavailable.", correlationId: expect.any(String) },
    });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "sales_trial.offering.monitoring.read_participants", outcome: "failure",
    }));
  });

  it("does not mask an ambiguous live roster with stale ended-offering history", async () => {
    const { deps, enrollments, audit, listParticipants } = createDeps({
      offerings: {
        findById: vi.fn().mockResolvedValue(
          createOffering({ status: "ended", unpublishedAt: new Date("2026-08-30T17:05:00.000Z") }),
        ),
      },
    });
    await enrollments.save({
      id: "enrollment-1", customerId: "customer-1", salesTrialOfferingId: "offering-1", portalUserId: "trial-user-1",
      email: "visitor@example.test", firstName: "Ari", lastName: "Visitor", cloudShareParticipantId: null,
      participationStatus: "pending", cloudShareRosterEnvironmentReference: null, environmentStatus: null, firstJoined: null,
      status: "active", attentionReason: null, lastLaunchedAt: null, lastReconciledAt: new Date("2026-08-30T10:00:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"), updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: ["remote-1", "remote-2"].map((id) => ({
        id, firstName: "Ari", lastName: "Visitor", email: "visitor@example.test", invitationStatus: "notSent",
        invitedBy: null, participationStatus: "inProgress", firstJoined: null, environmentId: null, envStatus: null,
        customProperties: { certalisSalesTrialEnrollmentId: "enrollment-1", certalisSalesTrialParticipantUserId: "trial-user-1" },
      })),
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }, { id: "remote-2" }] } },
    });

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1", offeringId: "offering-1", actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });

    expect(result).toEqual({
      status: 502,
      body: { error: "Sales Trial participant monitoring is unavailable.", correlationId: expect.any(String) },
    });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "sales_trial.offering.monitoring.read_participants", outcome: "failure",
    }));
  });

  it("contains roster reconciliation persistence failures in the supportable monitoring response", async () => {
    const { deps, enrollments, audit, listParticipants } = createDeps();
    await enrollments.save({
      id: "enrollment-1", customerId: "customer-1", salesTrialOfferingId: "offering-1", portalUserId: "trial-user-1",
      email: "visitor@example.test", firstName: "Ari", lastName: "Visitor", cloudShareParticipantId: null,
      participationStatus: "pending", cloudShareRosterEnvironmentReference: null, environmentStatus: null, firstJoined: null,
      status: "active", attentionReason: null, lastLaunchedAt: null, lastReconciledAt: new Date("2026-08-30T10:00:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"), updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: [{
        id: "remote-1", firstName: "Ari", lastName: "Visitor", email: "visitor@example.test", invitationStatus: "notSent",
        invitedBy: null, participationStatus: "inProgress", firstJoined: null, environmentId: null, envStatus: null,
        customProperties: { certalisSalesTrialEnrollmentId: "enrollment-1", certalisSalesTrialParticipantUserId: "trial-user-1" },
      }],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });
    vi.spyOn(enrollments, "save").mockRejectedValueOnce(new Error("database unavailable"));

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1", offeringId: "offering-1", actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });

    expect(result).toEqual({
      status: 502,
      body: { error: "Sales Trial participant monitoring is unavailable.", correlationId: expect.any(String) },
    });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "sales_trial.offering.monitoring.read_participants", outcome: "failure",
    }));
  });

  it("reports a roster environment with no projectable status as not observed", async () => {
    const { deps, enrollments, listParticipants } = createDeps();
    await enrollments.save({
      id: "enrollment-1", customerId: "customer-1", salesTrialOfferingId: "offering-1", portalUserId: "trial-user-1",
      email: "visitor@example.test", firstName: "Ari", lastName: "Visitor", cloudShareParticipantId: null,
      participationStatus: "pending", cloudShareRosterEnvironmentReference: null, environmentStatus: null, firstJoined: null,
      status: "active", attentionReason: null, lastLaunchedAt: null, lastReconciledAt: new Date("2026-08-30T10:00:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"), updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: [{
        id: "remote-1", firstName: "Ari", lastName: "Visitor", email: "visitor@example.test", invitationStatus: "notSent",
        invitedBy: null, participationStatus: "inProgress", firstJoined: null, environmentId: "env-1", envStatus: null,
        customProperties: { certalisSalesTrialEnrollmentId: "enrollment-1", certalisSalesTrialParticipantUserId: "trial-user-1" },
      }],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1", offeringId: "offering-1", actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });

    expect(result).toMatchObject({
      status: 200,
      body: {
        participants: [
          expect.objectContaining({
            invitationStatus: "notSent",
            environment: expect.objectContaining({ source: "not_observed", value: null }),
          }),
        ],
      },
    });
  });

  it("projects enrolled participants for admin monitoring without provider ids or login URLs", async () => {
    const { deps, enrollments, listParticipants } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      participationStatus: "pending",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "CreationFailed",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:06:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:06:00.000Z"),
    });
    listParticipants.mockResolvedValue({
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
          envStatus: "FutureAllocationScheduled",
          customProperties: {
            certalisSalesTrialEnrollmentId: "enrollment-1",
            certalisSalesTrialParticipantUserId: "trial-user-1",
          },
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:09:00.000Z"));
    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    vi.useRealTimers();

    expect(result.body).toEqual({
      offering: {
        id: "offering-1",
        status: "published",
      },
      observation: {
        freshness: "live",
        source: "cloudshare_v4_sales_participant_roster",
        observedAt: "2026-08-30T10:09:00.000Z",
      },
      participants: [
        {
          id: "enrollment-1",
          subject: {
            type: "sales_trial_enrollment",
            id: "enrollment-1",
          },
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          participationStatus: "inProgress",
          observation: {
            freshness: "live",
            source: "cloudshare_v4_sales_participant_roster",
            observedAt: "2026-08-30T10:09:00.000Z",
          },
          firstJoined: "2026-08-30T10:05:00.000Z",
          envStatus: "FutureAllocationScheduled",
          environment: {
            dimension: "cloudshare_environment",
            value: "Future allocation scheduled",
            source: "cloudshare_v4_sales_participant_roster",
            observedAt: "2026-08-30T10:09:00.000Z",
          },
          extend: {
            enabled: true,
            reason: null,
          },
        },
      ],
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(result.body)).not.toContain("remote-1");
    expect(JSON.stringify(result.body)).not.toContain("loginUrl");
  });

  it("keeps retained participant monitoring visible after an offering reconciles from ending to ended in the same request", async () => {
    const offeringReads = vi.fn()
      .mockResolvedValueOnce(
        createOffering({
          status: "ending",
          end: "2026-08-30T17:00",
          endingCalculatedEnd: "2026-08-30T17:00",
          endingLastReconciledAt: new Date("2026-08-30T10:06:00.000Z"),
        }),
      )
      .mockResolvedValueOnce(
        createOffering({
          status: "ended",
          end: "2026-08-30T17:00",
          unpublishedAt: new Date("2026-08-30T17:05:00.000Z"),
        }),
      );
    const reconcileEnding = vi.fn().mockResolvedValue(undefined);
    const { deps, enrollments, listParticipants } = createDeps({
      offerings: { findById: offeringReads },
      reconcileEnding,
    });
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "CreationFailed",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:06:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:06:00.000Z"),
    });
    listParticipants.mockResolvedValue({
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
          envStatus: "FutureAllocationScheduled",
          customProperties: {
            certalisSalesTrialEnrollmentId: "enrollment-1",
            certalisSalesTrialParticipantUserId: "trial-user-1",
          },
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });

    expect(reconcileEnding).toHaveBeenCalledWith({
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    expect(result).toMatchObject({
      status: 200,
      body: {
        offering: { status: "ended" },
        observation: {
          freshness: "live",
          source: "cloudshare_v4_sales_participant_roster",
        },
        participants: [
          expect.objectContaining({
            id: "enrollment-1",
            subject: { type: "sales_trial_enrollment", id: "enrollment-1" },
          }),
        ],
      },
    });
  });

  it("marks unmatched retained rows as locally reconciled history when a live roster read returns only a partial match", async () => {
    const { deps, enrollments, listParticipants } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Ready",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:06:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:06:00.000Z"),
    });
    await enrollments.save({
      id: "enrollment-2",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-2",
      email: "second@example.test",
      firstName: "Bea",
      lastName: "Retained",
      cloudShareParticipantId: "remote-2",
      participationStatus: "concluded",
      cloudShareRosterEnvironmentReference: "env-2",
      environmentStatus: "Suspended",
      firstJoined: "2026-08-30T10:01:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:02:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    listParticipants.mockResolvedValue({
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
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:09:00.000Z"));
    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    vi.useRealTimers();

    expect(result).toMatchObject({
      status: 200,
      body: {
        observation: {
          freshness: "live",
          source: "cloudshare_v4_sales_participant_roster",
          observedAt: "2026-08-30T10:09:00.000Z",
        },
        participants: [
          expect.objectContaining({
            id: "enrollment-1",
            observation: {
              freshness: "live",
              source: "cloudshare_v4_sales_participant_roster",
              observedAt: "2026-08-30T10:09:00.000Z",
            },
          }),
          expect.objectContaining({
            id: "enrollment-2",
            participationStatus: "concluded",
            observation: {
              freshness: "stale",
              source: "certalis_sales_trial_enrollment_reconciliation",
              observedAt: "2026-08-30T10:07:00.000Z",
            },
            environment: expect.objectContaining({
              source: "certalis_sales_trial_enrollment_reconciliation",
              observedAt: "2026-08-30T10:07:00.000Z",
            }),
          }),
        ],
      },
    });
  });

  it("persists fresh roster participation state so stale monitoring retains concluded history", async () => {
    const offeringReads = vi.fn()
      .mockResolvedValueOnce(createOffering({ status: "published" }))
      .mockResolvedValueOnce(
        createOffering({
          status: "ended",
          unpublishedAt: new Date("2026-08-30T17:05:00.000Z"),
        }),
      );
    const { deps, enrollments, listParticipants } = createDeps({
      offerings: { findById: offeringReads },
    });
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Ready",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:06:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:06:00.000Z"),
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:09:00.000Z"));
    listParticipants.mockResolvedValueOnce({
      participants: [
        {
          id: "remote-1",
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          invitedBy: null,
          participationStatus: "concluded",
          firstJoined: "2026-08-30T10:05:00.000Z",
          environmentId: "env-1",
          envStatus: "FutureAllocationScheduled",
          customProperties: {
            certalisSalesTrialEnrollmentId: "enrollment-1",
            certalisSalesTrialParticipantUserId: "trial-user-1",
          },
        },
      ],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [{ id: "remote-1" }] } },
    });

    const fresh = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    listParticipants.mockRejectedValueOnce(
      new CloudShareTransportError("participant roster timed out", {
        method: "GET",
        path: "/sales/sales-1/participants",
        cause: "ETIMEDOUT",
        transport: "tcp",
      }),
    );
    const stale = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    vi.useRealTimers();

    expect(fresh).toMatchObject({
      status: 200,
      body: {
        observation: {
          freshness: "live",
          observedAt: "2026-08-30T10:09:00.000Z",
        },
        participants: [
          expect.objectContaining({
            participationStatus: "concluded",
            envStatus: "FutureAllocationScheduled",
            environment: expect.objectContaining({
              value: "Future allocation scheduled",
              observedAt: "2026-08-30T10:09:00.000Z",
            }),
          }),
        ],
      },
    });
    expect(stale).toMatchObject({
      status: 200,
      body: {
        observation: {
          freshness: "stale",
          observedAt: "2026-08-30T10:09:00.000Z",
        },
        participants: [
          expect.objectContaining({
            participationStatus: "concluded",
            envStatus: "FutureAllocationScheduled",
            environment: expect.objectContaining({
              value: "Future allocation scheduled",
              observedAt: "2026-08-30T10:09:00.000Z",
            }),
          }),
        ],
      },
    });
  });

  it("passes the customer-scoped reconciliation request object before reading ending history", async () => {
    const reconcileEnding = vi.fn().mockResolvedValue(undefined);
    const offeringReads = vi.fn()
      .mockResolvedValueOnce(createOffering({ status: "ending" }))
      .mockResolvedValueOnce(createOffering({ status: "unpublished" }));
    const { deps } = createDeps({
      offerings: { findById: offeringReads },
      reconcileEnding,
    });

    await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-9", email: "sales-admin@example.test" },
    });

    expect(reconcileEnding).toHaveBeenCalledWith({
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-9", email: "sales-admin@example.test" },
    });
  });

  it.each([
    {
      label: "the roster request times out",
      error: new CloudShareTransportError("participant roster timed out", {
        method: "GET",
        path: "/sales/sales-1/participants",
        requestQuery: { offset: "0", limit: "100" },
        requestHeaders: { authorization: "Bearer secret", "x-request-id": "req-1" },
        cause: "ETIMEDOUT",
        transport: "tcp",
      }),
    },
    {
      label: "CloudShare no longer exposes the ended roster",
      error: new CloudShareRequestError("participant roster was not found", 404, {
        method: "GET",
        path: "/sales/sales-1/participants",
      }),
    },
  ])("falls back to the last locally reconciled participant state with explicit timestamp and source when $label", async ({ error }) => {
    const { deps, enrollments, diagnosticRepository, audit, listParticipants } = createDeps({
      offerings: {
        findById: vi.fn().mockResolvedValue(
          createOffering({
            status: "ended",
            unpublishedAt: new Date("2026-08-30T17:05:00.000Z"),
          }),
        ),
      },
    });
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      participationStatus: "concluded",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "CreationFailed",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    listParticipants.mockRejectedValue(error);

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.monitoring.read_participants",
      outcome: "failure",
    });

    expect(result).toEqual({
      status: 200,
      body: {
        offering: { id: "offering-1", status: "ended" },
        observation: {
          freshness: "stale",
          source: "certalis_sales_trial_enrollment_reconciliation",
          observedAt: "2026-08-30T10:07:00.000Z",
          warning: "CloudShare could not refresh the participant roster; showing the last locally reconciled participant state.",
        },
        participants: [
          {
            id: "enrollment-1",
            subject: {
              type: "sales_trial_enrollment",
              id: "enrollment-1",
            },
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          participationStatus: "concluded",
            observation: {
              freshness: "stale",
              source: "certalis_sales_trial_enrollment_reconciliation",
              observedAt: "2026-08-30T10:07:00.000Z",
            },
            firstJoined: "2026-08-30T10:05:00.000Z",
            envStatus: "CreationFailed",
            environment: {
              dimension: "cloudshare_environment",
              value: "Creation Failed",
              source: "certalis_sales_trial_enrollment_reconciliation",
              observedAt: "2026-08-30T10:07:00.000Z",
            },
            extend: {
              enabled: false,
              reason: "Only active Sales Trial participants can extend their environment.",
            },
          },
        ],
        correlationId: expect.any(String),
      },
    });
    expect(failure).toMatchObject({
      correlationId: result.body.correlationId,
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales.participants",
        attemptedOperation: "list_participants",
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.monitoring.read_participants",
        correlationId: result.body.correlationId,
        outcome: "failure",
      }),
    );
  });

  it("retains unpublished offering history instead of returning the misleading not-found response", async () => {
    const { deps, enrollments, listParticipants, diagnosticRepository } = createDeps({
      offerings: {
        findById: vi.fn().mockResolvedValue(
          createOffering({
            status: "unpublished",
            unpublishedAt: new Date("2026-08-30T17:05:00.000Z"),
          }),
        ),
      },
    });
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
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
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    listParticipants.mockRejectedValue(
      new CloudShareTransportError("participant roster timed out", {
        method: "GET",
        path: "/sales/sales-1/participants",
        cause: "ETIMEDOUT",
        transport: "tcp",
      }),
    );

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.monitoring.read_participants",
      outcome: "failure",
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      offering: { id: "offering-1", status: "unpublished" },
      observation: {
        freshness: "stale",
        source: "certalis_sales_trial_enrollment_reconciliation",
        observedAt: "2026-08-30T10:07:00.000Z",
      },
      participants: [expect.objectContaining({ id: "enrollment-1" })],
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(result.body)).not.toContain("Sales Trial Offering was not found");
    expect(failure).toBeTruthy();
  });

  it("does not present stale history while an ending offering roster cannot be refreshed", async () => {
    const { deps, enrollments, listParticipants, diagnosticRepository } = createDeps({
      offerings: {
        findById: vi.fn().mockResolvedValue(
          createOffering({
            status: "ending",
            endingCalculatedEnd: "2026-08-30T17:00",
            endingLastReconciledAt: new Date("2026-08-30T10:08:00.000Z"),
          }),
        ),
      },
    });
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Suspended",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    listParticipants.mockRejectedValue(
      new CloudShareTransportError("participant roster timed out", {
        method: "GET",
        path: "/sales/sales-1/participants",
        cause: "ETIMEDOUT",
        transport: "tcp",
      }),
    );

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.monitoring.read_participants",
      outcome: "failure",
    });

    expect(result).toEqual({
      status: 502,
      body: { error: "Sales Trial participant monitoring is unavailable.", correlationId: expect.any(String) },
    });
    expect(failure).toBeTruthy();
  });

  it("treats a missing CloudShare connection as stale roster unavailability for retained ended history", async () => {
    const { deps, enrollments } = createDeps({
      offerings: {
        findById: vi.fn().mockResolvedValue(
          createOffering({
            status: "ended",
            unpublishedAt: new Date("2026-08-30T17:05:00.000Z"),
          }),
        ),
      },
      connections: { findByCustomerId: vi.fn().mockResolvedValue(null) },
    });
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      participationStatus: "concluded",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "CreationFailed",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });

    expect(result).toEqual({
      status: 200,
      body: {
        offering: { id: "offering-1", status: "ended" },
        observation: {
          freshness: "stale",
          source: "certalis_sales_trial_enrollment_reconciliation",
          observedAt: "2026-08-30T10:07:00.000Z",
          warning:
            "CloudShare could not refresh the participant roster; showing the last locally reconciled participant state.",
        },
        participants: [
          {
            id: "enrollment-1",
            subject: {
              type: "sales_trial_enrollment",
              id: "enrollment-1",
            },
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          invitationStatus: "notSent",
          participationStatus: "concluded",
            observation: {
              freshness: "stale",
              source: "certalis_sales_trial_enrollment_reconciliation",
              observedAt: "2026-08-30T10:07:00.000Z",
            },
            firstJoined: "2026-08-30T10:05:00.000Z",
            envStatus: "CreationFailed",
            environment: {
              dimension: "cloudshare_environment",
              value: "Creation Failed",
              source: "certalis_sales_trial_enrollment_reconciliation",
              observedAt: "2026-08-30T10:07:00.000Z",
            },
            extend: {
              enabled: false,
              reason: "Only active Sales Trial participants can extend their environment.",
            },
          },
        ],
        correlationId: expect.any(String),
      },
    });
  });

  it("records the current live roster read time even when the provider roster is empty", async () => {
    const { deps, listParticipants, enrollments } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      participationStatus: "concluded",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "CreationFailed",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    listParticipants.mockResolvedValue({
      participants: [],
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: { participants: [] } },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:11:00.000Z"));
    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    vi.useRealTimers();

    expect(result).toMatchObject({
      status: 200,
      body: {
        observation: {
          freshness: "live",
          source: "cloudshare_v4_sales_participant_roster",
          observedAt: "2026-08-30T10:11:00.000Z",
        },
        participants: [
          expect.objectContaining({
            id: "enrollment-1",
            observation: {
              freshness: "stale",
              source: "certalis_sales_trial_enrollment_reconciliation",
              observedAt: "2026-08-30T10:07:00.000Z",
            },
          }),
        ],
      },
    });
  });

  it("returns a safe monitoring failure while recording protected provider evidence and audit", async () => {
    const { deps, diagnosticRepository, audit, enrollments, listParticipants } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      cloudShareRosterEnvironmentReference: null,
      environmentStatus: null,
      firstJoined: null,
      status: "active",
      attentionReason: null,
      lastLaunchedAt: null,
      lastReconciledAt: new Date("2026-08-30T10:00:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    });
    listParticipants.mockRejectedValue(
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
    );

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.monitoring.read_participants",
      outcome: "failure",
    });

    expect(result).toEqual({
      status: 502,
      body: {
        error: "Sales Trial participant monitoring is unavailable.",
        correlationId: expect.any(String),
      },
    });
    expect(failure).toMatchObject({
      customerId: "customer-1",
      correlationId: result.body.correlationId,
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales.participants",
        attemptedOperation: "list_participants",
      }),
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
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.monitoring.read_participants",
        correlationId: result.body.correlationId,
        details: expect.objectContaining({
          attemptedOperation: "list_participants",
          integrationSurface: "cloudshare.v4.sales.participants",
        }),
      }),
    );
    expect(JSON.stringify(result.body)).not.toContain("203.0.113.10");
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });
});

describe("Sales Trial participant environment extension", () => {
  it("extends an exact retained environment mapping, reads back the provider state, and returns a safe monitoring projection", async () => {
    const { deps, enrollments, diagnosticRepository, audit, observe, extendById, observeById } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    observe
      .mockResolvedValueOnce({
        environmentId: "opaque-v3-env-1",
        statusCode: 4,
        expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
        exchanges: [
          {
            request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
            response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
          },
          {
            request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
            response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
          },
        ],
      })
      ;
    observeById.mockResolvedValueOnce({
      environmentId: "opaque-v3-env-1",
      statusCode: 4,
      expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
      exchanges: [
        {
          request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
          response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" } },
        },
      ],
    });

    const result = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const persisted = await enrollments.findById?.("customer-1", "enrollment-1");
    const [success] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "success",
    });

    expect(result).toEqual({
      status: 200,
      body: {
        participant: expect.objectContaining({
          id: "enrollment-1",
          envStatus: "Archived",
          observation: {
            freshness: "stale",
            source: "certalis_sales_trial_enrollment_reconciliation",
            observedAt: "2026-08-30T10:00:00.000Z",
          },
          environment: {
            dimension: "cloudshare_environment",
            value: "Archived",
            source: "certalis_sales_trial_enrollment_reconciliation",
            observedAt: "2026-08-30T10:00:00.000Z",
          },
        }),
        correlationId: expect.any(String),
      },
    });
    expect(observe).toHaveBeenCalledWith({
      ownerEmail: "visitor@example.test",
      projectId: "project-1",
    });
    expect(extendById).toHaveBeenCalledWith("opaque-v3-env-1");
    expect(observeById).toHaveBeenCalledTimes(1);
    expect(observeById).toHaveBeenNthCalledWith(1, "opaque-v3-env-1");
    expect(persisted).toMatchObject({
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
      lastReconciledAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    });
    expect(success).toMatchObject({
      correlationId: result.body.correlationId,
      externalIds: expect.objectContaining({
        environmentId: "opaque-v3-env-1",
      }),
      request: expect.objectContaining({
        method: "PUT",
        path: "/api/v3/envs/actions/extend",
        query: { envId: "opaque-v3-env-1" },
      }),
      response: expect.objectContaining({ status: 200, body: "" }),
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v3.environments",
        attemptedOperation: "extend_environment",
        expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
        httpExchanges: expect.arrayContaining([
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs",
              query: { ownerEmail: "visitor@example.test", brief: "false" },
            }),
          }),
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs/actions/getextended",
              query: { envId: "opaque-v3-env-1" },
            }),
          }),
          expect.objectContaining({
            request: expect.objectContaining({
              method: "PUT",
              path: "/api/v3/envs/actions/extend",
              query: { envId: "opaque-v3-env-1" },
            }),
          }),
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs/actions/getextended",
              query: { envId: "opaque-v3-env-1" },
            }),
          }),
        ]),
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.environment.extend",
        correlationId: result.body.correlationId,
        outcome: "success",
      }),
    );
    expect(JSON.stringify(result.body)).not.toContain("env-1");
    expect(JSON.stringify(result.body)).not.toContain("remote-1");
  });

  it("fails closed before provider mutation when the enrollment does not retain a continuable environment", async () => {
    const { deps, enrollments, extendById } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "concluded",
      cloudShareRosterEnvironmentReference: null,
      environmentStatus: "Deleted",
      observedExpirationTime: null,
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });

    const result = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });

    expect(result).toEqual({
      status: 409,
      body: {
        error: "This Sales Trial environment cannot be extended.",
        reason: "A retained CloudShare environment mapping is required before Certalis can request an extension.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).not.toHaveBeenCalled();
  });

  it("does not mutate the provider when preflight reports a terminal environment, persists the observed state, and records protected diagnostics", async () => {
    const { deps, enrollments, diagnosticRepository, audit, extendById, observe } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    observe.mockResolvedValueOnce({
      environmentId: "opaque-v3-env-1",
      statusCode: 5,
      expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      exchanges: [
        {
          request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
          response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
        },
        {
          request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
          response: { status: 200, body: { statusCode: 5, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
        },
      ],
    });

    const result = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const persisted = await enrollments.findById?.("customer-1", "enrollment-1");
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });

    expect(result).toEqual({
      status: 409,
      body: {
        error: "This Sales Trial environment cannot be extended.",
        reason: "CloudShare now reports this retained environment as terminal and not extendable.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      environmentStatus: "Deleted",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      status: "active",
      attentionReason: null,
    });
    expect(failure).toMatchObject({
      customerId: "customer-1",
      correlationId: result.body.correlationId,
      details: expect.objectContaining({
        attemptedOperation: "observe_extended_environment",
        failureMode: "CloudShare now reports this retained environment as terminal and not extendable.",
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.environment.extend",
        outcome: "failure",
        correlationId: result.body.correlationId,
        details: expect.objectContaining({
          attemptedOperation: "observe_extended_environment",
          failureMode: "CloudShare now reports this retained environment as terminal and not extendable.",
        }),
      }),
    );
  });

  it("treats CreationFailed as terminal before mutation and keeps the participant ineligible for extend", async () => {
    const { deps, enrollments, extendById, observe } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    observe.mockResolvedValueOnce({
      environmentId: "opaque-v3-env-1",
      statusCode: 9,
      expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      exchanges: [
        {
          request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
          response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
        },
        {
          request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
          response: { status: 200, body: { statusCode: 9, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
        },
      ],
    });

    const extendResult = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const monitoringResult = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });

    expect(extendResult).toEqual({
      status: 409,
      body: {
        error: "This Sales Trial environment cannot be extended.",
        reason: "CloudShare now reports this retained environment as terminal and not extendable.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).not.toHaveBeenCalled();
    expect(monitoringResult).toMatchObject({
      status: 200,
      body: {
        participants: [
          expect.objectContaining({
            envStatus: "CreationFailed",
            extend: {
              enabled: false,
              reason: "CloudShare does not currently report this retained environment as eligible for extension.",
            },
          }),
        ],
      },
    });
  });

  it("blocks replay after an ambiguous extend outcome, records both exchanges, and reconciles on retry before allowing success", async () => {
    const { deps, enrollments, diagnosticRepository, observe, extendById, observeById } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    observe
      .mockResolvedValueOnce({
        environmentId: "opaque-v3-env-1",
        statusCode: 4,
        expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
        exchanges: [
          {
            request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
            response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
          },
          {
            request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
            response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
          },
        ],
      })
      .mockResolvedValueOnce({
        environmentId: "opaque-v3-env-1",
        statusCode: 4,
        expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
        exchanges: [
          {
            request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
            response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
          },
          {
            request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
            response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" } },
          },
        ],
      });
    observeById.mockRejectedValueOnce(
      new CloudShareTransportError("getextended timed out", {
        method: "GET",
        path: "/api/v3/envs/actions/getextended",
        requestQuery: { envId: "opaque-v3-env-1" },
        requestHeaders: { authorization: "cs_sha1 secret", "x-request-id": "req-1" },
        cause: "ETIMEDOUT",
        transport: "tcp",
      }),
    );

    const first = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const unresolved = await enrollments.findById?.("customer-1", "enrollment-1");
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });

    expect(first).toEqual({
      status: 502,
      body: {
        error: "Sales Trial environment extension could not be confirmed.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).toHaveBeenCalledWith("opaque-v3-env-1");
    expect(unresolved).toMatchObject({
      status: "needs_attention",
      attentionReason:
        "The previous Sales Trial extension outcome is still unconfirmed. Certalis must reconcile the current CloudShare state before another extension can be requested.",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
    });
    expect(failure).toMatchObject({
      correlationId: first.body.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/api/v3/envs/actions/getextended",
        query: { envId: "opaque-v3-env-1" },
        headers: { authorization: "[REDACTED]", "x-request-id": "req-1" },
      }),
      externalIds: expect.objectContaining({
        environmentId: "opaque-v3-env-1",
      }),
      details: expect.objectContaining({
        attemptedOperation: "observe_extended_environment",
        failureMode: "transport_failure",
        httpExchanges: expect.arrayContaining([
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs",
              query: { ownerEmail: "visitor@example.test", brief: "false" },
            }),
          }),
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs/actions/getextended",
              query: { envId: "opaque-v3-env-1" },
            }),
          }),
          expect.objectContaining({
            request: expect.objectContaining({
              method: "PUT",
              path: "/api/v3/envs/actions/extend",
              query: { envId: "opaque-v3-env-1" },
            }),
          }),
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs/actions/getextended",
              query: { envId: "opaque-v3-env-1" },
            }),
          }),
        ]),
      }),
    });

    const second = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const reconciled = await enrollments.findById?.("customer-1", "enrollment-1");
    const successes = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "success",
    });

    expect(second).toEqual({
      status: 200,
      body: {
        participant: expect.objectContaining({
          id: "enrollment-1",
          envStatus: "Archived",
        }),
        correlationId: expect.any(String),
      },
    });
    expect(extendById).toHaveBeenCalledTimes(1);
    expect(observeById).toHaveBeenCalledTimes(1);
    expect(reconciled).toMatchObject({
      status: "active",
      attentionReason: null,
      observedExpirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
    });
    expect(successes.at(-1)).toMatchObject({
      correlationId: second.body.correlationId,
      details: expect.objectContaining({
        attemptedOperation: "observe_extended_environment",
        expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
      }),
    });
  });

  it("does not record success on a reconcile-only retry when CloudShare now reports the environment as terminal", async () => {
    const { deps, enrollments, diagnosticRepository, observe, extendById } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "needs_attention",
      attentionReason:
        "The previous Sales Trial extension outcome is still unconfirmed. Certalis must reconcile the current CloudShare state before another extension can be requested.",
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    observe.mockResolvedValueOnce({
      environmentId: "opaque-v3-env-1",
      statusCode: 5,
      expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
      exchanges: [
        {
          request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
          response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
        },
        {
          request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
          response: { status: 200, body: { statusCode: 5, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" } },
        },
      ],
    });

    const result = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const persisted = await enrollments.findById?.("customer-1", "enrollment-1");
    const failures = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });
    const successes = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "success",
    });

    expect(result).toEqual({
      status: 409,
      body: {
        error: "This Sales Trial environment cannot be extended.",
        reason: "CloudShare now reports this retained environment as terminal and not extendable.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({
      status: "active",
      attentionReason: null,
      environmentStatus: "Deleted",
      observedExpirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      externalIds: expect.objectContaining({
        environmentId: "opaque-v3-env-1",
      }),
    });
    expect(successes).toHaveLength(0);
  });

  it("keeps the durable no-replay fence when post-mutation reconciliation persistence fails, then blocks a second PUT", async () => {
    const backing = createEnrollmentRepository();
    await backing.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    const save = vi.fn(async (enrollment: SalesTrialEnrollment) => {
      if (
        enrollment.status === "active" &&
        enrollment.observedExpirationTime === "Tue, 01 Sep 2026 13:00:00 GMT"
      ) {
        throw new Error("write conflict");
      }
      await backing.save(enrollment);
    });
    const { deps, extendById, observe, observeById, diagnosticRepository } = createDeps({
      enrollments: {
        ...backing,
        save,
      },
    });
    observe
      .mockResolvedValueOnce({
        environmentId: "opaque-v3-env-1",
        statusCode: 4,
        expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
        exchanges: [
          {
            request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
            response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
          },
          {
            request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
            response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
          },
        ],
      })
      .mockResolvedValueOnce({
        environmentId: "opaque-v3-env-1",
        statusCode: 4,
        expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
        exchanges: [
          {
            request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
            response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
          },
          {
            request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
            response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" } },
          },
        ],
      });
    observeById.mockResolvedValueOnce({
      environmentId: "opaque-v3-env-1",
      statusCode: 4,
      expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
      exchanges: [
        {
          request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
          response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" } },
        },
      ],
    });

    const first = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const afterFirst = await backing.findById?.("customer-1", "enrollment-1");
    const second = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });

    expect(first).toEqual({
      status: 502,
      body: {
        error: "Sales Trial environment extension could not be confirmed.",
        correlationId: expect.any(String),
      },
    });
    expect(afterFirst).toMatchObject({
      status: "needs_attention",
      attentionReason:
        "The previous Sales Trial extension outcome is still unconfirmed. Certalis must reconcile the current CloudShare state before another extension can be requested.",
    });
    expect(second).toEqual({
      status: 502,
      body: {
        error: "Sales Trial environment extension could not be confirmed.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).toHaveBeenCalledTimes(1);
    const failures = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });
    const failure = failures.find(
      (entry) => entry.correlationId === first.body.correlationId,
    );
    expect(failure).toBeDefined();
    expect(failure).toMatchObject({
      correlationId: first.body.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/api/v3/envs/actions/getextended",
        query: { envId: "opaque-v3-env-1" },
      }),
      externalIds: expect.objectContaining({
        environmentId: "opaque-v3-env-1",
      }),
      details: expect.objectContaining({
        failureMode: "persistence_failure",
        httpExchanges: expect.arrayContaining([
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs",
              query: { ownerEmail: "visitor@example.test", brief: "false" },
            }),
          }),
        ]),
      }),
    });
    expect(JSON.stringify(first.body)).not.toContain("opaque-v3-env-1");
  });

  it("persists a resolution-needed attention state and retains list exchanges when CloudShare cannot resolve exactly one same-project environment", async () => {
    const { deps, enrollments, diagnosticRepository, extendById, observe } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    observe.mockRejectedValueOnce(
      new SalesEnvironmentResolutionError("environment_ambiguous_for_project", [
        {
          request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
          response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }, { id: "opaque-v3-env-2", projectId: "project-1" }] },
        },
      ]),
    );

    const first = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const persisted = await enrollments.findById?.("customer-1", "enrollment-1");
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });

    expect(first).toEqual({
      status: 502,
      body: {
        error: "Sales Trial environment extension could not be confirmed.",
        correlationId: expect.any(String),
      },
    });
    expect(persisted).toMatchObject({
      status: "needs_attention",
      attentionReason:
        "Certalis could not resolve exactly one retained CloudShare environment for this participant. Support reconciliation is required before another extension can be requested.",
    });
    expect(extendById).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      correlationId: first.body.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/api/v3/envs",
        query: { ownerEmail: "visitor@example.test", brief: "false" },
      }),
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v3.environments",
        attemptedOperation: "resolve_environment_for_project",
        failureMode: "environment_ambiguous_for_project",
        httpExchanges: [
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs",
              query: { ownerEmail: "visitor@example.test", brief: "false" },
            }),
          }),
        ],
      }),
    });
    expect(JSON.stringify(first.body)).not.toContain("opaque-v3-env-1");

    const second = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });

    expect(second).toEqual({
      status: 409,
      body: {
        error: "This Sales Trial environment cannot be extended.",
        reason:
          "Certalis could not resolve exactly one retained CloudShare environment for this participant. Support reconciliation is required before another extension can be requested.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).not.toHaveBeenCalled();
  });

  it("classifies resolution persistence save failures without polluting protected external ids", async () => {
    const backing = createEnrollmentRepository();
    await backing.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    const save = vi.fn(async (enrollment: SalesTrialEnrollment) => {
      if (
        enrollment.status === "needs_attention" &&
        enrollment.attentionReason ===
          "Certalis could not resolve exactly one retained CloudShare environment for this participant. Support reconciliation is required before another extension can be requested."
      ) {
        throw new Error("write conflict");
      }
      await backing.save(enrollment);
    });
    const { deps, diagnosticRepository, extendById, observe } = createDeps({
      enrollments: {
        ...backing,
        save,
      },
    });
    observe.mockRejectedValueOnce(
      new SalesEnvironmentResolutionError("environment_ambiguous_for_project", [
        {
          request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
          response: {
            status: 200,
            body: [
              { id: "opaque-v3-env-1", projectId: "project-1" },
              { id: "opaque-v3-env-2", projectId: "project-1" },
            ],
          },
        },
      ]),
    );

    const result = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });

    expect(result).toEqual({
      status: 502,
      body: {
        error: "Sales Trial environment extension could not be confirmed.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      correlationId: result.body.correlationId,
      request: expect.objectContaining({
        method: "GET",
        path: "/api/v3/envs",
        query: { ownerEmail: "visitor@example.test", brief: "false" },
      }),
      details: expect.objectContaining({
        attemptedOperation: "resolve_environment_for_project",
        failureMode: "persistence_failure",
        httpExchanges: [
          expect.objectContaining({
            request: expect.objectContaining({
              method: "GET",
              path: "/api/v3/envs",
              query: { ownerEmail: "visitor@example.test", brief: "false" },
            }),
          }),
        ],
      }),
    });
    expect(failure.externalIds).not.toHaveProperty("environmentId");
    expect(JSON.stringify(failure.externalIds)).not.toContain("persistence_failure");
    expect(JSON.stringify(result.body)).not.toContain("opaque-v3-env-1");
  });

  it("records safe guard-denied diagnostics when the retained mapping is unavailable before any provider call", async () => {
    const { deps, enrollments, diagnosticRepository, audit, extendById } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "concluded",
      cloudShareRosterEnvironmentReference: null,
      environmentStatus: "Deleted",
      observedExpirationTime: null,
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });

    const result = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });

    expect(result).toEqual({
      status: 409,
      body: {
        error: "This Sales Trial environment cannot be extended.",
        reason: "A retained CloudShare environment mapping is required before Certalis can request an extension.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      correlationId: result.body.correlationId,
      details: expect.objectContaining({
        integrationSurface: "portal.sales_trial",
        attemptedOperation: "portal_guard",
        failureMode: "A retained CloudShare environment mapping is required before Certalis can request an extension.",
        httpExchanges: [],
      }),
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_trial.offering.environment.extend",
        outcome: "failure",
        correlationId: result.body.correlationId,
        details: expect.objectContaining({
          attemptedOperation: "portal_guard",
          failureMode: "A retained CloudShare environment mapping is required before Certalis can request an extension.",
        }),
      }),
    );
  });

  it("fails closed after a successful PUT when post-extend readback reports a terminal environment", async () => {
    const { deps, enrollments, diagnosticRepository, observe, extendById, observeById } = createDeps();
    await enrollments.save({
      id: "enrollment-1",
      customerId: "customer-1",
      salesTrialOfferingId: "offering-1",
      portalUserId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      cloudShareParticipantId: "remote-1",
      invitationStatus: "sent",
      participationStatus: "inProgress",
      cloudShareRosterEnvironmentReference: "env-1",
      environmentStatus: "Archived",
      observedExpirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
      firstJoined: "2026-08-30T10:05:00.000Z",
      status: "active",
      attentionReason: null,
      lastLaunchedAt: new Date("2026-08-30T10:06:00.000Z"),
      lastReconciledAt: new Date("2026-08-30T10:07:00.000Z"),
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      updatedAt: new Date("2026-08-30T10:07:00.000Z"),
    });
    observe
      .mockResolvedValueOnce({
        environmentId: "opaque-v3-env-1",
        statusCode: 4,
        expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT",
        exchanges: [
          {
            request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: "visitor@example.test", brief: "false" } },
            response: { status: 200, body: [{ id: "opaque-v3-env-1", projectId: "project-1" }] },
          },
          {
            request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
            response: { status: 200, body: { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 12:00:00 GMT" } },
          },
        ],
      });
    observeById.mockResolvedValueOnce({
      environmentId: "opaque-v3-env-1",
      statusCode: 5,
      expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
      exchanges: [
        {
          request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-env-1" } },
          response: { status: 200, body: { statusCode: 5, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" } },
        },
      ],
    });

    const result = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });
    const persisted = await enrollments.findById?.("customer-1", "enrollment-1");
    const [failure] = await diagnosticRepository.query({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
    });

    expect(result).toEqual({
      status: 409,
      body: {
        error: "This Sales Trial environment cannot be extended.",
        reason: "CloudShare now reports this retained environment as terminal and not extendable.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({
      environmentStatus: "Deleted",
      observedExpirationTime: "Tue, 01 Sep 2026 13:00:00 GMT",
      status: "active",
      attentionReason: null,
    });
    expect(failure).toMatchObject({
      correlationId: result.body.correlationId,
      details: expect.objectContaining({
        attemptedOperation: "observe_extended_environment",
        failureMode: "CloudShare now reports this retained environment as terminal and not extendable.",
      }),
    });
  });

  it("fails closed for a customer-scoped enrollment lookup miss", async () => {
    const { deps, extendById, observe, observeById, diagnosticRepository } = createDeps({
      enrollments: {
        ...createEnrollmentRepository(),
        findById: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await handleExtendSalesTrialOfferingParticipant(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      enrollmentId: "enrollment-1",
      actor: { type: "admin", id: "admin-1", email: "sales-admin@example.test" },
    });

    expect(result).toEqual({
      status: 404,
      body: {
        error: "This Sales Trial environment cannot be extended.",
        correlationId: expect.any(String),
      },
    });
    expect(extendById).not.toHaveBeenCalled();
    expect(observeById).not.toHaveBeenCalled();
  });
});
