import { describe, expect, it } from "vitest";
import { CloudShareRequestError } from "./errors";
import { projectCloudShareFailureEvidence } from "./diagnostic-failure-projection";

describe("CloudShare failure diagnostic projection", () => {
  it("projects OAuth failures as metadata-only evidence", () => {
    const error = new CloudShareRequestError("token exchange failed", 502, {
      method: "POST", path: "/oauth/token", integrationSurface: "cloudshare.v4.oauth.token",
      requestHeaders: { authorization: "Bearer secret" }, requestBody: { client_secret: "marker-client_secret" },
      responseStatus: 502, responseBody: { access_token: "marker-access_token" }, cause: "raw provider cause",
    });

    const evidence = projectCloudShareFailureEvidence(error);

    expect(evidence).toEqual({ request: null, response: null });
    expect(JSON.stringify(evidence)).not.toContain("marker-client_secret");
    expect(JSON.stringify(evidence)).not.toContain("marker-access_token");
  });
});
