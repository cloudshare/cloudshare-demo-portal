import { describe, expect, it } from "vitest";
import { redactCloudShareAdminSupportValue } from "./diagnostic-redaction";

describe("redactCloudShareAdminSupportValue", () => {
  it("preserves ordinary support fields like authorized and authorizationError while redacting real auth material", () => {
    expect(
      redactCloudShareAdminSupportValue({
        tls: {
          authorized: false,
          authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
          authToken: "secret-auth-token",
          bearerHeader: "Bearer secret-bearer-token",
          token: "oauth-token",
          accessToken: "oauth-access-token",
          webhookPathToken: "support-routing-token",
        },
        authorEmail: "support@helioscx.demo",
      }),
    ).toEqual({
      tls: {
        authorized: false,
        authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
        authToken: "[REDACTED]",
        bearerHeader: "[REDACTED]",
        token: "oauth-token",
        accessToken: "[REDACTED]",
        webhookPathToken: "support-routing-token",
      },
      authorEmail: "support@helioscx.demo",
    });
  });

  it("preserves CloudShare body evidence even when ordinary payload keys look auth-adjacent", () => {
    expect(
      redactCloudShareAdminSupportValue({
        token: "cloudshare-body-token-evidence",
        authorization: "body-level-authorization-evidence",
        passphrase: "candidate-support-passphrase",
        loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
        apiKey: "actual-api-key",
        accessToken: "actual-oauth-access-token",
        signature: "actual-signature",
        diagnosticNote:
          "Bearer actual-bearer-token cs_sha1 userapiid:api-id;timestamp:1700000000;token:nonce12345;hmac:abc123",
      }),
    ).toEqual({
      token: "cloudshare-body-token-evidence",
      authorization: "body-level-authorization-evidence",
      passphrase: "[REDACTED]",
      loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
      apiKey: "[REDACTED]",
      accessToken: "[REDACTED]",
      signature: "[REDACTED]",
      diagnosticNote: "Bearer [REDACTED] cs_sha1 [REDACTED]",
    });
  });
});
