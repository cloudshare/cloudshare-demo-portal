import { describe, expect, it, vi } from "vitest";
import { LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO, withLocalSalesOauthPrewriteFailureQaFixture } from "./local-sales-oauth-prewrite-qa-fixture";

describe("local Sales OAuth pre-write QA fixture", () => {
  const env = {
    NODE_ENV: "development",
    PORTAL_LOCAL_QA_SCENARIO: LOCAL_SALES_OAUTH_PREWRITE_FAILURE_SCENARIO,
    PORTAL_LOCAL_QA_SALES_CUSTOMER_ID: "certalis",
  } as NodeJS.ProcessEnv;

  it("fails only the first allowed Customer OAuth exchange, then delegates", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "{}" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "certalis", env, new Set());

    await expect(http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" })).resolves.toMatchObject({ status: 503 });
    await expect(http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" })).resolves.toMatchObject({ status: 200 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not intercept another Customer or a non-OAuth request", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: "{}" });
    const http = withLocalSalesOauthPrewriteFailureQaFixture({ send }, "other-customer", env, new Set());

    await http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/oauth/token" });
    await http.send({ method: "POST", url: "https://api.accelerate.cloudshare.com/v4/sales" });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
