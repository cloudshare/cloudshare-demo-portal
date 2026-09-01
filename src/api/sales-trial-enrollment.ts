import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import { cloudShareWallClockToInstant } from "@/domain/cloudshare-wall-clock";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  hasContinuableSalesTrialEnvironment,
  type SalesTrialEnrollment,
  type SalesTrialEnrollmentRepository,
} from "@/domain/sales-trial-enrollment";
import {
  isProjectableSalesParticipantRosterEnvironment,
  projectSalesParticipantRosterEnvironment,
} from "@/domain/sales-participant-environment";
import type { ItemRepository } from "@/domain/item";
import type {
  SalesTrialOffering,
  SalesTrialOfferingRepository,
} from "@/domain/sales-trial-offering";
import {
  createCloudShareSalesDelivery,
  type SalesDelivery,
  type SalesDeliveryEvidence,
  type SalesParticipantCorrelationPropertyKey,
  type SalesParticipant,
  SALES_TRIAL_PARTICIPANT_CORRELATION_PROPERTY_KEYS,
} from "@/integrations/cloudshare/sales-delivery";
import {
  SalesEnvironmentResolutionError,
  type SalesEnvironmentSource,
} from "@/integrations/cloudshare/sales-environment";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare/errors";

const TRIAL_CORRELATION_KEYS: readonly SalesParticipantCorrelationPropertyKey[] =
  SALES_TRIAL_PARTICIPANT_CORRELATION_PROPERTY_KEYS;

const GENERIC_UNAVAILABLE = "This Sales Trial launch is unavailable.";
const NEEDS_ATTENTION_REASON =
  "Sales Trial enrollment needs support follow-up before CloudShare launch can continue.";
const EXTEND_UNAVAILABLE = "This Sales Trial environment cannot be extended.";
const EXTEND_UNCONFIRMED =
  "Sales Trial environment extension could not be confirmed.";
const EXTEND_MAPPING_REQUIRED =
  "A retained CloudShare environment mapping is required before Certalis can request an extension.";
const EXTEND_ACTIVE_PARTICIPANT_REQUIRED =
  "Only active Sales Trial participants can extend their environment.";
const EXTEND_PENDING_RECONCILIATION =
  "The previous Sales Trial extension outcome is still unconfirmed. Certalis must reconcile the current CloudShare state before another extension can be requested.";
const EXTEND_RESOLUTION_REQUIRED =
  "Certalis could not resolve exactly one retained CloudShare environment for this participant. Support reconciliation is required before another extension can be requested.";

type Actor = {
  readonly type: "sales_trial_participant";
  readonly id: string;
  readonly email: string;
};

type Participant = {
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
};

export interface SalesTrialEnrollmentDeps {
  readonly offerings: Pick<SalesTrialOfferingRepository, "findById">;
  readonly items?: Pick<ItemRepository, "findById">;
  readonly enrollments: SalesTrialEnrollmentRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly salesEnvironmentFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >,
    ): Pick<Required<SalesEnvironmentSource>, "observe" | "observeById" | "extendById">;
  };
  readonly deliveryFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >,
    ): Pick<
      SalesDelivery,
      | "readSession"
      | "ensureParticipantCorrelationProperties"
      | "listParticipants"
      | "registerParticipants"
      | "updateParticipantCorrelation"
      | "createSponsoredLink"
    >;
  };
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly reconcileEnding?: (
    request: SalesTrialOfferingReconciliationRequest,
  ) => Promise<void>;
}

export interface SalesTrialOfferingEnterRequest {
  readonly customerId: string;
  readonly offeringId: string;
  readonly participant: Participant;
  readonly actor: Actor;
}

export interface SalesTrialOfferingEnterResponse {
  readonly status: number;
  readonly redirect?: string;
  readonly body?: {
    readonly error: string;
    readonly correlationId: string;
  };
}

export interface EnterSalesTrialOfferingBlockedPageInput {
  readonly offeringId: string;
  readonly status: number;
  readonly message: string;
}

export interface SalesTrialOfferingReconciliationRequest {
  readonly customerId: string;
  readonly offeringId: string;
  readonly actor:
    | { readonly type: "admin"; readonly id: string; readonly email: string }
    | { readonly type: "sales_trial_participant"; readonly id: string; readonly email: string };
}

export interface SalesTrialMonitoringParticipant {
  readonly id: string;
  readonly subject: {
    readonly type: "sales_trial_enrollment";
    readonly id: string;
  };
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly invitationStatus: "sent" | "notSent";
  readonly participationStatus: "pending" | "inProgress" | "concluded";
  readonly observation: SalesTrialMonitoringObservation;
  readonly firstJoined: string | null;
  readonly envStatus: string | null;
  readonly environment: {
    readonly dimension: "cloudshare_environment";
    readonly value: string | null;
    readonly source:
      | "cloudshare_v4_sales_participant_roster"
      | "certalis_sales_trial_enrollment_reconciliation"
      | "not_observed"
      | "not_assigned";
    readonly observedAt?: string;
  };
  readonly needsAttention?: boolean;
  readonly monitoringMessage?: string;
  readonly extend?: {
    readonly enabled: boolean;
    readonly reason: string | null;
  };
}

export interface SalesTrialMonitoringObservation {
  readonly freshness: "live" | "stale";
  readonly source:
    | "cloudshare_v4_sales_participant_roster"
    | "certalis_sales_trial_enrollment_reconciliation";
  readonly observedAt?: string;
  readonly warning?: string;
}

export interface SalesTrialOfferingMonitoringSummary {
  readonly id: string;
  readonly status: SalesTrialOffering["status"];
}

export interface SalesTrialOfferingMonitoringResponseBody {
  readonly offering: SalesTrialOfferingMonitoringSummary;
  readonly observation: SalesTrialMonitoringObservation;
  readonly participants: readonly SalesTrialMonitoringParticipant[];
  readonly correlationId: string;
}

export interface SalesTrialOfferingMonitoringResponse {
  readonly status: number;
  readonly body:
    | SalesTrialOfferingMonitoringResponseBody
    | { readonly error: string; readonly correlationId?: string };
}

export interface SalesTrialParticipantEnvironmentExtendRequest {
  readonly customerId: string;
  readonly offeringId: string;
  readonly enrollmentId: string;
  readonly actor: { readonly type: "admin"; readonly id: string; readonly email: string };
}

export interface SalesTrialParticipantEnvironmentExtendResponse {
  readonly status: number;
  readonly body:
    | {
        readonly participant: SalesTrialMonitoringParticipant;
        readonly correlationId: string;
      }
    | {
        readonly error: string;
        readonly reason?: string;
        readonly correlationId: string;
      };
}

