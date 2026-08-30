import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import type { SalesTrialOffering } from "@/domain/sales-trial-offering";
import type { SalesTrialEnrollment, SalesTrialEnrollmentRepository } from "@/domain/sales-trial-enrollment";
import { CloudShareTransportError } from "@/integrations/cloudshare/errors";
import {
  handleEnterSalesTrialOffering,
  handleListSalesTrialOfferingParticipants,
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
    async listByOffering(customerId, salesTrialOfferingId) {
      return [...rows.values()].filter(
        (row) =>
          row.customerId === customerId && row.salesTrialOfferingId === salesTrialOfferingId,
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
  const deps = {
    offerings: { findById: vi.fn().mockResolvedValue(offering) },
    enrollments,
    connections: { findByCustomerId: vi.fn().mockResolvedValue({ id: "connection-1" }) },
    deliveryFactory: {
      forConnection: vi.fn().mockReturnValue({
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
    now: () => new Date("2026-08-30T10:00:00.000Z"),
    newId: () => "enrollment-1",
    ...overrides,
  };
  return {
    deps,
    enrollments,
    diagnosticRepository,
    audit: deps.audit,
    listParticipants,
    registerParticipants,
    updateParticipantCorrelation,
    createSponsoredLink,
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
          envStatus: "Ready",
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

    const result = await handleListSalesTrialOfferingParticipants(deps, {
      customerId: "customer-1",
      offeringId: "offering-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
    });

    expect(result.body).toEqual({
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
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(result.body)).not.toContain("remote-1");
    expect(JSON.stringify(result.body)).not.toContain("loginUrl");
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
