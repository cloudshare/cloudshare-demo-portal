import type { ZodType } from "zod";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "./errors";
import type { HttpClient, HttpRequest } from "./http";
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
}

function buildUrl(base: string, path: string, query?: Record<string, string>): string {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const sanitized = { ...headers };
  for (const [key, value] of Object.entries(headers)) {
    if (/signature/i.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (/authorization/i.test(key) && key !== "authorization") {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  const authorization = headers.authorization ?? headers.Authorization;
  if (authorization) {
    if (authorization.startsWith("Bearer ")) {
      sanitized.authorization = "Bearer [REDACTED]";
    } else if (authorization.startsWith("cs_sha1 ")) {
      sanitized.authorization = authorization
        .replace(/token:[^;]+/, "token:[REDACTED]")
        .replace(/hmac:[^;]+/, "hmac:[REDACTED]");
    } else {
      sanitized.authorization = "[REDACTED]";
    }
  }
  return sanitized;
}

function sanitizeResponseHeaders(
  headers: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> | undefined {
  if (!headers) {
    return undefined;
  }

  const sanitized = { ...headers };
  for (const key of Object.keys(headers)) {
    if (/signature/i.test(key)) {
      sanitized[key] = "[REDACTED]";
    }
  }
  const setCookie = headers["set-cookie"];
  if (setCookie) {
    sanitized["set-cookie"] = Array.isArray(setCookie)
      ? setCookie.map(() => "[REDACTED]")
      : "[REDACTED]";
  }
  return sanitized;
}

function sanitizeBody(body: string | undefined): unknown {
  if (body === undefined) {
    return undefined;
  }

  try {
    return redactSensitiveBodyFields(JSON.parse(body));
  } catch {
    return body;
  }
}

function sanitizeResponseBody(body: string): string {
  try {
    return JSON.stringify(redactSensitiveBodyFields(JSON.parse(body)));
  } catch {
    return redactSensitiveText(body);
  }
}

function sanitizeResponseBodyValue(body: string): unknown {
  try {
    return redactSensitiveBodyFields(JSON.parse(body));
  } catch {
    return redactSensitiveText(body);
  }
}

function redactSensitiveBodyFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveBodyFields);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (/api[-_]?key|secret|token|hmac|signature|passphrase|password|login[-_]?url/i.test(key)) {
      redacted[key] = "[REDACTED]";
      continue;
    }
    redacted[key] =
      typeof fieldValue === "string"
        ? redactSensitiveText(fieldValue)
        : redactSensitiveBodyFields(fieldValue);
  }
  return redacted;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/\S*(?:ClassSponsoredLink|SponsoredLink|Ent\/Login)\S*/gi, "[REDACTED]")
    .replace(/([?&](?:token|access_token|loginUrl)=)[^&\s"]+/gi, "$1[REDACTED]");
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

export function createCloudShareClient(opts: CloudShareClientOptions): CloudShareClient {
  function trace(
    level: "info" | "warn",
    message: string,
    request: HttpRequest,
    fields?: Record<string, unknown>,
  ): void {
    const requestInfo = describeRequest(request.url);
    const requestBody = sanitizeBody(request.body);
    opts.trace?.({
      level,
      message,
      fields: {
        operation: "cloudshare_http",
        method: request.method,
        host: requestInfo.host,
        path: requestInfo.path,
        integrationSurface: requestInfo.integrationSurface,
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
        requestHeaders: sanitizeHeaders(request.headers),
        ...(requestBody !== undefined ? { requestBody } : {}),
        ...fields,
      },
    });
  }

  async function executeDetailed<T>(
    request: HttpRequest,
    schema: ZodType<T, ZodType["_def"], unknown>,
  ): Promise<CloudShareDetailedResult<T>> {
    const requestInfo = describeRequest(request.url);
    trace("info", "cloudshare request sent", request);

    let response;
    try {
      response = await opts.http.send(request);
    } catch (cause) {
      trace("warn", "cloudshare transport failure", request, {
        failureMode: "transport",
        error: cause instanceof Error ? cause.message : String(cause),
      });
      throw new CloudShareTransportError(
        `CloudShare request to ${request.url} failed to reach the server`,
        {
          method: request.method,
          host: requestInfo.host,
          path: requestInfo.path,
          integrationSurface: requestInfo.integrationSurface,
          requestHeaders: sanitizeHeaders(request.headers),
          requestBody: sanitizeBody(request.body),
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      );
    }

    trace("info", "cloudshare response received", request, {
      responseStatus: response.status,
      responseHeaders: sanitizeResponseHeaders(response.headers),
      responseBody: sanitizeResponseBody(response.body),
      network: response.network,
      tls: response.tls,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CloudShareRequestError(
        `CloudShare request to ${request.url} returned ${response.status}`,
        response.status,
        {
          method: request.method,
          host: requestInfo.host,
          path: requestInfo.path,
          integrationSurface: requestInfo.integrationSurface,
          requestHeaders: sanitizeHeaders(request.headers),
          requestBody: sanitizeBody(request.body),
          responseHeaders: sanitizeResponseHeaders(response.headers),
          responseBody: sanitizeResponseBody(response.body),
          network: response.network,
          tls: response.tls,
        },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      throw new CloudShareResponseError(
        `CloudShare response from ${request.url} was not valid JSON`,
        {
          method: request.method,
          status: response.status,
          host: requestInfo.host,
          path: requestInfo.path,
          integrationSurface: requestInfo.integrationSurface,
          requestHeaders: sanitizeHeaders(request.headers),
          requestBody: sanitizeBody(request.body),
          responseHeaders: sanitizeResponseHeaders(response.headers),
          responseBody: sanitizeResponseBody(response.body),
          network: response.network,
          tls: response.tls,
        },
      );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new CloudShareResponseError(
        `CloudShare response from ${request.url} did not match the expected schema`,
        {
          method: request.method,
          host: requestInfo.host,
          path: requestInfo.path,
          integrationSurface: requestInfo.integrationSurface,
          requestHeaders: sanitizeHeaders(request.headers),
          requestBody: sanitizeBody(request.body),
          responseHeaders: sanitizeResponseHeaders(response.headers),
          responseBody: sanitizeResponseBody(response.body),
          network: response.network,
          tls: response.tls,
          issues: parsed.error.issues.map((i) => i.message),
        },
      );
    }
    return {
      data: parsed.data,
      host: requestInfo.host,
      integrationSurface: requestInfo.integrationSurface,
      request: {
        method: request.method,
        path: requestInfo.path,
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
        body: sanitizeResponseBodyValue(response.body),
        ...(response.network ? { network: response.network } : {}),
        ...(response.tls ? { tls: response.tls } : {}),
      },
    };
  }

  async function performV4Detailed<T>(
    spec: V4RequestSpec<T>,
  ): Promise<CloudShareDetailedResult<T>> {
    const token = await opts.tokenProvider.getToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(spec.body);
    }
    return executeDetailed(
      {
        method: spec.method,
        url: buildUrl(opts.endpoints.v4BaseUrl, spec.path, spec.query),
        headers,
        body,
      },
      spec.schema,
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

    trace("info", "cloudshare request sent", request);
    const requestInfo = describeRequest(request.url);

    let response;
    try {
      response = await opts.http.send(request);
    } catch (cause) {
      trace("warn", "cloudshare transport failure", request, {
        failureMode: "transport",
        error: cause instanceof Error ? cause.message : String(cause),
      });
      throw new CloudShareTransportError(
        `CloudShare request to ${unsignedUrl} failed to reach the server`,
        {
          method: spec.method,
          host: requestInfo.host,
          path: requestInfo.path,
          integrationSurface: requestInfo.integrationSurface,
          requestHeaders: sanitizeHeaders(request.headers),
          requestBody: sanitizeBody(request.body),
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      );
    }

    trace("info", "cloudshare response received", request, {
      responseStatus: response.status,
      responseHeaders: sanitizeResponseHeaders(response.headers),
      responseBody: sanitizeResponseBody(response.body),
      network: response.network,
      tls: response.tls,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CloudShareRequestError(
        `CloudShare request to ${unsignedUrl} returned ${response.status}`,
        response.status,
        {
          method: spec.method,
          host: requestInfo.host,
          path: requestInfo.path,
          integrationSurface: requestInfo.integrationSurface,
          requestHeaders: sanitizeHeaders(request.headers),
          requestBody: sanitizeBody(request.body),
          responseHeaders: sanitizeResponseHeaders(response.headers),
          responseBody: sanitizeResponseBody(response.body),
          network: response.network,
          tls: response.tls,
        },
      );
    }

    return {
      data: response.body,
      host: requestInfo.host,
      integrationSurface: requestInfo.integrationSurface,
      request: {
        method: request.method,
        path: requestInfo.path,
        ...(sanitizeHeaders(request.headers)
          ? { headers: sanitizeHeaders(request.headers)! }
          : {}),
      },
      response: {
        status: response.status,
        ...(sanitizeResponseHeaders(response.headers)
          ? { headers: sanitizeResponseHeaders(response.headers)! }
          : {}),
        body: sanitizeResponseBodyValue(response.body),
        ...(response.network ? { network: response.network } : {}),
        ...(response.tls ? { tls: response.tls } : {}),
      },
    };
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
