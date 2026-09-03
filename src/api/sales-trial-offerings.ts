import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import {
  cloudShareWallClockToInstant,
  formatCloudShareWallClock,
} from "@/domain/cloudshare-wall-clock";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ItemRepository } from "@/domain/item";
import type {
  SalesTrialOffering,
  SalesTrialOfferingRepository,
} from "@/domain/sales-trial-offering";
import {
  hasContinuableSalesTrialEnvironment,
  type SalesTrialEnrollmentRepository,
} from "@/domain/sales-trial-enrollment";
import type { SalesTimezoneCacheRepository } from "@/domain/sales-timezones";
import { calculateSalesTrialEnding } from "@/domain/sales-trial-ending";
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
  isCloudShareErrorAcrossBoundaries,
} from "@/integrations/cloudshare/errors";
import type { CloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";
import type { SalesEnvironmentSource } from "@/integrations/cloudshare/sales-environment";
import { projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";

const writeSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(""),
  itemId: z.string().trim().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable(),
  noEndDate: z.boolean().optional(),
  timeZone: z.string().trim().min(1).max(100),
  salesProEmail: z.string().trim().email(),
});

const response = (status: number, body: Record<string, unknown>) => ({ status, body });

class SalesTrialEndingLeaseLostError extends Error {
  constructor() {
    super("Sales Trial ending reconciliation lease was lost.");
    this.name = "SalesTrialEndingLeaseLostError";
  }
}

export interface SalesTrialOfferingsDeps {
  readonly offerings: SalesTrialOfferingRepository;
  readonly items: Pick<ItemRepository, "findById">;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly deliveryFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >,
      options?: Parameters<CloudShareClientFactory["forConnection"]>[1],
    ): SalesDelivery;
  };
  readonly salesEnvironmentFactory?: {
    forConnection(
      connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>,
      options?: Parameters<CloudShareClientFactory["forConnection"]>[1],
    ): SalesEnvironmentSource;
  };
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly cloudshareObserver?: (input: { customerId: string; actor: DiagnosticActor; correlationId: string; offeringId: string }) => Parameters<CloudShareClientFactory["forConnection"]>[1];
  readonly itemProvisioningValidator?: SalesItemProvisioningValidator;
  readonly itemProvisioningValidatorFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >, options?: Parameters<CloudShareClientFactory["forConnection"]>[1],
    ): SalesItemProvisioningValidator;
  };
  readonly projectMembers?: CloudShareProjectMemberSource;
  readonly projectMemberSourceFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >, options?: Parameters<CloudShareClientFactory["forConnection"]>[1],
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
  readonly end: string | null;
  readonly timeZone: string;
  readonly salesProEmail: string;
  readonly salesProDisplayName: string | null;
  readonly status: SalesTrialOffering["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly unpublishedAt: string | null;
  readonly attentionReason: string | null;
  readonly endingCalculatedEnd: string | null;
  readonly endingLastReconciledAt: string | null;
};

type ParticipantSalesTrialOffering = Pick<
  PortalSalesTrialOffering,
  "id" | "title" | "description" | "start" | "end" | "timeZone"
>;

