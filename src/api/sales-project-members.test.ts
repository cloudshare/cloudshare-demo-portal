import { describe, expect, it, vi } from "vitest";
import { handleListSalesProjectMembers } from "./sales-project-members";

describe("Sales Project members API", () => {
  it("keeps OAuth token failure evidence metadata-only during the live member read", async () => {
    const diagnostics = { record: vi.fn() };
    const oauthFailure = Object.assign(new Error("wrapped OAuth token exchange returned 503"), { context: {
      method: "POST",
      path: "/oauth/token",
      integrationSurface: "cloudshare.v4.oauth.token",
      status: 503,
      requestBody: { client_secret: "private-secret" },
      responseBody: { access_token: "private-token" },
    } });
    const result = await handleListSalesProjectMembers({
      items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", status: "active", project: { id: "project-1" } }) },
      connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) },
      sourceFactory: { forConnection: () => ({ listActiveProjectMembers: vi.fn().mockRejectedValue(oauthFailure) }) },
      diagnostics,
    }, { customerId: "certalis", itemId: "item-1", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" } });
    const [failure] = diagnostics.record.mock.calls[0];

    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(failure).toMatchObject({ request: null, response: null, details: expect.objectContaining({ integrationSurface: "cloudshare.v4.oauth.token", failureMode: "http_failure", status: 503 }) });
    expect(JSON.stringify(failure)).not.toMatch(/private-secret|private-token/);
  });

  it("preserves untyped non-OAuth protected evidence during the live member read", async () => {
    const diagnostics = { record: vi.fn() };
    const providerFailure = Object.assign(new Error("provider unavailable"), { context: { method: "GET", path: "/projects/project-1/members", requestBody: { marker: "request-marker" }, responseStatus: 503, responseBody: { marker: "response-marker" } } });
    await handleListSalesProjectMembers({
      items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", status: "active", project: { id: "project-1" } }) },
      connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) },
      sourceFactory: { forConnection: () => ({ listActiveProjectMembers: vi.fn().mockRejectedValue(providerFailure) }) },
      diagnostics,
    }, { customerId: "certalis", itemId: "item-1", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" } });

    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ body: { marker: "request-marker" } }),
      response: expect.objectContaining({ body: { marker: "response-marker" } }),
    }));
  });
});
