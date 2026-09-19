import type { PrismaClient } from "@prisma/client";
import { extensionIdentity, newExtensionCommand, type SalesParticipantExtensionCommand, type SalesParticipantExtensionCommandStore } from "@/domain/sales-participant-extension-command";
export function createPrismaSalesParticipantExtensionCommandStore(prisma: PrismaClient): SalesParticipantExtensionCommandStore {
  const read: SalesParticipantExtensionCommandStore["read"] = async (customerId, commandId) => {
    const row = await prisma.salesParticipantExtensionCommand.findUnique({ where: { customerId_commandId: { customerId, commandId } } });
    return row ? { ...JSON.parse(row.state) as SalesParticipantExtensionCommand, revision: row.revision } : null;
  };
  return {
    read,
    async admit(input) {
      const existing = await read(input.customerId, input.commandId);
      if (existing) return { kind: extensionIdentity(existing) === extensionIdentity(input) ? "existing" : "mismatch", command: existing };
      const command = newExtensionCommand(input);
      try {
        await prisma.$transaction(async tx => {
          const previous = await tx.salesParticipantExtensionCommand.findFirst({ where: { customerId: input.customerId, sessionId: input.sessionId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
          // Explicit millisecond timestamps advance even within the same clock
          // tick. The transaction plus active Session fence serialize admission.
          const createdAt = new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1));
          await tx.salesParticipantExtensionCommand.create({ data: {
          createdAt,
          customerId: input.customerId, commandId: input.commandId, sessionId: input.sessionId, activeSessionId: input.sessionId,
          identity: extensionIdentity(input), state: JSON.stringify(command),
          targets: { create: command.targets.map(t => ({ salesSessionParticipantId: t.participantId, activeParticipantId: t.participantId, activeEnvironmentId: t.environmentId })) },
        } });
        });
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
        const raced = await read(input.customerId, input.commandId);
        return raced ? { kind: extensionIdentity(raced) === extensionIdentity(input) ? "existing" : "mismatch", command: raced } : { kind: "blocked" };
      }
      return { kind: "new", command };
    },
    async latest(customerId, sessionId) {
      // Recovery must expose the owned command even for legacy timestamp ties.
      const active = await prisma.salesParticipantExtensionCommand.findUnique({ where: { customerId_activeSessionId: { customerId, activeSessionId: sessionId } } });
      const row = active ?? await prisma.salesParticipantExtensionCommand.findFirst({ where: { customerId, sessionId }, orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }, { commandId: "desc" }] });
      return row ? read(customerId, row.commandId) : null;
    },
    async save(command, expectedRevision) {
      return prisma.$transaction(async tx => {
        const changed = await tx.salesParticipantExtensionCommand.updateMany({ where: { customerId: command.customerId, commandId: command.commandId, revision: expectedRevision, identity: extensionIdentity(command) }, data: { state: JSON.stringify(command), revision: { increment: 1 }, activeSessionId: command.finished ? null : command.sessionId } });
        if (changed.count !== 1) return false;
        if (command.finished) await tx.salesParticipantExtensionTarget.updateMany({ where: { customerId: command.customerId, commandId: command.commandId }, data: { activeParticipantId: null, activeEnvironmentId: null } });
        return true;
      });
    },
  };
}
