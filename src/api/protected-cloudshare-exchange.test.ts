import { describe, expect, it } from "vitest";
import { projectProtectedCloudShareExchange } from "./protected-cloudshare-exchange";

describe("projectProtectedCloudShareExchange", () => {
  it("drops both directions and transport details for OAuth token failures", () => {
    const exchange = projectProtectedCloudShareExchange({
      method: "POST",
      path: "/oauth/token",
      integrationSurface: "cloudshare.v4.oauth.token",
      failureMode: "rate_limit",
      responseStatus: 429,
      requestHeaders: { Authorization: "Basic credential-bearing-value" },
      requestBody: { client_secret: "credential-bearing-value" },
      responseHeaders: { "set-cookie": "credential-bearing-value" },
      responseBody: { access_token: "credential-bearing-value" },
      cause: { authorization: "credential-bearing-value" },
      network: { token: "credential-bearing-value" },
      tls: { passphrase: "credential-bearing-value" },
    });

    expect(exchange).toEqual({
      request: null,
      response: null,
      transport: null,
    });
  });

  it("retains transport failure details when there is no provider response", () => {
    const exchange = projectProtectedCloudShareExchange({
      method: "GET",
      path: "/v4/trainings/{trainingId}/students",
      failureMode: "transport",
      cause: { code: "synthetic-transport-cause" },
      network: { phase: "synthetic-network-phase" },
      tls: { phase: "synthetic-tls-phase" },
    });

    expect(exchange.response).toBeNull();
    expect((exchange as unknown as { transport: unknown }).transport).toEqual({
      cause: { code: "synthetic-transport-cause" },
      network: { phase: "synthetic-network-phase" },
      tls: { phase: "synthetic-tls-phase" },
    });
  });
});
