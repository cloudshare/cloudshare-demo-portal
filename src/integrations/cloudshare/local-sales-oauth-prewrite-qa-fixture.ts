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
  readonly opportunityId: string;
  readonly workflowSource: "sales-demo-sessions";
}

const firedCustomers = new Set<string>();

export function withLocalSalesOauthPrewriteFailureQaFixture(
  http: HttpClient,
  customerId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fired: Set<string> = firedCustomers,
  qaConfig?: LocalSalesOauthQaConfig,
): HttpClient {
  const enabled = env.NODE_ENV === "development" && env.PORTAL_MODE === "fixture" && qaConfig?.enabled === true &&
    qaConfig.workflowSource === "sales-demo-sessions" &&
    env.PORTAL_LOCAL_QA_SCENARIO === LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO &&
    Boolean(customerId) &&
    env.PORTAL_LOCAL_QA_SALES_CUSTOMER_ID?.trim() === customerId &&
    Boolean(qaConfig.customerId && qaConfig.projectId && qaConfig.opportunityId);
  const projectId = qaConfig?.projectId;
  const allowedCustomerId = qaConfig?.customerId;

  return {
    async send(request): Promise<HttpResponse> {
      const url = new URL(request.url);
      if (enabled && projectId && customerId === allowedCustomerId && request.method === "GET" && url.pathname === "/api/v3/users" && url.searchParams.get("projectUsers") === "true" && url.searchParams.get("projectId") === projectId) {
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify({ rows: [{ email: "qa-sales-admin@certalis.test", displayName: "QA Sales Admin" }] }) };
      }
      if (enabled && customerId === allowedCustomerId && request.method === "GET" && url.pathname === `/api/v3/projects/${projectId}/blueprints`) {
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify([{ id: "qa-blueprint-429", name: "QA Blueprint" }]) };
      }
      if (enabled && customerId === allowedCustomerId && request.method === "GET" && url.pathname === `/api/v3/projects/${projectId}/blueprints/qa-blueprint-429`) {
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify({ id: "qa-blueprint-429", name: "QA Blueprint", createFromVersions: [{ id: "qa-snapshot-429", name: "QA Snapshot", isDefault: true, regions: ["qa-region-429"] }] }) };
      }
      if (enabled && customerId === allowedCustomerId && request.method === "GET" && url.pathname === `/api/v3/projects/${projectId}/policies`) {
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify([{ id: "qa-policy-429", name: "QA Policy" }]) };
      }
      if (enabled && customerId === allowedCustomerId && request.method === "GET" && url.pathname === `/api/v3/projects/${projectId}/policies/qa-policy-429`) {
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify({ id: "qa-policy-429", name: "QA Policy", storageLeaseMinutes: 60, runtimeLeaseMinutes: 60 }) };
      }
      if (enabled && customerId === allowedCustomerId && request.method === "GET" && url.pathname === "/api/v3/timezones") {
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify({ Rows: [{ id: "UTC", displayName: "UTC" }] }) };
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
      if (enabled && customerId === allowedCustomerId && isOauthToken) {
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify({ access_token: "local-qa-token", token_type: "Bearer", expires_in: 3600 }) };
      }
      if (enabled && customerId === allowedCustomerId && request.method === "POST" && url.pathname.endsWith("/sales")) {
        let body: { projectId?: unknown; opportunity?: unknown };
        try { body = JSON.parse(request.body ?? "{}") as { projectId?: unknown; opportunity?: unknown }; } catch { return http.send(request); }
        // The v4 payload carries the opportunity display name, while the exact
        // configured Opportunity ID is already enforced by composition's
        // workflow gate. Keep this fixture bound to the configured Project and
        // require a real display name instead of comparing unlike identifiers.
        if (String(body.projectId ?? "") !== projectId || !String(body.opportunity ?? "").trim()) return http.send(request);
        return { status: 200, headers: { "content-type": "application/json", "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }, body: JSON.stringify({ id: "local-qa-sales-experience", status: "notStarted" }) };
      }
      return http.send(request);
    },
  };
}