export async function handleCreateSalesTrialOffering(
  deps: SalesTrialOfferingsDeps,
  request: SalesTrialOfferingMutationRequest,
) {
  const parsed = writeSchema.safeParse(request.body);
  if (!parsed.success) {
    return response(400, { error: "Invalid Sales Trial Offering request." });
  }
  if (parsed.data.end === null && !parsed.data.noEndDate) {
    return response(400, {
      error: "Select an end time or explicitly mark the Trial Offering as open-ended.",
    });
  }
  if (parsed.data.end !== null && parsed.data.end <= parsed.data.start) {
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
  await deps.diagnostics?.record({
    source: "sales-trial-offerings",
    operation: "sales.trial_offering.created",
    outcome: "success",
    customerId: request.customerId,
    actor: request.actor,
    subject: { type: "sales_trial_offering", id: offering.id },
    message: "Sales Trial Offering draft created",
    externalIds: { offeringId: offering.id, itemId: offering.itemId },
    details: {
      integrationSurface: "portal.sales_trial_offerings",
      lifecycle: "draft",
      status: "draft",
    },
  });
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
  deps: Pick<SalesTrialOfferingsDeps, "offerings" | "now"> & {
    readonly enrollments?: Pick<SalesTrialEnrollmentRepository, "listByPortalUser">;
  },
  request: SalesTrialOfferingReadRequest & { readonly portalUserId?: string },
) {
  const published = await deps.offerings.listPublishedByCustomerId(request.customerId);
  const now = (deps.now ?? (() => new Date()))();
  const launchedEnrollments = request.portalUserId && deps.enrollments?.listByPortalUser
    ? await deps.enrollments.listByPortalUser(request.customerId, request.portalUserId)
    : [];
  const continuedOfferingIds = new Set(
    launchedEnrollments
      .filter(hasContinuableSalesTrialEnvironment)
      .map((enrollment) => enrollment.salesTrialOfferingId),
  );
  const continued = continuedOfferingIds.size === 0
    ? []
    : (await deps.offerings.listByCustomerId(request.customerId)).filter(
        (offering) => (offering.status === "unpublished" || offering.status === "ending") && continuedOfferingIds.has(offering.id),
      );
  const accessible = new Map<string, SalesTrialOffering>();
  for (const offering of published.filter((candidate) => isOfferingActive(candidate, now))) {
    accessible.set(offering.id, offering);
  }
  for (const offering of continued) accessible.set(offering.id, offering);
  return response(200, {
    offerings: [...accessible.values()]
      .sort((left, right) => left.start.localeCompare(right.start))
      .map(toParticipantOffering),
  });
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
  if (offering.status === "provisioning") {
    return response(409, {
      error:
        offering.attentionReason ??
        PROVISIONING_RESERVATION_REASON,
      needsAttention: true,
      offering: toPortalOffering({
        ...offering,
        status: "needs_attention",
        attentionReason:
          offering.attentionReason ?? PROVISIONING_RESERVATION_REASON,
      }),
    });
  }
  if (offering.status === "unpublished") {
    return response(409, {
      error:
        "Unpublished Sales Trial Offerings cannot be published again because Certalis must not create a second shared CloudShare Sales Experience for the same Offering.",
    });
  }
  if (offering.status === "needs_attention") {
    return response(409, {
      error: offering.attentionReason ?? AMBIGUOUS_CREATE_REASON,
      needsAttention: true,
      offering: toPortalOffering(offering),
    });
  }
  if (hasProviderCorrelation(offering)) {
    return response(409, {
      error:
        "This Sales Trial Offering already has CloudShare publication correlation and must stay in needs-attention state until support resolves it. Do not retry publication.",
      needsAttention: true,
      offering: toPortalOffering({
        ...offering,
        status: "needs_attention",
        attentionReason:
          offering.attentionReason ?? LOCAL_CORRELATION_PERSISTENCE_REASON,
      }),
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
    return rejectPublishPreflight(
      deps,
      request,
      offering,
      correlationId,
      externalId,
      404,
      "Active Item was not found for this Customer.",
      "item_not_found_or_inactive",
    );
  }
  if (!connection) {
    return rejectPublishPreflight(
      deps,
      request,
      offering,
      correlationId,
      externalId,
      404,
      "Save a Certalis CloudShare Connection before publishing a Sales Trial Offering.",
      "connection_missing",
    );
  }
  if (
    !timezoneCache ||
    !timezoneCache.timezones.some((zone) => zone.id === offering.timeZone)
  ) {
    return rejectPublishPreflight(
      deps,
      request,
      offering,
      correlationId,
      externalId,
      422,
      "Refresh the documented CloudShare timezone catalogue before publishing.",
      "unsupported_cloudshare_timezone",
    );
  }
  const startInstant = cloudShareWallClockToInstant(offering.start, offering.timeZone);
  const endInstant =
    offering.end === null
      ? null
      : cloudShareWallClockToInstant(offering.end, offering.timeZone);
  if (!startInstant || (offering.end !== null && !endInstant)) {
    return rejectPublishPreflight(
      deps,
      request,
      offering,
      correlationId,
      externalId,
      400,
      "Start and end must be unambiguous CloudShare wall-clock values.",
      "invalid_wall_clock",
    );
  }
  if (endInstant !== null && endInstant <= startInstant) {
    return rejectPublishPreflight(
      deps,
      request,
      offering,
      correlationId,
      externalId,
      400,
      "End must be after start.",
      "end_before_start",
    );
  }
  if (startInstant <= (deps.now ?? (() => new Date()))()) {
    return rejectPublishPreflight(
      deps,
      request,
      offering,
      correlationId,
      externalId,
      400,
      "Choose a future start time before publishing.",
      "start_not_future",
    );
  }
  let memberRead:
    | Awaited<ReturnType<CloudShareProjectMemberSource["listActiveProjectMembers"]>>
    | undefined;
  const publishClientOptions = deps.cloudshareObserver?.({ customerId: request.customerId, actor: request.actor, correlationId, offeringId: offering.id });
  try {
    const validator =
      deps.itemProvisioningValidator ??
      deps.itemProvisioningValidatorFactory?.forConnection(connection, publishClientOptions);
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
      deps.projectMembers ?? deps.projectMemberSourceFactory?.forConnection(connection, publishClientOptions);
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
  const clientOptions = publishClientOptions;
  const delivery =
    (clientOptions ? deps.deliveryFactory?.forConnection(connection, clientOptions) : deps.deliveryFactory?.forConnection(connection)) ??
    createCloudShareSalesDelivery((deps.cloudshare ?? missingClientFactory).forConnection(connection, clientOptions));
  const reservationUpdatedAt = (deps.now ?? (() => new Date()))();
  const reservation = {
    ...offering,
    externalId,
    status: "provisioning" as const,
    updatedAt: reservationUpdatedAt,
    attentionReason: PROVISIONING_RESERVATION_REASON,
  };
  try {
    const reserved =
      (await deps.offerings.reservePublication?.(request.customerId, offering.id, {
        externalId,
        updatedAt: reservationUpdatedAt,
        attentionReason: PROVISIONING_RESERVATION_REASON,
      })) ?? false;
    if (!reserved) {
      const reloaded = await deps.offerings.findById(request.customerId, offering.id);
      if (reloaded && reloaded.status !== "draft") {
        return response(409, {
          error: reloaded.attentionReason ?? PROVISIONING_RESERVATION_REASON,
          needsAttention: true,
          offering: toPortalOffering({
            ...reloaded,
            status:
              reloaded.status === "published" || reloaded.status === "unpublished"
                ? reloaded.status
                : "needs_attention",
            attentionReason:
              reloaded.attentionReason ?? PROVISIONING_RESERVATION_REASON,
          }),
        });
      }
      throw new Error("Sales Trial Offering reservation was not claimed.");
    }
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
          "Certalis could not reserve the Sales Trial Offering locally. No CloudShare publication was attempted.",
        externalIds: {
          offeringId: offering.id,
          itemId: offering.itemId,
          externalId,
        },
        details: {
          integrationSurface: "portal.sales_trial_offerings",
          failureMode: "local_reservation_persistence",
          cloudShareAttempted: false,
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
          failureMode: "local_reservation_persistence",
          integrationSurface: "portal.sales_trial_offerings",
          cloudShareAttempted: false,
        },
        "Certalis could not reserve the Sales Trial Offering locally. No CloudShare publication was attempted.",
        correlationId,
      ),
    ]);
    return response(503, {
      error:
        "Certalis could not reserve the Sales Trial Offering locally. No CloudShare publication was attempted; review support diagnostics and retry.",
      needsAttention: false,
    });
  }

  try {
    const created = await delivery.createSession({
      name: reservation.title,
      type: "trial",
      projectId: item.project.id,
      blueprintIds: item.blueprints.map((blueprint) => blueprint.id),
      regionIds: item.regions.map((region) => region.id),
      policyId: item.policy.id,
      opportunity: reservation.title,
      externalId,
      passphrase,
      start: reservation.start,
      end: reservation.end,
      timeZone: reservation.timeZone,
      mainSalesProEmail: selectedSalesPro.email,
      registrationType: "registeredParticipantsOnly",
      sendInvitations: "dontSend",
    });
    const published = {
      ...reservation,
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
      const fallback = {
        cloudShareSalesExperienceId: created.salesExperienceId,
        externalId,
        salesProDisplayName: selectedSalesPro.displayName,
        updatedAt: published.updatedAt,
        publishedAt: published.publishedAt!,
        attentionReason: LOCAL_CORRELATION_PERSISTENCE_REASON,
      };
      let fallbackPersisted = false;
      try {
        const needsAttention = {
          ...published,
          status: "needs_attention" as const,
          attentionReason: LOCAL_CORRELATION_PERSISTENCE_REASON,
        };
        await deps.offerings.save(needsAttention);
        fallbackPersisted = true;
      } catch {
        fallbackPersisted =
          (await deps.offerings.markPublishNeedsAttention?.(
          request.customerId,
          offering.id,
          fallback,
        )) ?? false;
      }
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
            fallbackPersisted,
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
            outcome: fallbackPersisted ? "needs_attention" : "persistence_failed",
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
      await releaseReservationToDraft(
        deps,
        request.customerId,
        offering.id,
        reservation.updatedAt,
      );
      return publishFailure(deps, request, offering, correlationId, externalId, error);
    }
    const needsAttention = {
      ...reservation,
      externalId,
      status: "needs_attention" as const,
      updatedAt: (deps.now ?? (() => new Date()))(),
      attentionReason: AMBIGUOUS_CREATE_REASON,
    };
    let fallbackPersisted = false;
    try {
      await deps.offerings.save(needsAttention);
      fallbackPersisted = true;
    } catch {
      fallbackPersisted =
        (await deps.offerings.markPublishNeedsAttention?.(request.customerId, offering.id, {
          cloudShareSalesExperienceId:
            needsAttention.cloudShareSalesExperienceId,
          externalId,
          salesProDisplayName: needsAttention.salesProDisplayName,
          updatedAt: needsAttention.updatedAt,
          publishedAt: needsAttention.publishedAt ?? needsAttention.updatedAt,
          attentionReason: AMBIGUOUS_CREATE_REASON,
        })) ?? false;
    }
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
        fallbackPersisted,
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
        outcome: fallbackPersisted ? "needs_attention" : "persistence_failed",
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
  if (offering.status !== "published") {
    if (offering.status === "provisioning") {
      await auditLifecycle(
        deps,
        request,
        offering.id,
        "sales.trial_offering.unpublish",
        "denied",
        {
          itemId: offering.itemId,
          lifecycle: "unpublish",
          previousStatus: offering.status,
          status: offering.status,
          failureMode: "provisioning_preserved",
        },
        offering.attentionReason ?? PROVISIONING_RESERVATION_REASON,
      );
      return response(409, {
        error:
          offering.attentionReason ?? PROVISIONING_RESERVATION_REASON,
        needsAttention: true,
        offering: toPortalOffering({
          ...offering,
          status: "needs_attention",
          attentionReason:
            offering.attentionReason ?? PROVISIONING_RESERVATION_REASON,
        }),
      });
    }
    if (offering.status === "needs_attention") {
      await auditLifecycle(
        deps,
        request,
        offering.id,
        "sales.trial_offering.unpublish",
        "denied",
        {
          itemId: offering.itemId,
          lifecycle: "unpublish",
          previousStatus: offering.status,
          status: offering.status,
          failureMode: "needs_attention_preserved",
        },
        "This Sales Trial Offering already has CloudShare publication correlation and needs support follow-up. Unpublish is blocked to preserve the correlated state.",
      );
      return response(409, {
        error:
          "This Sales Trial Offering already has CloudShare publication correlation and needs support follow-up. Unpublish is blocked to preserve the correlated state.",
        needsAttention: true,
        offering: toPortalOffering(offering),
      });
    }
    return response(409, {
      error: "Only published Sales Trial Offerings can be unpublished.",
    });
  }
  const unpublished = {
    ...offering,
    status: "unpublished" as const,
    updatedAt: (deps.now ?? (() => new Date()))(),
    unpublishedAt: (deps.now ?? (() => new Date()))(),
    attentionReason: null,
  };
  await deps.offerings.save(unpublished);
  await deps.diagnostics?.record({
    source: "sales-trial-offerings",
    operation: "sales.trial_offering.unpublish",
    outcome: "success",
    customerId: request.customerId,
    actor: request.actor,
    subject: { type: "sales_trial_offering", id: offering.id },
    message: "Sales Trial Offering unpublished",
    externalIds: { offeringId: offering.id, itemId: offering.itemId },
    details: {
      integrationSurface: "portal.sales_trial_offerings",
      lifecycle: "unpublish",
      previousStatus: offering.status,
      status: "unpublished",
    },
  });
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

export async function handleEndSalesTrialOffering(
  deps: SalesTrialOfferingsDeps,
  request: SalesTrialOfferingPublishRequest,
) {
  // Production composition supplies the v3 environment source. Keep the
  // legacy failure-aware path for older explicit adapters until they migrate.
  if (!deps.salesEnvironmentFactory) {
    return legacyHandleEndSalesTrialOffering(deps, request);
  }
  const offering = await deps.offerings.findById(request.customerId, request.id);
  if (!offering) return response(404, { error: "Sales Trial Offering was not found for this Customer." });
  if ((offering.status !== "published" && offering.status !== "ending") || !offering.cloudShareSalesExperienceId) {
    return response(409, { error: "Only published or ending Sales Trial Offerings can be ended." });
  }
  const now = (deps.now ?? (() => new Date()))();
  // Admission closes durably before any provider read or mutation. A provider
  // failure must never reopen this catalogue entry to new participants.
  const ending: SalesTrialOffering = {
    ...offering,
    status: "ending",
    unpublishedAt: offering.unpublishedAt ?? now,
    updatedAt: now,
    attentionReason: null,
    endingLeaseToken: null,
    endingLeaseExpiresAt: null,
  };
  const leaseToken = randomUUID();
  const correlationId = randomUUID();
  const leaseDurationMs = 15 * 60_000;
  if (deps.offerings.reserveEndingReconciliation) {
    const reserved = await deps.offerings.reserveEndingReconciliation(
      request.customerId, offering.id, leaseToken, now, new Date(now.getTime() + leaseDurationMs), ending.unpublishedAt!,
    );
    if (!reserved) {
      const current = await deps.offerings.findById(request.customerId, offering.id);
      return response(202, { offering: toPortalOffering(current ?? ending), reconciliationInProgress: true });
    }
  } else {
    await deps.offerings.save(ending);
  }
  if (offering.status === "published") {
    await Promise.allSettled([
      deps.diagnostics?.record({
        source: "sales-trial-offerings", operation: "sales.trial_offering.end", outcome: "success",
        customerId: request.customerId, actor: request.actor, subject: { type: "sales_trial_offering", id: offering.id },
        correlationId, message: "Sales Trial Offering unpublished and entering deferred shutdown",
        externalIds: { offeringId: offering.id, cloudShareSalesExperienceId: offering.cloudShareSalesExperienceId! },
        details: { integrationSurface: "portal.sales_trial_offerings", previousStatus: "published", status: "ending" },
      }),
      auditLifecycle(deps, request, offering.id, "sales.trial_offering.end", "success", {
        lifecycle: "ending", previousStatus: "published", status: "ending", integrationSurface: "portal.sales_trial_offerings",
      }, undefined, correlationId),
    ]);
  }

  let terminalTarget = offering.endingTerminalTarget ?? null;
  const renewLease = async () => {
    if (!deps.offerings.renewEndingReconciliation) return;
    const renewalNow = (deps.now ?? (() => new Date()))();
    const renewed = await deps.offerings.renewEndingReconciliation(
      request.customerId, offering.id, leaseToken, renewalNow, new Date(renewalNow.getTime() + leaseDurationMs),
    );
    if (!renewed) throw new SalesTrialEndingLeaseLostError();
  };
  const configurationFailure = async (failureMode: string, integrationSurface: string) => {
    const attention = { ...ending, attentionReason: "CloudShare shutdown reconciliation requires attention; review support diagnostics." };
    await deps.offerings.save(attention);
    await deps.diagnostics?.record({
      source: "sales-trial-offerings", operation: "sales.trial_offering.end", outcome: "failure", level: "warn",
      customerId: request.customerId, actor: request.actor, subject: { type: "sales_trial_offering", id: offering.id },
      correlationId, message: attention.attentionReason!,
      externalIds: { offeringId: offering.id, cloudShareSalesExperienceId: offering.cloudShareSalesExperienceId! },
      details: { integrationSurface, failureMode, status: "ending", needsAttention: true },
    });
    return response(202, { offering: toPortalOffering(attention), needsAttention: true, correlationId });
  };
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) return configurationFailure("cloudshare_connection_missing", "portal.cloudshare_connection");
  const observerOptions = deps.cloudshareObserver?.({ customerId: request.customerId, actor: request.actor, correlationId, offeringId: offering.id });
  const delivery = (observerOptions ? deps.deliveryFactory?.forConnection(connection, observerOptions) : deps.deliveryFactory?.forConnection(connection)) ??
    createCloudShareSalesDelivery((deps.cloudshare ?? missingClientFactory).forConnection(connection, observerOptions));
  if (!delivery.updateSession) return configurationFailure("sales_delivery_update_missing", "cloudshare.v4.sales");
  const environments = deps.salesEnvironmentFactory.forConnection(connection, observerOptions);
  if (!environments.observeById) return configurationFailure("environment_getextended_missing", "cloudshare.v3.envs.getextended");
  try {
    await renewLease();
    const [provider, roster] = await Promise.all([
      delivery.readSession(offering.cloudShareSalesExperienceId),
      delivery.listParticipants(offering.cloudShareSalesExperienceId),
    ]);
    if (provider.status === "ended") {
      const ended = { ...ending, status: "ended" as const, endingLastReconciledAt: now, attentionReason: null };
      await deps.offerings.save(ended);
      await Promise.allSettled([
        deps.diagnostics?.record({
          source: "sales-trial-offerings", operation: "sales.trial_offering.end", outcome: "success",
          customerId: request.customerId, actor: request.actor, subject: { type: "sales_trial_offering", id: offering.id },
          correlationId, message: "CloudShare Sales Trial Experience is ended",
          externalIds: { offeringId: offering.id, cloudShareSalesExperienceId: offering.cloudShareSalesExperienceId! },
          request: provider.request as unknown as Record<string, unknown>, response: provider.response as unknown as Record<string, unknown>,
          details: { integrationSurface: "cloudshare.v4.sales", previousStatus: offering.status, status: "ended", providerUpdated: false },
        }),
        auditLifecycle(deps, request, offering.id, "sales.trial_offering.end", "success", {
          lifecycle: "provider_ended", previousStatus: offering.status, status: "ended", integrationSurface: "cloudshare.v4.sales",
        }, undefined, correlationId),
      ]);
      return response(200, { offering: toPortalOffering(ended) });
    }
    const environmentIds = [...new Set(roster.participants.map((p) => p.environmentId).filter((id): id is string => Boolean(id)))];
    const observations = [];
    // Deliberately sequential: fail closed on the first incomplete read and do
    // not burst an unbounded participant roster at the v3 endpoint.
    for (const environmentId of environmentIds) {
      observations.push(await environments.observeById!(environmentId));
      await renewLease();
    }
    const calculation = calculateSalesTrialEnding({
      observations, now, timeZone: offering.timeZone, providerEnd: provider.end,
      persistedTerminalTarget: offering.endingTerminalTarget,
    });
    if (calculation.activeCount === 0 && !terminalTarget) {
      terminalTarget = calculation.calculatedEnd;
      if (deps.offerings.persistEndingTerminalTarget &&
        !(await deps.offerings.persistEndingTerminalTarget(request.customerId, offering.id, leaseToken, terminalTarget))) {
        throw new SalesTrialEndingLeaseLostError();
      }
    }
    await renewLease();
    const providerUpdate = calculation.shouldUpdate
      ? await delivery.updateSession(offering.cloudShareSalesExperienceId, { end: calculation.calculatedEnd })
      : null;
    const reconciled = {
      ...ending,
      status: calculation.activeCount === 0 ? "ended" as const : "ending" as const,
      end: calculation.effectiveEnd,
      endingCalculatedEnd: calculation.effectiveEnd,
      endingTerminalTarget: terminalTarget,
      endingLastReconciledAt: now,
      attentionReason: null,
    };
    await deps.offerings.save(reconciled);
    const evidence = providerUpdate ?? provider;
    await Promise.allSettled([
      deps.diagnostics?.record({
        source: "sales-trial-offerings", operation: "sales.trial_offering.end", outcome: "success",
        customerId: request.customerId, actor: request.actor, subject: { type: "sales_trial_offering", id: offering.id },
        correlationId, message: providerUpdate ? "CloudShare Sales Trial end reconciled" : "CloudShare Sales Trial end remains safely scheduled",
        externalIds: { offeringId: offering.id, cloudShareSalesExperienceId: offering.cloudShareSalesExperienceId! },
        request: evidence.request as unknown as Record<string, unknown>, response: evidence.response as unknown as Record<string, unknown>,
        details: { integrationSurface: "cloudshare.v4.sales", previousStatus: offering.status,
          status: calculation.activeCount === 0 ? "ended" : "ending",
          providerUpdated: Boolean(providerUpdate), calculatedEnd: calculation.calculatedEnd, effectiveEnd: calculation.effectiveEnd,
          activeEnvironmentCount: calculation.activeCount },
      }),
      auditLifecycle(deps, request, offering.id, "sales.trial_offering.end", "success", {
        lifecycle: providerUpdate ? "provider_end_updated" : "provider_end_observed", previousStatus: offering.status,
        status: calculation.activeCount === 0 ? "ended" : "ending", integrationSurface: "cloudshare.v4.sales", calculatedEnd: calculation.calculatedEnd,
        effectiveEnd: calculation.effectiveEnd, activeEnvironmentCount: calculation.activeCount,
      }, undefined, correlationId),
    ]);
    return response(200, { offering: toPortalOffering(reconciled) });
  } catch (error) {
    if (error instanceof SalesTrialEndingLeaseLostError) {
      const current = await deps.offerings.findById(request.customerId, offering.id);
      return response(202, { offering: toPortalOffering(current ?? ending), reconciliationInProgress: true });
    }
    const attention = {
      ...ending,
      endingTerminalTarget: terminalTarget,
      endingLastReconciledAt: now,
      attentionReason: "CloudShare shutdown reconciliation requires attention; review support diagnostics.",
    };
    await deps.offerings.save(attention);
    const evidence = cloudShareEvidence(error);
    await deps.diagnostics?.record({
      source: "sales-trial-offerings", operation: "sales.trial_offering.end", outcome: "failure", level: "warn",
      customerId: request.customerId, actor: request.actor,
      subject: { type: "sales_trial_offering", id: offering.id }, correlationId,
      message: attention.attentionReason!,
      externalIds: { offeringId: offering.id, cloudShareSalesExperienceId: offering.cloudShareSalesExperienceId },
      request: evidence?.request, response: evidence?.response,
      details: { integrationSurface: "cloudshare.v3.envs.getextended", status: "ending", needsAttention: true },
    });
    return response(202, { offering: toPortalOffering(attention), needsAttention: true, correlationId });
  }
}

async function legacyHandleEndSalesTrialOffering(
  deps: SalesTrialOfferingsDeps,
  request: SalesTrialOfferingPublishRequest,
) {
  const offering = await deps.offerings.findById(request.customerId, request.id);
  if (!offering) {
    return response(404, { error: "Sales Trial Offering was not found for this Customer." });
  }
  if (offering.status !== "published" || !offering.cloudShareSalesExperienceId) {
    return response(409, { error: "Only published Sales Trial Offerings can be ended." });
  }
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    return response(404, { error: "Sales Trial Offering is unavailable." });
  }
  const delivery =
    deps.deliveryFactory?.forConnection(connection) ??
    createCloudShareSalesDelivery((deps.cloudshare ?? missingClientFactory).forConnection(connection, { scope: "customer_default", correlationId: `sales-offering-update:${request.customerId}`, reason: "unanchored_support_read" }));
  if (!delivery.updateSession) {
    return response(503, { error: "Sales Delivery update is not configured." });
  }

  const now = (deps.now ?? (() => new Date()))();
  const end = formatCloudShareWallClock(new Date(now.getTime() + 2 * 60_000), offering.timeZone);
  const correlationId = randomUUID();
  if (!end) {
    return response(400, { error: "End trial requires a supported CloudShare timezone." });
  }

  let updated;
  try {
    updated = await delivery.updateSession(offering.cloudShareSalesExperienceId, { end });
  } catch (error) {
    const publishedWithAttention = {
      ...offering,
      status: "published" as const,
      updatedAt: now,
      attentionReason: END_PROVIDER_FAILURE_REASON,
    };
    let localAttentionMarkerPersisted = false;
    try {
      await deps.offerings.save(publishedWithAttention);
      localAttentionMarkerPersisted = true;
    } catch {
      // Preserve the durable provider-failure evidence path through diagnostics and audit
      // even when the local attention marker cannot be saved.
    }
    const evidence = cloudShareEvidence(error);
    await Promise.allSettled([
      deps.diagnostics?.record({
        source: "sales-trial-offerings",
        operation: "sales.trial_offering.end",
        outcome: "failure",
        level: "warn",
        customerId: request.customerId,
        actor: request.actor,
        subject: { type: "sales_trial_offering", id: offering.id },
        correlationId,
        message: END_PROVIDER_FAILURE_REASON,
        externalIds: {
          offeringId: offering.id,
          itemId: offering.itemId,
          cloudShareSalesExperienceId: offering.cloudShareSalesExperienceId,
        },
        request: evidence?.request,
        response: evidence?.response,
        details: {
          integrationSurface: "cloudshare.v4.sales",
          failureMode: "cloudshare_end_trial_update",
          previousStatus: offering.status,
          status: "published",
          needsAttention: true,
          localAttentionMarkerPersisted,
        },
      }),
      auditLifecycle(
        deps,
        request,
        offering.id,
        "sales.trial_offering.end",
        "failure",
        {
          itemId: offering.itemId,
          lifecycle: "end",
          previousStatus: offering.status,
          status: "published",
          needsAttention: true,
          failureMode: "cloudshare_end_trial_update",
          integrationSurface: "cloudshare.v4.sales",
          localAttentionMarkerPersisted,
        },
        END_PROVIDER_FAILURE_REASON,
        correlationId,
      ),
    ]);
    return response(502, {
      correlationId,
      error: localAttentionMarkerPersisted ? END_PROVIDER_FAILURE_REASON : `${END_PROVIDER_FAILURE_REASON} Portal state may be stale.`,
      needsAttention: true,
      ...(localAttentionMarkerPersisted ? { offering: toPortalOffering(publishedWithAttention) } : {}),
    });
  }

  try {
    const unpublished = {
      ...offering,
      end,
      status: "unpublished" as const,
      updatedAt: now,
      unpublishedAt: now,
      attentionReason: null,
    };
    await deps.offerings.save(unpublished);
    await Promise.allSettled([
      deps.diagnostics?.record({
        source: "sales-trial-offerings",
        operation: "sales.trial_offering.end",
        outcome: "success",
        customerId: request.customerId,
        actor: request.actor,
        subject: { type: "sales_trial_offering", id: offering.id },
        message: "Sales Trial Offering ended and unpublished",
        externalIds: { offeringId: offering.id, itemId: offering.itemId },
        request: updated.request as unknown as Record<string, unknown>,
        response: updated.response as unknown as Record<string, unknown>,
        details: {
          integrationSurface: "cloudshare.v4.sales",
          lifecycle: "end",
          previousStatus: offering.status,
          status: "unpublished",
        },
      }),
      auditLifecycle(
        deps,
        request,
        offering.id,
        "sales.trial_offering.end",
        "success",
        {
          itemId: offering.itemId,
          lifecycle: "end",
          previousStatus: offering.status,
          status: "unpublished",
          integrationSurface: "cloudshare.v4.sales",
        },
      ),
    ]);
    return response(200, { offering: toPortalOffering(unpublished) });
  } catch (error) {
    const endedNeedsAttention = {
      ...offering,
      end,
      status: "needs_attention" as const,
      updatedAt: now,
      unpublishedAt: now,
      attentionReason: END_LOCAL_PERSISTENCE_REASON,
    };
    let fallbackPersisted = false;
    try {
      await deps.offerings.save(endedNeedsAttention);
      fallbackPersisted = true;
    } catch {
      fallbackPersisted =
        (await deps.offerings.markEndNeedsAttention?.(request.customerId, offering.id, {
          end,
          updatedAt: endedNeedsAttention.updatedAt,
          unpublishedAt: endedNeedsAttention.unpublishedAt!,
          attentionReason: END_LOCAL_PERSISTENCE_REASON,
        })) ?? false;
    }
    await Promise.allSettled([
      deps.diagnostics?.record({
        source: "sales-trial-offerings",
        operation: "sales.trial_offering.end",
        outcome: "failure",
        level: "warn",
        customerId: request.customerId,
        actor: request.actor,
        subject: { type: "sales_trial_offering", id: offering.id },
        message: END_LOCAL_PERSISTENCE_REASON,
        externalIds: {
          offeringId: offering.id,
          itemId: offering.itemId,
          cloudShareSalesExperienceId: offering.cloudShareSalesExperienceId,
        },
        request: updated.request as unknown as Record<string, unknown>,
        response: updated.response as unknown as Record<string, unknown>,
        details: {
          integrationSurface: "cloudshare.v4.sales",
          failureMode: "local_end_persistence",
          previousStatus: offering.status,
          status: fallbackPersisted ? "needs_attention" : offering.status,
          needsAttention: true,
          fallbackPersisted,
        },
      }),
      auditLifecycle(
        deps,
        request,
        offering.id,
        "sales.trial_offering.end",
        "failure",
        {
          itemId: offering.itemId,
          lifecycle: "end",
          previousStatus: offering.status,
          status: fallbackPersisted ? "needs_attention" : offering.status,
          needsAttention: true,
          failureMode: "local_end_persistence",
          integrationSurface: "cloudshare.v4.sales",
          outcome: fallbackPersisted ? "needs_attention" : "persistence_failed",
        },
        END_LOCAL_PERSISTENCE_REASON,
      ),
    ]);
    return response(503, {
      error: fallbackPersisted ? END_LOCAL_PERSISTENCE_REASON : `${END_LOCAL_PERSISTENCE_REASON} Portal state may be stale.`,
      needsAttention: true,
      ...(fallbackPersisted ? { offering: toPortalOffering(endedNeedsAttention) } : {}),
    });
  }
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
    endingCalculatedEnd: offering.endingCalculatedEnd ?? null,
    endingLastReconciledAt: offering.endingLastReconciledAt?.toISOString() ?? null,
  };
}

