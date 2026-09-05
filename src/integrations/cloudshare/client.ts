import type { ZodType } from "zod";
import { projectProtectedRequestHeaders as sanitizeHeaders } from "@/observability/protected-request-headers";
import {
  CloudShareRateLimitError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "./errors";
import { HttpTransportError, type HttpClient, type HttpRequest } from "./http";
import { buildV3AuthorizationHeader, signV3Request } from "./signing";
import type { V4TokenProvider } from "./v4-auth";

/**
 * The CloudShare adapter seam. Every other layer talks to CloudShare only
 * through this typed client — no layer touches CloudShare HTTP, auth, or wire
 * formats directly. The client owns:
 *  - v4 (Accelerate) requests authenticated with a cached Bearer token.
 *  - v3 (Production) requests signed with per-call `cs_sha1` params.
 *  - Zod validation of every response at the boundary.
 *  - mapping of every failure to a typed {@link CloudShareError}.
 *
 * Live vs fixture mode is chosen purely by which {@link HttpClient} is injected;
 * the code path below is identical either way.
 */

export interface CloudShareEndpoints {
  /** e.g. `https://use.cloudshare.com/api/v4` */
  readonly v4BaseUrl: string;
  /** e.g. `https://use.cloudshare.com/api/v3` */
  readonly v3BaseUrl: string;
}

type Method = HttpRequest["method"];

export interface V4RequestSpec<T> {
  readonly method: Method;
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
  /** Opt in only for documented v4 operations whose successful response has no body. */
  readonly allowEmptyResponse?: boolean;
  readonly schema: ZodType<T, ZodType["_def"], unknown>;
}

export interface V3RequestSpec<T> {
  readonly method: Method;
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly schema: ZodType<T, ZodType["_def"], unknown>;
}

export interface CloudShareRequestDiagnostics {
  readonly method: Method;
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

export interface CloudShareResponseDiagnostics {
  readonly status: number;
  readonly headers?: Record<string, string | string[]>;
  readonly body: unknown;
  readonly network?: {
    readonly localAddress?: string;
    readonly localFamily?: string;
    readonly localPort?: number;
    readonly remoteAddress?: string;
    readonly remoteFamily?: string;
    readonly remotePort?: number;
    readonly transport?: string;
  };
  readonly tls?: {
    readonly protocol?: string;
    readonly cipher?: unknown;
    readonly authorized?: boolean;
    readonly authorizationError?: string | null;
  };
}

export interface CloudShareDetailedResult<T> {
  readonly data: T;
  readonly host: string;
  readonly integrationSurface: string;
  readonly request: CloudShareRequestDiagnostics;
  readonly response: CloudShareResponseDiagnostics;
}

export interface CloudShareRequestObservation {
  readonly occurredAt: string;
  readonly outcome: "success" | "failure";
  readonly durationMs: number;
  readonly result?: CloudShareDetailedResult<unknown>;
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly context?: Record<string, unknown>;
  };
}

export interface CloudShareRequestObserver {
  readonly onRequest: (event: CloudShareRequestObservation) => Promise<void> | void;
}

/** Explicit opt-out for tests and isolated probes that do not persist diagnostics. */
export function createCloudShareNoopRequestObserver(): CloudShareRequestObserver {
  return { onRequest: () => undefined };
}

export interface CloudShareClient {
  requestV4<T>(spec: V4RequestSpec<T>): Promise<T>;
  requestV3<T>(spec: V3RequestSpec<T>): Promise<T>;
  requestV3Text(spec: Omit<V3RequestSpec<never>, "schema">): Promise<string>;
  requestV4Detailed?<T>(spec: V4RequestSpec<T>): Promise<CloudShareDetailedResult<T>>;
  requestV3Detailed?<T>(spec: V3RequestSpec<T>): Promise<CloudShareDetailedResult<T>>;
  requestV3TextDetailed?(
    spec: Omit<V3RequestSpec<never>, "schema">,
  ): Promise<CloudShareDetailedResult<string>>;
}

export interface CloudShareClientOptions {
  readonly http: HttpClient;
  readonly endpoints: CloudShareEndpoints;
  readonly tokenProvider: V4TokenProvider;
  readonly v3: { readonly apiId: string; readonly apiKey: string };
  readonly customerId?: string;
  readonly trace?: (event: {
    readonly level: "info" | "warn";
    readonly message: string;
    readonly fields: Record<string, unknown>;
  }) => void;
  /** Injectable clock for v3 signing. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injectable token generator for v3 signing. Defaults to a random UUID. */
  readonly newToken?: () => string;
  /** Injectable sleeper for bounded read retries. Defaults to `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable randomness for jittered backoff. Defaults to `Math.random`. */
  readonly random?: () => number;
  /** Shared per-process/customer cooldown store. */
  readonly cooldownStore?: CloudShareRateLimitCooldownStore;
  readonly observer: CloudShareRequestObserver;
}

interface CloudShareRateLimitCooldown {
  readonly untilEpochMs: number;
  readonly classification: "rate_limit" | "abuse_protection";
  readonly retryAfterSeconds?: number;
  readonly rateLimitHeaders?: Record<string, string | string[]>;
  /** Redacted evidence from the response that started the cooldown. */
  readonly responseHeaders?: Record<string, string | string[]>;
  readonly responseBody?: unknown;
}

export interface CloudShareRateLimitCooldownStore {
  get(customerId: string): CloudShareRateLimitCooldown | null;
  set(customerId: string, cooldown: CloudShareRateLimitCooldown): void;
  clear(customerId: string): void;
}

function createInMemoryCooldownStore(): CloudShareRateLimitCooldownStore {
  const byCustomerId = new Map<string, CloudShareRateLimitCooldown>();
  return {
    get(customerId) {
      return byCustomerId.get(customerId) ?? null;
    },
    set(customerId, cooldown) {
      byCustomerId.set(customerId, cooldown);
    },
    clear(customerId) {
      byCustomerId.delete(customerId);
    },
  };
}

const globalCooldownStore = createInMemoryCooldownStore();
const MAX_READ_RETRY_ATTEMPTS = 1;
const MAX_READ_RETRY_DELAY_MS = 5_000;
const DEFAULT_COOLDOWN_MS = 30_000;

function buildUrl(base: string, path: string, query?: Record<string, string>): string {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function sanitizeQuery(query: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!query) {
    return undefined;
  }
  return { ...query };
}

function sanitizeResponseHeaders(
  headers: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> | undefined {
  if (!headers) {
    return undefined;
  }

  const sanitized = { ...headers };
  const setCookie = headers["set-cookie"] ?? headers["Set-Cookie"];
  if (setCookie) {
    sanitized["set-cookie"] = Array.isArray(setCookie) ? setCookie.map(() => "[REDACTED]") : "[REDACTED]";
    delete sanitized["Set-Cookie"];
  }
  return sanitized;
}

function isHeaderMap(value: unknown): value is Record<string, string | string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value as Record<string, unknown>).every(
      (entry) => typeof entry === "string" || (Array.isArray(entry) && entry.every((item) => typeof item === "string")),
    )
  );
}

