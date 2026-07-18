import { describe, expect, it, vi } from "vitest";
import { handleCreateSalesParticipantLaunchLink, handleRevokeSalesParticipantLaunchLink, handleSalesParticipantLaunch } from "./sales-participant-launch";

const now = new Date("2026-07-18T09:30:00.000Z");
const session = { id: "session-1", customerId: "certalis", opportunityId: "opp-1", cloudShareSalesExperienceId: "sales-1", start: "2026-07-18T09:00", end: "2026-07-18T10:00", timeZone: "UTC" } as never;
const participant = { id: "participant-1", customerId: "certalis", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-1" } as never;
const actor = { type: "admin", id: "admin-1", email: "admin@certalis.demo" };
function deps(overrides: Record<string, unknown> = {}): any { return { sessions: { findById: vi.fn().mockResolvedValue(session) }, participants: { list: vi.fn().mockResolvedValue([participant]) }, records: { findContact: vi.fn().mockResolvedValue({ id: "contact-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" }) }, links: { create: vi.fn(), regenerate: vi.fn(), revokeActive: vi.fn(), findByTokenHash: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ id: "connection-1" }) }, cloudshare: { forConnection: vi.fn() }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSponsoredLink: vi.fn().mockResolvedValue({ loginUrl: "https://cloudshare.example.test/sensitive", request: { method: "POST", path: "/sales/sales-1/sponsored-link" }, response: { status: 200, body: { loginUrl: "https://cloudshare.example.test/sensitive" } } }) }) }, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() }, now: () => now, ...overrides }; }

describe("Sales participant instant launch", () => {
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
    const revoked = await handleSalesParticipantLaunch(d, "a".repeat(43)); expect(revoked.status).toBe(404); expect(d.deliveryFactory.forConnection).not.toHaveBeenCalled();
  });
  it("uses the persisted Windows timezone rather than the host timezone", async () => {
    const d = deps({ sessions: { findById: vi.fn().mockResolvedValue({ ...(session as any), start: "2026-07-18T10:00", end: "2026-07-18T11:00", timeZone: "GMT Standard Time" }) }, now: () => new Date("2026-07-18T09:30:00.000Z") });
    d.links.findByTokenHash.mockResolvedValue({ id: "link-1", customerId: "certalis", salesDemoSessionId: "session-1", salesSessionParticipantId: "participant-1", tokenHash: "hash", revokedAt: null, createdAt: now });
    await expect(handleSalesParticipantLaunch(d, "a".repeat(43))).resolves.toMatchObject({ status: 302 });
  });
});
