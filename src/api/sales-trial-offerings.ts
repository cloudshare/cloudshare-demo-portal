import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { isValidCloudShareWallClock } from "@/domain/cloudshare-wall-clock";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ItemRepository } from "@/domain/item";
import type {
  SalesTrialOffering,
  SalesTrialOfferingRepository,
} from "@/domain/sales-trial-offering";
import type { SalesTimezoneCacheRepository } from "@/domain/sales-timezones";
import {
  SalesItemProvisioningReadError,
  SalesItemProvisioningValidationError,
  type SalesItemProvisioningValidator,
} from "@/integrations/cloudshare/sales-item-provisioning";
import {
  createCloudShareSalesDelivery,
  type SalesDelivery,
} from "@/integrations/cloudshare/sales-delivery";
import {
  CloudShareAuthError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare/errors";
import type { CloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";

const writeSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2000),
  itemId: z.string().trim().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timeZone: z.string().trim().min(1).max(100),
  salesProEmail: z.string().trim().email(),
});

const response = (status: number, body: Record<string, unknown>) => ({ status, body });

export interface SalesTrialOfferingsDeps {
  readonly offerings: SalesTrialOfferingRepository;
  readonly items: Pick<ItemRepository, "findById">;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly deliveryFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >,
    ): SalesDelivery;
  };
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly itemProvisioningValidator?: SalesItemProvisioningValidator;
  readonly itemProvisioningValidatorFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >,
    ): SalesItemProvisioningValidator;
  };
  readonly projectMembers?: CloudShareProjectMemberSource;
  readonly projectMemberSourceFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >,
    ): CloudShareProjectMemberSource;
  };
  readonly timezones?: Pick<SalesTimezoneCacheRepository, "find">;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface SalesTrialOfferingMutationRequest {
  readonly customerId: string;
  readonly actor: DiagnosticActor;
  readonly body?: unknown;
}

export interface SalesTrialOfferingReadRequest {
  readonly customerId: string;
}

export interface SalesTrialOfferingPublishRequest {
  readonly customerId: string;
  readonly actor: DiagnosticActor;
  readonly id: string;
}

type PortalSalesTrialOffering = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly itemId: string;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly salesProEmail: string;
  readonly salesProDisplayName: string | null;
  readonly status: SalesTrialOffering["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly unpublishedAt: string | null;
  readonly attentionReason: string | null;
};

export async function handleCreateSalesTrialOffering(
  deps: SalesTrialOfferingsDeps,
  request: SalesTrialOfferingMutationRequest,
) {
  const parsed = writeSchema.safeParse(request.body);
  if (!parsed.success) {
    return response(400, { error: "Invalid Sales Trial Offering request." });
  }
  if (parsed.data.end <= parsed.data.start) {
    return response(400, { error: "End must be after start." });
  }
  const item = await deps.items.findById(parsed.data.itemId);
  if (!item || item.customerId !== request.customerId || item.status !== "active") {
    return response(404, { error: "Active Item was not found for this Customer." });
  }
  const id = (deps.newId ?? randomUUID)();
  const now = (deps.now ?? (() => new Date()))();
  const offering: SalesTrialOffering = {
    id,
    customerId: request.customerId,
    title: parsed.data.title,
    description: parsed.data.description,
    itemId: parsed.data.itemId,
    cloudShareSalesExperienceId: null,
    externalId: null,
    start: parsed.data.start,
    end: parsed.data.end,
    timeZone: parsed.data.timeZone,
    salesProEmail: parsed.data.salesProEmail.toLowerCase(),
    salesProDisplayName: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    unpublishedAt: null,
    attentionReason: null,
  };
  await deps.offerings.save(offering);
  await auditLifecycle(
    deps,
    request,
    offering.id,
    "sales.trial_offering.created",
    "success",
    {
      itemId: offering.itemId,
      lifecycle: "draft",
      status: "draft",
    },
  );
  return response(201, { offering: toPortalOffering(offering) });
}

