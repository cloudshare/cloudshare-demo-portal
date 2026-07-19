import { describe, expect, it } from "vitest";
import { projectProtectedCloudShareExchange } from "./protected-cloudshare-exchange";

describe("projectProtectedCloudShareExchange", () => {
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
