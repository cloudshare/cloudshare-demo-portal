import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import { cloudShareWallClockToInstant } from "@/domain/cloudshare-wall-clock";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesTrialEnrollment, SalesTrialEnrollmentRepository } from "@/domain/sales-trial-enrollment";
import type { SalesTrialOfferingRepository } from "@/domain/sales-trial-offering";
import {
  createCloudShareSalesDelivery,
  type SalesDelivery,
  type SalesDeliveryEvidence,
  type SalesParticipant,
} from "@/integrations/cloudshare/sales-delivery";
import { CloudShareResponseError } from "@/integrations/cloudshare/errors";

const TRIAL_CORRELATION_KEYS = [
  "certalisSalesTrialEnrollmentId",
  "certalisSalesTrialParticipantUserId",
] as const;

const GENERIC_UNAVAILABLE = "This Sales Trial launch is unavailable.";
const NEEDS_ATTENTION_REASON =
  "Sales Trial enrollment needs support follow-up before CloudShare launch can continue.";

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
  readonly enrollments: SalesTrialEnrollmentRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly deliveryFactory?: {
    forConnection(
      connection: NonNullable<
        Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>
      >,
    ): Pick<
      SalesDelivery,
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

type TrialMonitoringParticipant = {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly participationStatus: "pending" | "inProgress" | "concluded";
  readonly firstJoined: string | null;
  readonly envStatus: string | null;
  readonly environment: {
    readonly dimension: "cloudshare_environment";
    readonly value: string | null;
    readonly source: "cloudshare_v4_sales_participant_roster" | "not_assigned";
  };
  readonly needsAttention?: boolean;
  readonly monitoringMessage?: string;
};

export async function handleEnterSalesTrialOffering(
  deps: SalesTrialEnrollmentDeps,
  request: SalesTrialOfferingEnterRequest,
): Promise<SalesTrialOfferingEnterResponse> {
  const correlationId = randomUUID();
  const now = (deps.now ?? (() => new Date()))();
  const offering = await deps.offerings.findById(request.customerId, request.offeringId);
  if (
    !offering ||
    offering.status !== "published" ||
    !offering.cloudShareSalesExperienceId ||
    !isOfferingOpen(offering.start, offering.end, offering.timeZone, now)
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

  const current = await deps.enrollments.findByOfferingAndPortalUser(
    request.customerId,
    request.offeringId,
    request.participant.userId,
  );
  if (current?.status === "needs_attention") {
    return denied(
      deps,
      request,
      correlationId,
      "needs_attention",
      current.attentionReason ?? undefined,
    );
  }

  const enrollmentId = current?.id ?? (deps.newId ?? randomUUID)();
  let enrollment = current ?? createEnrollment(request, enrollmentId, now);

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
): Promise<{
  readonly status: number;
  readonly body: Record<string, unknown>;
}> {
  const offering = await deps.offerings.findById(request.customerId, request.offeringId);
  if (!offering || !offering.cloudShareSalesExperienceId || offering.status !== "published") {
    return { status: 404, body: { error: "Sales Trial Offering was not found for this Customer." } };
  }
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    return { status: 404, body: { error: "Sales Trial Offering is unavailable." } };
  }
  const delivery =
    deps.deliveryFactory?.forConnection(connection) ??
    createCloudShareSalesDelivery(deps.cloudshare!.forConnection(connection));
  const [enrollments, remote] = await Promise.all([
    deps.enrollments.listByOffering(request.customerId, request.offeringId),
    delivery.listParticipants(offering.cloudShareSalesExperienceId),
  ]);
  const participants = enrollments.map((enrollment) =>
    projectTrialMonitoringParticipant(
      enrollment,
      remote.participants.find((participant) => matchesEnrollment(participant, enrollment)),
    ),
  );
  return {
    status: 200,
    body: {
      participants,
      correlationId: randomUUID(),
    },
  };
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
    cloudShareRosterEnvironmentReference: null,
    environmentStatus: null,
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
  const propertylessByEmail = input.remoteBefore.participants.filter(
    (participant) =>
      participant.email.toLowerCase() === input.enrollment.email.toLowerCase() &&
      !participant.customProperties.certalisSalesTrialEnrollmentId &&
      !participant.customProperties.certalisSalesTrialParticipantUserId,
  );
  if (exactBefore.length === 1) {
    return { remote: exactBefore[0]! };
  }
  if (propertylessByEmail.length > 1) {
    throw ambiguousRoster(input.remoteBefore, input.enrollment, "duplicate_propertyless_email");
  }
  if (propertylessByEmail.length === 1) {
    const adopted = propertylessByEmail[0]!;
    await input.delivery.updateParticipantCorrelation(
      input.salesExperienceId,
      adopted.id,
      {
        firstName: input.enrollment.firstName,
        lastName: input.enrollment.lastName,
        customProperties: enrollmentCorrelationProperties(input.enrollment),
      },
    );
  } else {
    await input.delivery.registerParticipants(input.salesExperienceId, [
      {
        ...participantIdentity(input.enrollment),
        customProperties: enrollmentCorrelationProperties(input.enrollment),
      },
    ]);
  }
  const remoteAfter = await input.delivery.listParticipants(input.salesExperienceId);
  const exactAfter = exactMatches(remoteAfter.participants, input.enrollment);
  if (exactAfter.length !== 1) {
    throw ambiguousRoster(remoteAfter, input.enrollment, "participant_reconciliation_failed");
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
    "id" | "portalUserId" | "cloudShareParticipantId"
  >,
): boolean {
  if (
    enrollment.cloudShareParticipantId &&
    participant.id === enrollment.cloudShareParticipantId &&
    participant.customProperties.certalisSalesTrialEnrollmentId === enrollment.id &&
    participant.customProperties.certalisSalesTrialParticipantUserId === enrollment.portalUserId
  ) {
    return true;
  }
  return (
    participant.customProperties.certalisSalesTrialEnrollmentId === enrollment.id &&
    participant.customProperties.certalisSalesTrialParticipantUserId === enrollment.portalUserId
  );
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

function isOfferingOpen(start: string, end: string, timeZone: string, now: Date): boolean {
  const startInstant = cloudShareWallClockToInstant(start, timeZone);
  const endInstant = cloudShareWallClockToInstant(end, timeZone);
  if (!startInstant || !endInstant) {
    return false;
  }
  return startInstant <= now && now < endInstant;
}

function classifyAttentionReason(error: unknown): string | null {
  if (!(error instanceof Error) || !("context" in error)) {
    return null;
  }
  const failureMode = (error as { context?: { failureMode?: unknown } }).context?.failureMode;
  return typeof failureMode === "string" &&
    (failureMode.includes("duplicate") || failureMode.includes("reconciliation"))
    ? NEEDS_ATTENTION_REASON
    : null;
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
            },
          }
        : {}),
      details: {
        integrationSurface: context?.path ? "cloudshare.v4.sales.participants" : "portal.sales_trial",
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
): TrialMonitoringParticipant {
  if (!participant) {
    return {
      id: enrollment.id,
      firstName: enrollment.firstName,
      lastName: enrollment.lastName,
      email: enrollment.email,
      participationStatus: "pending",
      firstJoined: enrollment.firstJoined,
      envStatus: enrollment.environmentStatus,
      environment: { dimension: "cloudshare_environment", value: null, source: "not_assigned" },
      ...(enrollment.status === "needs_attention"
        ? { needsAttention: true, monitoringMessage: enrollment.attentionReason ?? NEEDS_ATTENTION_REASON }
        : {}),
    };
  }
  return {
    id: enrollment.id,
    firstName: enrollment.firstName,
    lastName: enrollment.lastName,
    email: enrollment.email,
    participationStatus: participant.participationStatus,
    firstJoined: participant.firstJoined,
    envStatus: participant.envStatus,
    environment: {
      dimension: "cloudshare_environment",
      value: participant.envStatus,
      source: participant.environmentId ? "cloudshare_v4_sales_participant_roster" : "not_assigned",
    },
  };
}
