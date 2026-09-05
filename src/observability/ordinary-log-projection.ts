const SAFE_METADATA_KEYS = new Set([
  "operation",
  "attemptedOperation",
  "integrationSurface",
  "outcome",
  "failureMode",
  "responseStatus",
  "status",
  "statusCode",
  "method",
  "path",
  "host",
  "correlationId",
  "eventType",
  "source",
  "actorType",
  "actorId",
  "actorEmail",
  "retryAfter",
  "retryAfterSeconds",
  "participantCount",
  "sectionCount",
  "activeParticipantCount",
  "nonTerminalEnvironmentCount",
  "confirmationRequired",
  "webhookPathFingerprint",
  "requestBodyBytes",
  "rawBodySha256",
  "signaturePresent",
  "signatureScheme",
  "storedWebhookSecretLength",
  "signatureMatched",
]);

const SAFE_ID_KEY = /^(?:customer|candidate|exam|examAttempt|cohortExamSession|session|opportunity|contact|salesSession|idempotency)Ids?$/;
const REDACTED = "[REDACTED]";

/** Fail-closed projection for ordinary process logs. */
export function projectOrdinaryLogFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      if (key === "request") return [[key, projectRequest(child)]];
      if (key === "response") return [[key, projectResponse(child)]];
      if (key === "requestHeaders" || key === "responseHeaders") {
        return [[key, maskHeaderValues(child)]];
      }
      if (key === "actor") return [[key, projectActor(child)]];
      if (key === "externalIds") return [[key, projectExternalIds(child)]];
      if (!SAFE_METADATA_KEYS.has(key) && !SAFE_ID_KEY.test(key)) return [];
      const projected = key === "path"
        ? projectPath(child)
        : key === "host"
          ? projectHost(child)
          : projectScalarMetadata(child);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

function projectRequest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(projectScalarMetadata(record.method) !== undefined ? { method: record.method } : {}),
    ...(projectPath(record.path) !== undefined ? { path: projectPath(record.path) } : {}),
    ...(projectHost(record.host) !== undefined ? { host: projectHost(record.host) } : {}),
    ...(record.headers !== undefined ? { headers: maskHeaderValues(record.headers) } : {}),
  };
}

function projectResponse(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, child]) => {
      if (key === "headers" || key === "responseHeaders") return [[key, maskHeaderValues(child)]];
      if (!["status", "statusCode", "failureMode"].includes(key)) return [];
      const projected = projectScalarMetadata(child);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

function projectActor(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    ["type", "id", "email"].flatMap((key) => {
      const projected = projectScalarMetadata(record[key]);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

function projectExternalIds(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      if (!SAFE_ID_KEY.test(key)) return [];
      const projected = projectScalarMetadata(child);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

function projectScalarMetadata(value: unknown): string | number | boolean | null | unknown[] | undefined {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value as string | number | boolean | null;
  if (Array.isArray(value) && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) return value;
  return undefined;
}

function projectPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value.split(/[?#]/, 1)[0];
  const rootedVersion = path.match(/^\/(?:api\/)?(v[34])(?:\/|$)/)?.[1];
  if (!rootedVersion) return "/[REDACTED_ROUTE]";
  const prefix = path.startsWith("/api/") ? `/api/${rootedVersion}` : `/${rootedVersion}`;
  const staticRoutes = new Set([
    "/api/v4/oauth/token",
    "/api/v3/envs/actions/getextended",
    "/v4/oauth/token",
    "/v3/envs/actions/getextended",
  ]);
  if (staticRoutes.has(path)) return path;
  return `${prefix}/[REDACTED_ROUTE]`;
}

function projectHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/i.test(value) ? value : undefined;
}

function maskHeaderValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => Array.isArray(entry) && entry.length === 2
      ? [entry[0], REDACTED]
      : maskHeaderValues(entry));
  }
  if (!value || typeof value !== "object") return REDACTED;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).map((key) => [key, REDACTED]));
}
