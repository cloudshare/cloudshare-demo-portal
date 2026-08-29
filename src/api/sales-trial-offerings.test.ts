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
  CloudShareRequestError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { SalesItemProvisioningValidationError } from "@/integrations/cloudshare/sales-item-provisioning";
import {
  handleCreateSalesTrialOffering,
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
        },
      ]),
    },
    projectMembers: {
      listActiveProjectMembers: vi.fn().mockResolvedValue({
        members: [{ email: "owner@example.test", displayName: "Owner Example" }],
        request: { method: "GET", path: "/projects/project-1/members" },
        response: { status: 200, body: [] },
        integrationSurface: "cloudshare.v3.project_members_gui",
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

const body = {
  title: "Helios Trial Offering",
  description: "A shared Sales Trial for evaluators.",
  itemId: "item-1",
  start: "2026-09-01T09:00",
  end: "2026-09-02T09:00",
  timeZone: "UTC",
  salesProEmail: "owner@example.test",
};

describe("Sales Trial Offering API", () => {
  it("creates a customer-scoped draft offering and keeps provider correlation server-only", async () => {
    const repository = createOfferingRepository();
    const deps = createDeps(repository);

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
            new CloudShareTransportError("timeout", {
              method: "POST",
              path: "/sales",
              cause: { code: "ETIMEDOUT" },
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
        cause: { code: "ETIMEDOUT" },
      }),
    );
    const save = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("sqlite write failed for ambiguous needs_attention");
      })
      .mockImplementation(async (offering: SalesTrialOffering) => {
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
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "cloudshare_create_outcome_ambiguous",
        fallbackPersisted: true,
      },
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
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "cloudshare_create",
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
    const deps = createDeps(repository);

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
    const save = vi
      .fn()
      .mockImplementationOnce(async (offering: SalesTrialOffering) => {
        throw new Error(`sqlite write failed for status ${offering.status}`);
      })
      .mockImplementation(async (offering: SalesTrialOffering) => {
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
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "local_correlation_persistence",
        createdSalesExperienceId: "sales-1",
        fallbackPersisted: true,
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
    const save = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("sqlite write failed for published");
      })
      .mockImplementation(async (offering: SalesTrialOffering) => {
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
          }),
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
      operation: "sales.trial_offering.project_members.revalidated",
    });

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
      },
    });
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
});
