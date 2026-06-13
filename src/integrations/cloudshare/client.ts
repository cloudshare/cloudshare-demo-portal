import type { ZodType } from "zod";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "./errors";
import type { HttpClient, HttpRequest } from "./http";
import { signV3Request } from "./signing";
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
  readonly schema: ZodType<T>;
}

export interface V3RequestSpec<T> {
  readonly method: Method;
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly schema: ZodType<T>;
}

export interface CloudShareClient {
  requestV4<T>(spec: V4RequestSpec<T>): Promise<T>;
  requestV3<T>(spec: V3RequestSpec<T>): Promise<T>;
  requestV3Text(spec: Omit<V3RequestSpec<never>, "schema">): Promise<string>;
}

export interface CloudShareClientOptions {
  readonly http: HttpClient;
  readonly endpoints: CloudShareEndpoints;
  readonly tokenProvider: V4TokenProvider;
  readonly v3: { readonly apiId: string; readonly apiKey: string };
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

export function createCloudShareClient(opts: CloudShareClientOptions): CloudShareClient {
  async function execute<T>(
    request: HttpRequest,
    schema: ZodType<T>,
  ): Promise<T> {
    let response;
    try {
      response = await opts.http.send(request);
    } catch (cause) {
      throw new CloudShareTransportError(
        `CloudShare request to ${request.url} failed to reach the server`,
        {
          method: request.method,
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw new CloudShareRequestError(
        `CloudShare request to ${request.url} returned ${response.status}`,
        response.status,
        { method: request.method },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      throw new CloudShareResponseError(
        `CloudShare response from ${request.url} was not valid JSON`,
        { method: request.method, status: response.status },
      );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new CloudShareResponseError(
        `CloudShare response from ${request.url} did not match the expected schema`,
        { method: request.method, issues: parsed.error.issues.map((i) => i.message) },
      );
    }
    return parsed.data;
  }

  return {
    async requestV4<T>(spec: V4RequestSpec<T>): Promise<T> {
      const token = await opts.tokenProvider.getToken();
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      let body: string | undefined;
      if (spec.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(spec.body);
      }
      return execute(
        {
          method: spec.method,
          url: buildUrl(opts.endpoints.v4BaseUrl, spec.path, spec.query),
          headers,
          body,
        },
        spec.schema,
      );
    },

    async requestV3<T>(spec: V3RequestSpec<T>): Promise<T> {
      const unsignedUrl = buildUrl(opts.endpoints.v3BaseUrl, spec.path, spec.query);
      const auth = signV3Request({
        apiId: opts.v3.apiId,
        apiKey: opts.v3.apiKey,
        fullUrl: unsignedUrl,
        now: opts.now,
        newToken: opts.newToken,
      });
      const signedUrl = buildUrl(opts.endpoints.v3BaseUrl, spec.path, {
        ...spec.query,
        UserApiId: auth.UserApiId,
        Timestamp: auth.Timestamp,
        Token: auth.Token,
        HMAC: auth.HMAC,
      });
      return execute({ method: spec.method, url: signedUrl }, spec.schema);
    },

    async requestV3Text(spec: Omit<V3RequestSpec<never>, "schema">): Promise<string> {
      const unsignedUrl = buildUrl(opts.endpoints.v3BaseUrl, spec.path, spec.query);
      const auth = signV3Request({
        apiId: opts.v3.apiId,
        apiKey: opts.v3.apiKey,
        fullUrl: unsignedUrl,
        now: opts.now,
        newToken: opts.newToken,
      });
      const signedUrl = buildUrl(opts.endpoints.v3BaseUrl, spec.path, {
        ...spec.query,
        UserApiId: auth.UserApiId,
        Timestamp: auth.Timestamp,
        Token: auth.Token,
        HMAC: auth.HMAC,
      });

      let response;
      try {
        response = await opts.http.send({ method: spec.method, url: signedUrl });
      } catch (cause) {
        throw new CloudShareTransportError(
          `CloudShare request to ${signedUrl} failed to reach the server`,
          {
            method: spec.method,
            cause: cause instanceof Error ? cause.message : String(cause),
          },
        );
      }

      if (response.status < 200 || response.status >= 300) {
        throw new CloudShareRequestError(
          `CloudShare request to ${signedUrl} returned ${response.status}`,
          response.status,
          { method: spec.method },
        );
      }

      return response.body;
    },
  };
}