export async function handleEnterSalesTrialOffering(
  deps: SalesTrialEnrollmentDeps,
  request: SalesTrialOfferingEnterRequest,
): Promise<SalesTrialOfferingEnterResponse> {
  const correlationId = randomUUID();
  const now = (deps.now ?? (() => new Date()))();
  let offering = await deps.offerings.findById(request.customerId, request.offeringId);
  if (offering?.status === "ending" && deps.reconcileEnding) {
    await deps.reconcileEnding({
      customerId: request.customerId,
      offeringId: request.offeringId,
      actor: request.actor,
    });
    offering = await deps.offerings.findById(request.customerId, request.offeringId);
  }
  const existingEnrollment = offering
    ? await deps.enrollments.findByOfferingAndPortalUser(
        request.customerId,
        request.offeringId,
        request.participant.userId,
      )
    : null;
  const isContinuedAccess =
    (offering?.status === "unpublished" || offering?.status === "ending") &&
    hasContinuableSalesTrialEnvironment(existingEnrollment);
  if (
    !offering ||
    !offering.cloudShareSalesExperienceId ||
    !(
      (offering.status === "published" &&
        isOfferingOpen(offering.start, offering.end, offering.timeZone, now)) ||
      isContinuedAccess
    )
  ) {
    return denied(deps, request, correlationId, "launch_unavailable");
  }
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    return denied(deps, request, correlationId, "connection_missing");
  }

  const delivery =
    deps.deliveryFactory?.forConnection(connection) ??
    createCloudShareSalesDelivery(deps.cloudshare!.forConnection(connection));
  try {
    const session = await delivery.readSession(offering.cloudShareSalesExperienceId);
    if (!isLaunchableProviderSession(offering, session, isContinuedAccess)) {
      return denied(
        deps,
        request,
        correlationId,
        "launch_unavailable",
        GENERIC_UNAVAILABLE,
        unavailableOffering(session, offering),
      );
    }
  } catch (error) {
    return denied(
      deps,
      request,
      correlationId,
      "provider_failure",
      GENERIC_UNAVAILABLE,
      error,
    );
  }
  const reservation = isContinuedAccess
    ? { enrollment: existingEnrollment!, created: false, reclaimed: false }
    : (await deps.enrollments.reserveForLaunch?.(
        createEnrollment(request, (deps.newId ?? randomUUID)(), now),
      )) ?? {
      enrollment:
        existingEnrollment ?? createEnrollment(request, (deps.newId ?? randomUUID)(), now),
      created: false,
      reclaimed: false,
    };
  if (!deps.enrollments.reserveForLaunch && reservation.enrollment.createdAt.getTime() === now.getTime()) {
    await deps.enrollments.save(reservation.enrollment);
  }
  if (reservation.enrollment.status === "needs_attention") {
    return denied(
      deps,
      request,
      correlationId,
      "needs_attention",
      reservation.enrollment.attentionReason ?? undefined,
    );
  }
  if (
    !reservation.created &&
    !reservation.reclaimed &&
    reservation.enrollment.status === "provisioning" &&
    !reservation.enrollment.cloudShareParticipantId
  ) {
    return denied(
      deps,
      request,
      correlationId,
      "launch_in_progress",
      "This Sales Trial launch is unavailable.",
      undefined,
      reservation.enrollment.id,
    );
  }
  let enrollment = reservation.enrollment;

  try {
    const correlationEvidence = await delivery.ensureParticipantCorrelationProperties(
      offering.cloudShareSalesExperienceId,
      TRIAL_CORRELATION_KEYS,
    );
    await deps.diagnostics?.record({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.participant_properties.ensured",
      outcome: "success",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_offering", id: request.offeringId },
      correlationId,
      message: "CloudShare Sales Trial participant correlation properties confirmed",
      externalIds: { offeringId: request.offeringId },
      request: correlationEvidence.request as unknown as Record<string, unknown>,
      response: correlationEvidence.response as unknown as Record<string, unknown>,
      details: {
        integrationSurface: "cloudshare.v4.sales.user_properties",
        requiredKeys: [...TRIAL_CORRELATION_KEYS],
      },
    });

    const remoteBefore = await delivery.listParticipants(offering.cloudShareSalesExperienceId);
    const resolved = await resolveEnrollment({
      delivery,
      salesExperienceId: offering.cloudShareSalesExperienceId,
      remoteBefore,
      enrollment,
      now,
    });

    enrollment = {
      ...enrollment,
      cloudShareParticipantId: resolved.remote.id,
      participationStatus: resolved.remote.participationStatus,
      cloudShareRosterEnvironmentReference: resolved.remote.environmentId,
      environmentStatus: resolved.remote.envStatus,
      firstJoined: resolved.remote.firstJoined,
      status: "active",
      attentionReason: null,
      lastLaunchedAt: now,
      lastReconciledAt: now,
      updatedAt: now,
    };
    await deps.enrollments.save(enrollment);

    const sponsored = await delivery.createSponsoredLink(
      offering.cloudShareSalesExperienceId,
      participantIdentity(request.participant),
    );

    await Promise.allSettled([
      deps.diagnostics?.record({
        source: "sales-trial-enrollment",
        operation: "sales_trial.offering.entered",
        outcome: "success",
        customerId: request.customerId,
        actor: request.actor,
        subject: { type: "sales_trial_enrollment", id: enrollment.id },
        correlationId,
        message: "Sales Trial participant launch redirected.",
        externalIds: {
          offeringId: request.offeringId,
          salesTrialEnrollmentId: enrollment.id,
        },
        request: sponsored.request as unknown as Record<string, unknown>,
        response: sponsored.response as unknown as Record<string, unknown>,
        details: {
          integrationSurface: "cloudshare.v4.sales.sponsored_link",
          participationStatus: resolved.remote.participationStatus,
          environmentStatus: resolved.remote.envStatus,
        },
      }),
      deps.audit?.write({
        id: randomUUID(),
        occurredAt: now,
        customerId: request.customerId,
        actorType: request.actor.type,
        actorId: request.actor.id,
        actorEmail: request.actor.email,
        action: "sales_trial.offering.entered",
        subjectType: "sales_trial_enrollment",
        subjectId: enrollment.id,
        outcome: "success",
        correlationId,
        details: { offeringId: request.offeringId },
      }),
    ]);

    return { status: 302, redirect: sponsored.loginUrl };
  } catch (error) {
    const attentionReason = classifyAttentionReason(error);
    if (attentionReason) {
      enrollment = {
        ...enrollment,
        status: "needs_attention",
        attentionReason,
        lastReconciledAt: now,
        updatedAt: now,
      };
      try {
        await deps.enrollments.save(enrollment);
      } catch {
        // Best-effort fail-closed state capture.
      }
    } else if (enrollment.cloudShareParticipantId === null) {
      enrollment = {
        ...enrollment,
        status: "retryable_failure",
        attentionReason: null,
        lastReconciledAt: now,
        updatedAt: now,
      };
      try {
        await deps.enrollments.save(enrollment);
      } catch {
        // Best-effort retryable state capture.
      }
    }
    return denied(
      deps,
      request,
      correlationId,
      attentionReason ? "identity_ambiguous" : "provider_failure",
      attentionReason ?? undefined,
      error,
      enrollment.id,
    );
  }
}

export async function handleListSalesTrialOfferingParticipants(
  deps: SalesTrialEnrollmentDeps,
  request: {
    readonly customerId: string;
    readonly offeringId: string;
    readonly actor: { readonly type: "admin"; readonly id: string; readonly email: string };
  },
): Promise<SalesTrialOfferingMonitoringResponse> {
  const correlationId = randomUUID();
  let offering = await deps.offerings.findById(request.customerId, request.offeringId);
  if (offering?.status === "ending" && deps.reconcileEnding) {
    await deps.reconcileEnding({
      customerId: request.customerId,
      offeringId: request.offeringId,
      actor: request.actor,
    });
    offering = await deps.offerings.findById(request.customerId, request.offeringId);
  }
  if (
    !offering ||
    !offering.cloudShareSalesExperienceId ||
    (offering.status !== "published" &&
      offering.status !== "ending" &&
      offering.status !== "ended" &&
      offering.status !== "unpublished")
  ) {
    return { status: 404, body: { error: "Sales Trial Offering was not found for this Customer." } };
  }
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    const retained = await deps.enrollments.listByOffering(
      request.customerId,
      request.offeringId,
    );
    const fallback = staleMonitoringFallback(offering, retained, correlationId);
    if (fallback) {
      return fallback;
    }
    return { status: 404, body: { error: "Sales Trial Offering is unavailable." } };
  }
  const delivery =
    deps.deliveryFactory?.forConnection(connection) ??
    createCloudShareSalesDelivery(deps.cloudshare!.forConnection(connection));
  let enrollments: Awaited<ReturnType<SalesTrialEnrollmentRepository["listByOffering"]>>;
  let remote: Awaited<ReturnType<SalesDelivery["listParticipants"]>>;
  let rosterObservedAt: Date;
  let reconciledEnrollments: SalesTrialEnrollment[];
  try {
    [enrollments, remote] = await Promise.all([
      deps.enrollments.listByOffering(request.customerId, request.offeringId),
      delivery.listParticipants(offering.cloudShareSalesExperienceId),
    ]);
    rosterObservedAt = new Date();
    reconciledEnrollments = await Promise.all(
      enrollments.map(async (enrollment) => {
        const matches = exactMatches(remote.participants, enrollment);
        if (matches.length > 1) {
          throw ambiguousRoster(remote, enrollment, "duplicate_correlated_participants");
        }
        const matched = matches[0];
        if (!matched) {
          return enrollment;
        }
        const nextEnrollment: SalesTrialEnrollment = {
          ...enrollment,
          cloudShareParticipantId: matched.id,
          invitationStatus: matched.invitationStatus,
          participationStatus: matched.participationStatus,
          cloudShareRosterEnvironmentReference: matched.environmentId,
          environmentStatus: matched.envStatus,
          firstJoined: matched.firstJoined,
          lastReconciledAt: rosterObservedAt,
          updatedAt: rosterObservedAt,
        };
        await deps.enrollments.save(nextEnrollment);
        return nextEnrollment;
      }),
    );
  } catch (error) {
    const failure = await monitoringFailure(
      deps,
      request,
      correlationId,
      "Sales Trial participant monitoring is unavailable.",
      error,
    );
    if (isParticipantRosterAmbiguity(error)) {
      return failure;
    }
    const retained = await deps.enrollments.listByOffering(
      request.customerId,
      request.offeringId,
    );
    const fallback = isUnavailableParticipantRoster(error)
      ? staleMonitoringFallback(offering, retained, correlationId)
      : null;
    return fallback ?? failure;
  }
  const participants = reconciledEnrollments.map((enrollment) =>
    projectTrialMonitoringParticipant(
      enrollment,
      exactMatches(remote.participants, enrollment)[0],
      rosterObservedAt,
    ),
  );
  return {
    status: 200,
    body: {
      offering: {
        id: offering.id,
        status: offering.status,
      },
      observation: liveMonitoringObservation(remote.participants, rosterObservedAt),
      participants,
      correlationId,
    },
  };
}

