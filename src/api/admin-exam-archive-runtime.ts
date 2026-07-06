import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CohortExamSessionRepository } from "@/domain/cohort-exam-session";
import {
  archiveExam,
  ExamNotFoundError,
  type ExamRepository,
} from "@/domain/exam-catalog";
import type { DiagnosticActor, DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { Logger } from "@/observability/logger";

export interface AdminExamArchiveAttemptRepository {
  listByExamId(
    customerId: string,
    examId: string,
  ): Promise<
    readonly {
      readonly id: string;
      readonly status: string;
      readonly cohortSessionId: string | null;
    }[]
  >;
}

export interface AdminExamArchiveRuntimeDeps {
  readonly repository: ExamRepository;
  readonly attempts: AdminExamArchiveAttemptRepository;
  readonly cohortSessions?: CohortExamSessionRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newAuditId?: () => string;
}

export interface AdminExamArchiveRuntimeRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly examId: string;
  readonly body?: unknown;
}

export async function archiveAdminExamRuntime(
  deps: AdminExamArchiveRuntimeDeps,
  request: AdminExamArchiveRuntimeRequest,
) {
  try {
    const existing = await deps.repository.findById(request.examId);
    if (!existing || existing.customerId !== request.customerId) {
      throw new ExamNotFoundError(request.customerId, request.examId);
    }

    const cohortSessionWarning = deps.cohortSessions
      ? buildCohortSessionArchiveWarning(await deps.cohortSessions.listByExamId(request.examId))
      : {
          totalCohortSessionCount: 0,
          activeCohortSessionCount: 0,
          activeCohortSessionStatuses: [] as string[],
        };
    if (cohortSessionWarning.activeCohortSessionCount > 0) {
      return {
        status: 409,
        body: {
          error: "Retire all Cohort Exam Sessions before archiving this Cohort Exam catalogue item.",
          code: "active_cohort_sessions",
          warning: cohortSessionWarning,
        },
      };
    }

    const attempts = await deps.attempts.listByExamId(request.customerId, request.examId);
    const warning = buildArchiveWarning(attempts);
    const confirmationRequested = parseBooleanFlag(request.body, "confirmArchive");
    if ((warning.scheduledAttemptCount > 0 || warning.activeAttemptCount > 0) && !confirmationRequested) {
      return {
        status: 409,
        body: {
          error: "Active or scheduled attempts may still rely on this Exam.",
          code: "confirmation_required",
          warning,
        },
      };
    }

    const exam = await archiveExam(
      { repository: deps.repository, now: deps.now },
      { customerId: request.customerId, examId: request.examId },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "exam", id: exam.id },
      examId: exam.id,
      level: "info",
      operation: "exam.archive",
      outcome: "success",
      message: "Exam archived",
      details: {
        ...warning,
        ...cohortSessionWarning,
        changedFields: ["status"],
      },
    });
    await safeRecordAudit(deps, {
      request,
      action: "exam.archived",
      subjectId: exam.id,
      examId: exam.id,
      details: {
        ...warning,
        ...cohortSessionWarning,
        changedFields: ["status"],
      },
    });
    return {
      status: 200,
      body: {
        exam,
        warning: {
          ...warning,
          ...cohortSessionWarning,
        },
      },
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

function buildCohortSessionArchiveWarning(
  sessions: Awaited<ReturnType<CohortExamSessionRepository["listByExamId"]>>,
) {
  const activeStatuses = sessions
    .map((session) => session.status)
    .filter((status) => status !== "retired");
  return {
    totalCohortSessionCount: sessions.length,
    activeCohortSessionCount: activeStatuses.length,
    activeCohortSessionStatuses: [...new Set(activeStatuses)].sort(),
  };
}

function buildArchiveWarning(
  attempts: readonly {
    readonly status: string;
  }[],
) {
  let scheduledAttemptCount = 0;
  let activeAttemptCount = 0;
  for (const attempt of attempts) {
    if (attempt.status === "scheduled" || attempt.status === "ready") {
      scheduledAttemptCount += 1;
      continue;
    }
    if (attempt.status === "in_progress" || attempt.status === "suspended") {
      activeAttemptCount += 1;
    }
  }
  return {
    scheduledAttemptCount,
    activeAttemptCount,
    totalAttemptCount: attempts.length,
  };
}

function parseBooleanFlag(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && (body as Record<string, unknown>)[key] === true;
}

async function safeRecordDiagnostic(
  deps: { readonly diagnostics?: DiagnosticRecorder; readonly logger: Logger },
  entry: DiagnosticLogEntryInput,
): Promise<void> {
  if (!deps.diagnostics) {
    return;
  }
  try {
    await deps.diagnostics.record(entry);
  } catch (error) {
    deps.logger.warn("admin exam diagnostic recording failed", {
      operation: entry.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeRecordAudit(
  deps: Pick<AdminExamArchiveRuntimeDeps, "audit" | "logger" | "now" | "newAuditId">,
  input: {
    readonly request: AdminExamArchiveRuntimeRequest;
    readonly action: string;
    readonly subjectId: string;
    readonly examId: string;
    readonly details?: Record<string, unknown>;
  },
): Promise<void> {
  if (!deps.audit) {
    return;
  }
  try {
    await deps.audit.write({
      id: (deps.newAuditId ?? randomUUID)(),
      customerId: input.request.customerId,
      actorType: input.request.actor?.type ?? null,
      actorId: input.request.actor?.id ?? null,
      actorEmail: input.request.actor?.email ?? null,
      action: input.action,
      subjectType: "exam",
      subjectId: input.subjectId,
      outcome: "success",
      examId: input.examId,
      details: input.details ?? null,
      occurredAt: (deps.now ?? (() => new Date()))(),
    });
  } catch (error) {
    deps.logger.warn("admin exam audit recording failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
