import type { PrismaClient } from "@prisma/client";
import {
  redactAuditDetails,
  projectAuditError,
  type AuditQuery,
  type AuditRecord,
  type AuditRepository,
} from "@/domain/audit-trail";

function materialiseAuditRecord(record: AuditRecord): AuditRecord {
  return {
    id: record.id,
    occurredAt: record.occurredAt,
    customerId: record.customerId ?? null,
    actorType: record.actorType ?? null,
    actorId: record.actorId ?? null,
    actorEmail: record.actorEmail?.toLowerCase() ?? null,
    action: record.action,
    subjectType: record.subjectType ?? null,
    subjectId: record.subjectId ?? null,
    outcome: record.outcome,
    candidateId: record.candidateId ?? null,
    candidateEmail: record.candidateEmail?.toLowerCase() ?? null,
    examId: record.examId ?? null,
    examAttemptId: record.examAttemptId ?? null,
    correlationId: record.correlationId ?? null,
    details: redactAuditDetails(record.details),
    error: projectAuditError(record.error),
  };
}

function matchesAuditQuery(record: AuditRecord, query: AuditQuery): boolean {
  return (
    (!query.customerId || record.customerId === query.customerId) &&
    (!query.actorEmail || record.actorEmail?.toLowerCase() === query.actorEmail.toLowerCase()) &&
    (!query.action || record.action === query.action) &&
    (!query.subjectType || record.subjectType === query.subjectType) &&
    (!query.subjectId || record.subjectId === query.subjectId) &&
    (!query.outcome || record.outcome === query.outcome) &&
    (!query.candidateEmail ||
      record.candidateEmail?.toLowerCase() === query.candidateEmail.toLowerCase()) &&
    (!query.examId || record.examId === query.examId) &&
    (!query.examAttemptId || record.examAttemptId === query.examAttemptId) &&
    (!query.correlationId || record.correlationId === query.correlationId)
  );
}

export function createInMemoryAuditRepository(): AuditRepository & {
  reset(): void;
} {
  let records: AuditRecord[] = [];

  return {
    async write(record: AuditRecord): Promise<void> {
      records.push(materialiseAuditRecord(record));
    },

    async listByExamAttemptId(examAttemptId: string): Promise<AuditRecord[]> {
      return records.filter((r) => r.examAttemptId === examAttemptId);
    },

    async listByExamAttemptIds(examAttemptIds: readonly string[]): Promise<AuditRecord[]> {
      const ids = new Set(examAttemptIds);
      return records.filter((record) => typeof record.examAttemptId === "string" && ids.has(record.examAttemptId));
    },

    async query(query: AuditQuery): Promise<AuditRecord[]> {
      const sorted = [...records]
        .filter((record) => matchesAuditQuery(record, query))
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      return query.limit !== undefined ? sorted.slice(0, query.limit) : sorted;
    },

    async listAll(limit?: number): Promise<AuditRecord[]> {
      const sorted = [...records].sort(
        (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
      );
      return limit !== undefined ? sorted.slice(0, limit) : sorted;
    },

    reset(): void {
      records = [];
    },
  };
}

interface AuditTrailEntryRow {
  id: string;
  occurredAt: Date;
  customerId: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  outcome: string;
  candidateId: string | null;
  candidateEmail: string | null;
  examId: string | null;
  examAttemptId: string | null;
  correlationId: string | null;
  detailsJson: string | null;
  error: string | null;
}

function parseJson<T>(json: string | null): T | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rowToAuditRecord(row: AuditTrailEntryRow): AuditRecord {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    customerId: row.customerId,
    actorType: row.actorType,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    outcome: row.outcome as AuditRecord["outcome"],
    candidateId: row.candidateId,
    candidateEmail: row.candidateEmail,
    examId: row.examId,
    examAttemptId: row.examAttemptId,
    correlationId: row.correlationId,
    details: parseJson<Record<string, unknown>>(row.detailsJson),
    error: row.error,
  };
}

export function createPrismaAuditRepository(
  prisma: PrismaClient,
): AuditRepository & { reset(): Promise<void> } {
  return {
    async write(record: AuditRecord): Promise<void> {
      const materialised = materialiseAuditRecord(record);
      await prisma.auditTrailEntry.create({
        data: {
          id: materialised.id,
          occurredAt: materialised.occurredAt,
          customerId: materialised.customerId,
          actorType: materialised.actorType,
          actorId: materialised.actorId,
          actorEmail: materialised.actorEmail,
          action: materialised.action,
          subjectType: materialised.subjectType,
          subjectId: materialised.subjectId,
          outcome: materialised.outcome,
          candidateId: materialised.candidateId,
          candidateEmail: materialised.candidateEmail,
          examId: materialised.examId,
          examAttemptId: materialised.examAttemptId,
          correlationId: materialised.correlationId,
          detailsJson: materialised.details ? JSON.stringify(materialised.details) : null,
          error: materialised.error,
        },
      });
    },

    async listByExamAttemptId(examAttemptId: string): Promise<AuditRecord[]> {
      const rows = (await prisma.auditTrailEntry.findMany({
        where: { examAttemptId },
        orderBy: { occurredAt: "desc" },
      })) as AuditTrailEntryRow[];

      return rows.map(rowToAuditRecord);
    },

    async listByExamAttemptIds(examAttemptIds: readonly string[]): Promise<AuditRecord[]> {
      if (examAttemptIds.length === 0) {
        return [];
      }
      const rows = (await prisma.auditTrailEntry.findMany({
        where: { examAttemptId: { in: [...examAttemptIds] } },
        orderBy: { occurredAt: "desc" },
      })) as AuditTrailEntryRow[];

      return rows.map(rowToAuditRecord);
    },

    async query(query: AuditQuery): Promise<AuditRecord[]> {
      const rows = (await prisma.auditTrailEntry.findMany({
        where: {
          ...(query.customerId ? { customerId: query.customerId } : {}),
          ...(query.actorEmail ? { actorEmail: query.actorEmail.toLowerCase() } : {}),
          ...(query.action ? { action: query.action } : {}),
          ...(query.subjectType ? { subjectType: query.subjectType } : {}),
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.candidateEmail ? { candidateEmail: query.candidateEmail.toLowerCase() } : {}),
          ...(query.examId ? { examId: query.examId } : {}),
          ...(query.examAttemptId ? { examAttemptId: query.examAttemptId } : {}),
          ...(query.correlationId ? { correlationId: query.correlationId } : {}),
        },
        orderBy: { occurredAt: "desc" },
        ...(query.limit !== undefined ? { take: query.limit } : {}),
      })) as AuditTrailEntryRow[];

      return rows.map(rowToAuditRecord);
    },

    async listAll(limit?: number): Promise<AuditRecord[]> {
      const rows = (await prisma.auditTrailEntry.findMany({
        orderBy: { occurredAt: "desc" },
        ...(limit !== undefined ? { take: limit } : {}),
      })) as AuditTrailEntryRow[];

      return rows.map(rowToAuditRecord);
    },

    async reset(): Promise<void> {
      await prisma.auditTrailEntry.deleteMany();
    },
  };
}
