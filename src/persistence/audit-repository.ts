import type { AuditRecord, AuditRepository } from "@/domain/audit-trail";

export function createInMemoryAuditRepository(): AuditRepository & {
  reset(): void;
} {
  let records: AuditRecord[] = [];

  return {
    async write(record: AuditRecord): Promise<void> {
      records.push(record);
    },

    async listByExamAttemptId(examAttemptId: string): Promise<AuditRecord[]> {
      return records.filter((r) => r.examAttemptId === examAttemptId);
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
