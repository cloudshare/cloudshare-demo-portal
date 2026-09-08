import type { HttpClient, HttpResponse } from "./http";

/**
 * Development-only browser-QA fixture for the #429 safe-retry path.
 *
 * It is deliberately an HTTP-adapter wrapper, so the real OAuth client,
 * observer, Sales workflow handler, and browser API route all execute. The
 * exact opt-in scenario and Customer allowlist make it inert outside the
 * disposable local QA server. It fails only the first OAuth exchange; no
 * CloudShare Sales POST can be reached on that attempt.
 */
export const LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO = "sales-oauth-prewrite-503";
export interface LocalSalesOauthQaConfig {
  readonly enabled: boolean;
  readonly customerId: string;
  readonly projectId: string;
}

const firedCustomers = new Set<string>();

export function withLocalSalesOauthPrewriteFailureQaFixture(
  http: HttpClient,
  customerId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fired: Set<string> = firedCustomers,
  qaConfig?: LocalSalesOauthQaConfig,
): HttpClient {
  const enabled = qaConfig?.enabled === true ||
    env.NODE_ENV === "development" &&
    env.PORTAL_LOCAL_QA_SCENARIO === LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO &&
    Boolean(customerId) &&
    env.PORTAL_LOCAL_QA_SALES_CUSTOMER_ID?.trim() === customerId;
  const projectId = qaConfig?.projectId || env.PORTAL_LOCAL_QA_SALES_PROJECT_ID?.trim();
  const allowedCustomerId = qaConfig?.customerId || env.PORTAL_LOCAL_QA_SALES_CUSTOMER_ID?.trim();

  return {
    async send(request): Promise<HttpResponse> {
      const url = new URL(request.url);
      if (enabled && projectId && customerId === allowedCustomerId && request.method === "GET" && url.pathname === "/api/v3/users" && url.searchParams.get("projectUsers") === "true" && url.searchParams.get("projectId") === projectId) {
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify({ rows: [{ email: "qa-sales-pro@certalis.test", displayName: "QA Sales Pro" }] }) };
      }
      const isOauthToken = request.method === "POST" && url.pathname.endsWith("/oauth/token");
      if (enabled && customerId === allowedCustomerId && isOauthToken && !fired.has(customerId!)) {
        fired.add(customerId!);
        return {
          status: 503,
          headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO },
          body: JSON.stringify({ error: "Local QA fixture: OAuth unavailable before Sales provisioning." }),
        };
      }
      return http.send(request);
    },
  };
}
