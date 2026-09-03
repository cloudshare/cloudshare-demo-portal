import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import {
  attachCohortExamSessionInheritedContext,
  CohortExamSessionValidationError,
  createDraftCohortExamSession,
  markCohortExamSessionPublishReconciliationRequired,
  markCohortExamSessionPublished,
  recordCohortExamSessionPublishFailure,
  type CohortExamSession,
  type CohortExamSessionRepository,
} from "@/domain/cohort-exam-session";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import { CLOUDSHARE_429_ADMIN_SUPPORT_GUIDANCE } from "@/domain/cloudshare-rate-limit-message";
import {
  ExamNotFoundError,
  isCohortExamSessionDeliveryAvailable,
  publishExam,
  type ExamRepository,
} from "@/domain/exam-catalog";
import { TrainingDeliveryOperationError } from "@/domain/lab-launch";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "@/integrations/cloudshare";
import { createCloudShareTrainingDelivery } from "@/integrations/cloudshare/training-delivery";
import type { Logger } from "@/observability/logger";
import { projectCloudShareFailureContext } from "@/integrations/cloudshare/diagnostic-failure-projection";
import { guardRuntimeBlueprintSnapshot } from "./runtime-blueprint-snapshot-guard";
import { certificationCloudShareWorkflow } from "./certification-cloudshare-observer";

export interface AdminCohortExamSessionDeps {
  readonly exams: ExamRepository;
  readonly sessions: CohortExamSessionRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newAuditId?: () => string;
  readonly newCorrelationId?: () => string;
}

export interface AdminCohortExamSessionServices {
  readonly exams: ExamRepository;
  readonly cohortExamSessions: CohortExamSessionRepository;
  readonly diagnosticRecorder?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly cloudshareConnections?: CloudShareConnectionRepository;
  readonly cloudshareClientFactory?: CloudShareClientFactory;
  readonly logger: Logger;
}

export interface AdminCohortExamSessionRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly examId: string;
  readonly body?: unknown;
}

export interface AdminCohortExamSessionDetailRequest {
  readonly customerId: string;
  readonly examId: string;
  readonly sessionId: string;
  readonly actor?: DiagnosticActor | null;
}

export function buildAdminCohortExamSessionDeps(
  services: AdminCohortExamSessionServices,
): AdminCohortExamSessionDeps {
  return {
    exams: services.exams,
    sessions: services.cohortExamSessions,
    diagnostics: services.diagnosticRecorder,
    ...(services.audit ? { audit: services.audit } : {}),
    ...(services.cloudshareConnections ? { connections: services.cloudshareConnections } : {}),
    ...(services.cloudshareClientFactory ? { cloudshare: services.cloudshareClientFactory } : {}),
    logger: services.logger,
  };
}

