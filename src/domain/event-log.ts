/**
 * Domain types for the integration event log. Every published IntegrationEvent is
 * captured here so the admin /events endpoint can surface a full history without
 * additional instrumentation on individual publishers.
 */

export type EventLogOutcome = "success" | "failure";

export interface EventLogActorMetadata {
  readonly type: "admin" | "candidate" | "system" | "webhook";
  readonly id?: string;
  readonly email?: string;
}

export interface EventLogExternalIds {
  readonly examAttemptId?: string;
  readonly candidateId?: string;
  readonly examId?: string;
  readonly environmentId?: string;
  readonly environmentExternalId?: string;
  readonly trainingId?: string;
  readonly participantId?: string;
  readonly webhookPathFingerprint?: string;
  readonly idempotencyKey?: string;
}

/**
 * The complete allowlist for ordinary Event Log payloads. Provider exchanges and
 * free-form error/context objects deliberately have no place in this interface.
 */
export interface EventLogMetadata {
  readonly operation: string;
  readonly integrationSurface?: string;
  readonly outcome: EventLogOutcome;
  readonly attemptedOperation?: string;
  readonly failureMode?: string;
  readonly responseStatus?: number;
  readonly actor?: EventLogActorMetadata;
  readonly externalIds?: EventLogExternalIds;
}

/** Runtime allowlist adapter for diagnostics assembled from provider failures. */
export function projectEventLogMetadata(input: {
  readonly operation: string;
  readonly outcome: EventLogOutcome;
  readonly integrationSurface?: unknown;
  readonly attemptedOperation?: unknown;
  readonly failureMode?: unknown;
  readonly responseStatus?: unknown;
  readonly actor?: EventLogActorMetadata;
  readonly externalIds?: EventLogExternalIds;
}): EventLogMetadata {
  return {
    operation: input.operation,
    outcome: input.outcome,
    ...(typeof input.integrationSurface === "string" && input.integrationSurface.length > 0
      ? { integrationSurface: input.integrationSurface }
      : {}),
    ...(typeof input.attemptedOperation === "string" && input.attemptedOperation.length > 0
      ? { attemptedOperation: input.attemptedOperation }
      : {}),
    ...(typeof input.failureMode === "string" && input.failureMode.length > 0
      ? { failureMode: input.failureMode }
      : {}),
    ...(typeof input.responseStatus === "number" && Number.isInteger(input.responseStatus)
      ? { responseStatus: input.responseStatus }
      : {}),
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.externalIds ? { externalIds: input.externalIds } : {}),
  };
}

export interface EventLogAppendInput {
  readonly eventId: string;
  readonly customerId: string;
  readonly correlationId: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly payload: EventLogMetadata;
}

export interface EventLogRecord extends EventLogAppendInput {
  readonly payload: EventLogMetadata;
}

export interface EventLogRepository {
  append(record: EventLogAppendInput): Promise<void>;
  listFailureEventsByExamAttemptIds(
    customerId: string,
    examAttemptIds: readonly string[],
  ): Promise<EventLogRecord[]>;
  /** Returns exact-Customer records newest-first. */
  listByCustomerId(customerId: string, limit?: number): Promise<EventLogRecord[]>;
}
