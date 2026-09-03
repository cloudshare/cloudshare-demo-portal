import { describe, expect, it, vi } from "vitest";
import { CloudShareAuthError } from "@/integrations/cloudshare/errors";
import { createSalesLaunchDenialContextResolver } from "./sales-launch-denial-context";

const link = { id: "link-1", customerId: "customer-1", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: new Date(), createdAt: new Date() };
const session = { id: "session-1", customerId: "customer-1", cloudShareSalesExperienceId: "sales-1", salesProDisplayName: "Persisted Owner", salesProEmail: "owner@example.test" };
const participant = { id: "participant-1", invitationStatus: "sent", lastInvitedAt: null, invitedBy: "sender@example.test" };
function deps(overrides: Record<string, unknown> = {}): any { return { sessions: { findById: vi.fn().mockResolvedValue(session) }, participants: { list: vi.fn().mockResolvedValue([participant]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, cloudshare: { forConnection: vi.fn() }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ listSalesPros: vi.fn().mockResolvedValue({ salesPros: [{ name: "Live Owner", email: "live@example.test", type: "mainSalesPro" }] }) }) }, diagnostics: { record: vi.fn() }, ...overrides }; }

describe("Sales launch denial context resolver", () => {
  it("loads only the link's Customer, Session, and Participant", async () => {
    const d = deps(); const result = await createSalesLaunchDenialContextResolver(d).resolve(link, "corr-1");
    expect(d.sessions.findById).toHaveBeenCalledWith("customer-1", "session-1"); expect(d.participants.list).toHaveBeenCalledWith("customer-1", "session-1"); expect(result?.salesPros[0].email).toBe("live@example.test");
  });
  it("returns no context when the persisted participant is outside the resolved scope", async () => {
    const d = deps({ participants: { list: vi.fn().mockResolvedValue([{ ...participant, id: "participant-other" }]) } });
    await expect(createSalesLaunchDenialContextResolver(d).resolve(link, "corr-2")).resolves.toBeNull(); expect(d.deliveryFactory.forConnection).not.toHaveBeenCalled();
  });
  it("falls back to the persisted main Sales Pro and records protected evidence when the provider read fails", async () => {
    const d = deps({ deliveryFactory: { forConnection: () => ({ listSalesPros: vi.fn().mockRejectedValue(new Error("provider secret")) }) } });
    const result = await createSalesLaunchDenialContextResolver(d).resolve(link, "corr-3");
    expect(result?.salesPros).toEqual([{ name: "Persisted Owner", email: "owner@example.test", type: "mainSalesPro" }]); expect(d.diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "corr-3", customerId: "customer-1", details: expect.objectContaining({ integrationSurface: "cloudshare.v4.sales.sales_pros" }) })); expect(JSON.stringify(result)).not.toContain("provider secret");
  });
  it("keeps OAuth token failure evidence metadata-only while loading recovery contacts", async () => {
    const oauthFailure = new CloudShareAuthError("OAuth token exchange returned 503", { method: "POST", path: "/oauth/token", integrationSurface: "cloudshare.v4.oauth.token", status: 503, requestBody: { client_secret: "private-secret" }, responseBody: { access_token: "private-token" } });
    const d = deps({ deliveryFactory: { forConnection: () => ({ listSalesPros: vi.fn().mockRejectedValue(oauthFailure) }) } });

    await createSalesLaunchDenialContextResolver(d).resolve(link, "corr-oauth");
    const [failure] = d.diagnostics.record.mock.calls[0];

    expect(failure).toMatchObject({ request: null, response: null, details: expect.objectContaining({ integrationSurface: "cloudshare.v4.oauth.token", failureMode: "http_failure", status: 503 }) });
    expect(JSON.stringify(failure)).not.toMatch(/private-secret|private-token/);
  });
});
