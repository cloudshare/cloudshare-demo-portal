import type { PrismaClient } from "@prisma/client";
import type { LogLevel } from "@/observability/logger";
import {
  boundDiagnosticLimit,
  boundDiagnosticOffset,
  type DiagnosticLogEntry,
  type DiagnosticLogEntryInput,
  type DiagnosticLogQuery,
  type DiagnosticLogRepository,
} from "@/domain/diagnostic-log";

/**
 * Repositories for DiagnosticLogEntry. Core correlation fields are stored as
 * first-class columns so the read API filters on them directly (never via
 * JSON-string search); only genuinely free-form structures are JSON-encoded.
 */

function materialise(
  input: DiagnosticLogEntryInput,
  id: string,
  occurredAt: Date,
): DiagnosticLogEntry {
  return {
    id,
    occurredAt,
    level: input.level ?? "info",
    source: input.source,
    operation: input.operation,
    outcome: input.outcome,
    customerId: input.customerId ?? null,
    actor: input.actor ?? null,
    subject: input.subject ?? null,
    message: input.message,
    correlationId: input.correlationId ?? null,
    candidateEmail: input.candidateEmail ?? null,
    examId: input.examId ?? null,
    examAttemptId: input.examAttemptId ?? null,
    externalIds: input.externalIds ?? null,
    request: input.request ?? null,
    response: input.response ?? null,
    details: input.details ?? null,
  };
}

function matchesQuery(entry: DiagnosticLogEntry, query: DiagnosticLogQuery): boolean {
  if (query.customerId !== undefined && entry.customerId !== query.customerId) {
    return false;
  }
  if (query.examId !== undefined && entry.examId !== query.examId) {
    return false;
  }
  if (query.examAttemptId !== undefined && entry.examAttemptId !== query.examAttemptId) {
    return false;
  }
  if (
    query.candidateEmail !== undefined &&
    entry.candidateEmail?.toLowerCase() !== query.candidateEmail.toLowerCase()
  ) {
    return false;
  }
  if (query.operation !== undefined && entry.operation !== query.operation) {
    return false;
  }
  if (query.outcome !== undefined && entry.outcome !== query.outcome) {
    return false;
  }
  if (query.source !== undefined && entry.source !== query.source) {
    return false;
  }
  if (query.correlationId !== undefined && entry.correlationId !== query.correlationId) {
    return false;
  }
  if (
    query.integrationSurface !== undefined &&
    entry.details?.integrationSurface !== query.integrationSurface
  ) {
    return false;
  }
  if (
    query.externalId !== undefined &&
    !Object.values(entry.externalIds ?? {}).includes(query.externalId)
  ) {
    return false;
  }
  if (query.from && entry.occurredAt.getTime() < query.from.getTime()) {
    return false;
  }
  if (query.to && entry.occurredAt.getTime() > query.to.getTime()) {
    return false;
  }
  return true;
}

export function createInMemoryDiagnosticLogRepository(): DiagnosticLogRepository & {
  reset(): void;
} {
  let entries: DiagnosticLogEntry[] = [];
  let seq = 0;

  return {
    async append(input: DiagnosticLogEntryInput): Promise<DiagnosticLogEntry> {
      const id = `diag-${++seq}`;
      const entry = materialise(input, id, input.occurredAt ?? new Date());
      entries.push(entry);
      return entry;
    },

    async query(query: DiagnosticLogQuery = {}): Promise<DiagnosticLogEntry[]> {
      const limit = boundDiagnosticLimit(query.limit);
      const offset = boundDiagnosticOffset(query.offset);
      return entries
        .filter((entry) => matchesQuery(entry, query))
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
        .slice(offset)
        .slice(0, limit);
    },

    reset(): void {
      entries = [];
    },
  };
}

interface DiagnosticLogRow {
  id: string;
  occurredAt: Date;
  level: string;
  source: string;
  operation: string;
  outcome: string;
  customerId: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  subjectType: string | null;
  subjectId: string | null;
  message: string;
  correlationId: string | null;
  candidateEmail: string | null;
  examId: string | null;
  examAttemptId: string | null;
  externalIdsJson: string | null;
  requestJson: string | null;
  responseJson: string | null;
  detailsJson: string | null;
}

