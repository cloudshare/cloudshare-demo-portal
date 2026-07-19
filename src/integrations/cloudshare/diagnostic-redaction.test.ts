import { describe, expect, it } from "vitest";
import { projectCloudShareGenericLogValue, redactCloudShareAdminSupportValue } from "./diagnostic-redaction";

describe("redactCloudShareAdminSupportValue", () => {
  it("preserves every nested body field verbatim; header masking is owned by the recorder seam", () => {
    const body = {
      token: "cloudshare-body-token-evidence",
      authorization: "body-level-authorization-evidence",
      passphrase: "candidate-support-passphrase",
      loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
      accessLink: "https://use.cloudshare.com/native-invitation",
      nested: [{ apiKey: "provider-body-data", signature: "provider-body-signature" }],
    };

    expect(redactCloudShareAdminSupportValue(body)).toBe(body);
  });
});

describe("projectCloudShareGenericLogValue", () => {
  it("removes body and payload evidence while masking actual request headers", () => {
    const projected = projectCloudShareGenericLogValue({
      request: { headers: [["Authorization", "Bearer secret"]], query: { token: "query-value" }, body: { passphrase: "body-secret" } },
      requestBody: { accessLink: "private" },
      response: { status: 500, headers: { retryAfter: "10" }, body: { loginUrl: "private-url" } },
      webhookPayload: { token: "payload-secret" },
      eventType: "environment.created",
    });
    expect(projected).toEqual({
      request: { headers: [["Authorization", "[REDACTED]"]] },
      response: { status: 500, headers: { retryAfter: "10" } },
      eventType: "environment.created",
    });
    expect(JSON.stringify(projected)).not.toContain("body-secret");
    expect(JSON.stringify(projected)).not.toContain("payload-secret");
    expect(JSON.stringify(projected)).not.toContain("private-url");
  });
});