export async function handleExtendSalesTrialOfferingParticipant(
  deps: SalesTrialEnrollmentDeps,
  request: SalesTrialParticipantEnvironmentExtendRequest,
): Promise<SalesTrialParticipantEnvironmentExtendResponse> {
  const correlationId = randomUUID();
  const now = (deps.now ?? (() => new Date()))();
  let offering = await deps.offerings.findById(request.customerId, request.offeringId);
  if (offering?.status === "ending" && deps.reconcileEnding) {
    await deps.reconcileEnding({
      customerId: request.customerId,
      offeringId: request.offeringId,
      actor: request.actor,
    });
    offering = await deps.offerings.findById(request.customerId, request.offeringId);
  }
  if (
    !offering ||
    !offering.cloudShareSalesExperienceId ||
    !["published", "ending", "ended", "unpublished"].includes(offering.status)
  ) {
    await recordExtensionGuardDenied(deps, request, correlationId, 404, EXTEND_UNAVAILABLE);
    return {
      status: 404,
      body: { error: EXTEND_UNAVAILABLE, correlationId },
    };
  }

  let enrollment =
    (await deps.enrollments.findById?.(request.customerId, request.enrollmentId)) ??
    (await deps.enrollments.listByOffering(request.customerId, request.offeringId)).find(
      (value) => value.id === request.enrollmentId,
    ) ??
    null;
  if (!enrollment || enrollment.salesTrialOfferingId !== request.offeringId) {
    await recordExtensionGuardDenied(deps, request, correlationId, 404, EXTEND_UNAVAILABLE);
    return {
      status: 404,
      body: { error: EXTEND_UNAVAILABLE, correlationId },
    };
  }

  const extendState = buildExtendState(enrollment);
  if (!extendState.enabled && !isPendingExtensionReconciliation(enrollment)) {
    await recordExtensionGuardDenied(
      deps,
      request,
      correlationId,
      409,
      extendState.reason ?? EXTEND_MAPPING_REQUIRED,
    );
    return {
      status: 409,
      body: {
        error: EXTEND_UNAVAILABLE,
        reason: extendState.reason ?? EXTEND_MAPPING_REQUIRED,
        correlationId,
      },
    };
  }

  const connection = await deps.connections.findByCustomerId(request.customerId);
  const item = deps.items ? await deps.items.findById(offering.itemId) : null;
  if (
    !connection ||
    !deps.salesEnvironmentFactory ||
    !item ||
    item.customerId !== request.customerId
  ) {
    await recordExtensionGuardDenied(deps, request, correlationId, 404, EXTEND_UNAVAILABLE);
    return {
      status: 404,
      body: { error: EXTEND_UNAVAILABLE, correlationId },
    };
  }

  let reconcileOnly = isPendingExtensionReconciliation(enrollment);
  let claimedExtensionReservation = false;
  let providerMutationAttempted = false;
  if (!reconcileOnly && deps.enrollments.reserveForExtension) {
    const claimed = await deps.enrollments.reserveForExtension(
      request.customerId,
      enrollment.id,
      {
        updatedAt: now,
        attentionReason: EXTEND_PENDING_RECONCILIATION,
      },
    );
    if (claimed) {
      claimedExtensionReservation = true;
      enrollment = {
        ...enrollment,
        status: "needs_attention",
        attentionReason: EXTEND_PENDING_RECONCILIATION,
        updatedAt: now,
      };
    } else {
      enrollment =
        (await deps.enrollments.findById?.(request.customerId, request.enrollmentId)) ??
        (await deps.enrollments.listByOffering(request.customerId, request.offeringId)).find(
          (value) => value.id === request.enrollmentId,
        ) ??
        null;
      if (!enrollment || enrollment.salesTrialOfferingId !== request.offeringId) {
        await recordExtensionGuardDenied(deps, request, correlationId, 404, EXTEND_UNAVAILABLE);
        return {
          status: 404,
          body: { error: EXTEND_UNAVAILABLE, correlationId },
        };
      }
      if (!isPendingExtensionReconciliation(enrollment)) {
        const reloadedExtendState = buildExtendState(enrollment);
        await recordExtensionGuardDenied(
          deps,
          request,
          correlationId,
          409,
          reloadedExtendState.reason ?? EXTEND_MAPPING_REQUIRED,
        );
        return {
          status: 409,
          body: {
            error: EXTEND_UNAVAILABLE,
            reason: reloadedExtendState.reason ?? EXTEND_MAPPING_REQUIRED,
            correlationId,
          },
        };
      }
      reconcileOnly = true;
    }
  }
  const environments = deps.salesEnvironmentFactory.forConnection(connection);

  try {
    const preflight = await environments.observe({
      ownerEmail: enrollment.email,
      projectId: item.project.id,
    });
    const preflightEnrollment = applyEnvironmentObservation(enrollment, preflight, now);

    if (reconcileOnly) {
      if (!isExtendEligibleEnvironmentStatus(preflight.statusCode)) {
        const ineligible = {
          ...preflightEnrollment,
          status: "active" as const,
          attentionReason: null,
        };
        try {
          await deps.enrollments.save(ineligible);
        } catch (saveError) {
          return extensionFailure(
            deps,
            request,
            correlationId,
            saveError,
            preflight.exchanges,
            ineligible.id,
            preflight.environmentId,
            "persistence_failure",
            "Sales Trial extension state could not be persisted after CloudShare preflight observation.",
          );
        }
        await recordExtensionFailure(
          deps,
          request,
          correlationId,
          EXTEND_UNAVAILABLE,
          ineligibleReasonForStatus(preflight.statusCode),
          preflight.environmentId,
          preflight.exchanges,
          ineligible.id,
        );
        return {
          status: 409,
          body: {
            error: EXTEND_UNAVAILABLE,
            reason: ineligibleReasonForStatus(preflight.statusCode),
            correlationId,
          },
        };
      }

      if (hasEstablishedExtensionOutcome(enrollment, preflightEnrollment)) {
        const reconciled = {
          ...preflightEnrollment,
          status: "active" as const,
          attentionReason: null,
        };
        try {
          await deps.enrollments.save(reconciled);
        } catch (saveError) {
          return extensionFailure(
            deps,
            request,
            correlationId,
            saveError,
            preflight.exchanges,
            reconciled.id,
            preflight.environmentId,
            "persistence_failure",
            "Sales Trial extension state could not be persisted after CloudShare preflight observation.",
          );
        }
        await recordExtensionSuccess(
          deps,
          request,
          correlationId,
          reconciled,
          preflight.expirationTime,
          preflight.environmentId,
          undefined,
          preflight.exchanges,
        );
        return {
          status: 200,
          body: {
            participant: projectTrialMonitoringParticipant(reconciled),
            correlationId,
          },
        };
      }

      const unresolved = {
        ...preflightEnrollment,
        status: "needs_attention" as const,
        attentionReason: EXTEND_PENDING_RECONCILIATION,
      };
      try {
        await deps.enrollments.save(unresolved);
      } catch (saveError) {
        return extensionFailure(
          deps,
          request,
          correlationId,
          saveError,
          preflight.exchanges,
          unresolved.id,
          preflight.environmentId,
          "persistence_failure",
          "Sales Trial extension state could not be persisted after CloudShare preflight observation.",
        );
      }
      return {
        status: 409,
        body: {
          error: EXTEND_UNAVAILABLE,
          reason: EXTEND_PENDING_RECONCILIATION,
          correlationId,
        },
      };
    }

    if (!isExtendEligibleEnvironmentStatus(preflight.statusCode)) {
      const ineligible = {
        ...preflightEnrollment,
        status: "active" as const,
        attentionReason: null,
      };
      try {
        await deps.enrollments.save(ineligible);
      } catch (saveError) {
        return extensionFailure(
          deps,
          request,
          correlationId,
          saveError,
          preflight.exchanges,
          ineligible.id,
          preflight.environmentId,
          "persistence_failure",
          "Sales Trial extension state could not be persisted after CloudShare preflight observation.",
        );
      }
      await recordExtensionFailure(
        deps,
        request,
        correlationId,
        EXTEND_UNAVAILABLE,
        ineligibleReasonForStatus(preflight.statusCode),
        preflight.environmentId,
        preflight.exchanges,
        ineligible.id,
      );
      return {
        status: 409,
        body: {
          error: EXTEND_UNAVAILABLE,
          reason: ineligibleReasonForStatus(preflight.statusCode),
          correlationId,
        },
      };
    }

    const pendingExtension = {
      ...preflightEnrollment,
      status: "needs_attention" as const,
      attentionReason: EXTEND_PENDING_RECONCILIATION,
    };
    try {
      await deps.enrollments.save(pendingExtension);
    } catch (saveError) {
      return extensionFailure(
        deps,
        request,
        correlationId,
        saveError,
        preflight.exchanges,
        pendingExtension.id,
        preflight.environmentId,
        "persistence_failure",
        "Sales Trial extension state could not be persisted after CloudShare preflight observation.",
      );
    }

    let extension;
    try {
      providerMutationAttempted = true;
      extension = await environments.extendById(preflight.environmentId);
    } catch (error) {
      return extensionFailure(
        deps,
        request,
        correlationId,
        error,
        preflight.exchanges,
        pendingExtension.id,
        preflight.environmentId,
      );
    }
    let observed;
    try {
      observed = await environments.observeById(preflight.environmentId);
    } catch (error) {
      return extensionFailure(
        deps,
        request,
        correlationId,
        error,
        [...preflight.exchanges, extension.exchange],
        pendingExtension.id,
        preflight.environmentId,
      );
    }

    const updatedEnrollment = applyEnvironmentObservation(preflightEnrollment, observed, now);
    if (!isExtendEligibleEnvironmentStatus(observed.statusCode)) {
      const ineligible = {
        ...updatedEnrollment,
        status: "active" as const,
        attentionReason: null,
      };
      try {
        await deps.enrollments.save(ineligible);
      } catch (saveError) {
        return extensionFailure(
          deps,
          request,
          correlationId,
          saveError,
          [...preflight.exchanges, extension.exchange, ...observed.exchanges],
          pendingExtension.id,
          preflight.environmentId,
          "persistence_failure",
          "Sales Trial extension state could not be persisted after CloudShare reconcile observation.",
        );
      }
      await recordExtensionFailure(
        deps,
        request,
        correlationId,
        EXTEND_UNAVAILABLE,
        ineligibleReasonForStatus(observed.statusCode),
        preflight.environmentId,
        [...preflight.exchanges, extension.exchange, ...observed.exchanges],
        ineligible.id,
      );
      return {
        status: 409,
        body: {
          error: EXTEND_UNAVAILABLE,
          reason: ineligibleReasonForStatus(observed.statusCode),
          correlationId,
        },
      };
    }
    if (!didExtensionChangeOutcome(preflightEnrollment, updatedEnrollment)) {
      return extensionFailure(
        deps,
        request,
        correlationId,
        undefined,
        [...preflight.exchanges, extension.exchange, ...observed.exchanges],
        pendingExtension.id,
        preflight.environmentId,
      );
    }

    const reconciled = {
      ...updatedEnrollment,
      status: "active" as const,
      attentionReason: null,
    };
    try {
      await deps.enrollments.save(reconciled);
    } catch (saveError) {
      return extensionFailure(
        deps,
        request,
        correlationId,
        saveError,
        [...preflight.exchanges, extension.exchange, ...observed.exchanges],
        pendingExtension.id,
        preflight.environmentId,
        "persistence_failure",
        "Sales Trial extension state could not be persisted after CloudShare reconcile observation.",
      );
    }

    await recordExtensionSuccess(
      deps,
      request,
      correlationId,
      reconciled,
      observed.expirationTime,
      preflight.environmentId,
      extension.exchange,
      [...preflight.exchanges, extension.exchange, ...observed.exchanges],
    );

    return {
      status: 200,
      body: {
        participant: projectTrialMonitoringParticipant(reconciled),
        correlationId,
      },
    };
  } catch (error) {
    if (error instanceof SalesEnvironmentResolutionError) {
      const unresolved = {
        ...enrollment,
        status: "needs_attention" as const,
        attentionReason: EXTEND_RESOLUTION_REQUIRED,
        updatedAt: now,
      };
      try {
        await deps.enrollments.save(unresolved);
      } catch (saveError) {
        return extensionFailure(
          deps,
          request,
          correlationId,
          saveError,
          error.exchanges,
          unresolved.id,
          undefined,
          "persistence_failure",
          "Sales Trial extension state could not be persisted after CloudShare environment resolution.",
        );
      }
      return extensionFailure(
        deps,
        request,
        correlationId,
        error,
        error.exchanges,
        unresolved.id,
        undefined,
        error.reason,
      );
    }
    if (
      claimedExtensionReservation &&
      !providerMutationAttempted &&
      deps.enrollments.releaseExtensionReservation
    ) {
      await Promise.allSettled([
        deps.enrollments.releaseExtensionReservation(request.customerId, enrollment.id, {
          updatedAt: now,
          expectedAttentionReason: EXTEND_PENDING_RECONCILIATION,
        }),
      ]);
    }
    return extensionFailure(
      deps,
      request,
      correlationId,
      error,
      [],
      enrollment.id,
    );
  }
}