export async function handleListSalesTrialOfferings(
  deps: Pick<SalesTrialOfferingsDeps, "offerings">,
  request: SalesTrialOfferingReadRequest,
) {
  const offerings = await deps.offerings.listByCustomerId(request.customerId);
  return response(200, { offerings: offerings.map(toPortalOffering) });
}

export async function handleListPublishedSalesTrialOfferings(
  deps: Pick<SalesTrialOfferingsDeps, "offerings">,
  request: SalesTrialOfferingReadRequest,
) {
  const offerings = await deps.offerings.listPublishedByCustomerId(request.customerId);
  return response(200, { offerings: offerings.map(toPortalOffering) });
}

export async function handlePublishSalesTrialOffering(
  deps: SalesTrialOfferingsDeps,
  request: SalesTrialOfferingPublishRequest,
) {
  const offering = await deps.offerings.findById(request.customerId, request.id);
  if (!offering) {
    return response(404, { error: "Sales Trial Offering was not found for this Customer." });
  }
  if (offering.status === "published") {
    return response(409, { error: "Sales Trial Offering is already published." });
  }
  if (offering.status === "unpublished") {
    return response(409, {
      error:
        "Unpublished Sales Trial Offerings cannot be published again because Certalis must not create a second shared CloudShare Sales Experience for the same Offering.",
    });
  }
  if (offering.status === "needs_attention") {
    return response(409, {
      error: AMBIGUOUS_CREATE_REASON,
      needsAttention: true,
      offering: toPortalOffering(offering),
    });
  }
  const [item, connection, timezoneCache] = await Promise.all([
    deps.items.findById(offering.itemId),
    deps.connections.findByCustomerId(request.customerId),
    deps.timezones?.find(request.customerId),
  ]);
  const correlationId = randomUUID();
  const externalId = offering.externalId ?? opaqueCloudShareId(offering.id);
  if (!item || item.customerId !== request.customerId || item.status !== "active") {
    return response(404, { error: "Active Item was not found for this Customer." });
  }
  if (!connection) {
    return response(404, {
      error: "Save a Certalis CloudShare Connection before publishing a Sales Trial Offering.",
    });
  }
  if (
    !timezoneCache ||
    !timezoneCache.timezones.some((zone) => zone.id === offering.timeZone)
  ) {
    return response(422, {
      error: "Refresh the documented CloudShare timezone catalogue before publishing.",
    });
  }
  if (
    !isValidCloudShareWallClock(offering.start, offering.timeZone) ||
    !isValidCloudShareWallClock(offering.end, offering.timeZone)
  ) {
    return response(400, {
      error: "Start and end must be unambiguous CloudShare wall-clock values.",
    });
  }
  let memberRead:
    | Awaited<ReturnType<CloudShareProjectMemberSource["listActiveProjectMembers"]>>
    | undefined;
  try {
    const validator =
      deps.itemProvisioningValidator ??
      deps.itemProvisioningValidatorFactory?.forConnection(connection);
    const reads = (await validator?.revalidate(item)) ?? [];
    await recordResourceReads(
      deps,
      request,
      correlationId,
      offering.id,
      item.id,
      item.project.id,
      reads,
      "success",
      "Catalogue Item resource revalidated before Sales Trial Offering publication",
    );
    const memberSource =
      deps.projectMembers ?? deps.projectMemberSourceFactory?.forConnection(connection);
    memberRead = await memberSource?.listActiveProjectMembers(item.project.id);
    if (memberRead) {
      await recordProjectMemberRead(
        deps,
        request,
        correlationId,
        offering.id,
        item.id,
        item.project.id,
        memberRead,
        "success",
        "Active Project members revalidated before Sales Trial Offering publication",
      );
    }
  } catch (error) {
    await recordPrePublishFailureEvidence(
      deps,
      request,
      correlationId,
      offering.id,
      item.id,
      item.project.id,
      error,
    );
    return publishFailure(deps, request, offering, correlationId, externalId, error);
  }
  const selectedSalesPro = memberRead?.members.find(
    (member) => member.email.toLowerCase() === offering.salesProEmail.toLowerCase(),
  );
  if (!selectedSalesPro) {
    if (memberRead) {
      await recordProjectMemberRead(
        deps,
        request,
        correlationId,
        offering.id,
        item.id,
        item.project.id,
        memberRead,
        "failure",
        "Selected Sales Pro was not active in the revalidated Project members",
      );
    }
    await auditLifecycle(
      deps,
      request,
      offering.id,
      "sales.trial_offering.publish",
      "failure",
      {
        itemId: offering.itemId,
        lifecycle: "publish",
        status: offering.status,
        failureMode: "selected_sales_pro_inactive",
        integrationSurface: "cloudshare.v3.project_members_gui",
      },
      "The selected Sales Pro is no longer an active Project member.",
      correlationId,
    );
    return response(422, {
      error: "The selected Sales Pro is no longer an active Project member.",
    });
  }
  const passphrase = opaqueCloudShareId(randomUUID());
  const delivery =
    deps.deliveryFactory?.forConnection(connection) ??
    createCloudShareSalesDelivery((deps.cloudshare ?? missingClientFactory).forConnection(connection));

  try {
    const created = await delivery.createSession({
      name: offering.title,
      type: "trial",
      projectId: item.project.id,
      blueprintIds: item.blueprints.map((blueprint) => blueprint.id),
      regionIds: item.regions.map((region) => region.id),
      policyId: item.policy.id,
      opportunity: offering.title,
      externalId,
      passphrase,
      start: offering.start,
      end: offering.end,
      timeZone: offering.timeZone,
      mainSalesProEmail: selectedSalesPro.email,
      registrationType: "registeredParticipantsOnly",
      sendInvitations: "dontSend",
    });
    const published = {
      ...offering,
      externalId,
      cloudShareSalesExperienceId: created.salesExperienceId,
      salesProDisplayName: selectedSalesPro.displayName,
      status: "published" as const,
      updatedAt: (deps.now ?? (() => new Date()))(),
      publishedAt: (deps.now ?? (() => new Date()))(),
      attentionReason: null,
    };
    try {
      await deps.offerings.save(published);
    } catch (error) {
      await Promise.allSettled([
        deps.diagnostics?.record({
          source: "sales-trial-offerings",
          operation: "sales.trial_offering.publish",
          outcome: "failure",
          level: "warn",
          customerId: request.customerId,
          actor: request.actor,
          subject: { type: "sales_trial_offering", id: offering.id },
          correlationId,
          message:
            "CloudShare created the shared Sales Trial Experience, but Certalis could not save its correlation.",
          externalIds: {
            offeringId: offering.id,
            itemId: offering.itemId,
            cloudShareSalesExperienceId: created.salesExperienceId,
            externalId,
          },
          request: created.request as unknown as Record<string, unknown>,
          response: created.response as unknown as Record<string, unknown>,
          details: {
            integrationSurface: "cloudshare.v4.sales",
            failureMode: "local_correlation_persistence",
            createdSalesExperienceId: created.salesExperienceId,
          },
        }),
        auditLifecycle(
          deps,
          request,
          offering.id,
          "sales.trial_offering.publish",
          "failure",
          {
            itemId: offering.itemId,
            lifecycle: "publish",
            status: offering.status,
            failureMode: "local_correlation_persistence",
            integrationSurface: "cloudshare.v4.sales",
          },
          "CloudShare created the shared Sales Trial Experience, but Certalis could not save its correlation.",
          correlationId,
        ),
      ]);
      return response(503, {
        error:
          "CloudShare created the Sales Trial Offering, but Certalis could not save its correlation. Do not retry publication; review support diagnostics.",
        needsAttention: true,
      });
    }
    await deps.diagnostics?.record({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.publish",
      outcome: "success",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_offering", id: offering.id },
      correlationId,
      message: "Sales Trial Offering published",
      externalIds: {
        offeringId: offering.id,
        itemId: offering.itemId,
        cloudShareSalesExperienceId: created.salesExperienceId,
        externalId,
      },
      request: created.request as unknown as Record<string, unknown>,
      response: created.response as unknown as Record<string, unknown>,
      details: { integrationSurface: "cloudshare.v4.sales", status: "published" },
    });
    await auditLifecycle(
      deps,
      request,
      offering.id,
      "sales.trial_offering.publish",
      "success",
      {
        itemId: offering.itemId,
        lifecycle: "publish",
        previousStatus: offering.status,
        status: "published",
        integrationSurface: "cloudshare.v4.sales",
      },
      undefined,
      correlationId,
    );
    return response(200, { offering: toPortalOffering(published) });
  } catch (error) {
    if (!isOutcomeAmbiguousCreateFailure(error)) {
      return publishFailure(deps, request, offering, correlationId, externalId, error);
    }
    const needsAttention = {
      ...offering,
      externalId,
      status: "needs_attention" as const,
      updatedAt: (deps.now ?? (() => new Date()))(),
      attentionReason: AMBIGUOUS_CREATE_REASON,
    };
    await deps.offerings.save(needsAttention);
    await deps.diagnostics?.record({
      source: "sales-trial-offerings",
      operation: "sales.trial_offering.publish",
      outcome: "failure",
      level: "warn",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_offering", id: offering.id },
      correlationId,
      message: AMBIGUOUS_CREATE_REASON,
      externalIds: {
        offeringId: offering.id,
        itemId: offering.itemId,
        externalId,
      },
      request: cloudShareEvidence(error)?.request,
      response: cloudShareEvidence(error)?.response,
      details: {
        integrationSurface: "cloudshare.v4.sales",
        failureMode: "cloudshare_create_outcome_ambiguous",
      },
    });
    await auditLifecycle(
      deps,
      request,
      offering.id,
      "sales.trial_offering.publish",
      "failure",
      {
        itemId: offering.itemId,
        lifecycle: "publish",
        status: "needs_attention",
        failureMode: "cloudshare_create_outcome_ambiguous",
        integrationSurface: "cloudshare.v4.sales",
      },
      AMBIGUOUS_CREATE_REASON,
      correlationId,
    );
    return response(502, {
      error: AMBIGUOUS_CREATE_REASON,
      needsAttention: true,
      offering: toPortalOffering(needsAttention),
    });
  }
}

