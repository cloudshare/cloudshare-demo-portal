import { randomUUID } from "node:crypto";
import type { PortalSession } from "@/auth";
import type { AuditRecord, AuditRepository } from "@/domain/audit-trail";
import type { HeartbeatAutoSuspend } from "@/domain/heartbeat-auto-suspend";
import { handleSuspendExam } from "./suspend-resume";
import type {
  SuspendHandlerDeps,
  SuspendResumeRequest,
  SuspendResumeResponse,
} from "./suspend-resume";

export interface CandidateLogoutAutoSuspendServices {
  readonly environmentController: SuspendHandlerDeps["controller"];
  readonly environmentSource: SuspendHandlerDeps["source"];
  readonly examClock: SuspendHandlerDeps["timer"] & SuspendHandlerDeps["clocks"];
  readonly exams: SuspendHandlerDeps["exams"];
  readonly examAttempts: SuspendHandlerDeps["attempts"];
  readonly labLaunches: SuspendHandlerDeps["launches"];
  readonly logger: SuspendHandlerDeps["logger"];
  readonly eventLog: SuspendHandlerDeps["eventLog"];
  readonly cloudshareConnections: SuspendHandlerDeps["connections"];
  readonly cloudshareClientFactory: SuspendHandlerDeps["cloudshare"];
  readonly diagnosticRecorder: SuspendHandlerDeps["diagnostics"];
  readonly heartbeatAutoSuspend: Pick<HeartbeatAutoSuspend, "removeHeartbeat">;
  readonly audit: Pick<AuditRepository, "write">;
}

export interface CandidateLogoutAutoSuspendDeps extends SuspendHandlerDeps {
  readonly suspendExam: (
    deps: SuspendHandlerDeps,
    request: SuspendResumeRequest,
  ) => Promise<SuspendResumeResponse>;
  readonly heartbeatAutoSuspend: Pick<HeartbeatAutoSuspend, "removeHeartbeat">;
  readonly audit: Pick<AuditRepository, "write">;
  readonly newId: () => string;
  readonly now: () => Date;
}

interface CandidateLogoutAutoSuspendDepsOptions {
  readonly suspendExam?: CandidateLogoutAutoSuspendDeps["suspendExam"];
  readonly sleep?: CandidateLogoutAutoSuspendDeps["sleep"];
  readonly newId?: CandidateLogoutAutoSuspendDeps["newId"];
  readonly now?: CandidateLogoutAutoSuspendDeps["now"];
}

export function buildCandidateLogoutAutoSuspendDeps(
  services: CandidateLogoutAutoSuspendServices,
  session: PortalSession,
  options: CandidateLogoutAutoSuspendDepsOptions = {},
): CandidateLogoutAutoSuspendDeps {
  return {
    controller: services.environmentController,
    source: services.environmentSource,
    timer: services.examClock,
    exams: services.exams,
    clocks: services.examClock,
    attempts: services.examAttempts,
    launches: services.labLaunches,
    sleep: options.sleep ?? sleep,
    logger: services.logger,
    eventLog: services.eventLog,
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
    diagnostics: services.diagnosticRecorder,
    candidateEmail: session.email ?? undefined,
    suspendExam: options.suspendExam ?? handleSuspendExam,
    heartbeatAutoSuspend: services.heartbeatAutoSuspend,
    audit: services.audit,
    newId: options.newId ?? randomUUID,
    now: options.now ?? (() => new Date()),
  };
}

export async function suspendCandidateRunningLabsForLogout(
  deps: CandidateLogoutAutoSuspendDeps,
  session: PortalSession,
): Promise<void> {
  const attempts = await deps.attempts.listByCandidate(session.userId);
  const runningAttempts = attempts.filter((attempt) => attempt.status === "in_progress");

  for (const attempt of runningAttempts) {
    const resp = await deps.suspendExam(deps, { body: { examAttemptId: attempt.id } });

    if (resp.status !== 200) {
      throw new Error(
        `Logout auto-suspend failed for ExamAttempt ${attempt.id}: ${JSON.stringify(resp.body)}`,
      );
    }

    deps.heartbeatAutoSuspend.removeHeartbeat(attempt.id);
    await deps.audit.write({
      id: deps.newId(),
      customerId: attempt.customerId,
      actorType: "candidate",
      actorId: session.userId,
      actorEmail: session.email,
      subjectType: "exam_attempt",
      subjectId: attempt.id,
      examAttemptId: attempt.id,
      candidateId: session.userId,
      candidateEmail: session.email,
      examId: attempt.examId,
      action: "lab_suspended",
      outcome: "success",
      details: { reason: "candidate_logout" },
      occurredAt: deps.now(),
    } satisfies AuditRecord);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
