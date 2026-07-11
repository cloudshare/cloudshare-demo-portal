import { describe, expect, it } from "vitest";
import { buildWebhookCallbackUrl } from "./admin-cloudshare-connection-state";

describe("webhook callback URL", () => {
  it("combines the public base URL and per-Customer webhook path", () => {
    expect(
      buildWebhookCallbackUrl(
        "https://example.trycloudflare.com/",
        "/api/webhooks/cloudshare/token-123",
      ),
    ).toBe("https://example.trycloudflare.com/api/webhooks/cloudshare/token-123");
  });

  it("returns null until both values are present", () => {
    expect(buildWebhookCallbackUrl("", "/api/webhooks/cloudshare/token-123")).toBeNull();
    expect(buildWebhookCallbackUrl("https://example.test", null)).toBeNull();
  });
});
