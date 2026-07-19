import type {
  EventLogAppendInput,
  EventLogExternalIds,
  EventLogMetadata,
  EventLogRecord,
  EventLogRepository,
} from "@/domain/event-log";

export type { EventLogRecord, EventLogRepository };

export function createInMemoryEventLogRepository(): EventLogRepository & {
  reset(): void;
} {
  let records: EventLogRecord[] = [];

  return {
    async append(record: EventLogAppendInput): Promise<void> {
      const projected = projectEventLogRecord(record);
      if (projected) {
        records.push(projected);
      }
    },

    async listFailureEventsByExamAttemptIds(
      customerId: string,
      examAttemptIds: readonly string[],
    ): Promise<EventLogRecord[]> {
      const ids = new Set(examAttemptIds);
      return records.filter((record) => {
        if (record.customerId !== customerId || !record.type.endsWith(".failed")) {
          return false;
        }

        const examAttemptId = record.payload.externalIds?.examAttemptId;
        return typeof examAttemptId === "string" && ids.has(examAttemptId);
      });
    },

    async listByCustomerId(customerId: string, limit?: number): Promise<EventLogRecord[]> {
      const sorted = records.filter((record) => record.customerId === customerId).sort(
        (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
      );
      return limit !== undefined ? sorted.slice(0, limit) : sorted;
    },

    reset(): void {
      records = [];
    },
  };
}

const EXTERNAL_ID_KEYS = [
  "examAttemptId",
  "candidateId",
  "examId",
  "environmentId",
  "environmentExternalId",
  "trainingId",
  "participantId",
  "webhookPathFingerprint",
  "idempotencyKey",
] as const satisfies readonly (keyof EventLogExternalIds)[];

function projectEventLogRecord(input: EventLogAppendInput): EventLogRecord | null {
  if (
    !isNonEmptyString(input.customerId) ||
    !isNonEmptyString(input.correlationId) ||
    !isNonEmptyString(input.eventId) ||
    !isNonEmptyString(input.type) ||
    !(input.occurredAt instanceof Date) ||
    !Number.isFinite(input.occurredAt.getTime()) ||
    !isMetadata(input.payload)
  ) {
    return null;
  }

  const actor = projectActor(input.payload.actor);
  const externalIds = projectExternalIds(input.payload.externalIds);
  const payload: EventLogMetadata = {
    operation: input.payload.operation,
    outcome: input.payload.outcome,
    ...(isNonEmptyString(input.payload.integrationSurface)
      ? { integrationSurface: input.payload.integrationSurface }
      : {}),
    ...(isNonEmptyString(input.payload.attemptedOperation)
      ? { attemptedOperation: input.payload.attemptedOperation }
      : {}),
    ...(isNonEmptyString(input.payload.failureMode)
      ? { failureMode: input.payload.failureMode }
      : {}),
    ...(typeof input.payload.responseStatus === "number" && Number.isInteger(input.payload.responseStatus)
      ? { responseStatus: input.payload.responseStatus }
      : {}),
    ...(actor ? { actor } : {}),
    ...(externalIds ? { externalIds } : {}),
  };

  return {
    eventId: input.eventId,
    customerId: input.customerId,
    correlationId: input.correlationId,
    type: input.type,
    occurredAt: new Date(input.occurredAt),
    payload,
  };
}

function isMetadata(value: unknown): value is EventLogMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EventLogMetadata>;
  return isNonEmptyString(candidate.operation) &&
    (candidate.outcome === "success" || candidate.outcome === "failure");
}

function projectActor(value: EventLogMetadata["actor"]): EventLogMetadata["actor"] | null {
  if (!value || !["admin", "candidate", "system", "webhook"].includes(value.type)) return null;
  return {
    type: value.type,
    ...(isNonEmptyString(value.id) ? { id: value.id } : {}),
    ...(isNonEmptyString(value.email) ? { email: value.email } : {}),
  };
}

function projectExternalIds(value: EventLogMetadata["externalIds"]): EventLogExternalIds | null {
  if (!value || typeof value !== "object") return null;
  const projected: Partial<Record<keyof EventLogExternalIds, string>> = {};
  for (const key of EXTERNAL_ID_KEYS) {
    const candidate = value[key];
    if (isNonEmptyString(candidate)) projected[key] = candidate;
  }
  return Object.keys(projected).length > 0 ? projected : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