function createEnrollment(
  request: SalesTrialOfferingEnterRequest,
  id: string,
  now: Date,
): SalesTrialEnrollment {
  return {
    id,
    customerId: request.customerId,
    salesTrialOfferingId: request.offeringId,
    portalUserId: request.participant.userId,
    email: request.participant.email.toLowerCase(),
    firstName: request.participant.firstName,
    lastName: request.participant.lastName,
    cloudShareParticipantId: null,
    invitationStatus: "notSent",
    participationStatus: "pending",
    cloudShareRosterEnvironmentReference: null,
    environmentStatus: null,
    observedExpirationTime: null,
    firstJoined: null,
    status: "provisioning",
    attentionReason: null,
    lastLaunchedAt: null,
    lastReconciledAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function resolveEnrollment(input: {
  readonly delivery: Pick<
    SalesDelivery,
    "listParticipants" | "registerParticipants" | "updateParticipantCorrelation"
  >;
  readonly salesExperienceId: string;
  readonly remoteBefore: { readonly participants: readonly SalesParticipant[] } & SalesDeliveryEvidence;
  readonly enrollment: SalesTrialEnrollment;
  readonly now: Date;
}) {
  const exactBefore = exactMatches(input.remoteBefore.participants, input.enrollment);
  if (exactBefore.length > 1) {
    throw ambiguousRoster(input.remoteBefore, input.enrollment, "duplicate_correlated_participants");
  }
  const sameEmailConflicts = input.remoteBefore.participants.filter(
    (participant) =>
      participant.email.toLowerCase() === input.enrollment.email.toLowerCase() &&
      participant.id !== input.enrollment.cloudShareParticipantId,
  );
  if (sameEmailConflicts.length > 0) {
    throw sameEmailParticipantConflict(input.remoteBefore, input.enrollment, sameEmailConflicts);
  }
  const stalePersistedMatch = input.enrollment.cloudShareParticipantId
    ? input.remoteBefore.participants.find(
        (participant) => participant.id === input.enrollment.cloudShareParticipantId,
      ) ?? null
    : null;
  if (input.enrollment.cloudShareParticipantId && !stalePersistedMatch) {
    throw missingPersistedParticipant(input.remoteBefore, input.enrollment);
  }
  if (
    stalePersistedMatch &&
    !hasRequiredEnrollmentCorrelation(stalePersistedMatch, input.enrollment)
  ) {
    throw mismatchedPersistedParticipant(
      input.remoteBefore,
      input.enrollment,
      stalePersistedMatch,
    );
  }
  if (input.enrollment.cloudShareParticipantId === null && exactBefore.length === 1) {
    throw unboundCorrelatedParticipant(input.remoteBefore, input.enrollment, exactBefore[0]!);
  }
  const propertylessByEmail = input.remoteBefore.participants.filter(
    (participant) =>
      participant.email.toLowerCase() === input.enrollment.email.toLowerCase() &&
      !participant.customProperties.certalisSalesTrialEnrollmentId &&
      !participant.customProperties.certalisSalesTrialParticipantUserId,
  );
  if (exactBefore.length === 1) {
    return { remote: exactBefore[0]! };
  }
  if (propertylessByEmail.length > 0) {
    throw propertylessSameEmailConflict(input.remoteBefore, input.enrollment, propertylessByEmail);
  }
  await input.delivery.registerParticipants(input.salesExperienceId, [
    {
      ...participantIdentity(input.enrollment),
      customProperties: enrollmentCorrelationProperties(input.enrollment),
    },
  ]);
  const remoteAfter = await input.delivery.listParticipants(input.salesExperienceId);
  const exactAfter = exactMatches(remoteAfter.participants, input.enrollment);
  if (exactAfter.length !== 1) {
    throw ambiguousRoster(remoteAfter, input.enrollment, "participant_reconciliation_failed");
  }
  const sameEmailConflictsAfter = remoteAfter.participants.filter(
    (participant) =>
      participant.email.toLowerCase() === input.enrollment.email.toLowerCase() &&
      participant.id !== exactAfter[0]!.id,
  );
  if (sameEmailConflictsAfter.length > 0) {
    throw sameEmailParticipantConflict(
      remoteAfter,
      input.enrollment,
      sameEmailConflictsAfter,
      exactAfter[0]!.id,
    );
  }
  return { remote: exactAfter[0]! };
}

function exactMatches(
  participants: readonly SalesParticipant[],
  enrollment: SalesTrialEnrollment,
): SalesParticipant[] {
  return participants.filter((participant) => matchesEnrollment(participant, enrollment));
}

function matchesEnrollment(
  participant: SalesParticipant,
  enrollment: Pick<
    SalesTrialEnrollment,
    "id" | "portalUserId"
  >,
): boolean {
  return hasRequiredEnrollmentCorrelation(participant, enrollment);
}

function enrollmentCorrelationProperties(
  enrollment: Pick<SalesTrialEnrollment, "id" | "portalUserId">,
) {
  return [
    { name: "certalisSalesTrialEnrollmentId", value: enrollment.id },
    { name: "certalisSalesTrialParticipantUserId", value: enrollment.portalUserId },
  ];
}

function participantIdentity(
  participant: Pick<Participant, "firstName" | "lastName" | "email">,
) {
  return {
    firstName: participant.firstName,
    lastName: participant.lastName,
    email: participant.email.toLowerCase(),
  };
}

function ambiguousRoster(
  remote: SalesDeliveryEvidence,
  enrollment: SalesTrialEnrollment,
  failureMode: string,
): CloudShareResponseError {
  return new CloudShareResponseError(
    "CloudShare roster reconciliation was not one-to-one for this Sales Trial participant.",
    {
      method: remote.request.method,
      path: remote.request.path,
      requestQuery: remote.request.query,
      requestHeaders: remote.request.headers,
      requestBody: remote.request.body,
      responseStatus: remote.response.status,
      responseHeaders: remote.response.headers,
      responseBody: remote.response.body,
      failureMode,
      salesTrialEnrollmentId: enrollment.id,
    },
  );
}

function isOfferingOpen(
  start: string,
  end: string | null,
  timeZone: string,
  now: Date,
): boolean {
  const startInstant = cloudShareWallClockToInstant(start, timeZone);
  const endInstant = end === null ? null : cloudShareWallClockToInstant(end, timeZone);
  if (!startInstant || (end !== null && !endInstant)) {
    return false;
  }
  return startInstant <= now && (endInstant === null || now < endInstant);
}

function classifyAttentionReason(error: unknown): string | null {
  return isParticipantRosterAmbiguity(error) ? NEEDS_ATTENTION_REASON : null;
}

function isParticipantRosterAmbiguity(error: unknown): boolean {
  if (!(error instanceof Error) || !("context" in error)) {
    return false;
  }
  const failureMode = (error as { context?: { failureMode?: unknown } }).context?.failureMode;
  return typeof failureMode === "string" &&
    (
      failureMode.includes("duplicate") ||
      failureMode.includes("reconciliation") ||
      failureMode.includes("correlation") ||
      failureMode.includes("correlated") ||
      failureMode.includes("propertyless") ||
      failureMode.includes("same_email")
    );
}

function isLaunchableProviderSession(
  offering: Pick<SalesTrialOffering, "end" | "timeZone">,
  session: { readonly status: "notStarted" | "inProgress" | "ended"; readonly end?: string | null },
  continuedAccess = false,
): boolean {
  const sessionEnd = normalizeCloudShareProviderWallClock(session.end ?? null);
  const matchingEnd = offering.end === null
    ? sessionEnd === null
    : cloudShareWallClockToInstant(offering.end, offering.timeZone)?.getTime() ===
      cloudShareWallClockToInstant(sessionEnd ?? "", offering.timeZone)?.getTime();
  return (
    (session.status === "inProgress" || (continuedAccess && session.status === "ended")) &&
    matchingEnd
  );
}

function normalizeCloudShareProviderWallClock(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):00(?:\.0+)?$/.exec(value);
  return match?.[1] ?? value;
}

function unavailableOffering(
  session: { readonly id: string; readonly status: "notStarted" | "inProgress" | "ended"; readonly end?: string | null } & SalesDeliveryEvidence,
  offering: Pick<SalesTrialOffering, "end">,
): CloudShareResponseError {
  return new CloudShareResponseError(
    "CloudShare no longer reports this Sales Trial Offering as open for launch.",
    {
      method: session.request.method,
      path: session.request.path,
      ...(session.request.query ? { requestQuery: session.request.query } : {}),
      ...(session.request.headers ? { requestHeaders: session.request.headers } : {}),
      ...(session.request.body !== undefined ? { requestBody: session.request.body } : {}),
      responseStatus: session.response.status,
      ...(session.response.headers ? { responseHeaders: session.response.headers } : {}),
      responseBody: session.response.body,
      failureMode:
        session.status === "ended"
          ? "offering_ended"
          : session.status === "notStarted"
            ? "offering_not_started"
            : session.end !== offering.end
              ? "offering_window_mismatch"
              : "offering_unavailable",
    },
  );
}

async function denied(
  deps: SalesTrialEnrollmentDeps,
  request: SalesTrialOfferingEnterRequest,
  correlationId: string,
  failureMode: string,
  reason = GENERIC_UNAVAILABLE,
  error?: unknown,
  enrollmentId?: string,
): Promise<SalesTrialOfferingEnterResponse> {
  const context =
    error instanceof Error && "context" in error
      ? (error as { context?: Record<string, unknown> }).context
      : undefined;
  await Promise.allSettled([
    deps.diagnostics?.record({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.entered",
      outcome: "failure",
      level: "warn",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_offering", id: request.offeringId },
      correlationId,
      message: "Sales Trial launch blocked.",
      externalIds: {
        offeringId: request.offeringId,
        ...(enrollmentId ? { salesTrialEnrollmentId: enrollmentId } : {}),
      },
      ...(context
        ? {
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
              transport: context.transport,
              network: context.network,
              tls: context.tls,
            },
          }
        : {}),
      details: {
        integrationSurface: context?.path ? salesTrialIntegrationSurfaceForPath(context.path) : "portal.sales_trial",
        failureMode,
      },
    }),
    deps.audit?.write({
      id: randomUUID(),
      occurredAt: (deps.now ?? (() => new Date()))(),
      customerId: request.customerId,
      actorType: request.actor.type,
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      action: "sales_trial.offering.entered",
      subjectType: "sales_trial_offering",
      subjectId: request.offeringId,
      outcome: "failure",
      correlationId,
      details: { failureMode },
      error: reason,
    }),
  ]);
  return {
    status: 404,
    body: {
      error: GENERIC_UNAVAILABLE,
      correlationId,
    },
  };
}

