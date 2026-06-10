/**
 * Typed domain errors. Domain use cases raise these rather than bare `Error`s so
 * callers (route handlers, the audit trail) can map them to deliberate responses.
 */

export class DomainError extends Error {
  constructor(message: string, readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
  }
}

/** A candidate tried to book an exam they are not eligible for. */
export class NotEligibleError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "NotEligibleError";
  }
}

/** A lab launch was attempted for an ExamAttempt that is not entitled to one. */
export class NotEntitledError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "NotEntitledError";
  }
}

/**
 * The controlled lab-launch sequence failed (e.g. student registration — the
 * real entitlement gate — did not complete). Surfaced as an actionable error
 * rather than a silently denied login.
 */
export class LabLaunchError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "LabLaunchError";
  }
}

/** Suspend or resume of the exam environment + timer sync failed. */
export class TimerSyncError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "TimerSyncError";
  }
}

/** No LabLaunch record was found for the given ExamAttempt (thrown by suspend/resume). */
export class LabLaunchNotFoundError extends TimerSyncError {
  constructor(context?: Record<string, unknown>) {
    super("No lab launch found for exam attempt", context);
    this.name = "LabLaunchNotFoundError";
  }
}

/** Retrieving Guided Journey progress from CloudShare failed. */
export class ScoreRetrievalError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "ScoreRetrievalError";
  }
}
