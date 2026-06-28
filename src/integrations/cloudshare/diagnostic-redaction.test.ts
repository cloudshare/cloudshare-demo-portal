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
        },
        authorEmail: "support@helioscx.demo",
      }),
    ).toEqual({
      tls: {
        authorized: false,
        authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
        authToken: "[REDACTED]",
        bearerHeader: "[REDACTED]",
      },
      authorEmail: "support@helioscx.demo",
    });
  });
});
