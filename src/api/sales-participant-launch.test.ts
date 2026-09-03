import { describe, expect, it, vi } from "vitest";
import { handleCreateSalesParticipantLaunchLink, handleRevokeSalesParticipantLaunchLink, handleSalesParticipantLaunch } from "./sales-participant-launch";

const now = new Date("2026-07-18T09:30:00.000Z");
const session = { id: "session-1", customerId: "certalis", opportunityId: "opp-1", cloudShareSalesExperienceId: "sales-1", start: "2026-07-18T09:00", end: "2026-07-18T10:00", timeZone: "UTC", salesProDisplayName: "Persisted Owner", salesProEmail: "owner@example.test" } as never;
const participant = { id: "participant-1", customerId: "certalis", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-1", invitationStatus: "sent", lastInvitedAt: new Date("2026-07-18T09:05:00.000Z"), invitedBy: "admin@example.test" } as never;
const actor = { type: "admin", id: "admin-1", email: "admin@certalis.demo" };
function deps(overrides: Record<string, unknown> = {}): any { return { sessions: { findById: vi.fn().mockResolvedValue(session) }, participants: { list: vi.fn().mockResolvedValue([participant]) }, records: { findContact: vi.fn().mockResolvedValue({ id: "contact-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" }) }, links: { create: vi.fn(), regenerate: vi.fn(), revokeActive: vi.fn(), findByTokenHash: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ id: "connection-1" }) }, cloudshare: { forConnection: vi.fn() }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSponsoredLink: vi.fn().mockResolvedValue({ loginUrl: "https://cloudshare.example.test/sensitive", request: { method: "POST", path: "/sales/sales-1/sponsored-link" }, response: { status: 200, body: { loginUrl: "https://cloudshare.example.test/sensitive" } } }), listSalesPros: vi.fn().mockResolvedValue({ salesPros: [{ name: "Main Owner", email: "main@example.test", type: "mainSalesPro" }, { name: "Extra Owner", email: "extra@example.test", type: "salesPro" }] }) }) }, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() }, now: () => now, ...overrides }; }