function toParticipantOffering(offering: SalesTrialOffering): ParticipantSalesTrialOffering {
  return {
    id: offering.id,
    title: offering.title,
    description: offering.description,
    start: offering.start,
    end: offering.end,
    timeZone: offering.timeZone,
  };
}

function isOfferingActive(offering: SalesTrialOffering, now: Date): boolean {
  const start = cloudShareWallClockToInstant(offering.start, offering.timeZone);
  const end =
    offering.end === null
      ? null
      : cloudShareWallClockToInstant(offering.end, offering.timeZone);
  if (!start || (offering.end !== null && !end)) {
    return false;
  }
  return start <= now && (end === null || now < end);
}

function opaqueCloudShareId(value: string): string {
  return value.replaceAll("-", "");
}

function hasProviderCorrelation(offering: SalesTrialOffering): boolean {
  return (
    offering.status !== "published" &&
    (Boolean(offering.cloudShareSalesExperienceId) || Boolean(offering.externalId))
  );
}

function isOutcomeAmbiguousCreateFailure(error: unknown): boolean {
  if (isCloudShareOAuthTokenFailure(error)) {
    return false;
  }
  if (error instanceof CloudShareRequestError ||
    (isCloudShareErrorAcrossBoundaries(error) && error.name === "CloudShareRequestError")) {
    return (error as CloudShareRequestError).status >= 500 && isSalesCreateRequest(error);
  }
  if (error instanceof CloudShareTransportError || error instanceof CloudShareResponseError ||
    (isCloudShareErrorAcrossBoundaries(error) &&
      (error.name === "CloudShareTransportError" || error.name === "CloudShareResponseError"))) {
    const context = cloudShareErrorContext(error);
    return context ? isSalesCreateRequest(error) : true;
  }
  return !(error instanceof CloudShareAuthError) &&
    !(isCloudShareErrorAcrossBoundaries(error) && error.name === "CloudShareAuthError");
}

