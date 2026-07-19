/**
 * IntegrationEvents are the typed messages the portal exchanges to drive its
 * workflow. Candidate scheduling emits ExamAttempt events, runtime flows consume
 * them, and the admin audit trail logs them all. Keeping them a discriminated
 * union means every publisher and subscriber is type-checked against the same
 * shapes.
 */

interface BaseIntegrationEvent {
  readonly id: string;
  readonly customerId: string;
  readonly occurredAt: Date;
}

/** Emitted when a Candidate schedules an ExamAttempt; begins downstream runtime work. */
export interface ExamAttemptCreatedEvent extends BaseIntegrationEvent {
  readonly type: "exam_attempt.created";
  readonly examAttemptId: string;
  readonly candidateId: string;
  readonly examId: string;
}

/** The union of all integration events. Grows as later slices add event types. */
export type IntegrationEvent = ExamAttemptCreatedEvent;

export type IntegrationEventType = IntegrationEvent["type"];

/** Narrow an event to a specific type. */
export type IntegrationEventOf<T extends IntegrationEventType> = Extract<
  IntegrationEvent,
  { type: T }
>;

/** Outbound port: publish an IntegrationEvent. Scheduling depends on this. */
export interface IntegrationEventPublisher {
  publish(event: IntegrationEvent): Promise<void>;
}
