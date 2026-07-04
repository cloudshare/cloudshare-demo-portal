import { randomUUID } from "node:crypto";
import type { PortalSession } from "@/auth/portal-stores";
import type { AuditRecord } from "@/domain/audit-trail";
import { authorizeCandidateExamAttemptAccess } from "./candidate-exam-attempt-access";
import {
  handleResumeExam,
  handleSuspendExam,
  type ResumeHandlerDeps,
  type SuspendHandlerDeps,
  type SuspendResumeResponse,
} from "./suspend-resume";

export interface CandidateSuspendResumeServices {
  readonly environmentSource: SuspendHandlerDeps["source"];
  readonly environmentController: SuspendHandlerDeps["controller"];
  readonly examAttempts: SuspendHandlerDeps["attempts"];
  readonly labLaunches: SuspendHandlerDeps["launches"];
  readonly labProvisioner: ResumeHandlerDeps["labs"];
  readonly examClock: SuspendHandlerDeps["timer"] & SuspendHandlerDeps["clocks"];
  readonly exams: NonNullable<SuspendHandlerDeps["exams"]>;
  readonly logger: SuspendHandlerDeps["logger"];
  readonly heartbeatAutoSuspend: {
    readonly removeHeartbeat: (examAttemptId: string) => void;
  };
  readonly audit: {
    readonly write: (record: AuditRecord) => Promise<void>;
  };
  readonly eventLog: SuspendHandlerDeps["eventLog"];
  readonly cloudshareConnections: SuspendHandlerDeps["connections"];
  readonly cloudshareClientFactory: SuspendHandlerDeps["cloudshare"];
  readonly diagnosticRecorder: SuspendHandlerDeps["diagnostics"];
}

export interface CandidateSuspendResumeRouteRequest {
  readonly sessionId: string | undefined;
  readonly body: unknown;
  readonly getPortalSession: (sessionId: string | undefined) => Promise<PortalSession | null>;
}

interface CandidateSuspendResumeDepsOptions {
  readonly candidateEmail?: string;
}

export function buildCandidateSuspendWorkflowDeps(
  services: CandidateSuspendResumeServices,
  options: CandidateSuspendResumeDepsOptions = {},
): SuspendHandlerDeps {
  return {
    controller: services.environmentController,
    source: services.environmentSource,
    timer: services.examClock,
    exams: services.exams,
    clocks: services.examClock,
    attempts: services.examAttempts,
    launches: services.labLaunches,
    sleep,
    logger: services.logger,
    eventLog: services.eventLog,
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
    diagnostics: services.diagnosticRecorder,
    candidateEmail: options.candidateEmail,
  };
}

export function buildCandidateResumeWorkflowDeps(
  services: CandidateSuspendResumeServices,
  options: CandidateSuspendResumeDepsOptions = {},
): ResumeHandlerDeps {
  return {
    ...buildCandidateSuspendWorkflowDeps(services, options),
    labs: services.labProvisioner,
  };
}

export async function handleCandidateSuspendExamRoute(
  services: CandidateSuspendResumeServices,
  request: CandidateSuspendResumeRouteRequest,
): Promise<SuspendResumeResponse> {
  const examAttemptId = extractRouteExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  const session = await request.getPortalSession(request.sessionId);
  const access = await authorizeCandidateExamAttemptAccess(
    {
      getPortalSession: request.getPortalSession,
      examAttempts: services.examAttempts,
      labLaunches: services.labLaunches,
    },
    {
      sessionId: request.sessionId,
      examAttemptId,
      requireLaunch: true,
    },
  );
  if (!access.ok) {
    return access.response;
  }

  const response = await handleSuspendExam(
    buildCandidateSuspendWorkflowDeps(services, {
      candidateEmail: session?.email ?? undefined,
    }),
    { body: request.body },
  );

  await recordSuspendSideEffects(services, access, response, session?.email ?? null);
  return response;
}

