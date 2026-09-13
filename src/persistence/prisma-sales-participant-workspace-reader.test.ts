import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesParticipantWorkspaceReader } from "./prisma-sales-participant-workspace-reader";
function row(i: number) { return { id: `p${i}`, updatedAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date(2026, 0, i + 1), invitationStatus: "notSent", participationStatus: "pending", cloudShareParticipantId: `provider-${i}`, cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentObservedAt: null, environmentAttentionReason: null, contact: { firstName: "Ada", lastName: `${i}`, email: `ada${i}@example.test` }, launchLinks: [] }; }
describe("Prisma participant workspace reader", () => {
  it.each([0, 1, 25, 26, 500])("bounds page size for %i rows", async (count) => {
    const rows = Array.from({ length: Math.min(count, 25) }, (_, i) => row(i));
    const findMany = vi.fn().mockResolvedValue(rows), countFn = vi.fn().mockResolvedValue(count);
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "s1", end: "2026-12-01", sendInvitations: "salesProsAndParticipants" }) }, salesSessionParticipant: { count: countFn, findMany }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    const page = await reader.readPage({ customerId: "c1", sessionId: "s1", query: "Ada", offset: 0, limit: 25, now: new Date() });
    expect(page?.participants).toHaveLength(Math.min(count, 25)); expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 25, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
    expect(JSON.stringify(page)).not.toContain("provider-");
  });
  it("fails closed for another Customer", async () => { const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue(null) } } as never); expect(await reader.readPage({ customerId: "other", sessionId: "s1", query: "", offset: 0, limit: 25, now: new Date() })).toBeNull(); });
  it("confines the bounded query to the Customer, session, and unarchived contact opportunity", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const reader = createPrismaSalesParticipantWorkspaceReader({
      salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "s1", end: "2026-12-01", sendInvitations: "dontSend" }) },
      salesSessionParticipant: { count, findMany },
    } as never);
    await reader.readPage({ customerId: "customer-a", sessionId: "session-a", query: "Ada", offset: 0, limit: 25, now: new Date() });
    for (const call of [count, findMany]) {
      const where = call.mock.calls[0][0].where;
      expect(where).toMatchObject({ customerId: "customer-a", salesDemoSessionId: "session-a", contact: { archivedAt: null, opportunity: { archivedAt: null } } });
      expect(where.contact.OR).toEqual(expect.arrayContaining([
        { firstName: { contains: "Ada" } },
        { lastName: { contains: "Ada" } },
        { email: { contains: "Ada" } },
      ]));
    }
    expect(findMany.mock.calls[0][0].select).toMatchObject({ contact: { select: { firstName: true, lastName: true, email: true } } });
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty("contact.opportunity");
  });
});