function cloudShareErrorContext(error: unknown): Record<string, unknown> | undefined {
  return error instanceof Error && "context" in error
    ? (error as { context?: Record<string, unknown> }).context
    : undefined;
}

function isCloudShareOAuthTokenFailure(error: unknown): boolean {
  if (!(error instanceof CloudShareAuthError) &&
    !(error instanceof CloudShareRequestError) &&
    !(error instanceof CloudShareTransportError) &&
    !(error instanceof CloudShareResponseError) &&
    !isCloudShareErrorAcrossBoundaries(error)) {
    return false;
  }
  const context = cloudShareErrorContext(error);
  return context?.path === "/oauth/token" || context?.integrationSurface === "cloudshare.v4.oauth.token";
}

function isSalesCreateRequest(error: unknown): boolean {
  const context = cloudShareErrorContext(error);
  return context?.method === "POST" &&
    (context?.path === "/sales" || context?.path === "/v4/sales");
}

function cloudShareEvidence(error: unknown):
  | {
      readonly request: Record<string, unknown> | null;
      readonly response: Record<string, unknown> | null;
    }
  | undefined {
  return projectCloudShareFailureEvidence(error);
}

const missingClientFactory: Pick<CloudShareClientFactory, "forConnection"> = {
  forConnection() {
    throw new Error("Sales Delivery is not configured.");
  },
};

