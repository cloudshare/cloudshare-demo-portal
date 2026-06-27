import type { PortalSession } from "@/auth";
import type { AuditRecord, AuditRepository } from "@/domain/audit-trail";
import type { HeartbeatAutoSuspend } from "@/domain/heartbeat-auto-suspend";
import type {
  SuspendHandlerDeps,
  SuspendResumeRequest,
  SuspendResumeResponse,
} from "./suspend-resume";

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
      examAttemptId: attempt.id,
      candidateId: session.userId,
      action: "lab_suspended",
      outcome: "success",
      details: { reason: "candidate_logout" },
      occurredAt: deps.now(),
    } satisfies AuditRecord);
  }
}