function sanitizeBody(body: string | undefined): unknown {
  if (body === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function sanitizeResponseBody(body: string, _requestPath: string): string {
  return body;
}

function sanitizeResponseBodyValue(body: string, _requestPath: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}


function sanitizeRequestEvidenceBody(body: string | undefined): unknown {
  return sanitizeBody(body);
}

function sanitizeResponseEvidenceBody(body: string, requestPath: string): unknown {
  return sanitizeResponseBodyValue(body, requestPath);
}

function describeRequest(urlText: string): {
  readonly host: string;
  readonly path: string;
  readonly integrationSurface: string;
} {
  const url = new URL(urlText);
  const path = url.pathname;

  return {
    host: url.host,
    path,
    integrationSurface: path.startsWith("/api/v3/")
      ? "cloudshare.v3"
      : path.startsWith("/v4/")
        ? "cloudshare.v4"
        : "cloudshare.http",
  };
}

const REDACTED_SALES_ROUTE = "[REDACTED_ROUTE]";
const documentedSalesTracePatterns = [
  ["salespros"],
  ["salespros", "invite"],
  ["salespros", "email-template"],
  ["salespros", "{salesProId}"],
  ["participants"],
  ["participants", "invite"],
  ["participants", "email-template"],
  ["participants", "unassigned-environment"],
  ["participants", "{participantId}"],
  ["participants", "{participantId}", "unassigned-environment"],
  ["sponsored-link"],
  ["users", "properties"],
  ["users", "properties", "{propertyId}"],
  ["students", "participants", "{participantId}", "environment"],
  ["assign-shared-env-controlling-user"],
] as const;

function sanitizeOrdinaryTracePath(path: string): string {
  const safeStaticPaths = new Set([
    "/v4/experiences", "/v4/projects", "/v4/regions", "/v4/sales", "/v4/teams", "/v4/trainings",
    "/api/v3/envs", "/api/v3/envs/actions/archive", "/api/v3/envs/actions/extend",
    "/api/v3/envs/actions/getextended", "/api/v3/envs/actions/resume", "/api/v3/envs/actions/suspend",
    "/api/v3/ping", "/api/v3/projects", "/api/v3/regions", "/api/v3/timezones",
  ]);
  if (safeStaticPaths.has(path)) return path;
  const v4Training = path.match(/^\/v4\/trainings\/([^/]+)(?:\/(.*))?$/);
  if (v4Training) return "/v4/trainings/{trainingId}";
  const v3Environment = path.match(/^\/api\/v3\/envs\/([^/]+)(?:\/(.*))?$/);
  if (v3Environment) return "/api/v3/envs/{environmentId}";
  for (const prefix of ["/v4/projects/", "/v4/experiences/", "/v4/guided-journey/"]) {
    if (path.startsWith(prefix)) return `${prefix}{providerId}`;
  }
  const match = path.match(/^\/v4\/sales\/([^/]+)(?:\/(.*))?$/);
  if (!match) {
    if (path.startsWith("/v4/")) return "/v4/[REDACTED_ROUTE]";
    if (path.startsWith("/api/v3/")) return "/api/v3/[REDACTED_ROUTE]";
    return REDACTED_SALES_ROUTE;
  }

  const tail = match[2];
  if (!tail) {
    return "/v4/sales/{salesId}";
  }

  const segments = tail.split("/");
  const salesBase = "/v4/sales/{salesId}";
  const matches = (pattern: readonly string[]) =>
    pattern.length === segments.length &&
    pattern.every((part, index) => part.startsWith("{") || part === segments[index]);

  const render = (pattern: readonly string[]) =>
    `${salesBase}/${pattern.map((part, index) => part.startsWith("{") ? part : segments[index]!).join("/")}`;

  for (const pattern of documentedSalesTracePatterns) {
    if (matches(pattern)) {
      return render(pattern);
    }
  }

  return `${salesBase}/${REDACTED_SALES_ROUTE}`;
}

export function createCloudShareClient(opts: CloudShareClientOptions): CloudShareClient {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = opts.random ?? Math.random;
  const cooldownStore = opts.cooldownStore ?? globalCooldownStore;

  function trace(
    level: "info" | "warn",
    message: string,
    request: HttpRequest,
    fields?: Record<string, unknown>,
  ): void {
    const requestInfo = describeRequest(request.url);
    const { responseBody: _responseBody, responseHeaders: _responseHeaders, ...safeFields } = fields ?? {};
    opts.trace?.({
      level,
      message,
      fields: {
        operation: "cloudshare_http",
        method: request.method,
        host: requestInfo.host,
        path: sanitizeOrdinaryTracePath(requestInfo.path),
        integrationSurface: requestInfo.integrationSurface,
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
        requestHeaders: sanitizeHeaders(request.headers),
        ...safeFields,
      },
    });
  }

  function getNowMs(): number {
    return (opts.now ?? Date.now)();
  }

  function parseRetryAfterSeconds(
    headers: Record<string, string | string[]> | undefined,
  ): number | undefined {
    const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (!first) {
      return undefined;
    }

    const numeric = Number(first);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }

    const retryAt = Date.parse(first);
    if (!Number.isNaN(retryAt)) {
      const seconds = Math.ceil((retryAt - getNowMs()) / 1_000);
      return seconds > 0 ? seconds : 0;
    }

    return undefined;
  }

  function extractRateLimitHeaders(
    headers: Record<string, string | string[]> | undefined,
  ): Record<string, string | string[]> | undefined {
    if (!headers) {
      return undefined;
    }

    const result = Object.fromEntries(
      Object.entries(headers).filter(([key]) => /retry-after|rate.?limit|throttle/i.test(key)),
    );
    return Object.keys(result).length > 0 ? result : undefined;
  }

  function classifyRateLimit(
    status: number,
    headers: Record<string, string | string[]> | undefined,
    body: string,
  ): {
    readonly classification: "rate_limit" | "abuse_protection";
    readonly retryAfterSeconds?: number;
    readonly rateLimitHeaders?: Record<string, string | string[]>;
  } | null {
    const normalizedBody = body.toLowerCase();
    const classification =
      status === 429
        ? "rate_limit"
        : status === 403 && /\babuse(?:\s|-)?(?:list|protection)\b/.test(normalizedBody)
          ? "abuse_protection"
          : null;

    if (!classification) {
      return null;
    }

    return {
      classification,
      retryAfterSeconds: parseRetryAfterSeconds(headers),
      rateLimitHeaders: extractRateLimitHeaders(sanitizeResponseHeaders(headers)),
    };
  }

  function updateCooldownFromRateLimit(error: CloudShareRateLimitError): void {
    if (!opts.customerId) {
      return;
    }

    const retryAfterSeconds = error.retryAfterSeconds;
    const cooldownMs =
      retryAfterSeconds !== undefined
        ? Math.max(0, retryAfterSeconds * 1_000)
        : DEFAULT_COOLDOWN_MS;

    cooldownStore.set(opts.customerId, {
      untilEpochMs: getNowMs() + cooldownMs,
      classification: error.classification,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      ...(error.rateLimitHeaders ? { rateLimitHeaders: error.rateLimitHeaders } : {}),
      ...(isHeaderMap(error.context?.responseHeaders)
        ? { responseHeaders: error.context.responseHeaders }
        : {}),
      ...(error.context?.responseBody !== undefined
        ? { responseBody: error.context.responseBody }
        : {}),
    });
  }

  function getActiveCooldown(): CloudShareRateLimitCooldown | null {
    if (!opts.customerId) {
      return null;
    }

    const cooldown = cooldownStore.get(opts.customerId);
    if (!cooldown) {
      return null;
    }

    if (cooldown.untilEpochMs <= getNowMs()) {
      cooldownStore.clear(opts.customerId);
      return null;
    }

    return cooldown;
  }

  function clearCooldown(): void {
    if (opts.customerId) {
      cooldownStore.clear(opts.customerId);
    }
  }

  function throwIfCooldownActive(
    request: HttpRequest,
    requestInfo: ReturnType<typeof describeRequest>,
  ): void {
    const cooldown = getActiveCooldown();
    if (!cooldown) {
      return;
    }

    throw new CloudShareRateLimitError(
      `CloudShare requests for customer ${opts.customerId} are temporarily cooling down after rate limiting`,
      429,
      cooldown.classification,
      {
        method: request.method,
        host: requestInfo.host,
        path: requestInfo.path,
        integrationSurface: requestInfo.integrationSurface,
        requestQuery: sanitizeQuery(extractQuery(request.url)),
        requestHeaders: sanitizeHeaders(request.headers),
        cooldownActive: true,
        retryAfterSeconds: Math.max(
          0,
          Math.ceil((cooldown.untilEpochMs - getNowMs()) / 1_000),
        ),
        ...(cooldown.rateLimitHeaders ? { rateLimitHeaders: cooldown.rateLimitHeaders } : {}),
        ...(cooldown.responseHeaders
          ? { responseHeaders: cooldown.responseHeaders }
          : cooldown.rateLimitHeaders
            ? { responseHeaders: cooldown.rateLimitHeaders }
            : {}),
        ...(cooldown.responseBody !== undefined ? { responseBody: cooldown.responseBody } : {}),
      },
    );
  }

  function computeReadRetryDelayMs(error: CloudShareRateLimitError): number | null {
    if (error.retryAfterSeconds !== undefined) {
      const delayMs = error.retryAfterSeconds * 1_000;
      return delayMs <= MAX_READ_RETRY_DELAY_MS ? delayMs : null;
    }

    return 250 + Math.floor(random() * 500);
  }

  function isSafeRead(method: Method): boolean {
    return method === "GET";
  }

  function transportContext(cause: unknown): Record<string, unknown> {
    if (cause instanceof HttpTransportError) {
      return {
        cause: cause.cause instanceof Error ? { name: cause.cause.name, message: cause.cause.message } : String(cause.cause),
        ...(cause.network ? { network: cause.network } : {}),
        ...(cause.tls ? { tls: cause.tls } : {}),
      };
    }
    return { cause: cause instanceof Error ? { name: cause.name, message: cause.message } : String(cause) };
  }

  async function executeDetailed<T>(
    request: HttpRequest,
    schema: ZodType<T, ZodType["_def"], unknown>,
    allowEmptyResponse = false,
  ): Promise<CloudShareDetailedResult<T>> {
    const requestInfo = describeRequest(request.url);
    for (let attempt = 0; ; attempt += 1) {
      const attemptStartedAtMs = getNowMs();
      const attemptOccurredAt = new Date(attemptStartedAtMs).toISOString();
      const observeAttemptFailure = async (error: unknown): Promise<void> => {
        await notifyRequest({
          occurredAt: attemptOccurredAt,
          outcome: "failure",
          durationMs: Math.max(0, getNowMs() - attemptStartedAtMs),
          error: {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
            context: error instanceof CloudShareRequestError || error instanceof CloudShareResponseError || error instanceof CloudShareTransportError || error instanceof CloudShareRateLimitError ? error.context : undefined,
          },
        });
      };
      if (attempt === 0) {
        throwIfCooldownActive(request, requestInfo);
      }

      trace("info", "cloudshare request sent", request);

      let response;
      try {
        response = await opts.http.send(request);
      } catch (cause) {
        trace("warn", "cloudshare transport failure", request, {
          failureMode: "transport",
          error: cause instanceof Error ? cause.message : String(cause),
        });
        const error = new CloudShareTransportError(
          `CloudShare request to ${request.url} failed to reach the server`,
          {
            method: request.method,
            host: requestInfo.host,
            path: requestInfo.path,
            integrationSurface: requestInfo.integrationSurface,
            requestQuery: sanitizeQuery(extractQuery(request.url)),
            requestHeaders: sanitizeHeaders(request.headers),
            requestBody: sanitizeRequestEvidenceBody(request.body),
            ...transportContext(cause),
          },
        );
        await observeAttemptFailure(error);
        throw error;
      }

      trace("info", "cloudshare response received", request, {
        responseStatus: response.status,
        responseHeaders: sanitizeResponseHeaders(response.headers),
        responseBody: sanitizeResponseBody(response.body, requestInfo.path),
        network: response.network,
        tls: response.tls,
      });

      if (response.status < 200 || response.status >= 300) {
        const context = {
          method: request.method,
          host: requestInfo.host,
          path: requestInfo.path,
          integrationSurface: requestInfo.integrationSurface,
          requestQuery: sanitizeQuery(extractQuery(request.url)),
          requestHeaders: sanitizeHeaders(request.headers),
          requestBody: sanitizeRequestEvidenceBody(request.body),
          responseHeaders: sanitizeResponseHeaders(response.headers),
          responseBody: sanitizeResponseEvidenceBody(response.body, requestInfo.path),
          network: response.network,
          tls: response.tls,
        };
        const rateLimit = classifyRateLimit(response.status, response.headers, response.body);
        if (rateLimit) {
          const rateLimitError = new CloudShareRateLimitError(
            `CloudShare request to ${request.url} returned ${response.status}`,
            response.status,
            rateLimit.classification,
            {
              ...context,
              ...(rateLimit.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
                : {}),
              ...(rateLimit.rateLimitHeaders ? { rateLimitHeaders: rateLimit.rateLimitHeaders } : {}),
            },
          );
          updateCooldownFromRateLimit(rateLimitError);
          await observeAttemptFailure(rateLimitError);
          if (isSafeRead(request.method) && attempt < MAX_READ_RETRY_ATTEMPTS) {
            const delayMs = computeReadRetryDelayMs(rateLimitError);
            if (delayMs !== null) {
              await sleep(delayMs);
              continue;
            }
          }
          throw rateLimitError;
        }

        const error = new CloudShareRequestError(
          `CloudShare request to ${request.url} returned ${response.status}`,
          response.status,
          context,
        );
        await observeAttemptFailure(error);
        throw error;
      }

      let json: unknown;
      try {
        json = response.body.trim() === "" && allowEmptyResponse ? undefined : JSON.parse(response.body);
      } catch {
        const error = new CloudShareResponseError(
          `CloudShare response from ${request.url} was not valid JSON`,
          {
            method: request.method,
            status: response.status,
            host: requestInfo.host,
            path: requestInfo.path,
            integrationSurface: requestInfo.integrationSurface,
            requestQuery: sanitizeQuery(extractQuery(request.url)),
            requestHeaders: sanitizeHeaders(request.headers),
            requestBody: sanitizeRequestEvidenceBody(request.body),
            responseHeaders: sanitizeResponseHeaders(response.headers),
            responseBody: sanitizeResponseEvidenceBody(response.body, requestInfo.path),
            network: response.network,
            tls: response.tls,
          },
        );
        await observeAttemptFailure(error);
        throw error;
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const error = new CloudShareResponseError(
          `CloudShare response from ${request.url} did not match the expected schema`,
          {
            method: request.method,
            status: response.status,
            host: requestInfo.host,
            path: requestInfo.path,
            integrationSurface: requestInfo.integrationSurface,
            requestQuery: sanitizeQuery(extractQuery(request.url)),
            requestHeaders: sanitizeHeaders(request.headers),
            requestBody: sanitizeRequestEvidenceBody(request.body),
            responseHeaders: sanitizeResponseHeaders(response.headers),
            responseBody: sanitizeResponseEvidenceBody(response.body, requestInfo.path),
            network: response.network,
            tls: response.tls,
            issues: parsed.error.issues.map((i) => i.message),
          },
        );
        await observeAttemptFailure(error);
        throw error;
      }
      clearCooldown();
      const requestQuery = sanitizeQuery(extractQuery(request.url));
      const result = {
        data: parsed.data,
        host: requestInfo.host,
        integrationSurface: requestInfo.integrationSurface,
        request: {
          method: request.method,
          path: requestInfo.path,
          ...(requestQuery ? { query: requestQuery } : {}),
          ...(sanitizeHeaders(request.headers)
            ? { headers: sanitizeHeaders(request.headers)! }
            : {}),
          ...(sanitizeBody(request.body) !== undefined
            ? { body: sanitizeBody(request.body) }
            : {}),
        },
        response: {
          status: response.status,
          ...(sanitizeResponseHeaders(response.headers)
            ? { headers: sanitizeResponseHeaders(response.headers)! }
            : {}),
          body: sanitizeResponseBodyValue(response.body, requestInfo.path),
          ...(response.network ? { network: response.network } : {}),
          ...(response.tls ? { tls: response.tls } : {}),
        },
      };
      await notifyRequest({ occurredAt: attemptOccurredAt, outcome: "success", durationMs: Math.max(0, getNowMs() - attemptStartedAtMs), result });
      return result;
    }
  }

  async function performV4Detailed<T>(
    spec: V4RequestSpec<T>,
  ): Promise<CloudShareDetailedResult<T>> {
    const url = buildUrl(opts.endpoints.v4BaseUrl, spec.path, spec.query);
    const requestInfo = describeRequest(url);
    throwIfCooldownActive(
      {
        method: spec.method,
        url,
        headers: {},
        ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
      },
      requestInfo,
    );

    let token: string;
    try {
      token = await opts.tokenProvider.getToken();
    } catch (error) {
      if (isCloudShareRateLimitError(error)) {
        updateCooldownFromRateLimit(error as CloudShareRateLimitError);
      }
      throw error;
    }
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(spec.body);
    }
    return executeDetailed(
      {
        method: spec.method,
        url,
        headers,
        body,
      },
      spec.schema,
      spec.allowEmptyResponse,
    );
  }

  async function performV3Detailed<T>(
    spec: V3RequestSpec<T>,
  ): Promise<CloudShareDetailedResult<T>> {
    const unsignedUrl = buildUrl(opts.endpoints.v3BaseUrl, spec.path, spec.query);
    const auth = signV3Request({
      apiId: opts.v3.apiId,
      apiKey: opts.v3.apiKey,
      fullUrl: unsignedUrl,
      now: opts.now,
      newToken: opts.newToken,
    });
    return executeDetailed(
      {
        method: spec.method,
        url: unsignedUrl,
        headers: {
          authorization: buildV3AuthorizationHeader(auth),
        },
      },
      spec.schema,
    );
  }

  async function performV3TextDetailed(
    spec: Omit<V3RequestSpec<never>, "schema">,
  ): Promise<CloudShareDetailedResult<string>> {
    const unsignedUrl = buildUrl(opts.endpoints.v3BaseUrl, spec.path, spec.query);
    const auth = signV3Request({
      apiId: opts.v3.apiId,
      apiKey: opts.v3.apiKey,
      fullUrl: unsignedUrl,
      now: opts.now,
      newToken: opts.newToken,
    });
    const request: HttpRequest = {
      method: spec.method,
      url: unsignedUrl,
      headers: {
        authorization: buildV3AuthorizationHeader(auth),
      },
    };

    const requestInfo = describeRequest(request.url);
    for (let attempt = 0; ; attempt += 1) {
      const attemptStartedAtMs = getNowMs();
      const attemptOccurredAt = new Date(attemptStartedAtMs).toISOString();
      const observeTextFailure = async (error: unknown): Promise<void> => {
        await notifyRequest({ occurredAt: attemptOccurredAt, outcome: "failure", durationMs: Math.max(0, getNowMs() - attemptStartedAtMs), error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error), context: error instanceof CloudShareRequestError || error instanceof CloudShareResponseError || error instanceof CloudShareTransportError || error instanceof CloudShareRateLimitError ? error.context : undefined } });
      };
      if (attempt === 0) {
        throwIfCooldownActive(request, requestInfo);
      }

      trace("info", "cloudshare request sent", request);

      let response;
      try {
        response = await opts.http.send(request);
      } catch (cause) {
        trace("warn", "cloudshare transport failure", request, {
          failureMode: "transport",
          error: cause instanceof Error ? cause.message : String(cause),
        });
        const error = new CloudShareTransportError(
          `CloudShare request to ${unsignedUrl} failed to reach the server`,
          {
            method: spec.method,
            host: requestInfo.host,
            path: requestInfo.path,
            integrationSurface: requestInfo.integrationSurface,
            requestQuery: sanitizeQuery(extractQuery(request.url)),
            requestHeaders: sanitizeHeaders(request.headers),
            requestBody: sanitizeBody(request.body),
            ...transportContext(cause),
          },
        );
        await observeTextFailure(error);
        throw error;
      }

      trace("info", "cloudshare response received", request, {
        responseStatus: response.status,
        responseHeaders: sanitizeResponseHeaders(response.headers),
        responseBody: sanitizeResponseBody(response.body, requestInfo.path),
        network: response.network,
        tls: response.tls,
      });

      if (response.status < 200 || response.status >= 300) {
        const context = {
          method: spec.method,
          host: requestInfo.host,
          path: requestInfo.path,
          integrationSurface: requestInfo.integrationSurface,
          requestQuery: sanitizeQuery(extractQuery(request.url)),
          requestHeaders: sanitizeHeaders(request.headers),
          requestBody: sanitizeBody(request.body),
          responseHeaders: sanitizeResponseHeaders(response.headers),
          responseBody: sanitizeResponseBodyValue(response.body, requestInfo.path),
          network: response.network,
          tls: response.tls,
        };
        const rateLimit = classifyRateLimit(response.status, response.headers, response.body);
        if (rateLimit) {
          const rateLimitError = new CloudShareRateLimitError(
            `CloudShare request to ${unsignedUrl} returned ${response.status}`,
            response.status,
            rateLimit.classification,
            {
              ...context,
              ...(rateLimit.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
                : {}),
              ...(rateLimit.rateLimitHeaders ? { rateLimitHeaders: rateLimit.rateLimitHeaders } : {}),
            },
          );
          updateCooldownFromRateLimit(rateLimitError);
          await observeTextFailure(rateLimitError);
          if (isSafeRead(request.method) && attempt < MAX_READ_RETRY_ATTEMPTS) {
            const delayMs = computeReadRetryDelayMs(rateLimitError);
            if (delayMs !== null) {
              await sleep(delayMs);
              continue;
            }
          }
          throw rateLimitError;
        }

        const error = new CloudShareRequestError(
          `CloudShare request to ${unsignedUrl} returned ${response.status}`,
          response.status,
          context,
        );
        await observeTextFailure(error);
        throw error;
      }

      clearCooldown();
      const requestQuery = sanitizeQuery(extractQuery(request.url));
      const result = {
        data: response.body,
        host: requestInfo.host,
        integrationSurface: requestInfo.integrationSurface,
        request: {
          method: request.method,
          path: requestInfo.path,
          ...(requestQuery ? { query: requestQuery } : {}),
          ...(sanitizeHeaders(request.headers)
            ? { headers: sanitizeHeaders(request.headers)! }
            : {}),
        },
        response: {
          status: response.status,
          ...(sanitizeResponseHeaders(response.headers)
            ? { headers: sanitizeResponseHeaders(response.headers)! }
            : {}),
          body: sanitizeResponseBodyValue(response.body, requestInfo.path),
          ...(response.network ? { network: response.network } : {}),
          ...(response.tls ? { tls: response.tls } : {}),
        },
      };
      await notifyRequest({ occurredAt: attemptOccurredAt, outcome: "success", durationMs: Math.max(0, getNowMs() - attemptStartedAtMs), result });
      return result;
    }
  }

  async function notifyRequest(event: CloudShareRequestObservation): Promise<void> {
    try {
      await opts.observer.onRequest(event);
    } catch {
      // Diagnostics must not break CloudShare traffic.
    }
  }

  return {
    async requestV4<T>(spec: V4RequestSpec<T>): Promise<T> {
      const result = await performV4Detailed(spec);
      return result.data;
    },

    async requestV4Detailed<T>(spec: V4RequestSpec<T>): Promise<CloudShareDetailedResult<T>> {
      return performV4Detailed(spec);
    },

    async requestV3<T>(spec: V3RequestSpec<T>): Promise<T> {
      const result = await performV3Detailed(spec);
      return result.data;
    },

    async requestV3Detailed<T>(spec: V3RequestSpec<T>): Promise<CloudShareDetailedResult<T>> {
      return performV3Detailed(spec);
    },

    async requestV3Text(spec: Omit<V3RequestSpec<never>, "schema">): Promise<string> {
      const result = await performV3TextDetailed(spec);
      return result.data;
    },

    async requestV3TextDetailed(
      spec: Omit<V3RequestSpec<never>, "schema">,
    ): Promise<CloudShareDetailedResult<string>> {
      return performV3TextDetailed(spec);
    },
  };
}

function extractQuery(urlText: string): Record<string, string> | undefined {
  const url = new URL(urlText);
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = value;
  }
  return Object.keys(query).length > 0 ? query : undefined;
}
