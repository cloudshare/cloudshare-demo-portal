/** Captured IntegrationEvent, serialised for the admin event log. */
export interface EventLogRecord {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
}

export interface EventLogRepository {
  append(record: EventLogRecord): Promise<void>;
  /** Returns records newest-first. `limit` caps the result set (default: no limit). */
  listAll(limit?: number): Promise<EventLogRecord[]>;
}

export function createInMemoryEventLogRepository(): EventLogRepository {
  const records: EventLogRecord[] = [];

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
  };
}
