/**
 * Domain types for the integration event log. Every published IntegrationEvent is
 * captured here so the admin /events endpoint can surface a full history without
 * additional instrumentation on individual publishers.
 */

export interface EventLogRecord {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
}

export interface EventLogRepository {
  append(record: EventLogRecord): Promise<void>;
  listFailureEventsByExamAttemptIds(examAttemptIds: readonly string[]): Promise<EventLogRecord[]>;
  /** Returns records newest-first. `limit` caps the result set (default: no limit). */
  listAll(limit?: number): Promise<EventLogRecord[]>;
}
