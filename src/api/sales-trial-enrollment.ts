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
  type SalesParticipantCorrelationPropertyKey,
  type SalesParticipant,
  SALES_TRIAL_PARTICIPANT_CORRELATION_PROPERTY_KEYS,
} from "@/integrations/cloudshare/sales-delivery";
import { CloudShareResponseError } from "@/integrations/cloudshare/errors";

const TRIAL_CORRELATION_KEYS: readonly SalesParticipantCorrelationPropertyKey[] =
  SALES_TRIAL_PARTICIPANT_CORRELATION_PROPERTY_KEYS;

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

export interface EnterSalesTrialOfferingBlockedPageInput {
  readonly offeringId: string;
  readonly status: number;
  readonly message: string;
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
  const correlationId = randomUUID();
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
  let enrollments: Awaited<ReturnType<SalesTrialEnrollmentRepository["listByOffering"]>>;
  let remote: Awaited<ReturnType<SalesDelivery["listParticipants"]>>;
  try {
    [enrollments, remote] = await Promise.all([
      deps.enrollments.listByOffering(request.customerId, request.offeringId),
      delivery.listParticipants(offering.cloudShareSalesExperienceId),
    ]);
  } catch (error) {
    return monitoringFailure(
      deps,
      request,
      correlationId,
      "Sales Trial participant monitoring is unavailable.",
      error,
    );
  }
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
      correlationId,
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
  const stalePersistedMatch = input.enrollment.cloudShareParticipantId
    ? input.remoteBefore.participants.find(
        (participant) => participant.id === input.enrollment.cloudShareParticipantId,
      ) ?? null
    : null;
  if (input.enrollment.cloudShareParticipantId && !stalePersistedMatch && exactBefore.length === 0) {
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
    (
      failureMode.includes("duplicate") ||
      failureMode.includes("reconciliation") ||
      failureMode.includes("correlation")
    )
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
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
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

function salesTrialIntegrationSurfaceForPath(path: unknown): string {
  if (typeof path !== "string") {
    return "portal.sales_trial";
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
