import type { PrismaClient } from "@prisma/client";
import { cancellationIdentity, type SalesCancellationCommand, type SalesCancellationStore } from "@/domain/sales-session-cancellation";

export function createPrismaSalesCancellationStore(prisma: PrismaClient): SalesCancellationStore {
  const read: SalesCancellationStore["read"] = async (customerId, commandId) => {
    const row = await prisma.salesParticipantExtensionCommand.findUnique({ where: { customerId_commandId: { customerId, commandId } } });
    return row?.operation === "cancellation" ? { ...JSON.parse(row.state) as SalesCancellationCommand, revision: row.revision } : null;
  };
  return {
    read,
    async admit(input) {
      const existing = await read(input.customerId, input.commandId);
      if (existing) return { kind: cancellationIdentity(existing) === cancellationIdentity(input) ? "existing" : "mismatch", command: existing };
      const command: SalesCancellationCommand = { ...input, revision: 1, accessState: "pending", finished: false };
      try {
        await prisma.$transaction(async tx => {
          const session = await tx.salesDemoSession.findUnique({ where: { customerId_id: { customerId: input.customerId, id: input.sessionId } } });
          if (!session || session.cloudShareSalesExperienceId !== input.experienceId || session.cancellationRequestedAt) throw new Error("cancellation_identity_mismatch");
          const add = await tx.salesParticipantAddCommand.findFirst({ where: { customerId: input.customerId, sessionId: input.sessionId, state: { in: ["admitted", "dispatched", "needs_attention"] } }, select: { commandId: true } });
          const invitation = await tx.salesParticipantInvitationCommand.findFirst({ where: { customerId: input.customerId, sessionId: input.sessionId, phase: { not: "settled" } }, select: { commandId: true } });
          if (add || invitation) throw new Error("cancellation_publication_in_progress");
          // An Add may have settled after the provider inventory was read. Do
          // not admit that stale target set; the next request must inventory again.
          const participants = await tx.salesSessionParticipant.findMany({ where: { customerId: input.customerId, salesDemoSessionId: input.sessionId }, select: { id: true, cloudShareParticipantId: true, opportunityContactId: true } });
          if (participants.length !== input.targets.length || participants.some(p => !input.targets.some(t => t.participantId === p.id && t.providerParticipantId === p.cloudShareParticipantId && t.contactId === p.opportunityContactId))) throw new Error("cancellation_publication_in_progress");
          await tx.salesParticipantExtensionCommand.create({ data: {
            operation: "cancellation", customerId: input.customerId, commandId: input.commandId, sessionId: input.sessionId, activeSessionId: input.sessionId,
            identity: cancellationIdentity(input), state: JSON.stringify(command),
            targets: { create: input.targets.map(t => ({ salesSessionParticipantId: t.participantId, activeParticipantId: t.participantId, activeEnvironmentId: t.environmentId })) },
          } });
          await tx.salesDemoSession.update({ where: { customerId_id: { customerId: input.customerId, id: input.sessionId } }, data: { cancellationRequestedAt: new Date(input.cancelledAt) } });
        });
      } catch (error) {
        if (error instanceof Error && error.message === "cancellation_publication_in_progress") return { kind: "blocked" };
        if (error instanceof Error && error.message === "cancellation_identity_mismatch") return { kind: "mismatch" };
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
        const raced = await read(input.customerId, input.commandId);
        return raced ? { kind: cancellationIdentity(raced) === cancellationIdentity(input) ? "existing" : "mismatch", command: raced } : { kind: "blocked" };
      }
      return { kind: "new", command };
    },
    async latest(customerId, sessionId) {
      const row = await prisma.salesParticipantExtensionCommand.findFirst({ where: { customerId, sessionId, operation: "cancellation" } });
      return row ? read(customerId, row.commandId) : null;
    },
    async save(command, expectedRevision) {
      const changed = await prisma.salesParticipantExtensionCommand.updateMany({ where: { customerId: command.customerId, commandId: command.commandId, operation: "cancellation", revision: expectedRevision, identity: cancellationIdentity(command) }, data: { state: JSON.stringify(command), revision: { increment: 1 } } });
      // The terminal Session fence is deliberately never released.
      return changed.count === 1;
    },
  };
}
