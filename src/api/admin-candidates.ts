import {
  buildAdminCandidateAttemptSummary,
  formatAdminCandidateName,
  type AdminCandidateAttemptRecord,
  type AdminCandidateAttemptView,
  type AdminCandidateDetailView,
  type AdminCandidateRecord,
  type AdminCandidateRepository,
  type AdminCandidateRosterItem,
  type AdminCandidateScoreEvidence,
} from "@/domain/admin-candidates";
import {
  MAX_DIAGNOSTIC_QUERY_LIMIT,
  type DiagnosticLogEntry,
  type DiagnosticLogRepository,
} from "@/domain/diagnostic-log";
import type { Logger } from "@/observability/logger";

export interface AdminCandidateHandlerDeps {
  readonly candidates: AdminCandidateRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
}

export interface AdminCandidateServices {
  readonly adminCandidates: AdminCandidateRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
}

export function buildAdminCandidateDeps(
  services: AdminCandidateServices,
): AdminCandidateHandlerDeps {
  return {
    candidates: services.adminCandidates,
    diagnostics: services.diagnostics,
    logger: services.logger,
  };
}

export interface AdminCandidateResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleGetAdminCandidateRoster(
  deps: AdminCandidateHandlerDeps,
  request: {
    readonly customerId: string;
    readonly query?: { readonly search?: string };
  },
): Promise<AdminCandidateResponse> {
  const search = request.query?.search?.trim();
  const candidates = await deps.candidates.listByCustomerId(request.customerId, {
    ...(search ? { search } : {}),
  });
  const diagnosticsByAttemptId = await loadDiagnosticsByAttemptId(
    deps,
    request.customerId,
    candidates.flatMap((candidate) => candidate.attempts.map((attempt) => attempt.id)),
  );

  return {
    status: 200,
    body: {
      candidates: candidates.map((candidate) =>
        toRosterItem(candidate, diagnosticsByAttemptId),
      ),
    },
  };
}

export async function handleGetAdminCandidateDetail(
  deps: AdminCandidateHandlerDeps,
  request: {
    readonly customerId: string;
    readonly candidateId: string;
  },
): Promise<AdminCandidateResponse> {
  const candidate = await deps.candidates.findByCustomerIdAndCandidateId(
    request.customerId,
    request.candidateId,
  );
  if (!candidate) {
    return { status: 404, body: { error: "candidate not found" } };
  }

  const diagnosticsByAttemptId = await loadDiagnosticsByAttemptId(
    deps,
    request.customerId,
    candidate.attempts.map((attempt) => attempt.id),
  );

  return {
    status: 200,
    body: {
      candidate: toDetailView(candidate, diagnosticsByAttemptId),
    },
  };
}

async function loadDiagnosticsByAttemptId(
  deps: Pick<AdminCandidateHandlerDeps, "diagnostics" | "logger">,
  customerId: string,
  attemptIds: readonly string[],
): Promise<Map<string, readonly DiagnosticLogEntry[]>> {
  const uniqueAttemptIds = [...new Set(attemptIds)];
  const entries = new Map<string, readonly DiagnosticLogEntry[]>();

  await Promise.all(
    uniqueAttemptIds.map(async (examAttemptId) => {
      try {
        entries.set(
          examAttemptId,
          await deps.diagnostics.query({
            customerId,
            examAttemptId,
            limit: MAX_DIAGNOSTIC_QUERY_LIMIT,
          }),
        );
      } catch (error) {
        deps.logger.warn("admin candidate diagnostics lookup failed", {
          examAttemptId,
          error: error instanceof Error ? error.message : String(error),
        });
        entries.set(examAttemptId, []);
      }
    }),
  );

  return entries;
}

