import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantAddCommandStore, AddCommandState } from "@/domain/sales-participant-add-command";
import type { SalesParticipantWorkspaceAddParticipantResult } from "@/domain/sales-participant-workspace";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const result = (json: string | null): SalesParticipantWorkspaceAddParticipantResult | undefined => { if (!json) return undefined; try { return JSON.parse(json) as SalesParticipantWorkspaceAddParticipantResult; } catch { throw new Error("Invalid persisted participant add result"); } };
export function createPrismaSalesParticipantAddCommandStore(prisma: PrismaClient): SalesParticipantAddCommandStore {
  return {
    async findForReconciliation(input) {
      const row = await prisma.salesParticipantAddCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } });
      if (!row || row.sessionId !== input.sessionId) return null;
      return { state: row.state as AddCommandState, targetKey: row.targetKey, result: result(row.resultJson) };
    },
    async admit(input) {
      return prisma.$transaction(async tx => {
        const session = await tx.salesDemoSession.findUnique({ where: { customerId_id: { customerId: input.customerId, id: input.sessionId } }, select: { cancellationRequestedAt: true } });
        if (!session || session.cancellationRequestedAt) return { kind: "blocked" };
      const existing = await tx.salesParticipantAddCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } });
      const target = input.targetKey ? await tx.salesParticipantAddCommand.findUnique({ where: { customerId_sessionId_targetKey: { customerId: input.customerId, sessionId: input.sessionId, targetKey: input.targetKey } } }) : null;
      if (existing) {
        if (existing.payloadHash !== hash(input.payloadHash)) return { kind: "mismatch" };
        if (existing.state === "admitted" && !existing.resultJson) return { kind: "new" };
        // A process may have died after crossing the fence. This is an
        // ambiguous provider write: persist attention and never return 202.
        if (existing.state === "dispatched" && !existing.resultJson) {
          const attention: SalesParticipantWorkspaceAddParticipantResult = { status: 409, body: { outcome: "needs_attention", code: "participant_add_no_replay", error: "Participant add requires attention." } };
          await tx.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, state: "dispatched", resultJson: null }, data: { state: "needs_attention", status: 409, resultJson: JSON.stringify(attention), updatedAt: input.now } });
          return { kind: "existing", commandId: existing.commandId, state: "needs_attention", result: attention };
        }
        return { kind: "existing", commandId: existing.commandId, state: existing.state as AddCommandState, result: result(existing.resultJson) };
      }
      if (target && target.commandId !== input.commandId) {
        if (target.state === "dispatched" && !target.resultJson) {
          const attention: SalesParticipantWorkspaceAddParticipantResult = { status: 409, body: { outcome: "needs_attention", code: "participant_add_no_replay", error: "Participant add requires attention." } };
          await tx.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: target.commandId, state: "dispatched", resultJson: null }, data: { state: "needs_attention", status: 409, resultJson: JSON.stringify(attention), updatedAt: input.now } });
          return { kind: "existing", commandId: target.commandId, state: "needs_attention", result: attention };
        }
        const targetResult = result(target.resultJson);
        if (targetResult?.body.outcome === "registered") return { kind: "existing", commandId: target.commandId, state: target.state as AddCommandState, result: { status: 200, body: { ...targetResult.body, outcome: "already_registered", code: "already_registered" } } };
        return { kind: "existing", commandId: target.commandId, state: target.state as AddCommandState, result: targetResult };
      }
      try { await tx.salesParticipantAddCommand.create({ data: { customerId: input.customerId, commandId: input.commandId, sessionId: input.sessionId, targetKey: input.targetKey ?? `command:${input.commandId}`, payloadHash: hash(input.payloadHash), state: "admitted", createdAt: input.now, updatedAt: input.now } }); return { kind: "new" }; }
      catch { const row = await tx.salesParticipantAddCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } }); const winner = row ?? (input.targetKey ? await tx.salesParticipantAddCommand.findUniqueOrThrow({ where: { customerId_sessionId_targetKey: { customerId: input.customerId, sessionId: input.sessionId, targetKey: input.targetKey } } }) : null); if (!winner) throw new Error("Participant add admission failed"); return row && row.payloadHash !== hash(input.payloadHash) ? { kind: "mismatch" } : { kind: "existing", commandId: winner.commandId, state: winner.state as AddCommandState, result: result(winner.resultJson) }; }
      });
    },
    async markDispatched(input) {
      return prisma.$transaction(async tx => {
        const command = await tx.salesParticipantAddCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } });
        if (!command) return false;
        const session = await tx.salesDemoSession.findUnique({ where: { customerId_id: { customerId: input.customerId, id: command.sessionId } }, select: { cancellationRequestedAt: true } });
        if (!session || session.cancellationRequestedAt) return false;
        const changed = await tx.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, state: "admitted" }, data: { state: "dispatched", updatedAt: input.now } });
        return changed.count === 1;
      });
    },
    async settle(input) {
      const current = await prisma.salesParticipantAddCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, select: { state: true, targetKey: true } });
      if (!current) throw new Error("Participant add command not found");
      const preDispatch = current.state === "admitted" || (input.provenNotDispatched === true && current.state === "dispatched");
      const changed = await prisma.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, state: current.state, targetKey: current.targetKey }, data: { state: input.state, targetKey: preDispatch ? `command:${input.commandId}` : current.targetKey, status: input.result.status, resultJson: JSON.stringify(input.result), correlationId: input.result.body.correlationId ?? null, updatedAt: input.now } });
      if (changed.count !== 1) throw new Error("Participant add command settlement lost its ownership fence");
    },
    async reclassifyProvenPreDispatch(input) {
      const retryable: SalesParticipantWorkspaceAddParticipantResult = { status: 503, body: { outcome: "rejected", code: "participant_add_retryable", error: "CloudShare authentication failed before participant registration was sent. Retry is safe.", dispatchOutcome: "not_dispatched", correlationId: input.correlationId } };
      const changed = await prisma.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, state: "needs_attention", correlationId: input.correlationId }, data: { state: "settled", status: 503, targetKey: `command:${input.commandId}`, resultJson: JSON.stringify(retryable), updatedAt: input.now } });
      return changed.count === 1;
    },
  };
}
