import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesParticipantWorkspaceReader } from "./prisma-sales-participant-workspace-reader";
function row(i: number) { return { id: `p${i}`, updatedAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date(2026, 0, i + 1), invitationStatus: "notSent", participationStatus: "pending", cloudShareParticipantId: `provider-${i}`, cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentObservedAt: null, environmentAttentionReason: null, contact: { firstName: "Ada", lastName: `${i}`, email: `ada${i}@example.test` }, launchLinks: [] }; }
describe("Prisma participant workspace reader", () => {
  it.each([0, 1, 25, 26, 500])("bounds page size for %i rows", async (count) => {
    const rows = Array.from({ length: Math.min(count, 25) }, (_, i) => row(i));
    const findMany = vi.fn().mockResolvedValue(rows), countFn = vi.fn().mockResolvedValue(count);
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "s1", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "salesProsAndParticipants" }) }, salesSessionParticipant: { count: countFn, findMany }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    const page = await reader.readPage({ customerId: "c1", sessionId: "s1", query: "Ada", offset: 0, limit: 25, now: new Date() });
    expect(page?.participants).toHaveLength(Math.min(count, 25)); expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 25, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
    expect(JSON.stringify(page)).not.toContain("provider-");
  });
  it("fails closed for another Customer", async () => { const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue(null) } } as never); expect(await reader.readPage({ customerId: "other", sessionId: "s1", query: "", offset: 0, limit: 25, now: new Date() })).toBeNull(); });
  it("projects the latest bounded launch operation without leaking other scope", async () => {
    const operation = { salesSessionParticipantId: "p0", operation: "generate", outcome: "failure", safeReason: "persistence_failure", correlationId: "corr-launch" };
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "s1", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) }, salesSessionParticipant: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([row(0)]) }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([operation]) } } as never);
    await expect(reader.readPage({ customerId: "c1", sessionId: "s1", query: "", offset: 0, limit: 25, now: new Date() })).resolves.toMatchObject({ participants: [{ sessionEndsAt: "2026-12-01T12:00:00.000Z", launchOperation: { operation: "generate", outcome: "failure", reason: "persistence_failure", correlationId: operation.correlationId } }] });
  });
  it("confines the bounded query to the Customer, session, and unarchived contact opportunity", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const reader = createPrismaSalesParticipantWorkspaceReader({
      salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "s1", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) },
      salesSessionParticipant: { count, findMany },
      salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([]) },
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
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty("cloudShareRosterEnvironmentReference");
  });
  it("requires unarchived Opportunity and Account ancestry", async () => { const findFirst = vi.fn().mockResolvedValue(null); const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst } } as never); await reader.readPage({ customerId: "c1", sessionId: "s1", query: "", offset: 0, limit: 25, now: new Date() }); expect(findFirst.mock.calls[0][0].where).toMatchObject({ opportunity: { archivedAt: null, account: { archivedAt: null } } }); });
});
