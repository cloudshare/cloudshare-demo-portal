import type { SupportLogRecord, SupportLogRepository } from "@/domain/support-log";

export function createInMemorySupportLogRepository(): SupportLogRepository & {
  reset(): void;
} {
  let records: SupportLogRecord[] = [];

  return {
    async append(record: SupportLogRecord): Promise<void> {
      records.push(record);
    },

    async listAll(limit?: number): Promise<SupportLogRecord[]> {
      const sorted = [...records].sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      );
      return limit !== undefined ? sorted.slice(0, limit) : sorted;
    },

    reset(): void {
      records = [];
    },
  };
}
