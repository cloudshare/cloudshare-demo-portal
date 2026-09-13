import { describe, expect, it, vi } from "vitest";
import { createPrismaInvitationStore } from "./prisma-sales-participant-invitation-ledger";

function prismaProjectionFixture(overrides: { readonly fences?: unknown[]; readonly commands?: unknown[]; readonly latest?: Readonly<Record<string, unknown[]>> } = {}) {
  const latest = overrides.latest ?? {};
  return {
    salesParticipantInvitationFence: { findMany: vi.fn().mockResolvedValue(overrides.fences ?? []) },
    salesParticipantInvitationCommand: { findMany: vi.fn().mockResolvedValue(overrides.commands ?? []) },
    salesParticipantInvitationTarget: { findMany: vi.fn((args: { where: { salesSessionParticipantId: string } }) => Promise.resolve(latest[args.where.salesSessionParticipantId] ?? [])) },
  };
}

describe("Prisma invitation safe workspace projection", () => {
  it("projects current and latest feedback only for the exact Customer, Session, and bounded participant page", async () => {
    const prisma = prismaProjectionFixture({
      fences: [{ salesSessionParticipantId: "p1", commandId: "current", revision: 3 }],
      commands: [{ commandId: "current", revision: 3, correlationId: "corr-current", targets: [{ salesSessionParticipantId: "p1", outcome: "confirmation_required", reason: "confirmation_required" }] }],
      latest: {
        p1: [{ salesSessionParticipantId: "p1", outcome: "failed_retryable", reason: "not_dispatched", command: { correlationId: "corr-latest" } }],
        p2: [],
      },
    });
    const store = createPrismaInvitationStore(prisma as never);
    const result = await store.readParticipantProjections({ customerId: "customer-a", sessionId: "session-a", participantIds: ["p1", "p2"] });
    expect(result.get("p1")).toMatchObject({ currentCommandId: "current", invitationOutcome: "confirmation_required", invitationCorrelationId: "corr-current", latestInvitationOutcome: "failed_retryable", latestInvitationReason: "not_dispatched", latestInvitationCorrelationId: "corr-latest" });
    expect(result.get("p2")).toMatchObject({ currentCommandId: null, invitationOutcome: null, latestInvitationOutcome: null });
    expect(prisma.salesParticipantInvitationFence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: "customer-a", salesSessionParticipantId: { in: ["p1", "p2"] } } }));
    expect(prisma.salesParticipantInvitationCommand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: "customer-a", sessionId: "session-a", commandId: { in: ["current"] } } }));
  });

  it("fails closed for corrupt outcomes and mismatched current fences", async () => {
    const corrupt = createPrismaInvitationStore(prismaProjectionFixture({ latest: { p1: [{ salesSessionParticipantId: "p1", outcome: "raw-secret-state", reason: null, command: { correlationId: "corr" } }] } }) as never);
    await expect(corrupt.readParticipantProjections({ customerId: "customer-a", sessionId: "session-a", participantIds: ["p1"] })).rejects.toThrow("invalid persisted invitation outcome");
    const mismatched = createPrismaInvitationStore(prismaProjectionFixture({ fences: [{ salesSessionParticipantId: "p1", commandId: "current", revision: 4 }], commands: [{ commandId: "current", revision: 3, correlationId: null, targets: [] }] }) as never);
    await expect(mismatched.readParticipantProjections({ customerId: "customer-a", sessionId: "session-a", participantIds: ["p1"] })).rejects.toThrow("invalid persisted invitation fence");
  });

  it("rejects duplicate or unbounded participant projection scopes", async () => {
    const store = createPrismaInvitationStore(prismaProjectionFixture() as never);
    await expect(store.readParticipantProjections({ customerId: "c", sessionId: "s", participantIds: ["p1", "p1"] })).rejects.toThrow("invalid invitation projection scope");
    await expect(store.readParticipantProjections({ customerId: "c", sessionId: "s", participantIds: Array.from({ length: 51 }, (_, index) => `p${index}`) })).rejects.toThrow("invalid invitation projection scope");
  });
});