export async function handleUnpublishSalesTrialOffering(
  deps: SalesTrialOfferingsDeps,
  request: SalesTrialOfferingPublishRequest,
) {
  const offering = await deps.offerings.findById(request.customerId, request.id);
  if (!offering) {
    return response(404, { error: "Sales Trial Offering was not found for this Customer." });
  }
  const unpublished = {
    ...offering,
    status: "unpublished" as const,
    updatedAt: (deps.now ?? (() => new Date()))(),
    unpublishedAt: (deps.now ?? (() => new Date()))(),
    attentionReason: null,
  };
  await deps.offerings.save(unpublished);
  await auditLifecycle(
    deps,
    request,
    offering.id,
    "sales.trial_offering.unpublish",
    "success",
    {
      itemId: offering.itemId,
      lifecycle: "unpublish",
      previousStatus: offering.status,
      status: "unpublished",
    },
  );
  return response(200, { offering: toPortalOffering(unpublished) });
}

function toPortalOffering(offering: SalesTrialOffering): PortalSalesTrialOffering {
  return {
    id: offering.id,
    title: offering.title,
    description: offering.description,
    itemId: offering.itemId,
    start: offering.start,
    end: offering.end,
    timeZone: offering.timeZone,
    salesProEmail: offering.salesProEmail,
    salesProDisplayName: offering.salesProDisplayName,
    status: offering.status,
    createdAt: offering.createdAt.toISOString(),
    updatedAt: offering.updatedAt.toISOString(),
    publishedAt: offering.publishedAt?.toISOString() ?? null,
    unpublishedAt: offering.unpublishedAt?.toISOString() ?? null,
    attentionReason: offering.attentionReason,
  };
}

