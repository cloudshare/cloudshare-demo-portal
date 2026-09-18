import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantExtensionCommandStore } from "@/domain/sales-participant-extension-command";

export function createPrismaSalesParticipantExtensionCommandStore(prisma: PrismaClient): SalesParticipantExtensionCommandStore {
  const read = async (customerId: string, commandId: string) => {
    const row = await prisma.salesParticipantExtensionCommand.findUnique({ where: { customerId_commandId: { customerId, commandId } }, include: { targets: true } });
    return row ? { customerId: row.customerId, sessionId: row.sessionId, commandId: row.commandId, targetEnd: row.targetEnd, dispatchState: row.dispatchState as never, revision: row.revision, correlationId: row.correlationId, targets: row.targets.map((target) => ({ participantId: target.salesSessionParticipantId, participantRevision: target.participantRevision, environmentId: target.environmentId, preExpiry: target.preExpiry, outcome: target.outcome as never, reason: target.reason, confirmedExpiry: target.confirmedExpiry })) } : null;
  };
  return {
    admit: async (input) => {
      const existing = await read(input.customerId, input.commandId);
      if (existing) return existing.sessionId === input.sessionId && existing.targetEnd === input.targetEnd && existing.targets.map((target) => target.participantId).join(",") === input.targets.map((target) => target.participantId).join(",") ? { kind: "existing", command: existing } : { kind: "mismatch" };
      await prisma.salesParticipantExtensionCommand.create({ data: { customerId: input.customerId, commandId: input.commandId, sessionId: input.sessionId, targetEnd: input.targetEnd, dispatchState: "admitted", createdAt: new Date(), updatedAt: new Date(), targets: { create: input.targets.map((target) => ({ salesSessionParticipantId: target.participantId, participantRevision: target.participantRevision, environmentId: target.environmentId, preExpiry: target.preExpiry, outcome: "pending" })) } } });
      return { kind: "new", command: await read(input.customerId, input.commandId) ?? undefined };
    },
    markDispatching: async (input) => (await prisma.salesParticipantExtensionCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, revision: input.expectedRevision, dispatchState: "admitted" }, data: { dispatchState: "dispatching", revision: { increment: 1 }, updatedAt: new Date() } })).count === 1,
    settle: async (input) => { await prisma.$transaction(async (tx) => { await tx.salesParticipantExtensionCommand.update({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, data: { dispatchState: input.dispatchState, correlationId: input.correlationId, revision: { increment: 1 }, updatedAt: new Date() } }); for (const target of input.targets) await tx.salesParticipantExtensionTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId: input.customerId, commandId: input.commandId, salesSessionParticipantId: target.participantId } }, data: { outcome: target.outcome, reason: target.reason, confirmedExpiry: target.confirmedExpiry } }); }); return (await read(input.customerId, input.commandId))!; },
    read,
  };
}
