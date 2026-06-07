/**
 * Typed errors for the CloudShare integration. Every failure crossing the
 * adapter seam is one of these — never a bare `Error` or a generic 500 — so
 * callers can react deliberately (retry, surface, audit) and logs stay
 * actionable. Each carries enough structured context to debug without leaking
 * secrets (the logger redacts known secret values regardless).
 */

/** Base class for every CloudShare adapter failure. */
export class CloudShareError extends Error {
  constructor(message: string, readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "CloudShareError";
  }
}

/** v4 OAuth token acquisition failed (bad credentials, endpoint down, malformed token response). */
export class CloudShareAuthError extends CloudShareError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "CloudShareAuthError";
  }
}

/** A CloudShare API call returned a non-success status. */
export class CloudShareRequestError extends CloudShareError {
  constructor(
    message: string,
    readonly status: number,
    context?: Record<string, unknown>,
  ) {
    super(message, { ...context, status });
    this.name = "CloudShareRequestError";
  }
}

/**
 * A request never reached CloudShare (or no response came back): DNS failure,
 * timeout, connection refused, TLS error. Distinct from {@link CloudShareRequestError}
 * (which means CloudShare *did* respond, with a non-success status) so callers
 * can treat transport failures as retryable.
 */
export class CloudShareTransportError extends CloudShareError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "CloudShareTransportError";
  }
}

/** A response could not be parsed/validated against its expected schema. */
export class CloudShareResponseError extends CloudShareError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "CloudShareResponseError";
  }
}

/** No fixture was recorded for a request attempted in fixture mode. */
export class CloudShareFixtureError extends CloudShareError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "CloudShareFixtureError";
  }
}
