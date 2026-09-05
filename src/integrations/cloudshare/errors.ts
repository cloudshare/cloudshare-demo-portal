/**
 * Typed errors for the CloudShare integration. Every failure crossing the
 * adapter seam is one of these — never a bare `Error` or a generic 500 — so
 * callers can react deliberately (retry, surface, audit) and logs stay
 * actionable. Each carries enough structured context to debug without leaking
 * secrets (the logger redacts known secret values regardless).
 */

export const CLOUDSHARE_ERROR_DISCRIMINANT = "cloudshare.error.v1";

const CLOUDSHARE_ERROR_NAMES = new Set([
  "CloudShareError",
  "CloudShareAuthError",
  "CloudShareRequestError",
  "CloudShareRateLimitError",
  "CloudShareTransportError",
  "CloudShareResponseError",
  "CloudShareFixtureError",
]);

/** Base class for every CloudShare adapter failure. */
export class CloudShareError extends Error {
  readonly cloudShareErrorBoundaryDiscriminant = CLOUDSHARE_ERROR_DISCRIMINANT;

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

export type CloudShareRateLimitClassification = "rate_limit" | "abuse_protection";
export const CLOUDSHARE_RATE_LIMIT_ERROR_DISCRIMINANT = "cloudshare.rate-limit-error.v1";

/** A CloudShare request was throttled or blocked by abuse protection. */
export class CloudShareRateLimitError extends CloudShareRequestError {
  readonly cloudShareErrorDiscriminant = CLOUDSHARE_RATE_LIMIT_ERROR_DISCRIMINANT;
  readonly retryAfterSeconds?: number;
  readonly rateLimitHeaders?: Record<string, string | string[]>;

  constructor(
    message: string,
    status: number,
    readonly classification: CloudShareRateLimitClassification,
    context?: Record<string, unknown>,
  ) {
    super(message, status, context);
    this.name = "CloudShareRateLimitError";
    this.retryAfterSeconds =
      typeof context?.retryAfterSeconds === "number"
        ? context.retryAfterSeconds
        : undefined;
    this.rateLimitHeaders =
      isRateLimitHeaderMap(context?.rateLimitHeaders)
        ? context.rateLimitHeaders
        : undefined;
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

export function isCloudShareRateLimitError(error: unknown): error is CloudShareRateLimitError {
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const value = error as Record<string, unknown>;
  return value.name === "CloudShareRateLimitError" &&
    value.cloudShareErrorDiscriminant === CLOUDSHARE_RATE_LIMIT_ERROR_DISCRIMINANT &&
    typeof value.status === "number" && Number.isFinite(value.status) &&
    (value.classification === "rate_limit" || value.classification === "abuse_protection") &&
    (value.context === undefined ||
      (typeof value.context === "object" && value.context !== null && !Array.isArray(value.context)));
}

/**
 * Recognize typed adapter errors after a development reload has created a
 * second copy of this module, where `instanceof` is no longer reliable.
 */
export function isCloudShareErrorAcrossBoundaries(error: unknown): error is CloudShareError {
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const value = error as Record<string, unknown>;
  if (
    value.cloudShareErrorBoundaryDiscriminant !== CLOUDSHARE_ERROR_DISCRIMINANT ||
    typeof value.name !== "string" ||
    !CLOUDSHARE_ERROR_NAMES.has(value.name) ||
    (value.context !== undefined &&
      (typeof value.context !== "object" || value.context === null || Array.isArray(value.context)))
  ) {
    return false;
  }
  return value.name !== "CloudShareRequestError" ||
    (typeof value.status === "number" && Number.isFinite(value.status));
}

function isRateLimitHeaderMap(
  value: unknown,
): value is Record<string, string | string[]> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every(
    (entry) =>
      typeof entry === "string" ||
      (Array.isArray(entry) && entry.every((item) => typeof item === "string")),
  );
}