function opaqueCloudShareId(value: string): string {
  return value.replaceAll("-", "");
}

function isOutcomeAmbiguousCreateFailure(error: unknown): boolean {
  if (error instanceof CloudShareRequestError) {
    return error.status >= 500;
  }
  return (
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError ||
    !(error instanceof CloudShareAuthError)
  );
}

function cloudShareEvidence(error: unknown):
  | {
      readonly request?: Record<string, unknown>;
      readonly response?: Record<string, unknown>;
    }
  | undefined {
  if (!(error instanceof Error) || !("context" in error)) {
    return undefined;
  }
  const context = (error as { context?: Record<string, unknown> }).context;
  if (!context) {
    return undefined;
  }
  return {
    request: {
      method: context.method,
      path: context.path,
      query: context.requestQuery,
      headers: context.requestHeaders,
      body: context.requestBody,
    },
    response: {
      status: context.responseStatus ?? context.status,
      headers: context.responseHeaders,
      body: context.responseBody,
      cause: context.cause,
      network: context.network,
      tls: context.tls,
    },
  };
}

const missingClientFactory: Pick<CloudShareClientFactory, "forConnection"> = {
  forConnection() {
    throw new Error("Sales Delivery is not configured.");
  },
};

const AMBIGUOUS_CREATE_REASON =
  "CloudShare POST /sales completed without a response, so the creation outcome is unknown. Do not retry publication; review support diagnostics.";

