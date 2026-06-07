/**
 * Minimal HTTP seam the CloudShare adapter depends on. Both the live `fetch`
 * client and the fixture replay client implement {@link HttpClient}, so the
 * adapter's request/auth/validation code runs identically in either mode —
 * that's the live-vs-fixture toggle requirement, satisfied by substitution
 * rather than branching through the call path.
 */

export interface HttpRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly url: string;
  readonly headers?: Record<string, string>;
  /** Serialised request body, if any. */
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface HttpClient {
  send(request: HttpRequest): Promise<HttpResponse>;
}

/** Live HTTP client backed by the global `fetch` (injectable for tests). */
export function createFetchHttpClient(
  fetchImpl: typeof fetch = fetch,
): HttpClient {
  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      return { status: response.status, body: await response.text() };
    },
  };
}