export async function handleCandidateResumeExamRoute(
  services: CandidateSuspendResumeServices,
  request: CandidateSuspendResumeRouteRequest,
): Promise<SuspendResumeResponse> {
  const examAttemptId = extractRouteExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  const session = await request.getPortalSession(request.sessionId);
  const access = await authorizeCandidateExamAttemptAccess(
    {
      getPortalSession: request.getPortalSession,
      examAttempts: services.examAttempts,
      labLaunches: services.labLaunches,
    },
    {
      sessionId: request.sessionId,
      examAttemptId,
      requireLaunch: true,
    },
  );
  if (!access.ok) {
    return access.response;
  }

  const response = await handleResumeExam(
    buildCandidateResumeWorkflowDeps(services, {
      candidateEmail: session?.email ?? undefined,
    }),
    { body: request.body },
  );

  await recordResumeSideEffects(services, access, response, session?.email ?? null);
  return response;
}

function extractRouteExamAttemptId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { examAttemptId } = body as { examAttemptId?: unknown };
  return typeof examAttemptId === "string" && examAttemptId.length > 0 ? examAttemptId : null;
}

async function recordSuspendSideEffects(
  services: CandidateSuspendResumeServices,
  access: Extract<Awaited<ReturnType<typeof authorizeCandidateExamAttemptAccess>>, { ok: true }>,
  response: SuspendResumeResponse,
  candidateEmail: string | null,
): Promise<void> {
  const examAttemptId = access.attempt.id;
  if (response.status === 200) {
    services.heartbeatAutoSuspend.removeHeartbeat(examAttemptId);
    await services.audit.write({
      id: randomUUID(),
      customerId: access.session.customerId,
      actorType: "candidate",
      actorId: access.session.userId,
      actorEmail: candidateEmail,
      subjectType: "exam_attempt",
      subjectId: examAttemptId,
      examAttemptId,
      candidateId: access.session.userId,
      candidateEmail,
      examId: access.attempt.examId,
      action: "lab_suspended",
      outcome: "success",
      occurredAt: new Date(),
    } satisfies AuditRecord);
    return;
  }

  if (response.status >= 500) {
    await services.audit.write({
      id: randomUUID(),
      customerId: access.session.customerId,
      actorType: "candidate",
      actorId: access.session.userId,
      actorEmail: candidateEmail,
      subjectType: "exam_attempt",
      subjectId: examAttemptId,
      examAttemptId,
      candidateId: access.session.userId,
      candidateEmail,
      examId: access.attempt.examId,
      action: "lab_suspend_failed",
      outcome: "failure",
      error: typeof response.body.error === "string" ? response.body.error : "suspend failed",
      occurredAt: new Date(),
    } satisfies AuditRecord);
  }
}

async function recordResumeSideEffects(
  services: CandidateSuspendResumeServices,
  access: Extract<Awaited<ReturnType<typeof authorizeCandidateExamAttemptAccess>>, { ok: true }>,
  response: SuspendResumeResponse,
  candidateEmail: string | null,
): Promise<void> {
  const examAttemptId = access.attempt.id;
  const resumeDisposition =
    typeof response.body.resumeDisposition === "string" ? response.body.resumeDisposition : null;

  if (response.status === 200 && resumeDisposition === "resumed") {
    services.heartbeatAutoSuspend.removeHeartbeat(examAttemptId);
    await services.audit.write({
      id: randomUUID(),
      customerId: access.session.customerId,
      actorType: "candidate",
      actorId: access.session.userId,
      actorEmail: candidateEmail,
      subjectType: "exam_attempt",
      subjectId: examAttemptId,
      examAttemptId,
      candidateId: access.session.userId,
      candidateEmail,
      examId: access.attempt.examId,
      action: "lab_resumed",
      outcome: "success",
      occurredAt: new Date(),
    } satisfies AuditRecord);
    return;
  }

  if (response.status >= 500) {
    await services.audit.write({
      id: randomUUID(),
      customerId: access.session.customerId,
      actorType: "candidate",
      actorId: access.session.userId,
      actorEmail: candidateEmail,
      subjectType: "exam_attempt",
      subjectId: examAttemptId,
      examAttemptId,
      candidateId: access.session.userId,
      candidateEmail,
      examId: access.attempt.examId,
      action: "lab_resume_failed",
      outcome: "failure",
      error: typeof response.body.error === "string" ? response.body.error : "resume failed",
      occurredAt: new Date(),
    } satisfies AuditRecord);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