async function publishFailure(
  deps: SalesTrialOfferingsDeps,
  request: SalesTrialOfferingPublishRequest,
  offering: SalesTrialOffering,
  correlationId: string,
  externalId: string,
  error: unknown,
) {
  const itemValidationFailure = error instanceof SalesItemProvisioningValidationError;
  const itemReadFailure = error instanceof SalesItemProvisioningReadError;
  const evidence = cloudShareEvidence(itemReadFailure ? error.cause : error);
  const integrationSurface = itemValidationFailure || itemReadFailure
    ? "cloudshare.v3.sales_item_resources"
    : "cloudshare.v4.sales";
  const failureMode = itemValidationFailure
    ? "item_resource_drift"
    : itemReadFailure
      ? "item_resource_read"
      : "cloudshare_create";
  await deps.diagnostics?.record({
    source: "sales-trial-offerings",
    operation: "sales.trial_offering.publish",
    outcome: "failure",
    level: "warn",
    customerId: request.customerId,
    actor: request.actor,
    subject: { type: "sales_trial_offering", id: offering.id },
    correlationId,
    message: itemValidationFailure
      ? "Catalogue Item is stale against CloudShare resources"
      : itemReadFailure
        ? "CloudShare could not fully revalidate this Catalogue Item"
        : "CloudShare could not publish the Sales Trial Offering",
    externalIds: {
      offeringId: offering.id,
      itemId: offering.itemId,
      externalId,
    },
    request: evidence?.request,
    response: evidence?.response,
    details: {
      integrationSurface,
      failureMode,
      error: error instanceof Error ? error.message : String(error),
    },
  });
  const errorMessage = itemValidationFailure
    ? "This Item no longer matches its CloudShare resources. Refresh the Item before publishing."
    : itemReadFailure
      ? "CloudShare could not fully revalidate this Item. Review support diagnostics before retrying."
      : "CloudShare could not publish the Sales Trial Offering. Review support diagnostics.";
  await auditLifecycle(
    deps,
    request,
    offering.id,
    "sales.trial_offering.publish",
    "failure",
    {
      itemId: offering.itemId,
      lifecycle: "publish",
      status: offering.status,
      failureMode,
      integrationSurface,
    },
    errorMessage,
    correlationId,
  );
  return response(itemValidationFailure ? 422 : 502, {
    error: errorMessage,
  });
}

async function auditLifecycle(
  deps: Pick<SalesTrialOfferingsDeps, "audit" | "now">,
  request: Pick<SalesTrialOfferingMutationRequest, "customerId" | "actor">,
  subjectId: string,
  action: string,
  outcome: "success" | "failure" | "denied",
  details: Record<string, unknown>,
  error?: string,
  correlationId?: string,
) {
  await deps.audit?.write({
    id: randomUUID(),
    occurredAt: (deps.now ?? (() => new Date()))(),
    customerId: request.customerId,
    actorType: request.actor.type,
    actorId: request.actor.id,
    actorEmail: request.actor.email,
    action,
    subjectType: "sales_trial_offering",
    subjectId,
    outcome,
    correlationId,
    details,
    error,
  });
}

