import { describe, expect, it, vi } from "vitest";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import type { Item, ItemRepository } from "@/domain/item";
import type {
  SalesTrialOffering,
  SalesTrialOfferingRepository,
} from "@/domain/sales-trial-offering";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import {
  CLOUDSHARE_ERROR_DISCRIMINANT,
  CloudShareAuthError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { SalesItemProvisioningValidationError } from "@/integrations/cloudshare/sales-item-provisioning";
import {
  handleCreateSalesTrialOffering,
  handleEndSalesTrialOffering,
  handleListPublishedSalesTrialOfferings,
  handleListSalesTrialOfferings,
  handlePublishSalesTrialOffering,
  handleUnpublishSalesTrialOffering,
} from "./sales-trial-offerings";

function createOfferingRepository(): SalesTrialOfferingRepository {
  const rows = new Map<string, SalesTrialOffering>();

  return {
    async save(offering) {
      rows.set(offering.id, offering);
    },
    async reservePublication(customerId, id, update) {
      const offering = rows.get(id) ?? null;
      if (
        !offering ||
        offering.customerId !== customerId ||
        offering.status !== "draft" ||
        offering.cloudShareSalesExperienceId !== null ||
        offering.externalId !== null
      ) {
        return false;
      }
      rows.set(id, {
        ...offering,
        externalId: update.externalId,
        status: "provisioning",
        updatedAt: update.updatedAt,
        attentionReason: update.attentionReason,
      });
      return true;
    },
    async releasePublicationReservation(customerId, id, update) {
      const offering = rows.get(id) ?? null;
      if (
        !offering ||
        offering.customerId !== customerId ||
        offering.status !== "provisioning" ||
        offering.cloudShareSalesExperienceId !== null
      ) {
        return false;
      }
      rows.set(id, {
        ...offering,
        externalId: null,
        status: "draft",
        updatedAt: update.updatedAt,
        attentionReason: update.attentionReason,
      });
      return true;
    },
    async markPublishNeedsAttention(customerId, id, update) {
      const offering = rows.get(id) ?? null;
      if (!offering || offering.customerId !== customerId) {
        return false;
      }
      rows.set(id, {
        ...offering,
        cloudShareSalesExperienceId: update.cloudShareSalesExperienceId,
        externalId: update.externalId,
        salesProDisplayName: update.salesProDisplayName,
        status: "needs_attention",
        updatedAt: update.updatedAt,
        publishedAt: update.publishedAt,
        attentionReason: update.attentionReason,
      });
      return true;
    },
    async markEndNeedsAttention(customerId, id, update) {
      const offering = rows.get(id) ?? null;
      if (!offering || offering.customerId !== customerId) {
        return false;
      }
      rows.set(id, {
        ...offering,
        end: update.end,
        status: "needs_attention",
        updatedAt: update.updatedAt,
        unpublishedAt: update.unpublishedAt,
        attentionReason: update.attentionReason,
      });
      return true;
    },
    async findById(customerId, id) {
      const offering = rows.get(id) ?? null;
      return offering?.customerId === customerId ? offering : null;
    },
    async listByCustomerId(customerId) {
      return [...rows.values()].filter((offering) => offering.customerId === customerId);
    },
    async listPublishedByCustomerId(customerId) {
      return [...rows.values()].filter(
        (offering) => offering.customerId === customerId && offering.status === "published",
      );
    },
    async listEnding(customerId) {
      return [...rows.values()].filter((offering) => offering.status === "ending" && (!customerId || offering.customerId === customerId));
    },
    async reserveEndingReconciliation(customerId, id, token, now, expiresAt, unpublishedAt) {
      const offering = rows.get(id);
      if (!offering || offering.customerId !== customerId || (offering.status !== "published" && offering.status !== "ending") ||
        (offering.endingLeaseToken && offering.endingLeaseExpiresAt && offering.endingLeaseExpiresAt > now)) return false;
      rows.set(id, { ...offering, status: "ending", unpublishedAt, updatedAt: now, attentionReason: null, endingLeaseToken: token, endingLeaseExpiresAt: expiresAt });
      return true;
    },
    async releaseEndingReconciliation(customerId, id, token) {
      const offering = rows.get(id);
      if (offering?.customerId === customerId && offering.endingLeaseToken === token) {
        rows.set(id, { ...offering, endingLeaseToken: null, endingLeaseExpiresAt: null });
      }
    },
    async renewEndingReconciliation(customerId, id, token, now, expiresAt) {
      const offering = rows.get(id);
      if (!offering || offering.customerId !== customerId || offering.endingLeaseToken !== token ||
        !offering.endingLeaseExpiresAt || offering.endingLeaseExpiresAt <= now) return false;
      rows.set(id, { ...offering, endingLeaseExpiresAt: expiresAt });
      return true;
    },
    async persistEndingTerminalTarget(customerId, id, token, target) {
      const offering = rows.get(id);
      if (!offering || offering.customerId !== customerId || offering.endingLeaseToken !== token) return false;
      rows.set(id, { ...offering, endingTerminalTarget: target });
      return true;
    },
  };
}

function createItemRepository(item: Item): ItemRepository {
  return {
    save: vi.fn(),
    findById: vi.fn(async (id: string) => (id === item.id ? item : null)),
    listByCustomerId: vi.fn(async (customerId: string) =>
      customerId === item.customerId ? [item] : [],
    ),
  };
}

const connection: CloudShareConnectionRecord = {
  customerId: "customer-1",
  apiId: "api-id",
  apiKey: "api-key",
  webhookSecret: "secret",
  webhookPathToken: "token",
  connectedAt: new Date("2026-08-29T12:00:00Z"),
  verifiedAt: new Date("2026-08-29T12:01:00Z"),
};

const item: Item = {
  id: "item-1",
  customerId: "customer-1",
  name: "Accelerate Trial",
  description: "Trial-ready metadata",
  project: { id: "project-1", name: "Trial Project" },
  blueprints: [{ id: "bp-1", name: "Foundation" }],
  policy: { id: "policy-1", name: "One day" },
  regions: [{ id: "region-1", name: "US East" }],
  defaultDurationMinutes: 1440,
  status: "active",
  archivedAt: null,
  createdAt: new Date("2026-08-29T10:00:00Z"),
  updatedAt: new Date("2026-08-29T10:00:00Z"),
};

function createDeps(
  repository = createOfferingRepository(),
  overrides: Partial<Parameters<typeof handlePublishSalesTrialOffering>[0]> = {},
) {
  return {
    offerings: repository,
    items: createItemRepository(item),
    connections: { findByCustomerId: vi.fn().mockResolvedValue(connection) },
    deliveryFactory: {
      forConnection: vi.fn().mockReturnValue({
        createSession: vi.fn().mockResolvedValue({
          salesExperienceId: "sales-1",
          exchangeId: "create-session-exchange",
          request: { method: "POST", path: "/sales", body: { id: "provider-body" } },
          response: { status: 201, body: { id: "sales-1" } },
        }),
      }),
    },
    itemProvisioningValidator: {
      revalidate: vi.fn().mockResolvedValue([
        {
          request: { method: "GET", path: "/projects/project-1/blueprints" },
          response: { status: 200, body: [] },
          integrationSurface: "cloudshare.v3.projects.blueprints",
          exchangeId: "item-resource-exchange",
        },
      ]),
    },
    projectMembers: {
      listActiveProjectMembers: vi.fn().mockResolvedValue({
        members: [{ email: "owner@example.test", displayName: "Owner Example" }],
        request: { method: "GET", path: "/projects/project-1/members" },
        response: { status: 200, body: [] },
        integrationSurface: "cloudshare.v3.project_members_gui",
        exchangeId: "project-member-exchange",
      }),
    },
    timezones: {
      find: vi.fn().mockResolvedValue({
        customerId: "customer-1",
        timezones: [{ id: "UTC", name: "UTC", observedAt: "2026-08-29T00:00:00Z" }],
        fetchedAt: new Date("2026-08-29T00:00:00Z"),
      }),
    },
    now: () => new Date("2026-08-29T12:30:00Z"),
    newId: () => "offering-1",
    diagnostics: createDiagnosticRecorder({
      repository: createInMemoryDiagnosticLogRepository(),
    }),
    audit: { write: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

async function saveDeferredOffering(repository: SalesTrialOfferingRepository, id = "offering-deferred") {
  await repository.save({
    id, customerId: "customer-1", title: "Deferred Trial", description: "", itemId: "item-1",
    cloudShareSalesExperienceId: "sales-deferred", externalId: "opaque-deferred",
    start: "2026-08-31T09:00", end: null, timeZone: "UTC", salesProEmail: "owner@example.test",
    salesProDisplayName: "Owner", status: "published", createdAt: new Date("2026-08-31T08:00:00Z"),
    updatedAt: new Date("2026-08-31T09:00:00Z"), publishedAt: new Date("2026-08-31T09:00:00Z"),
    unpublishedAt: null, attentionReason: null,
  });
}

async function savePublishDraft(repository: SalesTrialOfferingRepository, id = "offering-token") {
  await repository.save({
    id, customerId: "customer-1", title: "OAuth Trial", description: "", itemId: "item-1",
    cloudShareSalesExperienceId: null, externalId: null, start: "2026-09-01T09:00", end: "2026-09-02T09:00",
    timeZone: "UTC", salesProEmail: "owner@example.test", salesProDisplayName: null, status: "draft",
    createdAt: new Date("2026-08-29T12:00:00Z"), updatedAt: new Date("2026-08-29T12:00:00Z"),
    publishedAt: null, unpublishedAt: null, attentionReason: null,
  });
}

const body = {
  title: "Helios Trial Offering",
  description: "A shared Sales Trial for evaluators.",
  itemId: "item-1",
  start: "2026-09-01T09:00",
  end: "2026-09-02T09:00",
  timeZone: "UTC",
  salesProEmail: "owner@example.test",
};

const openEndedBody = {
  ...body,
  end: null,
  noEndDate: true,
};

describe("Sales Trial Offering API", () => {
  it("creates a customer-scoped draft offering and keeps provider correlation server-only", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const deps = createDeps(repository);
    deps.diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });

    const result = await handleCreateSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      body,
    });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      offering: {
        id: "offering-1",
        title: "Helios Trial Offering",
        status: "draft",
        itemId: "item-1",
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("sales-1");
    expect(JSON.stringify(result.body)).not.toContain("externalId");
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.created",
        subjectType: "sales_trial_offering",
        subjectId: "offering-1",
        outcome: "success",
        details: { itemId: "item-1", lifecycle: "draft", status: "draft" },
      }),
    );
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.created",
    });
    expect(entry).toMatchObject({
      outcome: "success",
      externalIds: { offeringId: "offering-1", itemId: "item-1" },
      details: {
        integrationSurface: "portal.sales_trial_offerings",
        lifecycle: "draft",
        status: "draft",
      },
    });
  });

  it("creates an explicit open-ended draft only when the admin opts into no end date", async () => {
    const repository = createOfferingRepository();
    const deps = createDeps(repository);

    const allowed = await handleCreateSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      body: openEndedBody,
    });
    const rejected = await handleCreateSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      body: { ...body, end: null },
    });

    expect(allowed).toMatchObject({
      status: 201,
      body: {
        offering: {
          id: "offering-1",
          status: "draft",
          end: null,
        },
      },
    });
    expect(rejected).toMatchObject({
      status: 400,
      body: { error: "Select an end time or explicitly mark the Trial Offering as open-ended." },
    });
  });

  it("accepts a blank description for an explicit open-ended draft", async () => {
    const repository = createOfferingRepository();
    const deps = createDeps(repository);

    const result = await handleCreateSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      body: {
        ...openEndedBody,
        description: "   ",
      },
    });
    const persisted = await repository.findById("customer-1", "offering-1");

    expect(result).toMatchObject({
      status: 201,
      body: {
        offering: {
          id: "offering-1",
          description: "",
          end: null,
          status: "draft",
        },
      },
    });
    expect(persisted).toMatchObject({
      id: "offering-1",
      description: "",
      end: null,
      status: "draft",
    });
  });

  it("lists only this customer's offerings and keeps admin responses metadata-only", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Customer One",
      description: "Visible here",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-08-29T12:00",
      end: "2026-08-29T13:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:30:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    await repository.save({
      id: "offering-2",
      customerId: "customer-2",
      title: "Customer Two",
      description: "Not visible here",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-2",
      externalId: "opaque-2",
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:30:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });

    const result = await handleListSalesTrialOfferings(createDeps(repository), {
      customerId: "customer-1",
    });

    expect(result.body).toMatchObject({
      offerings: [{ id: "offering-1", title: "Customer One", status: "published" }],
    });
    expect(JSON.stringify(result.body)).not.toContain("sales-1");
    expect(JSON.stringify(result.body)).not.toContain("opaque-1");
  });

  it("projects only in-window published participant offerings without admin-only metadata", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Customer One",
      description: "Visible here",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-08-29T12:00",
      end: "2026-08-29T13:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:30:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    await repository.save({
      id: "offering-2",
      customerId: "customer-1",
      title: "Future Offering",
      description: "Starts later",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-2",
      externalId: "opaque-2",
      start: "2026-09-02T09:00",
      end: "2026-09-03T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:30:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    await repository.save({
      id: "offering-3",
      customerId: "customer-1",
      title: "Ended Offering",
      description: "Ended already",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-3",
      externalId: "opaque-3",
      start: "2026-08-28T09:00",
      end: "2026-08-29T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-28T12:00:00Z"),
      updatedAt: new Date("2026-08-29T09:00:00Z"),
      publishedAt: new Date("2026-08-28T12:30:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    await repository.save({
      id: "offering-4",
      customerId: "customer-1",
      title: "Unpublished Offering",
      description: "Not visible",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-4",
      externalId: "opaque-4",
      start: "2026-08-29T11:00",
      end: "2026-08-30T12:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "unpublished",
      createdAt: new Date("2026-08-28T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-28T12:30:00Z"),
      unpublishedAt: new Date("2026-08-29T12:31:00Z"),
      attentionReason: null,
    });

    const result = await handleListPublishedSalesTrialOfferings(createDeps(repository), {
      customerId: "customer-1",
    });

    expect(result.body).toEqual({
      offerings: [
        {
          id: "offering-1",
          title: "Customer One",
          description: "Visible here",
          start: "2026-08-29T12:00",
          end: "2026-08-29T13:00",
          timeZone: "UTC",
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toContain("itemId");
    expect(JSON.stringify(result.body)).not.toContain("salesPro");
    expect(JSON.stringify(result.body)).not.toContain("createdAt");
    expect(JSON.stringify(result.body)).not.toContain("publishedAt");
    expect(JSON.stringify(result.body)).not.toContain("status");
  });

  it("keeps open-ended published participant offerings visible after they start", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Open-ended Trial",
      description: "Visible after start until an admin ends it.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-08-29T12:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:30:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });

    const result = await handleListPublishedSalesTrialOfferings(createDeps(repository), {
      customerId: "customer-1",
    });

    expect(result.body).toEqual({
      offerings: [
        {
          id: "offering-1",
          title: "Open-ended Trial",
          description: "Visible after start until an admin ends it.",
          start: "2026-08-29T12:00",
          end: null,
          timeZone: "UTC",
        },
      ],
    });
  });

  it("keeps an ended offering visible only to a participant who previously launched it", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-ended", customerId: "customer-1", title: "Continued Trial", description: "Already launched",
      itemId: "item-1", cloudShareSalesExperienceId: "sales-ended", externalId: "opaque-ended",
      start: "2026-08-28T09:00", end: "2026-08-29T12:32", timeZone: "UTC",
      salesProEmail: "owner@example.test", salesProDisplayName: "Owner", status: "ending",
      createdAt: new Date("2026-08-28T08:00:00Z"), updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-28T08:30:00Z"), unpublishedAt: new Date("2026-08-29T12:30:00Z"), attentionReason: null,
    });
    const enrollments = {
      listByPortalUser: vi.fn().mockResolvedValue([
        {
          salesTrialOfferingId: "offering-ended", lastLaunchedAt: new Date("2026-08-29T10:00:00Z"), status: "active",
          cloudShareParticipantId: "participant-1", cloudShareRosterEnvironmentReference: "environment-1", environmentStatus: "Archived",
        },
      ]),
    };

    const result = await handleListPublishedSalesTrialOfferings(
      { ...createDeps(repository), enrollments } as never,
      { customerId: "customer-1", portalUserId: "trial-user-1" } as never,
    );

    expect(result.body).toEqual({ offerings: [{
      id: "offering-ended", title: "Continued Trial", description: "Already launched",
      start: "2026-08-28T09:00", end: "2026-08-29T12:32", timeZone: "UTC",
    }] });
  });

  it("hides an ended offering after the participant environment becomes terminal", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-ended", customerId: "customer-1", title: "Finished Trial", description: "No environment remains",
      itemId: "item-1", cloudShareSalesExperienceId: "sales-ended", externalId: "opaque-ended",
      start: "2026-08-28T09:00", end: "2026-08-29T12:32", timeZone: "UTC",
      salesProEmail: "owner@example.test", salesProDisplayName: "Owner", status: "ending",
      createdAt: new Date("2026-08-28T08:00:00Z"), updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-28T08:30:00Z"), unpublishedAt: new Date("2026-08-29T12:30:00Z"), attentionReason: null,
    });
    const enrollments = { listByPortalUser: vi.fn().mockResolvedValue([{
      salesTrialOfferingId: "offering-ended", lastLaunchedAt: new Date("2026-08-29T10:00:00Z"), status: "active",
      cloudShareParticipantId: "participant-1", cloudShareRosterEnvironmentReference: "environment-1", environmentStatus: "Deleted",
    }]) };

    const result = await handleListPublishedSalesTrialOfferings(
      { ...createDeps(repository), enrollments } as never,
      { customerId: "customer-1", portalUserId: "trial-user-1" } as never,
    );

    expect(result.body).toEqual({ offerings: [] });
  });

  it("publishes a draft offering through POST /sales using type trial and disabled invitations", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository);

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      offering: { id: "offering-1", status: "published", salesProDisplayName: "Owner Example" },
    });
    expect(deps.deliveryFactory.forConnection).toHaveBeenCalledWith(connection);
    expect(
      deps.deliveryFactory.forConnection(connection).createSession,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trial",
        projectId: "project-1",
        blueprintIds: ["bp-1"],
        policyId: "policy-1",
        opportunity: "Helios Trial Offering",
        registrationType: "registeredParticipantsOnly",
        sendInvitations: "dontSend",
        mainSalesProEmail: "owner@example.test",
      }),
    );
    expect(JSON.stringify(result.body)).not.toContain("sales-1");
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.publish",
        subjectType: "sales_trial_offering",
        subjectId: "offering-1",
        outcome: "success",
        details: expect.objectContaining({
          itemId: "item-1",
          lifecycle: "publish",
          previousStatus: "draft",
          status: "published",
          integrationSurface: "cloudshare.v4.sales",
        }),
      }),
    );
  });

  it("publishes an explicit open-ended draft through POST /sales with end null", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository);

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(result.status).toBe(200);
    expect(
      deps.deliveryFactory.forConnection(connection).createSession,
    ).toHaveBeenCalledWith(expect.objectContaining({ end: null }));
    expect(result.body).toMatchObject({
      offering: { id: "offering-1", status: "published", end: null },
    });
  });

  it("allows retry after a known provider rejection by restoring the offering to draft", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const createSession = vi
      .fn()
      .mockRejectedValueOnce(
        new CloudShareRequestError("forbidden", 403, {
          method: "POST",
          path: "/sales",
          responseStatus: 403,
          responseBody: { error: "forbidden" },
        }),
      )
      .mockResolvedValueOnce({
        salesExperienceId: "sales-1",
        request: { method: "POST", path: "/sales" },
        response: { status: 201, body: { id: "sales-1" } },
      });
    const deps = createDeps(repository, {
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({ createSession }),
      },
    });

    const first = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const persistedAfterFailure = await repository.findById("customer-1", "offering-1");
    const second = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(first).toMatchObject({
      status: 502,
      body: {
        error: "CloudShare could not publish the Sales Trial Offering. Review support diagnostics.",
      },
    });
    expect(persistedAfterFailure).toMatchObject({
      status: "draft",
      externalId: null,
      cloudShareSalesExperienceId: null,
      attentionReason: null,
    });
    expect(second).toMatchObject({
      status: 200,
      body: { offering: { status: "published" } },
    });
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("allows only one concurrent publish request to claim the draft reservation", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const createSession = vi.fn().mockImplementation(
      async () =>
        await new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                salesExperienceId: "sales-1",
                request: { method: "POST", path: "/sales" },
                response: { status: 201, body: { id: "sales-1" } },
              }),
            10,
          ),
        ),
    );
    const deps = createDeps(repository, {
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({ createSession }),
      },
    });

    const firstPromise = handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const secondPromise = handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toMatchObject({
      status: 200,
      body: { offering: { status: "published" } },
    });
    expect(second).toMatchObject({
      status: 409,
      body: { needsAttention: true },
    });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("blocks publication when the Trial Offering window no longer starts in the future", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-08-29T12:00",
      end: "2026-08-29T13:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T11:00:00Z"),
      updatedAt: new Date("2026-08-29T11:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository);

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(result).toMatchObject({
      status: 400,
      body: { error: "Choose a future start time before publishing." },
    });
    expect(deps.deliveryFactory.forConnection).not.toHaveBeenCalled();
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.publish",
        subjectType: "sales_trial_offering",
        subjectId: "offering-1",
        outcome: "denied",
        details: expect.objectContaining({
          itemId: "item-1",
          failureMode: "start_not_future",
          cloudShareAttempted: false,
        }),
      }),
    );
  });

  it("does not call CloudShare when the provisioning reservation cannot be saved", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const createSession = vi.fn();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const deps = createDeps(
      {
        ...repository,
        reservePublication: vi.fn().mockRejectedValue(new Error("sqlite reservation failed")),
      },
      {
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({ createSession }),
        },
        diagnostics: createDiagnosticRecorder({ repository: diagnosticRepository }),
      },
    );

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(result).toMatchObject({
      status: 503,
      body: {
        error:
          "Certalis could not reserve the Sales Trial Offering locally. No CloudShare publication was attempted; review support diagnostics and retry.",
        needsAttention: false,
      },
    });
    expect(createSession).not.toHaveBeenCalled();
    const [diagnostic] = await diagnosticRepository.query({ operation: "sales.trial_offering.publish" });
    expect(diagnostic).toMatchObject({
      details: {
        evidenceKind: "semantic",
        cloudShareAttempted: true,
        publicationAttempted: false,
        contributingExchangeIds: ["item-resource-exchange", "project-member-exchange"],
      },
    });
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.publish",
        outcome: "failure",
        details: expect.objectContaining({
          itemId: "item-1",
          failureMode: "local_reservation_persistence",
          cloudShareAttempted: true,
          publicationAttempted: false,
        }),
      }),
    );
  });

  it("retains an ambiguous publish as needs_attention and blocks a blind replay", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository, {
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({
          createSession: vi.fn().mockRejectedValue(
            new CloudShareRequestError("gateway timeout", 504, {
              method: "POST",
              path: "/v4/sales",
              responseStatus: 504,
              responseBody: "<html><body><h1>504 Gateway Time-out</h1></body></html>",
            }),
          ),
        }),
      },
    });

    const first = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const second = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(first).toMatchObject({
      status: 502,
      body: { needsAttention: true, offering: { status: "needs_attention" } },
    });
    expect(second).toMatchObject({
      status: 409,
      body: { needsAttention: true },
    });
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.publish",
        subjectType: "sales_trial_offering",
        subjectId: "offering-1",
        outcome: "failure",
        details: expect.objectContaining({
          itemId: "item-1",
          lifecycle: "publish",
          status: "needs_attention",
          failureMode: "cloudshare_create_outcome_ambiguous",
          integrationSurface: "cloudshare.v4.sales",
          outcome: "needs_attention",
        }),
      }),
    );
  });

  it("persists ambiguous publish needs_attention through fallback and blocks a later replay", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    const createSession = vi.fn().mockRejectedValue(
      new CloudShareTransportError("timeout", {
        method: "POST",
        path: "/sales",
        exchangeId: "ambiguous-create-exchange",
        cause: { code: "ETIMEDOUT" },
      }),
    );
    let saveCalls = 0;
    const save = vi.fn().mockImplementation(async (offering: SalesTrialOffering) => {
      saveCalls += 1;
      if (saveCalls === 2) {
        throw new Error("sqlite write failed for ambiguous needs_attention");
      }
      await repository.save(offering);
    });
    const deps = createDeps(
      {
        ...repository,
        save,
      },
      {
        diagnostics,
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({ createSession }),
        },
      },
    );

    const first = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const second = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.publish",
    });

    expect(first).toMatchObject({
      status: 502,
      body: { needsAttention: true, offering: { status: "needs_attention" } },
    });
    expect(second).toMatchObject({
      status: 409,
      body: {
        needsAttention: true,
        error:
          "CloudShare POST /sales completed without a response, so the creation outcome is unknown. Do not retry publication; review support diagnostics.",
      },
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(entry).toMatchObject({
      outcome: "failure",
      externalIds: {
        offeringId: "offering-1",
        itemId: "item-1",
        externalId: "offering1",
      },
      details: {
        evidenceKind: "semantic",
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "cloudshare_create_outcome_ambiguous",
        fallbackPersisted: true,
        contributingExchangeIds: [
          "item-resource-exchange",
          "project-member-exchange",
          "ambiguous-create-exchange",
        ],
      },
    });
    const persisted = await repository.findById("customer-1", "offering-1");
    expect(persisted).toMatchObject({
      status: "needs_attention",
      externalId: "offering1",
      cloudShareSalesExperienceId: null,
    });
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.publish",
        outcome: "failure",
        details: expect.objectContaining({
          itemId: "item-1",
          lifecycle: "publish",
          status: "needs_attention",
          failureMode: "cloudshare_create_outcome_ambiguous",
          integrationSurface: "cloudshare.v4.sales",
          outcome: "needs_attention",
        }),
      }),
    );
  });

  it("records protected diagnostics for non-ambiguous provider publish failures", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository, {
      diagnostics,
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({
          createSession: vi.fn().mockRejectedValue(
            new CloudShareRequestError("forbidden", 403, {
              method: "POST",
              path: "/sales",
              responseStatus: 403,
              requestBody: { registrationType: "registeredParticipantsOnly" },
              responseBody: { error: "forbidden" },
              exchangeId: "definite-create-exchange",
            }),
          ),
        }),
      },
    });

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.publish",
    });

    expect(result).toMatchObject({
      status: 502,
      body: {
        error: "CloudShare could not publish the Sales Trial Offering. Review support diagnostics.",
      },
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      externalIds: { offeringId: "offering-1", itemId: "item-1", externalId: "offering1" },
      request: { method: "POST", path: "/sales" },
      response: { status: 403, body: { error: "forbidden" } },
      details: {
        evidenceKind: "semantic",
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "cloudshare_create",
        contributingExchangeIds: [
          "item-resource-exchange",
          "project-member-exchange",
          "definite-create-exchange",
        ],
      },
    });
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.publish",
        outcome: "failure",
        details: expect.objectContaining({
          itemId: "item-1",
          lifecycle: "publish",
          failureMode: "cloudshare_create",
          integrationSurface: "cloudshare.v4.sales",
        }),
      }),
    );
  });

  it("records protected diagnostics for item revalidation drift before publish", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository, {
      diagnostics,
      itemProvisioningValidator: {
        revalidate: vi.fn().mockRejectedValue(
          new SalesItemProvisioningValidationError("Item drifted", [
            {
              data: [{ id: "bp-1" }],
              request: { method: "GET", path: "/projects/project-1/blueprints" },
              response: { status: 200, body: [{ id: "bp-1" }] },
              integrationSurface: "cloudshare.v3.projects.blueprints",
            },
          ]),
        ),
      },
    });

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.publish",
    });

    expect(result).toMatchObject({
      status: 422,
      body: {
        error: "This Item no longer matches its CloudShare resources. Refresh the Item before publishing.",
      },
    });
    const itemReadEntry = (await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.item_resources.revalidated",
    }))[0];
    expect(entry).toMatchObject({
      outcome: "failure",
      details: {
        integrationSurface: "cloudshare.v3.sales_item_resources",
        failureMode: "item_resource_drift",
      },
    });
    expect(itemReadEntry).toMatchObject({
      outcome: "failure",
      externalIds: { offeringId: "offering-1", itemId: "item-1", projectId: "project-1" },
      request: { method: "GET", path: "/projects/project-1/blueprints" },
      details: { integrationSurface: "cloudshare.v3.projects.blueprints" },
    });
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.publish",
        outcome: "failure",
        details: expect.objectContaining({
          itemId: "item-1",
          lifecycle: "publish",
          failureMode: "item_resource_drift",
          integrationSurface: "cloudshare.v3.sales_item_resources",
        }),
      }),
    );
  });

  it("unpublishes without mutating the provider and hides the offering from trial participants", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:30:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository, {
      diagnostics: createDiagnosticRecorder({ repository: diagnosticRepository }),
    });

    const unpublish = await handleUnpublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const published = await handleListPublishedSalesTrialOfferings(deps, {
      customerId: "customer-1",
    });

    expect(unpublish).toMatchObject({
      status: 200,
      body: { offering: { id: "offering-1", status: "unpublished" } },
    });
    expect(published.body).toEqual({ offerings: [] });
    expect(deps.deliveryFactory.forConnection).not.toHaveBeenCalled();
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.unpublish",
        subjectType: "sales_trial_offering",
        subjectId: "offering-1",
        outcome: "success",
        details: {
          itemId: "item-1",
          lifecycle: "unpublish",
          previousStatus: "published",
          status: "unpublished",
        },
      }),
    );
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.unpublish",
    });
    expect(entry).toMatchObject({
      outcome: "success",
      externalIds: { offeringId: "offering-1", itemId: "item-1" },
      details: {
        integrationSurface: "portal.sales_trial_offerings",
        lifecycle: "unpublish",
        previousStatus: "published",
        status: "unpublished",
      },
    });
  });

  it("does not re-dispatch POST /sales after an offering has been unpublished", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "unpublished",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: new Date("2026-08-29T12:30:00Z"),
      attentionReason: null,
    });
    const deps = createDeps(repository);

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(result).toMatchObject({
      status: 409,
      body: {
        error:
          "Unpublished Sales Trial Offerings cannot be published again because Certalis must not create a second shared CloudShare Sales Experience for the same Offering.",
      },
    });
    expect(deps.deliveryFactory.forConnection).not.toHaveBeenCalled();
  });

  it("records successful revalidation reads before publishing", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository, { diagnostics });

    await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    const resourceEntry = (await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.item_resources.revalidated",
    }))[0];
    const memberEntry = (await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.project_members.revalidated",
    }))[0];
    const [terminalEntry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.publish",
      outcome: "success",
    });

    expect(resourceEntry).toMatchObject({
      outcome: "success",
      externalIds: { offeringId: "offering-1", itemId: "item-1", projectId: "project-1" },
      request: { method: "GET", path: "/projects/project-1/blueprints" },
    });
    expect(memberEntry).toMatchObject({
      outcome: "success",
      externalIds: { offeringId: "offering-1", itemId: "item-1", projectId: "project-1" },
      request: { method: "GET", path: "/projects/project-1/members" },
      details: {
        integrationSurface: "cloudshare.v3.project_members_gui",
        memberCount: 1,
        cached: false,
      },
    });
    expect(terminalEntry).toMatchObject({
      details: {
        evidenceKind: "semantic",
        contributingExchangeIds: [
          "item-resource-exchange",
          "project-member-exchange",
          "create-session-exchange",
        ],
      },
    });
  });

  it("distinguishes remote-created local-persistence failure from ambiguous provider creation", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    let saveCalls = 0;
    const save = vi.fn().mockImplementation(async (offering: SalesTrialOffering) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        throw new Error(`sqlite write failed for status ${offering.status}`);
      }
      await repository.save(offering);
    });
    const deps = createDeps(
      {
        ...repository,
        save,
      },
      { diagnostics },
    );

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.publish",
    });

    expect(result).toMatchObject({
      status: 503,
      body: {
        needsAttention: true,
        error:
          "CloudShare created the Sales Trial Offering, but Certalis could not save its correlation. Do not retry publication; review support diagnostics.",
      },
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      externalIds: {
        offeringId: "offering-1",
        itemId: "item-1",
        cloudShareSalesExperienceId: "sales-1",
        externalId: "offering1",
      },
      request: { method: "POST", path: "/sales" },
      response: { status: 201, body: { id: "sales-1" } },
      details: {
        evidenceKind: "semantic",
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "local_correlation_persistence",
        createdSalesExperienceId: "sales-1",
        fallbackPersisted: true,
        contributingExchangeIds: [
          "item-resource-exchange",
          "project-member-exchange",
          "create-session-exchange",
        ],
      },
    });
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales.trial_offering.publish",
        outcome: "failure",
        details: expect.objectContaining({
          itemId: "item-1",
          lifecycle: "publish",
          failureMode: "local_correlation_persistence",
          integrationSurface: "cloudshare.v4.sales",
          outcome: "needs_attention",
        }),
      }),
    );
  });

  it("fails closed on a later publish after fallback persistence records provider correlation", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const createSession = vi.fn().mockResolvedValue({
      salesExperienceId: "sales-1",
      request: { method: "POST", path: "/sales", body: { id: "provider-body" } },
      response: { status: 201, body: { id: "sales-1" } },
    });
    let saveCalls = 0;
    const save = vi.fn().mockImplementation(async (offering: SalesTrialOffering) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        throw new Error("sqlite write failed for published");
      }
      await repository.save(offering);
    });
    const deps = createDeps(
      {
        ...repository,
        save,
      },
      {
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({ createSession }),
        },
      },
    );

    const first = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const second = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(first).toMatchObject({
      status: 503,
      body: { needsAttention: true },
    });
    expect(second).toMatchObject({
      status: 409,
      body: {
        needsAttention: true,
        error:
          "CloudShare created the shared Sales Trial Experience, but Certalis could not durably save its correlation. Do not retry publication; review support diagnostics.",
      },
    });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a later publish when post-create writes and fallback all fail after the reservation", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const createSession = vi.fn().mockResolvedValue({
      salesExperienceId: "sales-1",
      request: { method: "POST", path: "/sales", body: { id: "provider-body" } },
      response: { status: 201, body: { id: "sales-1" } },
    });
    let saveCalls = 0;
    const save = vi.fn().mockImplementation(async (offering: SalesTrialOffering) => {
      saveCalls += 1;
      if (saveCalls >= 1) {
        throw new Error(`sqlite write failed for status ${offering.status}`);
      }
      await repository.save(offering);
    });
    const deps = createDeps(
      {
        ...repository,
        save,
        markPublishNeedsAttention: vi.fn().mockResolvedValue(false),
      },
      {
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({ createSession }),
        },
      },
    );

    const first = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const second = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(first).toMatchObject({
      status: 503,
      body: { needsAttention: true },
    });
    expect(second).toMatchObject({
      status: 409,
      body: {
        needsAttention: true,
        error:
          "Sales Trial Offering publication is already in progress or unresolved. Do not retry publication or unpublish; review support diagnostics.",
      },
    });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a later publish when ambiguous outcome persistence and fallback both fail after the reservation", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const createSession = vi.fn().mockRejectedValue(
      new CloudShareTransportError("timeout", {
        method: "POST",
        path: "/sales",
        cause: { code: "ETIMEDOUT" },
      }),
    );
    let saveCalls = 0;
    const save = vi.fn().mockImplementation(async (offering: SalesTrialOffering) => {
      saveCalls += 1;
      if (saveCalls >= 1) {
        throw new Error(`sqlite write failed for status ${offering.status}`);
      }
      await repository.save(offering);
    });
    const deps = createDeps(
      {
        ...repository,
        save,
        markPublishNeedsAttention: vi.fn().mockResolvedValue(false),
      },
      {
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({ createSession }),
        },
      },
    );

    const first = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const second = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });

    expect(first).toMatchObject({
      status: 502,
      body: { needsAttention: true },
    });
    expect(second).toMatchObject({
      status: 409,
      body: {
        needsAttention: true,
        error:
          "Sales Trial Offering publication is already in progress or unresolved. Do not retry publication or unpublish; review support diagnostics.",
      },
    });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("records protected diagnostics when the project-member read fails before publish", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: null,
      externalId: null,
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: null,
      status: "draft",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      publishedAt: null,
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository, {
      diagnostics,
      projectMembers: {
        listActiveProjectMembers: vi.fn().mockRejectedValue(
          new CloudShareRequestError("member read failed", 503, {
            method: "GET",
            path: "/users",
            requestQuery: { projectUsers: "true", projectId: "project-1" },
            responseStatus: 503,
            responseBody: { error: "unavailable" },
            exchangeId: "member-read-exchange",
          }),
        ),
      },
    });

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const entries = await diagnosticRepository.query({ source: "sales-trial-offerings", operation: "sales.trial_offering.project_members.revalidated" });
    const [entry] = entries;
    const terminalEntries = (await diagnosticRepository.query({ source: "sales-trial-offerings", operation: "sales.trial_offering.publish" })).filter((candidate) => candidate.details?.failureMode === "project_member_read");
    const [terminal] = terminalEntries;

    expect(result).toMatchObject({
      status: 502,
      body: {
        error: "CloudShare could not publish the Sales Trial Offering. Review support diagnostics.",
      },
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      externalIds: { offeringId: "offering-1", itemId: "item-1", projectId: "project-1" },
      request: { method: "GET", path: "/users", query: { projectUsers: "true", projectId: "project-1" } },
      response: { status: 503, body: { error: "unavailable" } },
      details: {
        integrationSurface: "cloudshare.v3.project_members_gui",
        failureMode: "project_member_read",
        cached: false,
        evidenceKind: "semantic",
      },
    });
    expect(terminalEntries).toHaveLength(1);
    expect(terminal).toMatchObject({ operation: "sales.trial_offering.publish", outcome: "failure", details: { integrationSurface: "cloudshare.v3.project_members_gui", failureMode: "project_member_read", terminal: true, evidenceKind: "semantic", contributingExchangeIds: ["member-read-exchange"] } });
  });

  it("blocks unpublish when the offering is already in needs_attention and preserves correlated state", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "needs_attention",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: null,
      attentionReason:
        "CloudShare created the shared Sales Trial Experience, but Certalis could not durably save its correlation. Do not retry publication; review support diagnostics.",
    });
    const deps = createDeps(repository);

    const result = await handleUnpublishSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const persisted = await repository.findById("customer-1", "offering-1");

    expect(result).toMatchObject({
      status: 409,
      body: {
        needsAttention: true,
        error:
          "This Sales Trial Offering already has CloudShare publication correlation and needs support follow-up. Unpublish is blocked to preserve the correlated state.",
        offering: {
          id: "offering-1",
          status: "needs_attention",
          attentionReason:
            "CloudShare created the shared Sales Trial Experience, but Certalis could not durably save its correlation. Do not retry publication; review support diagnostics.",
        },
      },
    });
    expect(persisted).toMatchObject({
      status: "needs_attention",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
    });
    expect(deps.audit.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "sales.trial_offering.unpublish", outcome: "success" }),
    );
  });

  it("ends a published offering by closing the provider window first and then unpublishing locally", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    const updateSession = vi.fn().mockResolvedValue({
      id: "sales-1",
      request: { method: "PUT", path: "/sales/sales-1", body: { end: "2026-08-29T12:32" } },
      response: { status: 200, body: { id: "sales-1", end: "2026-08-29T12:32" } },
    });
    const deps = createDeps(repository, {
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({
          createSession: vi.fn(),
          updateSession,
        }),
      } as never,
    });

    const result = await handleEndSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const persisted = await repository.findById("customer-1", "offering-1");

    expect(result).toMatchObject({
      status: 200,
      body: {
        offering: {
          id: "offering-1",
          status: "unpublished",
          end: "2026-08-29T12:32",
        },
      },
    });
    expect(updateSession).toHaveBeenCalledWith("sales-1", {
      end: "2026-08-29T12:32",
    });
    expect(persisted).toMatchObject({
      status: "unpublished",
      end: "2026-08-29T12:32",
      unpublishedAt: new Date("2026-08-29T12:30:00Z"),
    });
  });

  it("fails closed when provider end-trial update fails and preserves the published lifecycle visibility", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    const deps = createDeps(repository, {
      diagnostics,
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({
          createSession: vi.fn(),
          updateSession: vi.fn().mockRejectedValue(
            new CloudShareRequestError("unavailable", 503, {
              method: "PUT",
              path: "/sales/sales-1",
              responseStatus: 503,
              responseBody: { error: "unavailable" },
            }),
          ),
        }),
      } as never,
    });

    const result = await handleEndSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const persisted = await repository.findById("customer-1", "offering-1");
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.end",
    });

    expect(result).toMatchObject({
      status: 502,
      body: {
        error: "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics.",
        needsAttention: true,
        correlationId: expect.any(String),
        offering: {
          id: "offering-1",
          status: "published",
          attentionReason:
            "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics.",
        },
      },
    });
    expect(persisted).toMatchObject({
      status: "published",
      unpublishedAt: null,
      attentionReason:
        "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics.",
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      correlationId: expect.any(String),
      request: { method: "PUT", path: "/sales/sales-1" },
      response: { status: 503, body: { error: "unavailable" } },
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "cloudshare_end_trial_update",
        status: "published",
        needsAttention: true,
      }),
    });
  });

  it("records protected provider-failure diagnostics even when the published attention save fails", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    const save = vi.fn().mockRejectedValue(new Error("sqlite write failed for published attention"));
    const deps = createDeps(
      {
        ...repository,
        save,
      },
      {
        diagnostics,
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({
            createSession: vi.fn(),
            updateSession: vi.fn().mockRejectedValue(
              new CloudShareRequestError("unavailable", 503, {
                method: "PUT",
                path: "/sales/sales-1",
                responseStatus: 503,
                responseBody: { error: "unavailable" },
              }),
            ),
          }),
        } as never,
      },
    );

    const result = await handleEndSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const persisted = await repository.findById("customer-1", "offering-1");
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.end",
      outcome: "failure",
    });

    expect(result).toMatchObject({
      status: 502,
      body: {
        error:
          "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics. Portal state may be stale.",
        needsAttention: true,
        correlationId: expect.any(String),
      },
    });
    expect((result.body as { offering?: unknown }).offering).toBeUndefined();
    expect(persisted).toMatchObject({
      status: "published",
      unpublishedAt: null,
      attentionReason: null,
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      correlationId: expect.any(String),
      request: { method: "PUT", path: "/sales/sales-1" },
      response: { status: 503, body: { error: "unavailable" } },
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "cloudshare_end_trial_update",
        status: "published",
        needsAttention: true,
        localAttentionMarkerPersisted: false,
      }),
    });
  });

  it("still reports provider end-trial failure when the local attention marker cannot be saved", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    const save = vi.fn().mockRejectedValue(new Error("sqlite write failed for published marker"));
    const deps = createDeps(
      {
        ...repository,
        save,
      },
      {
        diagnostics,
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({
            createSession: vi.fn(),
            updateSession: vi.fn().mockRejectedValue(
              new CloudShareRequestError("unavailable", 503, {
                method: "PUT",
                path: "/sales/sales-1",
                responseStatus: 503,
                responseBody: { error: "unavailable" },
              }),
            ),
          }),
        } as never,
      },
    );

    const result = await handleEndSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const persisted = await repository.findById("customer-1", "offering-1");
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.end",
    });

    expect(result).toMatchObject({
      status: 502,
      body: {
        error:
          "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics. Portal state may be stale.",
        needsAttention: true,
        correlationId: expect.any(String),
      },
    });
    expect((result.body as { offering?: unknown }).offering).toBeUndefined();
    expect(persisted).toMatchObject({
      status: "published",
      unpublishedAt: null,
      attentionReason: null,
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      correlationId: expect.any(String),
      details: expect.objectContaining({
        failureMode: "cloudshare_end_trial_update",
        status: "published",
        localAttentionMarkerPersisted: false,
      }),
    });
  });

  it("records the protected GET evidence and returns a correlation id when end-trial stops before PUT", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    const failure = new CloudShareResponseError(
      "CloudShare did not return the complete documented Sales Experience required for a safe update.",
      {
        method: "GET",
        path: "/sales/sales-1",
        responseStatus: 200,
        responseBody: {
          id: "sales-1",
          name: "Helios Trial Offering",
          type: "trial",
          projectId: "project-1",
          blueprintIds: ["bp-1"],
          cloudshareRegionIds: ["region-1"],
          policyId: "policy-1",
          mainSalesPro: { email: "owner@example.test" },
          registrationType: "registeredParticipantsOnly",
          start: "2026-09-01T09:00",
          end: null,
          timeZone: "UTC",
        },
      },
    );
    const deps = createDeps(repository, {
      diagnostics,
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({
          createSession: vi.fn(),
          updateSession: vi.fn().mockRejectedValue(failure),
        }),
      } as never,
    });

    const result = await handleEndSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.end",
      outcome: "failure",
    });

    expect(result).toMatchObject({
      status: 502,
      body: {
        error: "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics.",
        needsAttention: true,
        correlationId: expect.any(String),
      },
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      correlationId: (result.body as { correlationId: string }).correlationId,
      request: { method: "GET", path: "/sales/sales-1" },
      response: {
        status: 200,
        body: expect.objectContaining({
          id: "sales-1",
          type: "trial",
          registrationType: "registeredParticipantsOnly",
        }),
      },
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "cloudshare_end_trial_update",
        status: "published",
        needsAttention: true,
      }),
    });
  });

  it("records a distinct needs-attention state when CloudShare end succeeds but local unpublish persistence fails", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    const updateSession = vi.fn().mockResolvedValue({
      id: "sales-1",
      request: { method: "PUT", path: "/sales/sales-1", body: { end: "2026-08-29T12:32" } },
      response: { status: 200, body: { id: "sales-1", end: "2026-08-29T12:32" } },
    });
    let saveCalls = 0;
    const save = vi.fn().mockImplementation(async (offering: SalesTrialOffering) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        throw new Error(`sqlite write failed for status ${offering.status}`);
      }
      await repository.save(offering);
    });
    const deps = createDeps(
      {
        ...repository,
        save,
      },
      {
        diagnostics,
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({
            createSession: vi.fn(),
            updateSession,
          }),
        } as never,
      },
    );

    const result = await handleEndSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const persisted = await repository.findById("customer-1", "offering-1");
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.end",
    });

    expect(result).toMatchObject({
      status: 503,
      body: {
        error:
          "CloudShare ended the Sales Trial Offering, but Certalis could not durably unpublish it locally. Do not retry end-trial; review support diagnostics.",
        needsAttention: true,
        offering: {
          id: "offering-1",
          status: "needs_attention",
          end: "2026-08-29T12:32",
          attentionReason:
            "CloudShare ended the Sales Trial Offering, but Certalis could not durably unpublish it locally. Do not retry end-trial; review support diagnostics.",
        },
      },
    });
    expect(persisted).toMatchObject({
      status: "needs_attention",
      end: "2026-08-29T12:32",
      unpublishedAt: new Date("2026-08-29T12:30:00Z"),
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      externalIds: {
        offeringId: "offering-1",
        itemId: "item-1",
        cloudShareSalesExperienceId: "sales-1",
      },
      request: { method: "PUT", path: "/sales/sales-1", body: { end: "2026-08-29T12:32" } },
      response: { status: 200, body: { id: "sales-1", end: "2026-08-29T12:32" } },
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "local_end_persistence",
        status: "needs_attention",
        needsAttention: true,
        fallbackPersisted: true,
      }),
    });
  });

  it("warns about stale portal state when CloudShare end succeeds but local unpublish persistence and fallback both fail", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticRepository });
    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      title: "Helios Trial Offering",
      description: "A shared Sales Trial for evaluators.",
      itemId: "item-1",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: null as never,
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:10:00Z"),
      unpublishedAt: null,
      attentionReason: null,
    });
    const updateSession = vi.fn().mockResolvedValue({
      id: "sales-1",
      request: { method: "PUT", path: "/sales/sales-1", body: { end: "2026-08-29T12:32" } },
      response: { status: 200, body: { id: "sales-1", end: "2026-08-29T12:32" } },
    });
    const save = vi.fn().mockRejectedValue(new Error("sqlite write failed for needs_attention"));
    const deps = createDeps(
      {
        ...repository,
        save,
        markEndNeedsAttention: vi.fn().mockResolvedValue(false),
      },
      {
        diagnostics,
        deliveryFactory: {
          forConnection: vi.fn().mockReturnValue({
            createSession: vi.fn(),
            updateSession,
          }),
        } as never,
      },
    );

    const result = await handleEndSalesTrialOffering(deps, {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      id: "offering-1",
    });
    const persisted = await repository.findById("customer-1", "offering-1");
    const [entry] = await diagnosticRepository.query({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.end",
    });

    expect(result).toMatchObject({
      status: 503,
      body: {
        error:
          "CloudShare ended the Sales Trial Offering, but Certalis could not durably unpublish it locally. Do not retry end-trial; review support diagnostics. Portal state may be stale.",
        needsAttention: true,
      },
    });
    expect((result.body as { offering?: unknown }).offering).toBeUndefined();
    expect(persisted).toMatchObject({
      status: "published",
      unpublishedAt: null,
      end: null,
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      externalIds: {
        offeringId: "offering-1",
        itemId: "item-1",
        cloudShareSalesExperienceId: "sales-1",
      },
      details: expect.objectContaining({
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "local_end_persistence",
        status: "published",
        needsAttention: true,
        fallbackPersisted: false,
      }),
    });
  });

  it("releases an OAuth token 504 reservation to Draft because POST sales was never attempted", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    await savePublishDraft(repository);
    const createSession = vi.fn().mockRejectedValue(new CloudShareRequestError("gateway timeout", 504, {
      method: "POST", path: "/oauth/token", integrationSurface: "cloudshare.v4.oauth.token",
      requestBody: { client_secret: "marker-client_secret" }, responseStatus: 504,
      responseBody: { access_token: "marker-access_token" },
      acquisition: { exchangeCorrelationId: "oauth-exchange" },
    }));
    const deps = createDeps(repository, {
      diagnostics: createDiagnosticRecorder({ repository: diagnosticRepository }),
      deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession }) },
    });

    const result = await handlePublishSalesTrialOffering(deps, {
      customerId: "customer-1", actor: { type: "admin", id: "admin-1" }, id: "offering-token",
    });

    expect(result).toMatchObject({ status: 502, body: {
      error: "CloudShare authentication failed before the Sales Trial Offering was created. Review support diagnostics and retry.",
      correlationId: expect.any(String),
    } });
    expect(await repository.findById("customer-1", "offering-token")).toMatchObject({
      status: "draft", externalId: null, cloudShareSalesExperienceId: null, attentionReason: null,
    });
    const [entry] = await diagnosticRepository.query({ operation: "sales.trial_offering.publish", outcome: "failure" });
    expect(entry).toMatchObject({
      message: "CloudShare OAuth token request failed before Sales Experience creation",
      request: null, response: null,
      details: {
        evidenceKind: "semantic",
        integrationSurface: "cloudshare.v4.oauth.token",
        failureMode: "cloudshare_oauth_token",
        contributingExchangeIds: [
          "item-resource-exchange",
          "project-member-exchange",
          "oauth-exchange",
        ],
        error: "gateway timeout",
      },
    });
    expect(JSON.stringify(entry)).not.toContain("marker-client_secret");
    expect(JSON.stringify(entry)).not.toContain("marker-access_token");
    expect(deps.audit.write).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failure", details: expect.objectContaining({ failureMode: "cloudshare_oauth_token", integrationSurface: "cloudshare.v4.oauth.token" }),
    }));
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("recognizes a branded OAuth token 504 across a reloaded module boundary", async () => {
    const repository = createOfferingRepository();
    await savePublishDraft(repository, "offering-reloaded-oauth");
    const reloadedModuleError = Object.assign(new Error("gateway timeout"), {
      name: "CloudShareRequestError",
      cloudShareErrorBoundaryDiscriminant: CLOUDSHARE_ERROR_DISCRIMINANT,
      status: 504,
      context: {
        method: "POST",
        path: "/oauth/token",
        integrationSurface: "cloudshare.v4.oauth.token",
        responseStatus: 504,
      },
    });
    const result = await handlePublishSalesTrialOffering(createDeps(repository, {
      deliveryFactory: {
        forConnection: vi.fn().mockReturnValue({
          createSession: vi.fn().mockRejectedValue(reloadedModuleError),
        }),
      },
    }), {
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1" },
      id: "offering-reloaded-oauth",
    });

    expect(result).toMatchObject({
      status: 502,
      body: {
        error: "CloudShare authentication failed before the Sales Trial Offering was created. Review support diagnostics and retry.",
      },
    });
    expect(await repository.findById("customer-1", "offering-reloaded-oauth")).toMatchObject({
      status: "draft",
      externalId: null,
      cloudShareSalesExperienceId: null,
      attentionReason: null,
    });
  });

  it("does not trust forged OAuth-looking context on an untyped Error", async () => {
    const repository = createOfferingRepository();
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    await savePublishDraft(repository, "offering-forged-oauth");
    const forged = Object.assign(new Error("unknown failure"), {
      context: { method: "POST", path: "/oauth/token", integrationSurface: "cloudshare.v4.oauth.token", responseStatus: 504 },
    });
    const result = await handlePublishSalesTrialOffering(createDeps(repository, {
      diagnostics: createDiagnosticRecorder({ repository: diagnosticRepository }),
      deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn().mockRejectedValue(forged) }) },
    }), { customerId: "customer-1", actor: { type: "admin", id: "admin-1" }, id: "offering-forged-oauth" });

    expect(result).toMatchObject({ status: 502, body: { needsAttention: true, offering: { status: "needs_attention" } } });
    expect(await repository.findById("customer-1", "offering-forged-oauth")).toMatchObject({
      status: "needs_attention", attentionReason: expect.stringContaining("creation outcome is unknown"),
    });
    const [entry] = await diagnosticRepository.query({
      operation: "sales.trial_offering.publish",
      outcome: "failure",
    });
    expect(entry.request).toBeNull();
    expect(entry.response).toBeNull();
  });

  it("unpublishes immediately and defers CloudShare end to the latest active Environment expiry plus five minutes", async () => {
    const repository = createOfferingRepository();
    await repository.save({
      id: "offering-deferred", customerId: "customer-1", title: "Deferred Trial", description: "",
      itemId: "item-1", cloudShareSalesExperienceId: "sales-deferred", externalId: "opaque-deferred",
      start: "2026-08-31T09:00", end: null, timeZone: "UTC", salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner", status: "published", createdAt: new Date("2026-08-31T08:00:00Z"),
      updatedAt: new Date("2026-08-31T09:00:00Z"), publishedAt: new Date("2026-08-31T09:00:00Z"),
      unpublishedAt: null, attentionReason: null,
    });
    const updateSession = vi.fn().mockResolvedValue({ id: "sales-deferred", request: {}, response: {} });
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const result = await handleEndSalesTrialOffering(createDeps(repository, {
      now: () => new Date("2026-08-31T12:00:00Z"),
      deliveryFactory: { forConnection: vi.fn().mockReturnValue({
        readSession: vi.fn().mockResolvedValue({ id: "sales-deferred", status: "inProgress", end: null, request: {}, response: {} }),
        listParticipants: vi.fn().mockResolvedValue({ participants: [
          { environmentId: "env-ready" }, { environmentId: "env-archived" }, { environmentId: "env-deleted" },
        ], request: {}, response: {} }), updateSession,
      }) } as never,
      salesEnvironmentFactory: { forConnection: vi.fn().mockReturnValue({ observe: vi.fn(), observeById: vi.fn(async (id: string) => ({
        environmentId: id,
        statusCode: id === "env-archived" ? 4 : id === "env-deleted" ? 5 : 2,
        expirationTime: id === "env-archived" ? "Tue, 01 Sep 2026 14:30:00 GMT" : "Tue, 01 Sep 2026 13:00:00 GMT",
        exchanges: [],
      })) }) },
      diagnostics: createDiagnosticRecorder({ repository: diagnosticRepository }), audit,
    } as never), { customerId: "customer-1", actor: { type: "admin", id: "admin-1" }, id: "offering-deferred" });

    expect(updateSession).toHaveBeenCalledWith("sales-deferred", { end: "2026-09-01T14:35" });
    expect(result).toMatchObject({ status: 200, body: { offering: {
      status: "ending", end: "2026-09-01T14:35", endingCalculatedEnd: "2026-09-01T14:35",
      endingLastReconciledAt: "2026-08-31T12:00:00.000Z",
    } } });
    await expect(repository.listPublishedByCustomerId("customer-1")).resolves.toEqual([]);
    const successes = await diagnosticRepository.query({ operation: "sales.trial_offering.end", outcome: "success" });
    expect(successes).toHaveLength(2);
    expect(successes.find((entry) => (entry.details as { providerUpdated?: boolean }).providerUpdated)).toMatchObject({ correlationId: successes[0]!.correlationId,
      request: {}, response: {}, details: expect.objectContaining({ status: "ending", providerUpdated: true }) });
    expect(audit.write).toHaveBeenCalledTimes(2);
  });

  it("serializes reconciliation per offering so competing triggers cannot land a stale shorter end", async () => {
    const repository = createOfferingRepository();
    await saveDeferredOffering(repository);
    const now = new Date("2026-08-31T12:00:00Z");
    const [first, second] = await Promise.all([
      repository.reserveEndingReconciliation!("customer-1", "offering-deferred", "lease-a", now, new Date(now.getTime() + 240_000), now),
      repository.reserveEndingReconciliation!("customer-1", "offering-deferred", "lease-b", now, new Date(now.getTime() + 240_000), now),
    ]);
    expect([first, second].sort()).toEqual([false, true]);
  });

  it("persists Ending attention and correlated diagnostics for every missing shutdown dependency", async () => {
    const scenarios = [
      { failureMode: "cloudshare_connection_missing", overrides: { connections: { findByCustomerId: vi.fn().mockResolvedValue(null) },
        deliveryFactory: {} as never, salesEnvironmentFactory: { forConnection: vi.fn() } } },
      { failureMode: "sales_delivery_update_missing", overrides: { deliveryFactory: { forConnection: vi.fn().mockReturnValue({}) },
        salesEnvironmentFactory: { forConnection: vi.fn() } } },
      { failureMode: "environment_getextended_missing", overrides: { deliveryFactory: { forConnection: vi.fn().mockReturnValue({ updateSession: vi.fn() }) },
        salesEnvironmentFactory: { forConnection: vi.fn().mockReturnValue({ observe: vi.fn() }) } } },
    ];
    for (const scenario of scenarios) {
      const repository = createOfferingRepository();
      await saveDeferredOffering(repository);
      const diagnosticRepository = createInMemoryDiagnosticLogRepository();
      const result = await handleEndSalesTrialOffering(createDeps(repository, {
        ...scenario.overrides, diagnostics: createDiagnosticRecorder({ repository: diagnosticRepository }),
      } as never), { customerId: "customer-1", actor: { type: "admin", id: "admin-1" }, id: "offering-deferred" });
      expect(result).toMatchObject({ status: 202, body: { needsAttention: true, correlationId: expect.any(String),
        offering: { status: "ending", attentionReason: expect.stringContaining("requires attention") } } });
      const [entry] = await diagnosticRepository.query({ operation: "sales.trial_offering.end", outcome: "failure" });
      expect(entry).toMatchObject({ correlationId: (result.body as { correlationId: string }).correlationId,
        details: expect.objectContaining({ failureMode: scenario.failureMode, status: "ending", needsAttention: true }) });
    }
  });

  it("keeps OAuth token failure evidence metadata-only while ending a Trial Offering", async () => {
    const repository = createOfferingRepository();
    await saveDeferredOffering(repository);
    const diagnosticRepository = createInMemoryDiagnosticLogRepository();
    const oauthFailure = new CloudShareAuthError("OAuth token exchange returned 503", {
      method: "POST",
      path: "/oauth/token",
      integrationSurface: "cloudshare.v4.oauth.token",
      status: 503,
      requestBody: { client_id: "private-client", client_secret: "private-secret" },
      responseBody: { access_token: "private-token" },
    });
    const result = await handleEndSalesTrialOffering(createDeps(repository, {
      diagnostics: createDiagnosticRecorder({ repository: diagnosticRepository }),
      deliveryFactory: { forConnection: vi.fn().mockReturnValue({
        readSession: vi.fn().mockRejectedValue(oauthFailure),
        listParticipants: vi.fn().mockResolvedValue({ participants: [], request: {}, response: {} }),
        updateSession: vi.fn(),
      }) } as never,
      salesEnvironmentFactory: { forConnection: vi.fn().mockReturnValue({ observeById: vi.fn() }) },
    } as never), { customerId: "customer-1", actor: { type: "admin", id: "admin-1" }, id: "offering-deferred" });
    const [failure] = await diagnosticRepository.query({
      operation: "sales.trial_offering.end",
      outcome: "failure",
    });

    expect(result).toMatchObject({ status: 202, body: { needsAttention: true } });
    expect(failure).toMatchObject({
      request: null,
      response: null,
      details: expect.objectContaining({ status: "ending", needsAttention: true }),
    });
    const persisted = JSON.stringify(failure);
    expect(persisted).not.toContain("private-client");
    expect(persisted).not.toContain("private-secret");
    expect(persisted).not.toContain("private-token");
  });

  it("bounds getextended reads to one in flight and fails closed without reading later environments", async () => {
    const repository = createOfferingRepository();
    await saveDeferredOffering(repository);
    let inFlight = 0;
    let maximum = 0;
    const observeById = vi.fn(async (id: string) => {
      inFlight += 1; maximum = Math.max(maximum, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (id === "env-2") throw new Error("provider read failed");
      return { environmentId: id, statusCode: 2 as const, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT", exchanges: [] };
    });
    const result = await handleEndSalesTrialOffering(createDeps(repository, {
      deliveryFactory: { forConnection: vi.fn().mockReturnValue({
        readSession: vi.fn().mockResolvedValue({ id: "sales-deferred", status: "inProgress", end: null, request: {}, response: {} }),
        listParticipants: vi.fn().mockResolvedValue({ participants: [1, 2, 3].map((n) => ({ environmentId: `env-${n}` })), request: {}, response: {} }),
        updateSession: vi.fn().mockResolvedValue({ id: "sales-deferred", request: {}, response: {} }),
      }) } as never,
      salesEnvironmentFactory: { forConnection: vi.fn().mockReturnValue({ observe: vi.fn(), observeById }) },
    } as never), { customerId: "customer-1", actor: { type: "admin", id: "admin-1" }, id: "offering-deferred" });
    expect(result).toMatchObject({ status: 202, body: { needsAttention: true, offering: { status: "ending" } } });
    expect(observeById).toHaveBeenCalledTimes(2);
    expect(maximum).toBe(1);
  });

  it("persists one terminal grace target before an ambiguous PUT and retries that same target", async () => {
    const repository = createOfferingRepository();
    await saveDeferredOffering(repository);
    let currentNow = new Date("2026-08-31T12:00:00Z");
    let statusCode: 2 | 5 = 2;
    let providerEnd: string | null = null;
    let ambiguous = false;
    const updateSession = vi.fn(async (_id: string, changes: { end?: string | null }) => {
      if (ambiguous) { ambiguous = false; throw new Error("ambiguous PUT"); }
      providerEnd = changes.end ?? null;
      return { id: "sales-deferred", request: { method: "PUT" }, response: { status: 200 } };
    });
    const deps = createDeps(repository, {
      now: () => currentNow,
      deliveryFactory: { forConnection: vi.fn().mockReturnValue({
        readSession: vi.fn(async () => ({ id: "sales-deferred", status: "inProgress", end: providerEnd, request: {}, response: {} })),
        listParticipants: vi.fn().mockResolvedValue({ participants: [{ environmentId: "env-1" }], request: {}, response: {} }),
        updateSession,
      }) } as never,
      salesEnvironmentFactory: { forConnection: vi.fn().mockReturnValue({ observe: vi.fn(), observeById: vi.fn(async () => ({
        environmentId: "env-1", statusCode, expirationTime: "Tue, 01 Sep 2026 14:00:00 GMT", exchanges: [],
      })) }) },
    } as never);
    await handleEndSalesTrialOffering(deps, { customerId: "customer-1", actor: { type: "admin", id: "admin-1" }, id: "offering-deferred" });
    statusCode = 5;
    currentNow = new Date("2026-08-31T12:10:00Z");
    ambiguous = true;
    const failed = await handleEndSalesTrialOffering(deps, { customerId: "customer-1", actor: { type: "system" }, id: "offering-deferred" });
    expect(failed).toMatchObject({ status: 202, body: { needsAttention: true } });
    expect(await repository.findById("customer-1", "offering-deferred")).toMatchObject({ status: "ending", endingTerminalTarget: "2026-08-31T12:12" });
    currentNow = new Date("2026-08-31T12:20:00Z");
    const completed = await handleEndSalesTrialOffering(deps, { customerId: "customer-1", actor: { type: "system" }, id: "offering-deferred" });
    expect(completed).toMatchObject({ status: 200, body: { offering: { status: "ended", end: "2026-08-31T12:12" } } });
    expect(await repository.findById("customer-1", "offering-deferred")).toMatchObject({ status: "ended" });
    expect(updateSession.mock.calls.slice(-2).map(([, changes]) => changes)).toEqual([
      { end: "2026-08-31T12:12" }, { end: "2026-08-31T12:12" },
    ]);
  });

  it("aborts without PUT when the reconciliation lease fence is lost during Environment reads", async () => {
    const repository = createOfferingRepository();
    await saveDeferredOffering(repository);
    const updateSession = vi.fn();
    let renewals = 0;
    repository.renewEndingReconciliation = vi.fn(async () => ++renewals < 3);
    const result = await handleEndSalesTrialOffering(createDeps(repository, {
      deliveryFactory: { forConnection: vi.fn().mockReturnValue({
        readSession: vi.fn().mockResolvedValue({ id: "sales-deferred", status: "inProgress", end: null, request: {}, response: {} }),
        listParticipants: vi.fn().mockResolvedValue({ participants: [{ environmentId: "env-1" }, { environmentId: "env-2" }], request: {}, response: {} }),
        updateSession,
      }) } as never,
      salesEnvironmentFactory: { forConnection: vi.fn().mockReturnValue({ observe: vi.fn(), observeById: vi.fn(async (id: string) => ({
        environmentId: id, statusCode: 2, expirationTime: "Tue, 01 Sep 2026 14:00:00 GMT", exchanges: [],
      })) }) },
    } as never), { customerId: "customer-1", actor: { type: "system" }, id: "offering-deferred" });
    expect(result).toMatchObject({ status: 202, body: { reconciliationInProgress: true } });
    expect(updateSession).not.toHaveBeenCalled();
  });
});
