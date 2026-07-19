import { describe, expect, it } from "vitest";
import { redactCloudShareAdminSupportValue } from "./diagnostic-redaction";

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