function projectTrialMonitoringParticipant(
  enrollment: SalesTrialEnrollment,
  participant?: SalesParticipant,
  rosterObservedAt?: Date,
): SalesTrialMonitoringParticipant {
  if (!participant) {
    const environment = projectRetainedEnvironment(enrollment);
    return {
      id: enrollment.id,
      subject: { type: "sales_trial_enrollment", id: enrollment.id },
      firstName: enrollment.firstName,
      lastName: enrollment.lastName,
      email: enrollment.email,
      invitationStatus: enrollment.invitationStatus ?? "notSent",
      participationStatus: enrollment.participationStatus ?? "pending",
      observation: {
        freshness: "stale",
        source: "certalis_sales_trial_enrollment_reconciliation",
        observedAt: enrollment.lastReconciledAt.toISOString(),
      },
      firstJoined: enrollment.firstJoined,
      envStatus: enrollment.environmentStatus,
      environment,
      extend: buildExtendState(enrollment),
      ...(enrollment.status === "needs_attention"
        ? { needsAttention: true, monitoringMessage: enrollment.attentionReason ?? NEEDS_ATTENTION_REASON }
        : {}),
    };
  }
  const environment = projectLiveEnvironment(
    participant.envStatus,
    participant.environmentId,
    rosterObservedAt ?? enrollment.lastReconciledAt,
  );
  return {
    id: enrollment.id,
    subject: { type: "sales_trial_enrollment", id: enrollment.id },
    firstName: enrollment.firstName,
    lastName: enrollment.lastName,
    email: enrollment.email,
    invitationStatus: participant.invitationStatus,
    participationStatus: participant.participationStatus,
    observation: {
      freshness: "live",
      source: "cloudshare_v4_sales_participant_roster",
      observedAt: (rosterObservedAt ?? enrollment.lastReconciledAt).toISOString(),
    },
    firstJoined: participant.firstJoined,
    envStatus: participant.envStatus,
    environment,
    extend: buildExtendState(enrollment, participant.participationStatus),
  };
}