export async function handleListCohortExamSessions(
  deps: AdminCohortExamSessionDeps,
  request: Omit<AdminCohortExamSessionRequest, "body" | "actor">,
) {
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    const sessions = await deps.sessions.listByExamId(exam.id);
    return {
      status: 200,
      body: {
        exam,
        sessions: sessions.map((session) => attachCohortExamSessionInheritedContext(exam, session)),
      },
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

export async function handleGetCohortExamSession(
  deps: AdminCohortExamSessionDeps,
  request: AdminCohortExamSessionDetailRequest,
) {
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    const session = await deps.sessions.findById(request.sessionId);
    if (!session || session.customerId !== request.customerId || session.examId !== exam.id) {
      return { status: 404, body: { error: `Cohort Exam Session ${request.sessionId} was not found.` } };
    }
    return {
      status: 200,
      body: attachCohortExamSessionInheritedContext(exam, session),
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

export async function handleCreateDraftCohortExamSession(
  deps: AdminCohortExamSessionDeps,
  request: AdminCohortExamSessionRequest,
) {
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    if (!isCohortExamSessionDeliveryAvailable(exam)) {
      return {
        status: 409,
        body: { error: "Cohort Exam Sessions are not available for individual-only Exams." },
      };
    }
    const input = parseCreateDraftCohortExamSessionInput(request.body);
    if (!input) {
      return {
        status: 400,
        body: { error: "Draft Cohort Exam Sessions require a name and admission window." },
      };
    }
    const session = await createDraftCohortExamSession(
      {
        repository: deps.sessions,
        now: deps.now,
        newId: deps.newId,
      },
      {
        customerId: request.customerId,
        examId: exam.id,
        ...input,
      },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "cohort_exam_session", id: session.id },
      examId: exam.id,
      level: "info",
      operation: "cohort_exam_session.create",
      outcome: "success",
      message: "Draft Cohort Exam Session created",
      details: {
        status: session.status,
        changedFields: ["name", "admissionStartsAt", "admissionEndsAt", "capacity", "status"],
      },
    });
    await safeRecordAudit(deps, {
      request,
      action: "cohort_exam_session.created",
      subjectId: session.id,
      examId: exam.id,
      details: {
        status: session.status,
        changedFields: ["name", "admissionStartsAt", "admissionEndsAt", "capacity", "status"],
      },
    });
    return {
      status: 201,
      body: attachCohortExamSessionInheritedContext(exam, session),
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    if (error instanceof CohortExamSessionValidationError) {
      return { status: 400, body: { error: error.message } };
    }
    throw error;
  }
}

export async function handlePublishCohortExamSession(
  deps: AdminCohortExamSessionDeps,
  request: AdminCohortExamSessionDetailRequest,
) {
  if (!deps.connections || !deps.cloudshare) {
    throw new Error("Cohort Exam Session publishing requires CloudShare dependencies.");
  }
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    if (!isCohortExamSessionDeliveryAvailable(exam)) {
      return {
        status: 409,
        body: { error: "Cohort Exam Sessions are not available for individual-only Exams." },
      };
    }
    const session = await findOwnedSession(deps, request.customerId, exam.id, request.sessionId);
    if (session.status === "publish_reconciliation_required") {
      return {
        status: 409,
        body: {
          error:
            "The previous CloudShare publish attempt has an unknown outcome. Reconcile it before retrying this Cohort Exam Session.",
          correlationId: session.lastPublishCorrelationId ?? undefined,
        },
      };
    }
    if (session.status !== "draft") {
      return {
        status: 409,
        body: { error: "Only draft Cohort Exam Sessions can be published." },
      };
    }
    const connection = await deps.connections.findByCustomerId(request.customerId);
    if (!connection) {
      return {
        status: 409,
        body: { error: "CloudShare is not connected for this customer." },
      };
    }
    const snapshotGuardFailure = await guardRuntimeBlueprintSnapshot(deps, {
      source: "admin-exams",
      operation: "cohort_exam_session.publish",
      correlationId,
      customerId: request.customerId,
      examId: exam.id,
      cohortSessionId: session.id,
      actor: request.actor ?? null,
      subject: { type: "cohort_exam_session", id: session.id },
      projectId: exam.projectId,
      blueprintId: exam.blueprintId,
      savedSnapshotId: exam.snapshotId,
    });
    if (snapshotGuardFailure) {
      return {
        status: snapshotGuardFailure.status,
        body: {
          error:
            snapshotGuardFailure.status === 429
              ? CLOUDSHARE_429_ADMIN_SUPPORT_GUIDANCE
              : "Cohort Exam Session publish is temporarily unavailable because the lab configuration changed. Refresh CloudShare resources and check the Exam Blueprint/default Snapshot.",
          correlationId,
        },
      };
    }

    const claimedSession = await deps.sessions.claimDraftForPublishing({
      id: session.id,
      customerId: request.customerId,
      examId: exam.id,
      claimedAt: (deps.now ?? (() => new Date()))(),
    });
    if (!claimedSession) {
      return {
        status: 409,
        body: { error: "Cohort Exam Session publish is already in progress or has already completed." },
      };
    }

    const cloudshareClient = deps.cloudshare.forConnection(connection, certificationCloudShareWorkflow({
      actor: request.actor,
      customerId: request.customerId,
      subject: { type: "cohort_exam_session", id: claimedSession.id },
      correlationId,
      source: "admin-exams",
      examId: exam.id,
      externalIds: { cohortExamSessionId: claimedSession.id },
    }));
    const trainingDelivery = createCloudShareTrainingDelivery(cloudshareClient);
    let created;
    try {
      created = await trainingDelivery.publishCohortTraining({
        name: buildCohortExperienceName(exam.title, claimedSession.name),
        startsAt: claimedSession.admissionStartsAt,
        endsAt: claimedSession.admissionEndsAt,
        externalId: claimedSession.id,
        projectId: exam.projectId,
        blueprintId: exam.blueprintId,
        policyId: exam.policyId,
        regionIds: exam.allowedRegions.map((region) => region.id),
        instructorId: exam.instructorId,
        timeZoneId: "UTC",
        passphrase: `certalis-${claimedSession.id}`,
      });
    } catch (error) {
      const publication =
        error instanceof TrainingDeliveryOperationError ? error.context.publication : undefined;
      if (
        error instanceof TrainingDeliveryOperationError &&
        error.operation === "ensure_user_properties" &&
        publication?.trainingId &&
        publication.experienceId
      ) {
      await markCohortExamSessionPublishReconciliationRequired(
        { repository: deps.sessions, now: deps.now },
        {
          session: claimedSession,
          correlationId,
          error:
            "CloudShare Experience was created, but required training user-property keys could not be added. Reconcile this Cohort Exam Session before retrying.",
          trainingId: publication.trainingId,
          experienceId: publication.experienceId,
          ...(publication.teamId ? { teamId: publication.teamId } : {}),
        },
      );
      await safeRecordDiagnostic(deps, {
        source: "admin-exams",
        customerId: request.customerId,
        actor: request.actor ?? null,
        subject: { type: "cohort_exam_session", id: claimedSession.id },
        examId: exam.id,
        level: "warn",
        operation: "cohort_exam_session.publish",
        outcome: "failure",
        correlationId,
        message: "Cohort Exam Session publish failed after CloudShare Experience creation while adding training user-property keys",
        externalIds: {
          trainingId: publication.trainingId,
          experienceId: publication.experienceId,
          ...(publication.teamId ? { teamId: publication.teamId } : {}),
        },
        ...toPublishFailureDiagnostic(error.context.cause, "ensure_user_properties"),
      });
      deps.logger.warn("cohort session publish training user-property validation failed", {
        correlationId,
        customerId: request.customerId,
        examId: exam.id,
        sessionId: claimedSession.id,
        trainingId: publication.trainingId,
        experienceId: publication.experienceId,
        ...(publication.teamId ? { teamId: publication.teamId } : {}),
        ...toPublishFailureLogFields(error.context.cause),
      });
      return {
          status: isCloudShareRateLimitError(error.context.cause) ? 429 : 502,
        body: {
          error:
            isCloudShareRateLimitError(error.context.cause)
              ? CLOUDSHARE_429_ADMIN_SUPPORT_GUIDANCE
              : "CloudShare created the Cohort Exam Session, but the required training user-property keys could not be added. Reconcile it before retrying and check the diagnostic log for the correlation ID.",
          correlationId,
        },
      };
      }
      throw error;
    }
    if (created.userProperties) {
      await safeRecordDiagnostic(deps, {
        source: "admin-exams",
        customerId: request.customerId,
        actor: request.actor ?? null,
        subject: { type: "cohort_exam_session", id: claimedSession.id },
        examId: exam.id,
        level: "info",
        operation: "cloudshare.ensure_user_properties",
        outcome: "success",
        correlationId,
        message: "CloudShare training user-property keys ensured for Cohort Exam Session",
        externalIds: {
          trainingId: created.trainingId,
          experienceId: created.experienceId,
          teamId: created.teamId,
        },
        ...(toCloudShareRequestDiagnostic(created.userProperties.request)
          ? { request: toCloudShareRequestDiagnostic(created.userProperties.request) }
          : {}),
        ...(toCloudShareResponseDiagnostic(created.userProperties.response)
          ? { response: toCloudShareResponseDiagnostic(created.userProperties.response) }
          : {}),
        details: {
          integrationSurface:
            created.userProperties.integrationSurface ?? "cloudshare.v4.training.user_properties",
          requiredKeys: created.userProperties.requiredKeys,
          availableKeys: created.userProperties.availableKeys,
          ...(toCloudShareHttpExchanges(
            created.userProperties.requests,
            created.userProperties.responses,
          )
            ? {
                httpExchanges: toCloudShareHttpExchanges(
              created.userProperties.requests,
              created.userProperties.responses,
                ),
              }
            : {}),
        },
      });
    }
    let parentExam = exam;
    let parentExamStatusChanged = false;
    let localPersistenceStage: "parent_exam_publish" | "cohort_session_publish" =
      exam.status === "published" ? "cohort_session_publish" : "parent_exam_publish";
    let published: CohortExamSession;
    try {
      if (exam.status !== "published") {
        parentExam = await publishExam(
          { repository: deps.exams, now: deps.now },
          { customerId: request.customerId, examId: exam.id },
        );
        parentExamStatusChanged = exam.status !== parentExam.status;
      }
      localPersistenceStage = "cohort_session_publish";
      published = await markCohortExamSessionPublished(
        { repository: deps.sessions, now: deps.now },
        {
          session: claimedSession,
          trainingId: created.trainingId,
          experienceId: created.experienceId,
          teamId: created.teamId,
        },
      );
    } catch (error) {
      try {
        await markCohortExamSessionPublishReconciliationRequired(
          { repository: deps.sessions, now: deps.now },
          {
            session: claimedSession,
            correlationId,
            error:
              "CloudShare Experience was created, but portal local publish state could not be fully persisted. Reconcile this Cohort Exam Session before retrying.",
            trainingId: created.trainingId,
            experienceId: created.experienceId,
            teamId: created.teamId,
          },
        );
      } catch (reconciliationError) {
        deps.logger.error("cohort session publish reconciliation marker failed", {
          customerId: request.customerId,
          examId: exam.id,
          sessionId: claimedSession.id,
          correlationId,
          error: reconciliationError instanceof Error ? reconciliationError.message : String(reconciliationError),
        });
      }
      await safeRecordDiagnostic(deps, {
        source: "admin-exams",
        customerId: request.customerId,
        actor: request.actor ?? null,
        subject: { type: "cohort_exam_session", id: claimedSession.id },
        examId: exam.id,
        level: "error",
        operation: "cohort_exam_session.publish",
        outcome: "failure",
        correlationId,
        message: "Cohort Exam Session publish local state update failed after CloudShare Experience creation",
        externalIds: {
          trainingId: created.trainingId,
          experienceId: created.experienceId,
          teamId: created.teamId,
        },
        request: created.request as unknown as Record<string, unknown>,
        response: created.response as unknown as Record<string, unknown>,
        details: {
          integrationSurface: created.integrationSurface,
          failureMode: "local_persistence",
          failedStage: localPersistenceStage,
          parentExamStatusChanged,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      deps.logger.error("cohort session publish local persistence failed after CloudShare create", {
        customerId: request.customerId,
        examId: exam.id,
        sessionId: claimedSession.id,
        correlationId,
        localPersistenceStage,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 500,
        body: {
          error:
            "Cohort Exam Session was created in CloudShare, but the portal could not persist the published state. Check the diagnostic log for the correlation ID.",
          correlationId,
        },
      };
    }
    if (parentExamStatusChanged) {
      await safeRecordAudit(deps, {
        request,
        action: "exam.published",
        subjectType: "exam",
        subjectId: parentExam.id,
        examId: parentExam.id,
        details: {
          changedFields: ["status", "publishedAt"],
          reason: "cohort_exam_session.publish",
          cohortExamSessionId: published.id,
        },
      });
    }
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "cohort_exam_session", id: claimedSession.id },
      examId: exam.id,
      level: "info",
      operation: "cohort_exam_session.publish",
      outcome: "success",
      correlationId,
      message: "Cohort Exam Session published to CloudShare",
      externalIds: {
        trainingId: created.trainingId,
        experienceId: created.experienceId,
        teamId: created.teamId,
      },
      request: created.request as unknown as Record<string, unknown>,
      response: created.response as unknown as Record<string, unknown>,
      details: {
        integrationSurface: created.integrationSurface,
        changedFields: [
          "status",
          "cloudShareTrainingId",
          "cloudShareExperienceId",
          "cloudShareTeamId",
          "publishedAt",
          ...(parentExamStatusChanged ? ["parentExam.status", "parentExam.publishedAt"] : []),
        ],
        parentExamStatusChanged,
        scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
      },
    });
    return {
      status: 200,
      body: attachCohortExamSessionInheritedContext(parentExam, published),
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    if (error instanceof CohortExamSessionValidationError) {
      return { status: 400, body: { error: error.message } };
    }
    if (isCloudSharePublishError(error)) {
      const exam = await deps.exams.findById(request.examId);
      const session = await deps.sessions.findById(request.sessionId);
      if (exam && session && exam.customerId === request.customerId && session.customerId === request.customerId) {
        const disposition = classifyCloudSharePublishFailure(error);
        const publishError =
          disposition === "reconciliation_required"
            ? "CloudShare publish outcome is unknown. Reconcile this Cohort Exam Session before retrying."
            : "CloudShare could not publish this Cohort Exam Session.";
        if (disposition === "reconciliation_required") {
          await markCohortExamSessionPublishReconciliationRequired(
            { repository: deps.sessions, now: deps.now },
            {
              session,
              correlationId,
              error: publishError,
            },
          );
        } else {
          await recordCohortExamSessionPublishFailure(
            { repository: deps.sessions, now: deps.now },
            {
              session,
              correlationId,
              error: publishError,
            },
          );
        }
        await safeRecordDiagnostic(deps, {
          source: "admin-exams",
          customerId: request.customerId,
          actor: request.actor ?? null,
          subject: { type: "cohort_exam_session", id: session.id },
          examId: exam.id,
          level: "warn",
          operation: "cohort_exam_session.publish",
          outcome: "failure",
          correlationId,
          message: "Cohort Exam Session publish failed",
          externalIds: buildPublishFailureExternalIds(exam),
          ...toPublishFailureDiagnostic(error),
        });
      }
      deps.logger.warn("cohort session publish failed", {
        correlationId,
        customerId: request.customerId,
        examId: request.examId,
        sessionId: request.sessionId,
        ...toPublishFailureLogFields(error),
      });
      const failureCause = unwrapTrainingDeliveryError(error);
      return {
        status: isCloudShareRateLimitError(failureCause) ? 429 : 502,
        body: {
          error:
            isCloudShareRateLimitError(failureCause)
              ? CLOUDSHARE_429_ADMIN_SUPPORT_GUIDANCE
              : classifyCloudSharePublishFailure(error) === "reconciliation_required"
              ? "CloudShare publish outcome is unknown. Reconcile it before retrying this Cohort Exam Session. Check the diagnostic log for the correlation ID."
              : "CloudShare could not publish this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
          correlationId,
        },
      };
    }
    throw error;
  }
}

async function findOwnedExam(
  deps: Pick<AdminCohortExamSessionDeps, "exams">,
  customerId: string,
  examId: string,
) {
  const exam = await deps.exams.findById(examId);
  if (!exam || exam.customerId !== customerId) {
    throw new ExamNotFoundError(customerId, examId);
  }
  return exam;
}

async function findOwnedSession(
  deps: Pick<AdminCohortExamSessionDeps, "sessions">,
  customerId: string,
  examId: string,
  sessionId: string,
) {
  const session = await deps.sessions.findById(sessionId);
  if (!session || session.customerId !== customerId || session.examId !== examId) {
    throw new CohortExamSessionValidationError(`Cohort Exam Session ${sessionId} was not found.`);
  }
  return session;
}

function buildCohortExperienceName(examTitle: string, sessionName: string): string {
  const name = `${examTitle.trim()} - ${sessionName.trim()}`.trim();
  return name.length <= 100 ? name : name.slice(0, 100);
}

function isCloudSharePublishError(error: unknown): boolean {
  error = unwrapTrainingDeliveryError(error);
  return (
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError ||
    (error instanceof Error && error.name.startsWith("CloudShare"))
  );
}

function buildPublishFailureExternalIds(exam: { projectId: string; blueprintId: string; policyId: string }) {
  return {
    projectId: exam.projectId,
    blueprintId: exam.blueprintId,
    policyId: exam.policyId,
  };
}

function toCloudShareRequestDiagnostic(
  request:
    | {
        readonly method: string;
        readonly path: string;
        readonly query?: Record<string, string>;
        readonly headers?: Record<string, string>;
        readonly body?: unknown;
      }
    | undefined,
): Record<string, unknown> | undefined {
  if (!request) {
    return undefined;
  }
  return {
    method: request.method,
    path: request.path,
    ...(request.query ? { query: request.query } : {}),
    ...(request.headers ? { headers: request.headers } : {}),
    ...(request.body !== undefined ? { body: request.body } : {}),
  };
}

function toCloudShareResponseDiagnostic(
  response:
    | {
        readonly status: number;
        readonly headers?: Record<string, string | string[]>;
        readonly body: unknown;
      }
    | undefined,
): Record<string, unknown> | undefined {
  if (!response) {
    return undefined;
  }
  return {
    status: response.status,
    ...(response.headers ? { headers: response.headers } : {}),
    body: response.body,
  };
}

function toCloudShareHttpExchanges(
  requests:
    | readonly {
        readonly method: string;
        readonly path: string;
        readonly query?: Record<string, string>;
        readonly headers?: Record<string, string>;
        readonly body?: unknown;
      }[]
    | undefined,
  responses:
    | readonly {
        readonly status: number;
        readonly headers?: Record<string, string | string[]>;
        readonly body: unknown;
      }[]
    | undefined,
): readonly Record<string, unknown>[] | undefined {
  if (!requests?.length) {
    return undefined;
  }
  return requests.map((request, index) => ({
    request: toCloudShareRequestDiagnostic(request),
    ...(responses?.[index] ? { response: toCloudShareResponseDiagnostic(responses[index]) } : {}),
  }));
}

function toPublishFailureDiagnostic(error: unknown, attemptedOperation?: string): {
  readonly request?: Record<string, unknown> | null;
  readonly response?: Record<string, unknown> | null;
  readonly details: Record<string, unknown>;
} {
  error = unwrapTrainingDeliveryError(error);
  const context = (error as { context?: Record<string, unknown> }).context ?? {};
  const status =
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : typeof context.status === "number"
        ? context.status
        : undefined;
  const baseDetails = {
    integrationSurface: context.integrationSurface ?? "cloudshare.v4.training",
    failureMode: inferPublishFailureMode(error),
  };
  const projected = projectCloudShareFailureContext(context);
  const oauthFailure = projected?.request === null && projected.response === null;
  return {
    request: oauthFailure ? null : {
      method: context.method ?? "POST",
      path: context.path ?? "/v4/trainings",
      ...(context.requestQuery ? { query: context.requestQuery } : {}),
      ...(context.requestHeaders ? { headers: context.requestHeaders } : {}),
      ...(context.requestBody ? { body: context.requestBody } : {}),
    },
    response: oauthFailure ? null :
      context.responseHeaders || context.responseBody !== undefined || status !== undefined
        ? {
            ...(status !== undefined ? { status } : {}),
            ...(context.responseHeaders ? { headers: context.responseHeaders } : {}),
            ...(context.responseBody !== undefined ? { body: context.responseBody } : {}),
          }
        : undefined,
    details: {
      ...baseDetails,
      ...(attemptedOperation ? { attemptedOperation } : {}),
      ...(status !== undefined ? { responseStatus: status } : {}),
      ...(!oauthFailure && context.cause ? { cause: context.cause } : {}),
      ...(!oauthFailure && context.issues ? { issues: context.issues } : {}),
    },
  };
}

function toPublishFailureLogFields(error: unknown): Record<string, unknown> {
  error = unwrapTrainingDeliveryError(error);
  const context = (error as { context?: Record<string, unknown> }).context ?? {};
  return {
    integrationSurface: context.integrationSurface,
    failureMode: inferPublishFailureMode(error),
    responseStatus:
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : context.status,
  };
}

function inferPublishFailureMode(error: unknown): string {
  error = unwrapTrainingDeliveryError(error);
  if (isCloudShareRateLimitError(error)) {
    return "rate_limit";
  }
  if (error instanceof CloudShareRequestError || (error as { name?: unknown }).name === "CloudShareRequestError") {
    return "http_status";
  }
  if (error instanceof CloudShareTransportError || (error as { name?: unknown }).name === "CloudShareTransportError") {
    return "transport";
  }
  if (error instanceof CloudShareResponseError || (error as { name?: unknown }).name === "CloudShareResponseError") {
    return "unexpected_response";
  }
  return "cloudshare_error";
}

function classifyCloudSharePublishFailure(error: unknown): "recoverable" | "reconciliation_required" {
  error = unwrapTrainingDeliveryError(error);
  if (isAmbiguousCloudShareTrainingCreateFailure(error)) {
    return "reconciliation_required";
  }
  if (error instanceof CloudShareRequestError || (error as { name?: unknown }).name === "CloudShareRequestError") {
    return "recoverable";
  }
  return "recoverable";
}

function isAmbiguousCloudShareTrainingCreateFailure(error: unknown): boolean {
  error = unwrapTrainingDeliveryError(error);
  const name = (error as { name?: unknown }).name;
  if (error instanceof CloudShareRequestError || name === "CloudShareRequestError") {
    const context = (error as { context?: Record<string, unknown>; status?: unknown }).context ?? {};
    const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
    return status !== null && status >= 500 && isCloudShareTrainingCreateRequestContext(context);
  }
  if (
    !(
      error instanceof CloudShareTransportError ||
      error instanceof CloudShareResponseError ||
      name === "CloudShareTransportError" ||
      name === "CloudShareResponseError"
    )
  ) {
    return false;
  }
  const context = (error as { context?: Record<string, unknown> }).context ?? {};
  return isCloudShareTrainingCreateRequestContext(context);
}

function unwrapTrainingDeliveryError(error: unknown): unknown {
  return error instanceof TrainingDeliveryOperationError ? error.context.cause : error;
}

function isCloudShareTrainingCreateRequestContext(context: Record<string, unknown>): boolean {
  return context.method === "POST" && (context.path === "/trainings" || context.path === "/v4/trainings");
}

function parseCreateDraftCohortExamSessionInput(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.name !== "string" || typeof candidate.admissionStartsAt !== "string") {
    return null;
  }
  const admissionStartsAt = new Date(candidate.admissionStartsAt);
  const admissionEndsAt =
    typeof candidate.admissionEndsAt === "string" && candidate.admissionEndsAt.trim()
      ? new Date(candidate.admissionEndsAt)
      : null;
  const capacity =
    typeof candidate.capacity === "number" && Number.isFinite(candidate.capacity)
      ? candidate.capacity
      : null;
  return {
    name: candidate.name,
    admissionStartsAt,
    admissionEndsAt,
    capacity,
  };
}

async function safeRecordDiagnostic(
  deps: { readonly diagnostics?: DiagnosticRecorder; readonly logger: Logger },
  entry: DiagnosticLogEntryInput,
): Promise<void> {
  if (!deps.diagnostics) return;
  try {
    await deps.diagnostics.record(entry);
  } catch (error) {
    deps.logger.warn("cohort session diagnostic recording failed", {
      operation: entry.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeRecordAudit(
  deps: Pick<AdminCohortExamSessionDeps, "audit" | "logger" | "now" | "newAuditId">,
  input: {
    readonly request: AdminCohortExamSessionRequest;
    readonly action: string;
    readonly subjectType?: string;
    readonly subjectId: string;
    readonly examId: string;
    readonly details?: Record<string, unknown>;
  },
): Promise<void> {
  if (!deps.audit) return;
  try {
    await deps.audit.write({
      id: (deps.newAuditId ?? randomUUID)(),
      customerId: input.request.customerId,
      actorType: input.request.actor?.type ?? null,
      actorId: input.request.actor?.id ?? null,
      actorEmail: input.request.actor?.email ?? null,
      action: input.action,
      subjectType: input.subjectType ?? "cohort_exam_session",
      subjectId: input.subjectId,
      outcome: "success",
      examId: input.examId,
      details: input.details ?? null,
      occurredAt: (deps.now ?? (() => new Date()))(),
    });
  } catch (error) {
    deps.logger.warn("cohort session audit recording failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
