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
