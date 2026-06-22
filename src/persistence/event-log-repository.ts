import type { EventLogRecord, EventLogRepository } from "@/domain/event-log";

export type { EventLogRecord, EventLogRepository };

export function createInMemoryEventLogRepository(): EventLogRepository & {
  reset(): void;
} {
  let records: EventLogRecord[] = [];

  return {
    async append(record: EventLogRecord): Promise<void> {
      records.push(record);
    },

    async listFailureEventsByExamAttemptIds(
      examAttemptIds: readonly string[],
    ): Promise<EventLogRecord[]> {
      const ids = new Set(examAttemptIds);
      return records.filter((record) => {
        if (!record.type.endsWith(".failed")) {
          return false;
        }

        const examAttemptId = record.payload.examAttemptId;
        return typeof examAttemptId === "string" && ids.has(examAttemptId);
      });
    },

    async listAll(limit?: number): Promise<EventLogRecord[]> {
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