async function recordResourceReads(
  deps: SalesTrialOfferingsDeps,
  request: Pick<SalesTrialOfferingMutationRequest, "customerId" | "actor">,
  correlationId: string,
  offeringId: string,
  itemId: string,
  projectId: string,
  reads: readonly {
    request: Record<string, unknown>;
    response: Record<string, unknown>;
    integrationSurface: string;
  }[],
  outcome: "success" | "failure",
  message: string,
) {
  await Promise.allSettled(
    reads.map((read) =>
      deps.diagnostics?.record({
        source: "sales-trial-offerings",
        operation: "sales.trial_offering.item_resources.revalidated",
        outcome,
        level: outcome === "failure" ? "warn" : "info",
        customerId: request.customerId,
        actor: request.actor,
        subject: { type: "sales_trial_offering", id: offeringId },
        correlationId,
        message,
        request: read.request,
        response: read.response,
        details: { integrationSurface: read.integrationSurface },
        externalIds: { offeringId, itemId, projectId },
      }),
    ),
  );
}

async function recordProjectMemberRead(
  deps: SalesTrialOfferingsDeps,
  request: Pick<SalesTrialOfferingMutationRequest, "customerId" | "actor">,
  correlationId: string,
  offeringId: string,
  itemId: string,
  projectId: string,
  read: Awaited<ReturnType<CloudShareProjectMemberSource["listActiveProjectMembers"]>>,
  outcome: "success" | "failure",
  message: string,
) {
  await deps.diagnostics?.record({
    source: "sales-trial-offerings",
    operation: "sales.trial_offering.project_members.revalidated",
    outcome,
    level: outcome === "failure" ? "warn" : "info",
    customerId: request.customerId,
    actor: request.actor,
    subject: { type: "sales_trial_offering", id: offeringId },
    correlationId,
    message,
    request: read.request as unknown as Record<string, unknown>,
    response: read.response as unknown as Record<string, unknown>,
    details: {
      integrationSurface: read.integrationSurface,
      memberCount: read.members.length,
      cached: false,
    },
    externalIds: { offeringId, itemId, projectId },
  });
}

async function recordPrePublishFailureEvidence(
  deps: SalesTrialOfferingsDeps,
  request: Pick<SalesTrialOfferingMutationRequest, "customerId" | "actor">,
  correlationId: string,
  offeringId: string,
  itemId: string,
  projectId: string,
  error: unknown,
) {
  if (error instanceof SalesItemProvisioningValidationError) {
    await recordResourceReads(
      deps,
      request,
      correlationId,
      offeringId,
      itemId,
      projectId,
      error.completedReads,
      "failure",
      "Catalogue Item revalidation found stale CloudShare resources",
    );
    return;
  }
  if (error instanceof SalesItemProvisioningReadError) {
    await recordResourceReads(
      deps,
      request,
      correlationId,
      offeringId,
      itemId,
      projectId,
      error.completedReads,
      "failure",
      "CloudShare could not fully revalidate this Catalogue Item",
    );
    return;
  }
  const evidence = cloudShareEvidence(error);
  if (!evidence) {
    return;
  }
  await deps.diagnostics?.record({
    source: "sales-trial-offerings",
    operation: "sales.trial_offering.project_members.revalidated",
    outcome: "failure",
    level: "warn",
    customerId: request.customerId,
    actor: request.actor,
    subject: { type: "sales_trial_offering", id: offeringId },
    correlationId,
    message: "CloudShare could not read active Project members before Sales Trial Offering publication",
    request: evidence.request,
    response: evidence.response,
    details: {
      integrationSurface: "cloudshare.v3.project_members_gui",
      failureMode: "project_member_read",
      cached: false,
    },
    externalIds: { offeringId, itemId, projectId },
  });
}
