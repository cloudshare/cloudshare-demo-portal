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
  const segments = path.split("/").filter(Boolean);
  const apiIndex = segments.findIndex((segment) => segment === "api");
  const versionIndex = apiIndex >= 0 ? apiIndex + 1 : (segments[0] === "v3" || segments[0] === "v4" ? 0 : -1);
  if (versionIndex < 0 || !["v3", "v4"].includes(segments[versionIndex] ?? "")) {
    return "/[REDACTED_ROUTE]";
  }
  const prefix = segments.slice(0, versionIndex + 1);
  const route = segments.slice(versionIndex + 1);
  const allowed = new Set([
    "oauth", "token", "projects", "experiences", "trainings", "guided-journeys", "properties", "students",
    "envs", "actions", "getextended", "extend", "blueprints", "policies", "regions", "participants",
  ]);
  if (route.length === 0) return `/${prefix.join("/")}`;
  if (route.some((segment) => !allowed.has(segment))) return `/${prefix.join("/")}/[REDACTED_ROUTE]`;
  return `/${[...prefix, ...route].join("/")}`;
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