const AMBIGUOUS_CREATE_REASON =
  "CloudShare POST /sales completed without a response, so the creation outcome is unknown. Do not retry publication; review support diagnostics.";
const LOCAL_CORRELATION_PERSISTENCE_REASON =
  "CloudShare created the shared Sales Trial Experience, but Certalis could not durably save its correlation. Do not retry publication; review support diagnostics.";
const PROVISIONING_RESERVATION_REASON =
  "Sales Trial Offering publication is already in progress or unresolved. Do not retry publication or unpublish; review support diagnostics.";
const END_PROVIDER_FAILURE_REASON =
  "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics.";
const END_LOCAL_PERSISTENCE_REASON =
  "CloudShare ended the Sales Trial Offering, but Certalis could not durably unpublish it locally. Do not retry end-trial; review support diagnostics.";

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
  const oauthTokenFailure = isCloudShareOAuthTokenFailure(error);
  const evidence = cloudShareEvidence(itemReadFailure ? error.cause : error);
  const integrationSurface = oauthTokenFailure
    ? "cloudshare.v4.oauth.token"
    : itemValidationFailure || itemReadFailure
      ? "cloudshare.v3.sales_item_resources"
      : "cloudshare.v4.sales";
  const failureMode = oauthTokenFailure
    ? "cloudshare_oauth_token"
    : itemValidationFailure
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
    message: oauthTokenFailure
      ? "CloudShare OAuth token request failed before Sales Experience creation"
      : itemValidationFailure
        ? "Catalogue Item is stale against CloudShare resources"
        : itemReadFailure
          ? "CloudShare could not fully revalidate this Catalogue Item"
          : "CloudShare could not publish the Sales Trial Offering",
    externalIds: {
      offeringId: offering.id,
      itemId: offering.itemId,
      externalId,
    },
    request: oauthTokenFailure ? null : evidence?.request,
    response: oauthTokenFailure ? null : evidence?.response,
    details: {
      integrationSurface,
      failureMode,
      error: error instanceof Error ? error.message : String(error),
    },
  });
  const errorMessage = oauthTokenFailure
    ? "CloudShare authentication failed before the Sales Trial Offering was created. Review support diagnostics and retry."
    : itemValidationFailure
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
    correlationId,
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

