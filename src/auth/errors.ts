/**
 * Typed auth failures. Candidate admission never throws a bare `Error`; callers
 * (and the audit trail) can distinguish *why* admission was denied — bad token,
 * expired token, or a replayed single-use token.
 */

export class AuthError extends Error {
  constructor(message: string, readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "AuthError";
  }
}

/** The token is malformed, has a bad signature, or fails its schema. */
export class InvalidExamTokenError extends AuthError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "InvalidExamTokenError";
  }
}

/** The token's signature/schema are valid but it has expired. */
export class ExpiredExamTokenError extends AuthError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "ExpiredExamTokenError";
  }
}

/** A single-use token was presented more than once (replay denied). */
export class TokenAlreadyUsedError extends AuthError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "TokenAlreadyUsedError";
  }
}
