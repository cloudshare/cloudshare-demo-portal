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
  const normalizedScore = normalizeScoreEvidenceResponse(scoreResponse);

  return {
    ...normalizedScore,
    retrievedAt: latestScoreDiagnostic.occurredAt.toISOString(),
  };
}

function normalizeScoreEvidenceResponse(
  response: Record<string, unknown> | null,
): Omit<AdminCandidateScoreEvidence, "retrievedAt"> {
  if (!response) {
    return { scoreAvailable: false };
  }

  if (typeof response.scoreAvailable === "boolean") {
    const scoreAvailable = response.scoreAvailable;
    return {
      scoreAvailable,
      ...(scoreAvailable
        ? {
            percentComplete: asNumber(response.percentComplete),
            stepsCompleted: asNumber(response.stepsCompleted),
            stepsTotal: asNumber(response.stepsTotal),
            passedRate: asNumber(response.passedRate),
            failedRate: asNumber(response.failedRate),
          }
        : {}),
    };
  }

  const cloudShareBody = isRecord(response.body) ? response.body : response;
  const progress = normalizeCloudShareProgressEvidence(cloudShareBody);
  if (!progress) {
    return { scoreAvailable: false };
  }

  return {
    scoreAvailable: true,
    ...progress,
  };
}

function normalizeCloudShareProgressEvidence(
  payload: Record<string, unknown>,
): Omit<AdminCandidateScoreEvidence, "scoreAvailable" | "retrievedAt"> | null {
  const rows = readProgressRows(payload);
  const hasRateEvidence = [
    "exploredRate",
    "inProgressRate",
    "notStartedRate",
    "passedRate",
    "failedRate",
    "notInitiatedRate",
  ].some((key) => typeof payload[key] === "number");
  if (rows.length === 0 && !hasRateEvidence) {
    return null;
  }

  const stepsTotal =
    asNumber(payload.totalSections) ??
    asNumber(payload.totalSteps) ??
    asNumber(payload.totalTasks) ??
    rows.length;
  const stepsCompleted =
    asNumber(payload.completedSections) ??
    asNumber(payload.completedSteps) ??
    asNumber(payload.completedTasks) ??
    rows.filter(isCompletedProgressRow).length;
  const percentComplete =
    normalizePercent(
      asNumber(payload.percentComplete) ??
      asNumber(payload.progressPercentage) ??
      asNumber(payload.completionRate) ??
      asNumber(payload.progressRate) ??
      asNumber(payload.progress),
    ) ?? (stepsTotal > 0 ? Math.round((stepsCompleted / stepsTotal) * 100) : undefined);

  return {
    percentComplete,
    stepsCompleted,
    stepsTotal,
    passedRate: asNumber(payload.passedRate),
    failedRate: asNumber(payload.failedRate),
  };
}

function readProgressRows(payload: Record<string, unknown>): readonly Record<string, unknown>[] {
  const rows =
    payload.sectionStatuses ??
    payload.sections ??
    payload.steps ??
    payload.tasks;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
}

function isCompletedProgressRow(row: Record<string, unknown>): boolean {
  const completed = row.completed ?? row.isCompleted;
  if (typeof completed === "boolean") {
    return completed;
  }

  const status = row.status ?? row.sectionStatus ?? row.stepStatus ?? row.taskStatus;
  if (typeof status === "number") {
    return status === 2 || status === 3;
  }
  if (typeof status !== "string") {
    return false;
  }

  switch (status.trim().toLowerCase()) {
    case "completed":
    case "complete":
    case "explored":
    case "explore":
    case "done":
    case "passed":
    case "success":
    case "verified":
      return true;
    default:
      return false;
  }
}

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value >= 0 && value <= 1) {
    return Math.round(value * 100);
  }
  return Math.round(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
