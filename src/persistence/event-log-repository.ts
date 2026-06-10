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