function parseJson<T>(json: string | null): T | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rowToEntry(row: DiagnosticLogRow): DiagnosticLogEntry {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    level: row.level as LogLevel,
    source: row.source,
    operation: row.operation,
    outcome: row.outcome as DiagnosticLogEntry["outcome"],
    customerId: row.customerId,
    actor: row.actorType
      ? { type: row.actorType, id: row.actorId, email: row.actorEmail }
      : null,
    subject: row.subjectType ? { type: row.subjectType, id: row.subjectId } : null,
    message: row.message,
    correlationId: row.correlationId,
    candidateEmail: row.candidateEmail,
    examId: row.examId,
    examAttemptId: row.examAttemptId,
    externalIds: parseJson<Record<string, string>>(row.externalIdsJson),
    request: parseJson<Record<string, unknown>>(row.requestJson),
    response: parseJson<Record<string, unknown>>(row.responseJson),
    details: parseJson<Record<string, unknown>>(row.detailsJson),
  };
}

export function createPrismaDiagnosticLogRepository(
  prisma: PrismaClient,
): DiagnosticLogRepository & { reset(): Promise<void> } {
  return {
    async append(input: DiagnosticLogEntryInput): Promise<DiagnosticLogEntry> {
      const row = (await prisma.diagnosticLogEntry.create({
        data: {
          occurredAt: input.occurredAt ?? new Date(),
          level: input.level ?? "info",
          source: input.source,
          operation: input.operation,
          outcome: input.outcome,
          customerId: input.customerId ?? null,
          actorType: input.actor?.type ?? null,
          actorId: input.actor?.id ?? null,
          actorEmail: input.actor?.email ?? null,
          subjectType: input.subject?.type ?? null,
          subjectId: input.subject?.id ?? null,
          message: input.message,
          correlationId: input.correlationId ?? null,
          candidateEmail: input.candidateEmail ?? null,
          examId: input.examId ?? null,
          examAttemptId: input.examAttemptId ?? null,
          externalIdsJson: input.externalIds ? JSON.stringify(input.externalIds) : null,
          requestJson: input.request ? JSON.stringify(input.request) : null,
          responseJson: input.response ? JSON.stringify(input.response) : null,
          detailsJson: input.details ? JSON.stringify(input.details) : null,
        },
      })) as DiagnosticLogRow;
      return rowToEntry(row);
    },

    async query(query: DiagnosticLogQuery = {}): Promise<DiagnosticLogEntry[]> {
      const limit = boundDiagnosticLimit(query.limit);
      const offset = boundDiagnosticOffset(query.offset);
      const occurredAt =
        query.from || query.to
          ? {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            }
          : undefined;

      const rows = (await prisma.diagnosticLogEntry.findMany({
        where: {
          ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
          ...(query.examId !== undefined ? { examId: query.examId } : {}),
          ...(query.examAttemptId !== undefined ? { examAttemptId: query.examAttemptId } : {}),
          ...(query.operation !== undefined ? { operation: query.operation } : {}),
          ...(query.outcome !== undefined ? { outcome: query.outcome } : {}),
          ...(query.source !== undefined ? { source: query.source } : {}),
          ...(query.correlationId !== undefined ? { correlationId: query.correlationId } : {}),
          ...(occurredAt ? { occurredAt } : {}),
        },
        orderBy: { occurredAt: "desc" },
        // Exact matching on nested JSON fields happens after row materialisation
        // so pagination semantics apply to the exact filtered set, not to a
        // substring-prefiltered superset that can omit valid matches.
      })) as DiagnosticLogRow[];

      return rows
        .map(rowToEntry)
        .filter((entry) => matchesQuery(entry, query))
        .slice(offset, offset + limit);
    },

    async reset(): Promise<void> {
      await prisma.diagnosticLogEntry.deleteMany();
    },
  };
}
