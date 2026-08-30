import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { cloudShareWallClockToInstant } from "@/domain/cloudshare-wall-clock";
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
  deps: Pick<SalesTrialOfferingsDeps, "offerings" | "now">,
  request: SalesTrialOfferingReadRequest,
) {
  const offerings = await deps.offerings.listPublishedByCustomerId(request.customerId);
  const now = (deps.now ?? (() => new Date()))();
  return response(200, {
    offerings: offerings
      .filter((offering) => isOfferingActive(offering, now))
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
  const endInstant = cloudShareWallClockToInstant(offering.end, offering.timeZone);
  if (!startInstant || !endInstant) {
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
  if (endInstant <= startInstant) {
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
  const end = cloudShareWallClockToInstant(offering.end, offering.timeZone);
  if (!start || !end) {
    return false;
  }
  return start <= now && now < end;
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
const LOCAL_CORRELATION_PERSISTENCE_REASON =
  "CloudShare created the shared Sales Trial Experience, but Certalis could not durably save its correlation. Do not retry publication; review support diagnostics.";
const PROVISIONING_RESERVATION_REASON =
  "Sales Trial Offering publication is already in progress or unresolved. Do not retry publication or unpublish; review support diagnostics.";

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