describe("Sales participant instant launch", () => {
  it("blocks create at session end and for concluded participants before token mutation, while revoke remains available", async () => {
    const ended = deps({ now: () => new Date("2026-07-18T10:00:00.000Z") });
    const endedResult = await handleCreateSalesParticipantLaunchLink(ended, { customerId: "certalis", sessionId: "session-1", participantId: "participant-1", actor });
    expect(endedResult).toMatchObject({ status: 409, body: { code: "sales_session_ended", correlationId: expect.any(String) } }); expect(ended.links.regenerate).not.toHaveBeenCalled();
    const concluded = deps({ participants: { list: vi.fn().mockResolvedValue([{ ...(participant as any), participationStatus: "concluded" }]) } });
    const concludedResult = await handleCreateSalesParticipantLaunchLink(concluded, { customerId: "certalis", sessionId: "session-1", participantId: "participant-1", actor });
    expect(concludedResult).toMatchObject({ status: 409, body: { code: "sales_participant_concluded", correlationId: expect.any(String) } }); expect(concluded.links.regenerate).not.toHaveBeenCalled();
    const revoked = await handleRevokeSalesParticipantLaunchLink(concluded, { customerId: "certalis", sessionId: "session-1", participantId: "participant-1", actor });
    expect(revoked.status).toBe(200); expect(concluded.links.revokeActive).toHaveBeenCalledOnce();
  });
  it("persists only a hash and returns the Certalis capability once", async () => {
    const d = deps(); const result = await handleCreateSalesParticipantLaunchLink(d, { customerId: "certalis", sessionId: "session-1", participantId: "participant-1", actor });
    expect(result.status).toBe(201); expect(result.body.launchUrl).toMatch(/^\/sales\/launch\//);
    expect(d.links.regenerate).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: expect.not.stringContaining(result.body.launchUrl.replace("/sales/launch/", "")) }), now);
    expect(JSON.stringify(d.links.regenerate.mock.calls)).not.toContain("/sales/launch/");
  });
  it("regeneration revokes prior capability and cross-customer ownership is not disclosed", async () => {
    const d = deps(); await handleCreateSalesParticipantLaunchLink(d, { customerId: "certalis", sessionId: "session-1", participantId: "participant-1", actor });
    expect(d.links.regenerate).toHaveBeenCalledTimes(1);
    const denied = await handleRevokeSalesParticipantLaunchLink(deps({ sessions: { findById: vi.fn().mockResolvedValue(null) } }), { customerId: "other", sessionId: "session-1", participantId: "participant-1", actor });
    expect(denied).toEqual({ status: 404, body: { error: "This Certalis launch link is unavailable." } });
  });
  it("redirects only in its active window and never returns the CloudShare URL in a body", async () => {
    const d = deps(); d.links.findByTokenHash.mockResolvedValue({ id: "link-1", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: null, createdAt: now });
    const result = await handleSalesParticipantLaunch(d, "a".repeat(43));
    expect(result).toEqual(expect.objectContaining({ status: 302, redirect: "https://cloudshare.example.test/sensitive" })); expect(result.body).toBeUndefined();
    const closed = await handleSalesParticipantLaunch(deps({ now: () => new Date("2026-07-18T10:01:00.000Z"), links: { ...d.links, findByTokenHash: vi.fn().mockResolvedValue({ id: "link-1", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: null, createdAt: now }) } }), "a".repeat(43));
    expect(closed.body).toMatchObject({ error: "This Certalis launch link is unavailable." }); expect(JSON.stringify(closed.body)).not.toContain("cloudshare.example");
  });
  it("blocks malformed and revoked capabilities without calling CloudShare", async () => {
    const d = deps(); const malformed = await handleSalesParticipantLaunch(d, "bad"); expect(malformed.status).toBe(404); expect(malformed.body?.correlationId).toBeTruthy(); expect(d.diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ correlationId: malformed.body?.correlationId, customerId: null })); expect(d.audit.write).toHaveBeenCalledWith(expect.objectContaining({ correlationId: malformed.body?.correlationId, customerId: null })); expect(d.deliveryFactory.forConnection).not.toHaveBeenCalled();
    d.links.findByTokenHash.mockResolvedValue({ id: "link", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: now, createdAt: now });
    const revoked = await handleSalesParticipantLaunch(d, "a".repeat(43)); expect(revoked.status).toBe(404); expect(revoked.body?.denialContext).toMatchObject({ salesPros: [{ type: "mainSalesPro" }, { type: "salesPro" }], invitation: { status: "sent", lastInvitedAt: "2026-07-18T09:05:00.000Z" } });
  });
  it("uses the persisted Windows timezone rather than the host timezone", async () => {
    const d = deps({ sessions: { findById: vi.fn().mockResolvedValue({ ...(session as any), start: "2026-07-18T10:00", end: "2026-07-18T11:00", timeZone: "GMT Standard Time" }) }, now: () => new Date("2026-07-18T09:30:00.000Z") });
    d.links.findByTokenHash.mockResolvedValue({ id: "link-1", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: null, createdAt: now });
    await expect(handleSalesParticipantLaunch(d, "a".repeat(43))).resolves.toMatchObject({ status: 302 });
  });
  it("keeps provider HTTP and transport failure evidence protected while returning the same generic response", async () => {
    const http = deps({ deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSponsoredLink: vi.fn().mockRejectedValue(Object.assign(new Error("provider"), { context: { method: "POST", path: "/sales/sales-1/sponsored-link", requestHeaders: { authorization: "[REDACTED]" }, requestBody: { email: "ada@example.test" }, responseStatus: 503, responseHeaders: { retryAfter: "30" }, responseBody: { error: "unavailable" }, cause: "provider unavailable" } })) }) } });
    http.links.findByTokenHash.mockResolvedValue({ id: "link-1", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: null, createdAt: now });
    const result = await handleSalesParticipantLaunch(http, "a".repeat(43));
    expect(result.body).toMatchObject({ error: "This Certalis launch link is unavailable." }); expect(JSON.stringify(result.body)).not.toContain("provider unavailable");
    expect(http.diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ integrationSurface: "cloudshare.v4.sales.sponsored_link", failureMode: "http_failure", cause: "provider unavailable" }), request: expect.objectContaining({ method: "POST", path: "/sales/sales-1/sponsored-link", headers: { authorization: "[REDACTED]" } }), response: expect.objectContaining({ status: 503, headers: { retryAfter: "30" } }) }));
  });
  it("records TLS or network transport cause without exposing it to the launch caller", async () => {
    const transport = deps({ deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSponsoredLink: vi.fn().mockRejectedValue(Object.assign(new Error("transport"), { context: { method: "POST", path: "/sales/sales-1/sponsored-link", network: "ECONNRESET", tls: "certificate verify failed", cause: "connection reset" } })) }) } });
    transport.links.findByTokenHash.mockResolvedValue({ id: "link-1", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: null, createdAt: now });
    const result = await handleSalesParticipantLaunch(transport, "a".repeat(43));
    expect(result.body).toMatchObject({ error: "This Certalis launch link is unavailable." });
    expect(transport.diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ failureMode: "transport_failure", cause: "connection reset", network: "ECONNRESET", tls: "certificate verify failed" }), response: expect.objectContaining({ network: "ECONNRESET", tls: "certificate verify failed" }) }));
  });
  it("keeps OAuth token failure evidence metadata-only during participant launch", async () => {
    const oauthFailure = Object.assign(new Error("wrapped OAuth token exchange returned 503"), { context: {
      method: "POST",
      path: "/oauth/token",
      integrationSurface: "cloudshare.v4.oauth.token",
      status: 503,
      requestBody: { client_id: "private-client", client_secret: "private-secret" },
      responseBody: { access_token: "private-token" },
      cause: "private-cause",
    } });
    const d = deps({ deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSponsoredLink: vi.fn().mockRejectedValue(oauthFailure) }) } });
    d.links.findByTokenHash.mockResolvedValue({ id: "link-1", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: null, createdAt: now });

    const result = await handleSalesParticipantLaunch(d, "a".repeat(43));
    const failure = d.diagnostics.record.mock.calls
      .map(([entry]: [Record<string, unknown>]) => entry)
      .find((entry: Record<string, unknown>) => entry.operation === "sales.demo_session.participant_launch.opened" && entry.outcome === "failure");

    expect(result).toMatchObject({ status: 404, body: { error: "This Certalis launch link is unavailable." } });
    expect(failure).toMatchObject({
      request: null,
      response: null,
      details: expect.objectContaining({ integrationSurface: "cloudshare.v4.oauth.token", failureMode: "http_failure", status: 503 }),
    });
    const persisted = JSON.stringify(failure);
    expect(persisted).not.toContain("private-client");
    expect(persisted).not.toContain("private-secret");
    expect(persisted).not.toContain("private-token");
    expect(persisted).not.toContain("private-cause");
  });
  it.each([
    ["Session repository", { sessions: { findById: vi.fn().mockRejectedValue(new Error("session database secret")) } }],
    ["Participant repository", { participants: { list: vi.fn().mockRejectedValue(new Error("participant database secret")) } }],
  ])("keeps a known denial generic when the %s fails", async (_label, override) => {
    const d = deps(override); d.links.findByTokenHash.mockResolvedValue({ id: "link-1", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: null, createdAt: now });
    const result = await handleSalesParticipantLaunch(d, "a".repeat(43));
    expect(result.status).toBe(404); expect(result.body).toMatchObject({ error: "This Certalis launch link is unavailable.", correlationId: expect.any(String) }); expect(result.body?.denialContext).toBeUndefined(); expect(JSON.stringify(result.body)).not.toMatch(/database secret|owner@example|participant-1|sales-1|a{20}/);
  });
});
