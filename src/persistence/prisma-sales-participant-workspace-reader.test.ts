import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesParticipantWorkspaceReader as createReader } from "./prisma-sales-participant-workspace-reader";
function createPrismaSalesParticipantWorkspaceReader(prisma: Record<string, unknown>) {
  return createReader({ opportunityContact: { findMany: vi.fn().mockResolvedValue([]) }, ...prisma } as never);
}
function row(i: number) { return { id: `p${i}`, updatedAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date(2026, 0, i + 1), invitationStatus: "notSent", participationStatus: "pending", cloudShareParticipantId: `provider-${i}`, cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentObservedAt: null, environmentAttentionReason: null, contact: { firstName: "Ada", lastName: `${i}`, email: `ada${i}@example.test` }, launchLinks: [] }; }
describe("Prisma participant workspace reader", () => {
  it("projects only bounded, active, unregistered contacts for the exact session opportunity", async () => {
    const contactFindMany = vi.fn().mockResolvedValue([{ id: "contact-good", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" }]);
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "s1", opportunityId: "opp-1", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) }, opportunityContact: { findMany: contactFindMany }, salesSessionParticipant: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    const page = await reader.readPage({ customerId: "customer-a", sessionId: "s1", query: "", offset: 0, limit: 25, now: new Date() });
    expect(page?.eligibleContacts).toEqual([{ id: "contact-good", name: "Ada Lovelace", email: "ada@example.test" }]);
    expect(contactFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: "customer-a", opportunityId: "opp-1", archivedAt: null, opportunity: { archivedAt: null, account: { archivedAt: null } }, salesSessionParticipants: { none: { customerId: "customer-a", salesDemoSessionId: "s1" } } }), take: 50 }));
  });
  it.each([0, 1, 25, 26, 500])("bounds page size for %i rows", async (count) => {
    const rows = Array.from({ length: Math.min(count, 25) }, (_, i) => row(i));
    const findMany = vi.fn().mockResolvedValue(rows), countFn = vi.fn().mockResolvedValue(count);
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "s1", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "salesProsAndParticipants" }) }, salesSessionParticipant: { count: countFn, findMany }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    const page = await reader.readPage({ customerId: "c1", sessionId: "s1", query: "Ada", offset: 0, limit: 25, now: new Date() });
    expect(page?.participants).toHaveLength(Math.min(count, 25)); expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 25, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
    expect(JSON.stringify(page)).not.toContain("provider-");
  });
  it("fails closed for another Customer", async () => { const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue(null) } } as never); expect(await reader.readPage({ customerId: "other", sessionId: "s1", query: "", offset: 0, limit: 25, now: new Date() })).toBeNull(); });
  it("reads one latest launch operation per page row without history skew or scope leakage", async () => {
    const findLaunchOperations = vi.fn(async (args: { where: { customerId: string; salesDemoSessionId: string; salesSessionParticipantId: string }; take: number }) => [{
      salesSessionParticipantId: args.where.salesSessionParticipantId,
      operation: "generate",
      outcome: "failure",
      safeReason: "persistence_failure",
      correlationId: `corr-${args.where.salesSessionParticipantId}`,
    }]);
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-a", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) }, salesSessionParticipant: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([row(0), row(1)]) }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantLaunchOperation: { findMany: findLaunchOperations } } as never);
    const result = await reader.readPage({ customerId: "customer-a", sessionId: "session-a", query: "", offset: 0, limit: 25, now: new Date() });
    expect(result?.participants.map((participant) => participant.launchOperation?.correlationId)).toEqual(["corr-p0", "corr-p1"]);
    expect(findLaunchOperations).toHaveBeenCalledTimes(2);
    for (const call of findLaunchOperations.mock.calls) {
      expect(call[0]).toMatchObject({
        where: { customerId: "customer-a", salesDemoSessionId: "session-a" },
        orderBy: [{ occurredAt: "desc" }, { revision: "desc" }, { id: "desc" }],
        take: 1,
      });
      expect(call[0]).not.toHaveProperty("distinct");
    }
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
  it("does not read invitation ledger tables while reading the bounded base page", async () => {
    const invitationFindMany = vi.fn(async (args: { where: { customerId: string; salesSessionParticipantId: string; command: { sessionId: string } }; take: number }) => [{ salesSessionParticipantId: args.where.salesSessionParticipantId, outcome: "completed", reason: null, command: { correlationId: `corr-${args.where.salesSessionParticipantId}` } }]);
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-a", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) }, salesSessionParticipant: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([row(0), row(1)]) }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: invitationFindMany }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    const result = await reader.readPage({ customerId: "customer-a", sessionId: "session-a", query: "", offset: 0, limit: 25, now: new Date() });
    expect(result?.participants).toHaveLength(2);
    expect(invitationFindMany).not.toHaveBeenCalled();
  });
  it("fails closed instead of projecting arbitrary persisted invitation and launch values", async () => {
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-a", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) }, salesSessionParticipant: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([row(0)]) }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([{ salesSessionParticipantId: "p0", commandId: "cmd", revision: 1 }]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([{ commandId: "cmd", phase: "settled", revision: 1, correlationId: "current-corr", targets: [{ salesSessionParticipantId: "p0", outcome: "<script>bad</script>", reason: "secret database value" }] }]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([{ salesSessionParticipantId: "p0", outcome: "invented", reason: "another arbitrary value", command: { correlationId: "latest-corr" } }]) }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([{ salesSessionParticipantId: "p0", operation: "redirect", outcome: "maybe", safeReason: "raw exception", correlationId: "launch-corr" }]) } } as never);
    const result = await reader.readPage({ customerId: "customer-a", sessionId: "session-a", query: "", offset: 0, limit: 25, now: new Date() });
    expect(result?.participants[0]).toMatchObject({ launchOperation: null });
    expect(JSON.stringify(result)).not.toContain("raw exception");
  });
  it("leaves invitation feedback to the workspace projection module", async () => {
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-a", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) }, salesSessionParticipant: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([row(0)]) }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([{ salesSessionParticipantId: "p0", outcome: "failed_retryable", reason: "not_dispatched", command: { correlationId: "latest-corr" } }]) }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    const result = await reader.readPage({ customerId: "customer-a", sessionId: "session-a", query: "", offset: 0, limit: 25, now: new Date() });
    expect(result?.participants[0]).not.toHaveProperty("latestInvitationOutcome");
  });
  it("accepts an absent attention pair when Prisma returns null values", async () => {
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-a", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) }, salesSessionParticipant: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([{ ...row(0), environmentAttentionReason: null, environmentAttentionSource: null }]) }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    await expect(reader.readPage({ customerId: "customer-a", sessionId: "session-a", query: "", offset: 0, limit: 25, now: new Date() })).resolves.toMatchObject({ participants: [{ environmentAttention: null }] });
  });
  it.each([
    { invitationStatus: "invented" },
    { participationStatus: "joining" },
    { environmentStatus: "Secret raw provider state" },
    { environmentStatusCode: 99 },
    { environmentAttentionReason: "raw provider detail", environmentAttentionSource: "unsafe source" },
    { environmentAttentionReason: "environment_ambiguous_for_project", environmentAttentionSource: null },
    { environmentAttentionReason: null, environmentAttentionSource: "cloudshare_v3_owner_email_item_project" },
  ])("fails closed for malformed persisted Participant state %#", async (malformed) => {
    const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-a", end: "2026-12-01T12:00", timeZone: "UTC", sendInvitations: "dontSend" }) }, salesSessionParticipant: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([{ ...row(0), ...malformed }]) }, salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantInvitationTarget: { findMany: vi.fn().mockResolvedValue([]) }, salesParticipantLaunchOperation: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    await expect(reader.readPage({ customerId: "customer-a", sessionId: "session-a", query: "", offset: 0, limit: 25, now: new Date() })).rejects.toThrow("Invalid persisted Participant");
  });
  it("requires unarchived Opportunity and Account ancestry", async () => { const findFirst = vi.fn().mockResolvedValue(null); const reader = createPrismaSalesParticipantWorkspaceReader({ salesDemoSession: { findFirst } } as never); await reader.readPage({ customerId: "c1", sessionId: "s1", query: "", offset: 0, limit: 25, now: new Date() }); expect(findFirst.mock.calls[0][0].where).toMatchObject({ opportunity: { archivedAt: null, account: { archivedAt: null } } }); });
});