function buildExtendState(
  enrollment: SalesTrialEnrollment,
  participationStatus = enrollment.participationStatus ?? "pending",
): NonNullable<SalesTrialMonitoringParticipant["extend"]> {
  if (isPendingExtensionReconciliation(enrollment)) {
    return {
      enabled: false,
      reason: EXTEND_PENDING_RECONCILIATION,
    };
  }
  if (enrollment.status === "needs_attention") {
    return {
      enabled: false,
      reason: enrollment.attentionReason ?? NEEDS_ATTENTION_REASON,
    };
  }
  if (enrollment.status !== "active") {
    return {
      enabled: false,
      reason: EXTEND_MAPPING_REQUIRED,
    };
  }
  if (
    enrollment.cloudShareParticipantId === null ||
    enrollment.cloudShareRosterEnvironmentReference === null ||
    enrollment.lastLaunchedAt === null
  ) {
    return {
      enabled: false,
      reason: EXTEND_MAPPING_REQUIRED,
    };
  }
  if (participationStatus === "concluded") {
    return {
      enabled: false,
      reason: EXTEND_ACTIVE_PARTICIPANT_REQUIRED,
    };
  }
  if (isPersistedEnvironmentIneligibleForExtend(enrollment.environmentStatus)) {
    return {
      enabled: false,
      reason: "CloudShare does not currently report this retained environment as eligible for extension.",
    };
  }
  return {
    enabled: true,
    reason: null,
  };
}

function projectRetainedEnvironment(
  enrollment: Pick<
    SalesTrialEnrollment,
    "cloudShareRosterEnvironmentReference" | "environmentStatus" | "lastReconciledAt"
  >,
): SalesTrialMonitoringParticipant["environment"] {
  if (
    enrollment.environmentStatus &&
    isProjectableSalesParticipantRosterEnvironment(enrollment.environmentStatus)
  ) {
    const rosterEnvironment = projectSalesParticipantRosterEnvironment(enrollment.environmentStatus, enrollment.lastReconciledAt);
    return {
      dimension: "cloudshare_environment",
      value: rosterEnvironment.value,
      source: "certalis_sales_trial_enrollment_reconciliation",
      observedAt: enrollment.lastReconciledAt.toISOString(),
    };
  }
  return {
    dimension: "cloudshare_environment",
    value: null,
    source: enrollment.cloudShareRosterEnvironmentReference ? "not_observed" : "not_assigned",
  };
}

function projectLiveEnvironment(
  envStatus: SalesParticipant["envStatus"],
  environmentId: SalesParticipant["environmentId"],
  observedAt: Date,
): SalesTrialMonitoringParticipant["environment"] {
  if (environmentId && envStatus && isProjectableSalesParticipantRosterEnvironment(envStatus)) {
    const rosterEnvironment = projectSalesParticipantRosterEnvironment(envStatus, observedAt);
    return {
      dimension: "cloudshare_environment",
      value: rosterEnvironment.value,
      source: "cloudshare_v4_sales_participant_roster",
      observedAt: observedAt.toISOString(),
    };
  }
  return {
    dimension: "cloudshare_environment",
    value: null,
    source: environmentId ? "not_observed" : "not_assigned",
  };
}

function liveMonitoringObservation(
  participants: readonly SalesParticipant[],
  observedAt: Date,
): SalesTrialMonitoringObservation {
  return {
    freshness: "live",
    source: "cloudshare_v4_sales_participant_roster",
    observedAt: observedAt.toISOString(),
  };
}

function staleMonitoringFallback(
  offering: Pick<SalesTrialOffering, "id" | "status">,
  enrollments: readonly SalesTrialEnrollment[],
  correlationId: string,
): SalesTrialOfferingMonitoringResponse | null {
  if (
    (offering.status !== "ended" &&
      offering.status !== "unpublished") ||
    enrollments.length === 0
  ) {
    return null;
  }
  const latest = enrollments.reduce<Date>((current, enrollment) =>
    enrollment.lastReconciledAt > current ? enrollment.lastReconciledAt : current,
  enrollments[0]!.lastReconciledAt);
  return {
    status: 200,
    body: {
      offering: {
        id: offering.id,
        status: offering.status,
      },
      observation: {
        freshness: "stale",
        source: "certalis_sales_trial_enrollment_reconciliation",
        observedAt: latest.toISOString(),
        warning:
          "CloudShare could not refresh the participant roster; showing the last locally reconciled participant state.",
      },
      participants: enrollments.map((enrollment) =>
        projectTrialMonitoringParticipant(enrollment),
      ),
      correlationId,
    },
  };
}

function statusCodeToPersistedEnvironmentStatus(
  statusCode: number,
): string | null {
  if (statusCode === 2) return "Ready";
  if (statusCode === 3) return "Suspended";
  if (statusCode === 4) return "Archived";
  if (statusCode === 5) return "Deleted";
  if (statusCode === 8) return "Preparing";
  if (statusCode === 9) return "CreationFailed";
  return null;
}

function applyEnvironmentObservation(
  enrollment: SalesTrialEnrollment,
  observation: Pick<
    NonNullable<Awaited<ReturnType<NonNullable<SalesEnvironmentSource["observeById"]>>>>,
    "statusCode" | "expirationTime"
  >,
  observedAt: Date,
): SalesTrialEnrollment {
  return {
    ...enrollment,
    environmentStatus:
      statusCodeToPersistedEnvironmentStatus(observation.statusCode) ??
      enrollment.environmentStatus,
    observedExpirationTime: observation.expirationTime,
    lastReconciledAt: observedAt,
    updatedAt: observedAt,
  };
}

function isExtendEligibleEnvironmentStatus(statusCode: number): boolean {
  return statusCode === 2 || statusCode === 3 || statusCode === 4 || statusCode === 8;
}

function isPersistedEnvironmentIneligibleForExtend(status: string | null): boolean {
  const normalizedStatus = status?.trim().toLowerCase() ?? null;
  return normalizedStatus === "deleted" || normalizedStatus === "creation failed" || normalizedStatus === "creationfailed";
}

function ineligibleReasonForStatus(statusCode: number): string {
  if (statusCode === 5 || statusCode === 9) {
    return "CloudShare now reports this retained environment as terminal and not extendable.";
  }
  return "CloudShare does not currently report this retained environment as eligible for extension.";
}

function didExtensionChangeOutcome(
  before: Pick<SalesTrialEnrollment, "observedExpirationTime" | "environmentStatus">,
  after: Pick<SalesTrialEnrollment, "observedExpirationTime" | "environmentStatus">,
): boolean {
  return (
    (before.observedExpirationTime ?? null) !== (after.observedExpirationTime ?? null) ||
    (before.environmentStatus ?? null) !== (after.environmentStatus ?? null)
  );
}

function hasEstablishedExtensionOutcome(
  before: Pick<SalesTrialEnrollment, "status" | "observedExpirationTime" | "environmentStatus">,
  after: Pick<SalesTrialEnrollment, "observedExpirationTime" | "environmentStatus">,
): boolean {
  if (!after.environmentStatus) {
    return false;
  }
  return (
    before.observedExpirationTime !== null &&
    after.observedExpirationTime !== null &&
    before.observedExpirationTime !== after.observedExpirationTime
  );
}

function isRetryBlockedByPendingOutcome(
  enrollment: Pick<SalesTrialEnrollment, "environmentStatus" | "observedExpirationTime">,
): boolean {
  const normalizedStatus = enrollment.environmentStatus?.trim().toLowerCase() ?? null;
  const stillEligible =
    normalizedStatus === "ready" ||
    normalizedStatus === "suspended" ||
    normalizedStatus === "archived" ||
    normalizedStatus === "preparing";
  return Boolean(stillEligible && enrollment.observedExpirationTime);
}

function isPendingExtensionReconciliation(
  enrollment: Pick<SalesTrialEnrollment, "status" | "attentionReason">,
): boolean {
  return (
    enrollment.status === "needs_attention" &&
    enrollment.attentionReason === EXTEND_PENDING_RECONCILIATION
  );
}

function isUnavailableParticipantRoster(error: unknown): boolean {
  return (
    error instanceof CloudShareTransportError ||
    (error instanceof CloudShareRequestError &&
      (error.status === 404 || error.status === 410 || error.status >= 500))
  );
}

function hasRequiredEnrollmentCorrelation(
  participant: SalesParticipant,
  enrollment: Pick<SalesTrialEnrollment, "id" | "portalUserId">,
): boolean {
  return (
    participant.customProperties.certalisSalesTrialEnrollmentId === enrollment.id &&
    participant.customProperties.certalisSalesTrialParticipantUserId === enrollment.portalUserId
  );
}

