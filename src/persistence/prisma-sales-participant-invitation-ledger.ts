import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { invitationOutcomes, invitationPhases, invitationResult, invitationScopeHash, type Admission, type CurrentInvitationState, type FinishInvitationCommand, type InvitationPhase, type InvitationTargetOutcome, type RevisionedInvitationCommand, type SalesParticipantInvitationLedger } from "@/domain/sales-participant-invitation-ledger";

const LEASE_MS = 30_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function createPrismaSalesParticipantInvitationLedger(prisma: PrismaClient): SalesParticipantInvitationLedger {
  return {
    async admitBatch(input): Promise<Admission> {
      if (!input.targets.length || new Set(input.targets.map((target) => target.participantId)).size !== input.targets.length) return { kind: "blocked", commandId: input.commandId };
      const scopeHash = invitationScopeHash(input);
      const token = randomBytes(18).toString("hex");
      const lease = new Date(input.at.getTime() + LEASE_MS);
      const existing = await prisma.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } });
      if (existing) {
        if (existing.scopeHash !== scopeHash) return { kind: "blocked", commandId: input.commandId };
        if (!invitationPhases.includes(existing.phase as never)) throw new Error("invalid persisted invitation phase");
        return { kind: "same_command", commandId: input.commandId, command: { customerId: existing.customerId, commandId: existing.commandId, phase: existing.phase as never, revision: existing.revision, correlationId: existing.correlationId } };
      }
      try {
        await prisma.$transaction(async (tx) => {
          const existing = await tx.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, include: { targets: true } });
          if (existing) { if (existing.scopeHash !== scopeHash) throw new Error("command_id_mismatch"); return; }
          const participants = await tx.salesSessionParticipant.findMany({ where: { customerId: input.customerId, salesDemoSessionId: input.sessionId, id: { in: input.targets.map((target) => target.participantId) } }, select: { id: true, invitationStatus: true, updatedAt: true } });
          if (participants.length !== input.targets.length || input.targets.some((target) => { const row = participants.find((candidate) => candidate.id === target.participantId); return !row || row.invitationStatus !== (target.expectedInvitationStatus === "sent" ? "sent" : "notSent") || row.updatedAt.toISOString() !== target.participantRevision; })) throw new Error("blocked");
          await tx.salesParticipantInvitationCommand.create({ data: { customerId: input.customerId, commandId: input.commandId, sessionId: input.sessionId, scopeHash, phase: "admitted", admissionTokenHash: hash(token), admissionLeaseUntil: lease, createdAt: input.at, updatedAt: input.at, targets: { create: input.targets.map((target) => ({ customerId: input.customerId, salesSessionParticipantId: target.participantId, intent: target.intent, expectedInvitationStatus: target.expectedInvitationStatus, participantRevision: target.participantRevision })) } } });
          for (const target of input.targets) await tx.salesParticipantInvitationFence.create({ data: { customerId: input.customerId, salesSessionParticipantId: target.participantId, commandId: input.commandId, acquiredAt: input.at } });
        });
        return { kind: "admitted", commandId: input.commandId, admissionToken: token };
      } catch (error) {
        if (error instanceof Error && error.message === "command_id_mismatch") return { kind: "blocked", commandId: input.commandId };
        if (error instanceof Error && error.message === "blocked") return { kind: "blocked", commandId: input.commandId };
        throw error;
      }
    },
    async markBatchDispatching(customerId, commandId, admissionToken, expectedRevision, at) {
      const command = await prisma.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId, commandId } }, include: { targets: true, fences: true } });
      if (!command || command.revision !== expectedRevision || command.phase !== "admitted" || command.admissionTokenHash !== hash(admissionToken) || !command.admissionLeaseUntil || command.admissionLeaseUntil <= at || command.fences.length !== command.targets.length || command.fences.some((fence) => fence.commandId !== commandId)) throw new Error("invitation admission is no longer current");
      const updated = await prisma.salesParticipantInvitationCommand.updateMany({ where: { customerId, commandId, revision: expectedRevision, phase: "admitted" }, data: { phase: "dispatching", revision: { increment: 1 }, updatedAt: at } });
      if (updated.count !== 1) throw new Error("invitation admission is no longer current");
      const result = await prisma.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId, commandId } } });
      return { customerId: result.customerId, commandId: result.commandId, phase: result.phase as InvitationPhase, revision: result.revision, correlationId: result.correlationId };
    },
    async expireAdmitted(customerId, commandId, expectedRevision, at) {
      const updated = await prisma.$transaction(async (tx) => { const result = await tx.salesParticipantInvitationCommand.updateMany({ where: { customerId, commandId, revision: expectedRevision, phase: "admitted", admissionLeaseUntil: { lte: at } }, data: { phase: "settled", revision: { increment: 1 }, updatedAt: at } }); if (result.count !== 1) throw new Error("admitted command is no longer current"); const targets = await tx.salesParticipantInvitationTarget.findMany({ where: { customerId, commandId } }); for (const target of targets) await tx.salesParticipantInvitationTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId, commandId, salesSessionParticipantId: target.salesSessionParticipantId } }, data: { outcome: "failed_retryable", reason: "failed_retryable" } }); await tx.salesParticipantInvitationFence.deleteMany({ where: { customerId, commandId } }); return tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId, commandId } } }); });
      return { customerId: updated.customerId, commandId: updated.commandId, phase: updated.phase as InvitationPhase, revision: updated.revision, correlationId: updated.correlationId };
    },
    async finishBatch(input: FinishInvitationCommand & { customerId: string; targetOutcomes: readonly InvitationTargetOutcome[] }): Promise<RevisionedInvitationCommand> {
      return prisma.$transaction(async (tx) => {
        const command = await tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, include: { targets: true } });
        if (command.revision !== input.expectedRevision || command.phase !== input.expectedPhase || command.targets.length !== input.targetOutcomes.length || command.targets.some((target) => !input.targetOutcomes.some((outcome) => outcome.participantId === target.salesSessionParticipantId))) throw new Error("invitation command is no longer current");
        const updated = await tx.salesParticipantInvitationCommand.update({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, data: { phase: input.phase, correlationId: input.correlationId, revision: { increment: 1 }, updatedAt: new Date() } });
        for (const outcome of input.targetOutcomes) await tx.salesParticipantInvitationTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId: input.customerId, commandId: input.commandId, salesSessionParticipantId: outcome.participantId } }, data: { outcome: outcome.outcome, reason: outcome.reason } });
        const result = invitationResult({ commandId: input.commandId, outcomes: input.targetOutcomes, correlationId: input.correlationId });
        const releasable = new Set(input.targetOutcomes.filter((outcome) => !["no_replay", "confirmation_required"].includes(outcome.outcome)).map((outcome) => outcome.participantId));
        if (releasable.size) await tx.salesParticipantInvitationFence.deleteMany({ where: { customerId: input.customerId, commandId: input.commandId, salesSessionParticipantId: { in: [...releasable] } } });
        return { customerId: updated.customerId, commandId: updated.commandId, phase: updated.phase as InvitationPhase, revision: updated.revision, correlationId: updated.correlationId };
      });
    },
    async readCurrent(customerId, participantId): Promise<CurrentInvitationState | null> { const fence = await prisma.salesParticipantInvitationFence.findUnique({ where: { customerId_salesSessionParticipantId: { customerId, salesSessionParticipantId: participantId } }, include: { command: { include: { targets: true } } } }); if (!fence) return null; if (!invitationPhases.includes(fence.command.phase as never)) throw new Error("invalid persisted invitation phase"); const outcomes = fence.command.targets.map((target) => { if (!target.outcome || !invitationOutcomes.includes(target.outcome as never)) throw new Error("invalid persisted invitation outcome"); return { participantId: target.salesSessionParticipantId, outcome: target.outcome as never, reason: target.reason }; }); return { command: { customerId: fence.command.customerId, commandId: fence.command.commandId, phase: fence.command.phase as never, revision: fence.command.revision, correlationId: fence.command.correlationId }, outcome: invitationResult({ commandId: fence.command.commandId, outcomes, correlationId: fence.command.correlationId }) }; },
  };
}
