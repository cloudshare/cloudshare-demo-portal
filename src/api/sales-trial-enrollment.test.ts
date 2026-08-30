import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import type { SalesTrialOffering } from "@/domain/sales-trial-offering";
import type { SalesTrialEnrollment, SalesTrialEnrollmentRepository } from "@/domain/sales-trial-enrollment";
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
  const diagnostics = createDiagnosticRecorder({
    repository: createInMemoryDiagnosticLogRepository(),
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
  return { deps, enrollments, listParticipants, registerParticipants, updateParticipantCorrelation, createSponsoredLink };
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
    const { deps, listParticipants, registerParticipants, createSponsoredLink } = createDeps();
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
});