function toRosterItem(
  candidate: AdminCandidateRecord,
  diagnosticsByAttemptId: ReadonlyMap<string, readonly DiagnosticLogEntry[]>,
): AdminCandidateRosterItem {
  const attempts = toAttemptViews(candidate.attempts, diagnosticsByAttemptId);

  return {
    id: candidate.id,
    email: candidate.email,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    name: formatAdminCandidateName(candidate),
    createdAt: candidate.createdAt.toISOString(),
    attemptSummary: buildAdminCandidateAttemptSummary(candidate.attempts),
    latestAttempt: attempts[0] ?? null,
    latestScore: findLatestScore(attempts),
  };
}

function toDetailView(
  candidate: AdminCandidateRecord,
  diagnosticsByAttemptId: ReadonlyMap<string, readonly DiagnosticLogEntry[]>,
): AdminCandidateDetailView {
  const rosterItem = toRosterItem(candidate, diagnosticsByAttemptId);

  return {
    ...rosterItem,
    attempts: toAttemptViews(candidate.attempts, diagnosticsByAttemptId),
  };
}

function toAttemptViews(
  attempts: readonly AdminCandidateAttemptRecord[],
  diagnosticsByAttemptId: ReadonlyMap<string, readonly DiagnosticLogEntry[]>,
): AdminCandidateAttemptView[] {
  return [...attempts]
    .sort(compareAttemptRecordsNewestFirst)
    .map((attempt) => {
      const diagnostics = diagnosticsByAttemptId.get(attempt.id) ?? [];
      return {
        id: attempt.id,
        examId: attempt.examId,
        examTitle: attempt.examTitle,
        status: attempt.status,
        scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
        createdAt: attempt.createdAt.toISOString(),
        updatedAt: attempt.updatedAt.toISOString(),
        completedAt: findCompletionTime(diagnostics),
        scoreRetrievalEnabled: attempt.scoreRetrievalEnabled,
        score: findLatestScoreEvidence(diagnostics),
      };
    });
}

function findLatestScore(
  attempts: readonly AdminCandidateAttemptView[],
): AdminCandidateScoreEvidence | null {
  return attempts
    .map((attempt) => attempt.score)
    .filter((score): score is AdminCandidateScoreEvidence => score !== null)
    .sort((left, right) => right.retrievedAt.localeCompare(left.retrievedAt))[0] ?? null;
}

function findLatestScoreEvidence(
  diagnosticRecords: readonly DiagnosticLogEntry[],
): AdminCandidateScoreEvidence | null {
  const latestScoreDiagnostic = [...diagnosticRecords]
    .filter(
      (record) =>
        record.operation === "exam_attempt.score.retrieve" &&
        record.outcome === "success",
    )
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];

  if (!latestScoreDiagnostic) {
    return null;
  }

  const scoreResponse =
    latestScoreDiagnostic.response && typeof latestScoreDiagnostic.response === "object"
      ? latestScoreDiagnostic.response
      : null;
  const scoreAvailable = scoreResponse?.scoreAvailable === true;

  return {
    scoreAvailable,
    ...(scoreAvailable
      ? {
          percentComplete: asNumber(scoreResponse?.percentComplete),
          stepsCompleted: asNumber(scoreResponse?.stepsCompleted),
          stepsTotal: asNumber(scoreResponse?.stepsTotal),
        }
      : {}),
    retrievedAt: latestScoreDiagnostic.occurredAt.toISOString(),
  };
}

function findCompletionTime(
  diagnosticRecords: readonly DiagnosticLogEntry[],
): string | null {
  const completion = [...diagnosticRecords]
    .filter(
      (record) =>
        record.operation === "exam_attempt.complete" &&
        record.outcome === "success",
    )
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];

  return completion?.occurredAt.toISOString() ?? null;
}

function compareAttemptRecordsNewestFirst(
  left: AdminCandidateAttemptRecord,
  right: AdminCandidateAttemptRecord,
): number {
  const scheduledDiff =
    (right.scheduledFor?.getTime() ?? right.createdAt.getTime()) -
    (left.scheduledFor?.getTime() ?? left.createdAt.getTime());
  if (scheduledDiff !== 0) {
    return scheduledDiff;
  }
  return right.createdAt.getTime() - left.createdAt.getTime();
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