function mismatchedPersistedParticipant(
  remote: SalesDeliveryEvidence,
  enrollment: Pick<SalesTrialEnrollment, "id" | "portalUserId" | "cloudShareParticipantId">,
  participant: SalesParticipant,
): CloudShareResponseError {
  return new CloudShareResponseError(
    "CloudShare returned the persisted Sales Trial participant without the required Certalis trial correlation values.",
    {
      method: remote.request.method,
      path: remote.request.path,
      ...(remote.request.query ? { requestQuery: remote.request.query } : {}),
      ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}),
      ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}),
      status: remote.response.status,
      responseStatus: remote.response.status,
      ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}),
      responseBody: remote.response.body,
      cloudShareParticipantId: participant.id,
      salesTrialEnrollmentId: enrollment.id,
      failureMode: "participant_correlation_mismatch",
    },
  );
}

function missingPersistedParticipant(
  remote: SalesDeliveryEvidence,
  enrollment: Pick<SalesTrialEnrollment, "id" | "portalUserId" | "cloudShareParticipantId">,
): CloudShareResponseError {
  return new CloudShareResponseError(
    "CloudShare no longer returned the persisted Sales Trial participant for this enrollment.",
    {
      method: remote.request.method,
      path: remote.request.path,
      ...(remote.request.query ? { requestQuery: remote.request.query } : {}),
      ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}),
      ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}),
      status: remote.response.status,
      responseStatus: remote.response.status,
      ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}),
      responseBody: remote.response.body,
      cloudShareParticipantId: enrollment.cloudShareParticipantId ?? undefined,
      salesTrialEnrollmentId: enrollment.id,
      failureMode: "participant_reconciliation_missing_persisted_id",
    },
  );
}

function propertylessSameEmailConflict(
  remote: SalesDeliveryEvidence,
  enrollment: Pick<SalesTrialEnrollment, "id" | "portalUserId" | "email">,
  participants: readonly SalesParticipant[],
): CloudShareResponseError {
  return new CloudShareResponseError(
    "CloudShare returned an unproven same-email Sales Trial participant without the required Certalis correlation values.",
    {
      method: remote.request.method,
      path: remote.request.path,
      ...(remote.request.query ? { requestQuery: remote.request.query } : {}),
      ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}),
      ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}),
      status: remote.response.status,
      responseStatus: remote.response.status,
      ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}),
      responseBody: remote.response.body,
      salesTrialEnrollmentId: enrollment.id,
      portalUserId: enrollment.portalUserId,
      participantCount: participants.length,
      failureMode:
        participants.length > 1
          ? "duplicate_propertyless_same_email"
          : "propertyless_same_email_conflict",
    },
  );
}

function sameEmailParticipantConflict(
  remote: SalesDeliveryEvidence,
  enrollment: Pick<
    SalesTrialEnrollment,
    "id" | "portalUserId" | "email" | "cloudShareParticipantId"
  >,
  participants: readonly SalesParticipant[],
  cloudShareParticipantId = enrollment.cloudShareParticipantId ?? undefined,
): CloudShareResponseError {
  return new CloudShareResponseError(
    "CloudShare returned additional same-email Sales Trial participants, so sponsored-link launch could not be trusted.",
    {
      method: remote.request.method,
      path: remote.request.path,
      ...(remote.request.query ? { requestQuery: remote.request.query } : {}),
      ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}),
      ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}),
      status: remote.response.status,
      responseStatus: remote.response.status,
      ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}),
      responseBody: remote.response.body,
      salesTrialEnrollmentId: enrollment.id,
      portalUserId: enrollment.portalUserId,
      cloudShareParticipantId,
      participantCount: participants.length,
      failureMode: "same_email_participant_conflict",
    },
  );
}

function unboundCorrelatedParticipant(
  remote: SalesDeliveryEvidence,
  enrollment: Pick<SalesTrialEnrollment, "id" | "portalUserId">,
  participant: SalesParticipant,
): CloudShareResponseError {
  return new CloudShareResponseError(
    "CloudShare returned a correlated Sales Trial participant before Certalis had durably bound its provider participant id.",
    {
      method: remote.request.method,
      path: remote.request.path,
      ...(remote.request.query ? { requestQuery: remote.request.query } : {}),
      ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}),
      ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}),
      status: remote.response.status,
      responseStatus: remote.response.status,
      ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}),
      responseBody: remote.response.body,
      salesTrialEnrollmentId: enrollment.id,
      portalUserId: enrollment.portalUserId,
      cloudShareParticipantId: participant.id,
      failureMode: "correlated_participant_without_persisted_id",
    },
  );
}

async function monitoringFailure(
  deps: SalesTrialEnrollmentDeps,
  request: {
    readonly customerId: string;
    readonly offeringId: string;
    readonly actor: { readonly type: "admin"; readonly id: string; readonly email: string };
  },
  correlationId: string,
  message: string,
  error: unknown,
): Promise<{
  readonly status: number;
  readonly body: { readonly error: string; readonly correlationId: string };
}> {
  const context =
    error instanceof Error && "context" in error
      ? (error as { context?: Record<string, unknown> }).context
      : undefined;
  const integrationSurface = salesTrialIntegrationSurfaceForPath(context?.path);
  const attemptedOperation = salesTrialAttemptedOperationForPath(context?.path);

  await Promise.allSettled([
    deps.diagnostics?.record({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.monitoring.read_participants",
      outcome: "failure",
      level: "warn",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_offering", id: request.offeringId },
      correlationId,
      message,
      externalIds: { offeringId: request.offeringId },
      ...(context
        ? {
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
              transport: context.transport,
              network: context.network,
              tls: context.tls,
            },
          }
        : {}),
      details: {
        integrationSurface,
        attemptedOperation,
        failureMode:
          context?.failureMode ??
          ((context?.responseStatus ?? context?.status) ? "http_failure" : "transport_failure"),
      },
    }),
    deps.audit?.write({
      id: randomUUID(),
      occurredAt: (deps.now ?? (() => new Date()))(),
      customerId: request.customerId,
      actorType: request.actor.type,
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      action: "sales_trial.offering.monitoring.read_participants",
      subjectType: "sales_trial_offering",
      subjectId: request.offeringId,
      outcome: "failure",
      correlationId,
      details: {
        offeringId: request.offeringId,
        integrationSurface,
        attemptedOperation,
        failureMode:
          context?.failureMode ??
          ((context?.responseStatus ?? context?.status) ? "http_failure" : "transport_failure"),
      },
      error: message,
    }),
  ]);

  return {
    status: 502,
    body: {
      error: message,
      correlationId,
    },
  };
}

async function recordExtensionGuardDenied(
  deps: SalesTrialEnrollmentDeps,
  request: SalesTrialParticipantEnvironmentExtendRequest,
  correlationId: string,
  status: number,
  reason: string,
): Promise<void> {
  await Promise.allSettled([
    deps.diagnostics?.record({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
      level: "warn",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_enrollment", id: request.enrollmentId },
      correlationId,
      message: EXTEND_UNAVAILABLE,
      externalIds: {
        offeringId: request.offeringId,
        salesTrialEnrollmentId: request.enrollmentId,
      },
      details: {
        integrationSurface: "portal.sales_trial",
        attemptedOperation: "portal_guard",
        failureMode: reason,
        httpExchanges: [],
      },
      response: { status },
    }),
    deps.audit?.write({
      id: randomUUID(),
      occurredAt: (deps.now ?? (() => new Date()))(),
      customerId: request.customerId,
      actorType: request.actor.type,
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      action: "sales_trial.offering.environment.extend",
      subjectType: "sales_trial_enrollment",
      subjectId: request.enrollmentId,
      outcome: "failure",
      correlationId,
      details: {
        offeringId: request.offeringId,
        integrationSurface: "portal.sales_trial",
        attemptedOperation: "portal_guard",
        failureMode: reason,
      },
      error: EXTEND_UNAVAILABLE,
    }),
  ]);
}

