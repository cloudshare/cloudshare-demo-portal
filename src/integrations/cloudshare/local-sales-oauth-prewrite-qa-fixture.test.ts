import { describe, expect, it, vi } from "vitest";
import { LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO, withLocalSalesOauthPrewriteFailureQaFixture } from "./local-sales-oauth-prewrite-qa-fixture";

describe("local Sales OAuth pre-write QA fixture", () => {
  const env = {
    NODE_ENV: "development",
    PORTAL_LOCAL_QA_SCENARIO: LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO,
    PORTAL_LOCAL_QA_SALES_CUSTOMER_ID: "certalis",
    PORTAL_LOCAL_QA_SALES_OPPORTUNITY_ID: "opp-qa",
    PORTAL_LOCAL_QA_SALES_PROJECT_ID: "project-qa",
    PORTAL_MODE: "fixture",
  } as NodeJS.ProcessEnv;

  it("fails only the first allowed Customer OAuth exchange, then delegates", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "{}" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", env, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });

    await expect(http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" })).resolves.toMatchObject({ status: 503 });
    await expect(http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" })).resolves.toMatchObject({ status: 200 });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not intercept another Customer or a non-OAuth request", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "{}" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "other-customer", env, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });

    await http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" });
    await http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/sales" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("allows only the configured project-member lookup and delegates other projects", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "delegated" });
    const scopedEnv = env;
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", scopedEnv, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });

    await expect(http.send({ method: "GET", url: "https://use.cloudshare.com/api/v3/users?projectUsers=true&projectId=project-qa" })).resolves.toMatchObject({ status: 200, headers: expect.objectContaining({ "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }) });
    await expect(http.send({ method: "GET", url: "https://use.cloudshare.com/api/v3/users?projectUsers=true&projectId=project-other" })).resolves.toMatchObject({ body: "delegated" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("provides the hermetic timezone catalogue only for the configured Customer", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "delegated" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", env, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });

    await expect(http.send({ method: "GET", url: "https://use.cloudshare.com/api/v3/timezones" })).resolves.toMatchObject({ status: 200, body: JSON.stringify({ Rows: [{ id: "UTC", displayName: "UTC" }] }) });
    expect(send).not.toHaveBeenCalled();
  });

  it("delegates the timezone catalogue for another Customer", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "delegated" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "other-customer", env, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });

    await expect(http.send({ method: "GET", url: "https://use.cloudshare.com/api/v3/timezones" })).resolves.toMatchObject({ body: "delegated" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("accepts the configured Project with the v4 opportunity display name on retry", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "delegated" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", env, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });

    await expect(http.send({ method: "POST", url: "https://use.cloudshare.com/api/v4/sales", body: JSON.stringify({ projectId: "project-qa", opportunity: "Renewal" }) })).resolves.toMatchObject({ status: 200, headers: expect.objectContaining({ "x-local-qa-fixture": LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO }) });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["a different project", { projectId: "project-other", opportunity: "Renewal" }],
    ["a blank opportunity", { projectId: "project-qa", opportunity: "   " }],
    ["a missing opportunity", { projectId: "project-qa" }],
  ])("delegates /sales for %s", async (_label, body) => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "delegated" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", env, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });

    await expect(http.send({ method: "POST", url: "https://use.cloudshare.com/api/v4/sales", body: JSON.stringify(body) })).resolves.toMatchObject({ body: "delegated" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("is inert in production even with the scenario enabled", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "delegated" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", { ...env, NODE_ENV: "production" }, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });
    await expect(http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" })).resolves.toMatchObject({ status: 200 });
    expect(send).toHaveBeenCalledOnce();
  });

  it("is inert outside fixture mode even in development", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "delegated" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", { ...env, PORTAL_MODE: "live" }, new Set(), { enabled: true, customerId: "certalis", projectId: "project-qa", opportunityId: "opp-qa", workflowSource: "sales-demo-sessions" });
    await expect(http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" })).resolves.toMatchObject({ status: 200 });
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not intercept a different workflow or opportunity", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "delegated" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", env, new Set(), { enabled: false, customerId: "certalis", projectId: "project-qa", opportunityId: "other-opportunity", workflowSource: "sales-demo-sessions" });
    await expect(http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" })).resolves.toMatchObject({ status: 200 });
    expect(send).toHaveBeenCalledOnce();
  });
});