async function releaseReservationToDraft(
  deps: Pick<SalesTrialOfferingsDeps, "offerings">,
  customerId: string,
  id: string,
  updatedAt: Date,
) {
  const released =
    (await deps.offerings.releasePublicationReservation?.(customerId, id, {
      updatedAt,
      attentionReason: null,
    })) ?? false;
  if (!released) {
    const persisted = await deps.offerings.findById(customerId, id);
    if (
      persisted &&
      persisted.status === "provisioning" &&
      !persisted.cloudShareSalesExperienceId
    ) {
      await deps.offerings.save({
        ...persisted,
        externalId: null,
        status: "draft",
        updatedAt,
        attentionReason: null,
      });
    }
  }
}

async function rejectPublishPreflight(
  deps: SalesTrialOfferingsDeps,
  request: SalesTrialOfferingPublishRequest,
  offering: SalesTrialOffering,
  correlationId: string,
  externalId: string,
  status: number,
  error: string,
  failureMode: string,
) {
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
      message: error,
      externalIds: { offeringId: offering.id, itemId: offering.itemId, externalId },
      request: { method: "POST", path: `/api/sales/trial-offerings/${offering.id}/publish` },
      response: { status },
      details: {
        integrationSurface: "portal.sales_trial_offerings",
        failureMode,
        cloudShareAttempted: false,
      },
    }),
    auditLifecycle(
      deps,
      request,
      offering.id,
      "sales.trial_offering.publish",
      "denied",
      {
        itemId: offering.itemId,
        lifecycle: "publish",
        status: offering.status,
        failureMode,
        integrationSurface: "portal.sales_trial_offerings",
        cloudShareAttempted: false,
      },
      error,
      correlationId,
    ),
  ]);
  return response(status, { error, correlationId });
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