async function recordExtensionSuccess(
  deps: SalesTrialEnrollmentDeps,
  request: SalesTrialParticipantEnvironmentExtendRequest,
  correlationId: string,
  enrollment: SalesTrialEnrollment,
  expirationTime: string,
  canonicalEnvironmentId: string | undefined,
  primaryExchange:
    | {
        readonly request: unknown;
        readonly response: unknown;
      }
    | undefined,
  httpExchanges: readonly {
    readonly request: unknown;
    readonly response: unknown;
  }[],
): Promise<void> {
  await Promise.allSettled([
    deps.diagnostics?.record({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "success",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_enrollment", id: enrollment.id },
      correlationId,
      message: "Sales Trial environment extension confirmed from CloudShare.",
      externalIds: {
        offeringId: request.offeringId,
        salesTrialEnrollmentId: enrollment.id,
        ...(canonicalEnvironmentId
          ? { environmentId: canonicalEnvironmentId }
          : {}),
      },
      request: primaryExchange?.request as Record<string, unknown> | undefined,
      response: primaryExchange?.response as Record<string, unknown> | undefined,
      details: {
        integrationSurface: "cloudshare.v3.environments",
        attemptedOperation: primaryExchange ? "extend_environment" : "observe_extended_environment",
        expirationTime,
        httpExchanges,
      },
    }),
    deps.audit?.write({
      id: randomUUID(),
      occurredAt: (deps.now ?? (() => new Date()))(),
      customerId: request.customerId,
      actorType: request.actor.type,
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      action: "sales_trial.offering.environment.extend",
      subjectType: "sales_trial_enrollment",
      subjectId: enrollment.id,
      outcome: "success",
      correlationId,
      details: {
        offeringId: request.offeringId,
        expirationTime,
        attemptedOperation: primaryExchange ? "extend_environment" : "observe_extended_environment",
        integrationSurface: "cloudshare.v3.environments",
      },
    }),
  ]);
}

async function recordExtensionFailure(
  deps: SalesTrialEnrollmentDeps,
  request: SalesTrialParticipantEnvironmentExtendRequest,
  correlationId: string,
  error: string,
  reason: string,
  canonicalEnvironmentId: string | undefined,
  httpExchanges: readonly {
    readonly request: unknown;
    readonly response: unknown;
  }[],
  subjectId: string,
): Promise<void> {
  const lastRequest = httpExchanges[httpExchanges.length - 1]?.request as
    | Record<string, unknown>
    | undefined;
  await Promise.allSettled([
    deps.diagnostics?.record({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
      level: "warn",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_enrollment", id: subjectId },
      correlationId,
      message: error,
      externalIds: {
        offeringId: request.offeringId,
        salesTrialEnrollmentId: subjectId,
        ...(canonicalEnvironmentId ? { environmentId: canonicalEnvironmentId } : {}),
      },
      request: httpExchanges[httpExchanges.length - 1]?.request as Record<string, unknown> | undefined,
      response: httpExchanges[httpExchanges.length - 1]?.response as Record<string, unknown> | undefined,
      details: {
        integrationSurface: "cloudshare.v3.environments",
        attemptedOperation: salesTrialAttemptedOperationForPath(lastRequest?.path),
        failureMode: reason,
        httpExchanges,
      },
    }),
    deps.audit?.write({
      id: randomUUID(),
      occurredAt: (deps.now ?? (() => new Date()))(),
      customerId: request.customerId,
      actorType: request.actor.type,
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      action: "sales_trial.offering.environment.extend",
      subjectType: "sales_trial_enrollment",
      subjectId,
      outcome: "failure",
      correlationId,
      details: {
        offeringId: request.offeringId,
        integrationSurface: "cloudshare.v3.environments",
        attemptedOperation: salesTrialAttemptedOperationForPath(lastRequest?.path),
        failureMode: reason,
      },
      error,
    }),
  ]);
}

async function extensionFailure(
  deps: SalesTrialEnrollmentDeps,
  request: SalesTrialParticipantEnvironmentExtendRequest,
  correlationId: string,
  error: unknown,
  completedExchanges: readonly {
    readonly request: unknown;
    readonly response: unknown;
  }[] = [],
  subjectId = request.enrollmentId,
  canonicalEnvironmentId?: string,
  failureModeOverride?: string,
  loggedErrorOverride?: string,
): Promise<SalesTrialParticipantEnvironmentExtendResponse> {
  const context =
    error instanceof Error && "context" in error
      ? (error as { context?: Record<string, unknown> }).context
      : undefined;
  const fallbackExchange =
    (completedExchanges[completedExchanges.length - 1] as
      | {
          readonly request: Record<string, unknown>;
          readonly response: Record<string, unknown>;
        }
      | undefined) ?? null;
  const requestExchange = context
    ? {
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
          transport: context.transport,
          network: context.network,
          tls: context.tls,
        },
      }
    : fallbackExchange;
  const attemptedOperation = salesTrialAttemptedOperationForPath(
    requestExchange?.request?.path,
  );
  const httpExchanges = requestExchange
    ? context
      ? [...completedExchanges, requestExchange]
      : completedExchanges
    : completedExchanges;
  const failureMode =
    failureModeOverride ??
    context?.failureMode ??
    ((context?.responseStatus ?? context?.status) ? "http_failure" : "transport_failure");
  const loggedError = loggedErrorOverride ?? EXTEND_UNCONFIRMED;

  await Promise.allSettled([
    deps.diagnostics?.record({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.environment.extend",
      outcome: "failure",
      level: "warn",
      customerId: request.customerId,
      actor: request.actor,
      subject: { type: "sales_trial_enrollment", id: subjectId },
      correlationId,
      message: loggedError,
      externalIds: {
        offeringId: request.offeringId,
        salesTrialEnrollmentId: subjectId,
        ...(canonicalEnvironmentId ? { environmentId: canonicalEnvironmentId } : {}),
      },
      ...(requestExchange
        ? {
            request: requestExchange.request,
            response: requestExchange.response,
          }
        : {}),
      details: {
        integrationSurface: "cloudshare.v3.environments",
        attemptedOperation,
        failureMode,
        httpExchanges,
      },
    }),
    deps.audit?.write({
      id: randomUUID(),
      occurredAt: (deps.now ?? (() => new Date()))(),
      customerId: request.customerId,
      actorType: request.actor.type,
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      action: "sales_trial.offering.environment.extend",
      subjectType: "sales_trial_enrollment",
      subjectId,
      outcome: "failure",
      correlationId,
      details: {
        offeringId: request.offeringId,
        integrationSurface: "cloudshare.v3.environments",
        attemptedOperation,
        failureMode,
      },
      error: loggedError,
    }),
  ]);
  return {
    status: 502,
    body: {
      error: EXTEND_UNCONFIRMED,
      correlationId,
    },
  };
}

function salesTrialIntegrationSurfaceForPath(path: unknown): string {
  if (typeof path !== "string") {
    return "portal.sales_trial";
  }
  if (path.includes("/envs")) {
    return "cloudshare.v3.environments";
  }
  if (/^\/sales\/[^/]+$/.test(path)) {
    return "cloudshare.v4.sales";
  }
  if (path.includes("/sponsored-link")) {
    return "cloudshare.v4.sales.sponsored_link";
  }
  if (path.includes("/users/properties")) {
    return "cloudshare.v4.sales.user_properties";
  }
  if (path.includes("/participants")) {
    return "cloudshare.v4.sales.participants";
  }
  return "portal.sales_trial";
}

function salesTrialAttemptedOperationForPath(path: unknown): string {
  if (typeof path !== "string") {
    return "portal_guard";
  }
  if (path === "/api/v3/envs" || path === "/envs") {
    return "resolve_environment_for_project";
  }
  if (path.includes("/envs/actions/extend")) {
    return "extend_environment";
  }
  if (path.includes("/envs/actions/getextended")) {
    return "observe_extended_environment";
  }
  if (/^\/sales\/[^/]+$/.test(path)) {
    return "read_offering";
  }
  if (path.includes("/sponsored-link")) {
    return "create_sponsored_link";
  }
  if (path.includes("/users/properties")) {
    return "ensure_participant_correlation_properties";
  }
  if (path.includes("/participants")) {
    return "list_participants";
  }
  return "portal_guard";
}

export function buildEnterSalesTrialOfferingBlockedPage(
  input: EnterSalesTrialOfferingBlockedPageInput,
): string {
  const payload = safeJson({
    type: "certalis:sales-trial-entry-blocked",
    offeringId: input.offeringId,
    status: input.status,
    message: input.message,
  });
  const message = escapeHtml(input.message);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sales Trial entry unavailable</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Arial, sans-serif;
        background: #f7f9fc;
        color: #14213d;
      }
      main {
        width: min(520px, calc(100vw - 32px));
        border: 1px solid #f5c2c7;
        border-radius: 8px;
        background: #fff5f5;
        padding: 24px;
        box-shadow: 0 18px 45px rgba(20, 33, 61, 0.12);
      }
      p.label {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        color: #b42318;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 0;
        line-height: 1.5;
        color: #334e68;
      }
      a {
        display: inline-block;
        margin-top: 18px;
        color: #0b5d3b;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="label">Sales Trial entry unavailable</p>
      <h1>Return to your Sales Trial home</h1>
      <p>${message}</p>
      <a href="/sales-trial">Back to Sales Trial home</a>
    </main>
    <script>
      (function () {
        var payload = ${payload};
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
          window.setTimeout(function () { window.close(); }, 150);
        }
      }());
    </script>
  </body>
</html>`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
