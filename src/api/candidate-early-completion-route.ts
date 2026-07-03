import { randomUUID } from "node:crypto";
import type { PortalSession } from "@/auth/portal-stores";
import type { AuditRecord } from "@/domain/audit-trail";
import { authorizeCandidateExamAttemptAccess } from "./candidate-exam-attempt-access";
import {
  completeExamAttemptEarlyRuntime,
  type CompleteExamAttemptEarlyHandlerDeps,
} from "./exam-attempt-early-completion-runtime";
import type { SuspendResumeResponse } from "./exam-attempt-suspend-resume-runtime";

export interface CandidateEarlyCompletionServices {
  readonly environmentSource: CompleteExamAttemptEarlyHandlerDeps["source"];
  readonly environmentController: CompleteExamAttemptEarlyHandlerDeps["controller"];
  readonly examAttempts: CompleteExamAttemptEarlyHandlerDeps["attempts"];
  readonly labLaunches: CompleteExamAttemptEarlyHandlerDeps["launches"];
  readonly examClock: CompleteExamAttemptEarlyHandlerDeps["timer"] & CompleteExamAttemptEarlyHandlerDeps["clocks"];
  readonly exams: NonNullable<CompleteExamAttemptEarlyHandlerDeps["exams"]>;
  readonly logger: CompleteExamAttemptEarlyHandlerDeps["logger"];
  readonly heartbeatAutoSuspend: {
    readonly removeHeartbeat: (examAttemptId: string) => void;
  };
  readonly audit: {
    readonly write: (record: AuditRecord) => Promise<void>;
  };
  readonly eventLog: CompleteExamAttemptEarlyHandlerDeps["eventLog"];
  readonly cloudshareConnections: CompleteExamAttemptEarlyHandlerDeps["connections"];
  readonly cloudshareClientFactory: CompleteExamAttemptEarlyHandlerDeps["cloudshare"];
  readonly diagnosticRecorder: CompleteExamAttemptEarlyHandlerDeps["diagnostics"];
}

export interface CandidateEarlyCompletionRouteRequest {
  readonly sessionId: string | undefined;
  readonly body: unknown;
  readonly getPortalSession: (sessionId: string | undefined) => Promise<PortalSession | null>;
}

export function buildCandidateEarlyCompletionWorkflowDeps(
  services: CandidateEarlyCompletionServices,
  options: { readonly candidateEmail?: string } = {},
): CompleteExamAttemptEarlyHandlerDeps {
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

export async function handleCandidateCompleteExamRoute(
  services: CandidateEarlyCompletionServices,
  request: CandidateEarlyCompletionRouteRequest,
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
    },
  );
  if (!access.ok) {
    return access.response;
  }

  const response = await completeExamAttemptEarlyRuntime(
    buildCandidateEarlyCompletionWorkflowDeps(services, {
      candidateEmail: session?.email ?? undefined,
    }),
    { examAttemptId },
  );

  await recordCompleteSideEffects(services, examAttemptId, response, session?.email ?? null);
  return response;
}

function extractRouteExamAttemptId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { examAttemptId } = body as { examAttemptId?: unknown };
  return typeof examAttemptId === "string" && examAttemptId.length > 0 ? examAttemptId : null;
}

async function recordCompleteSideEffects(
  services: CandidateEarlyCompletionServices,
  examAttemptId: string,
  response: SuspendResumeResponse,
  candidateEmail: string | null,
): Promise<void> {
  if (response.status !== 200) {
    return;
  }

  try {
    services.heartbeatAutoSuspend.removeHeartbeat(examAttemptId);
    await services.audit.write({
      id: randomUUID(),
      examAttemptId,
      action: "exam_completed_early",
      outcome: "success",
      occurredAt: new Date(),
    } satisfies AuditRecord);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.logger.warn("exam completion side effect failed", {
      examAttemptId,
      error: message,
    });
    await services.diagnosticRecorder?.record({
      source: "runtime",
      level: "warn",
      operation: "exam_attempt.complete.side_effect",
      outcome: "failure",
      message: "Exam completion side effect failed after candidate response was completed",
      candidateEmail,
      examAttemptId,
      actor: {
        type: "candidate",
        email: candidateEmail,
      },
      subject: {
        type: "exam_attempt",
        id: examAttemptId,
      },
      details: {
        sideEffect: "heartbeat_or_audit",
        error: message,
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
