import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantAddCommandStore, AddCommandState } from "@/domain/sales-participant-add-command";
import type { SalesParticipantWorkspaceAddParticipantResult } from "@/domain/sales-participant-workspace";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const result = (json: string | null): SalesParticipantWorkspaceAddParticipantResult | undefined => { if (!json) return undefined; try { return JSON.parse(json) as SalesParticipantWorkspaceAddParticipantResult; } catch { throw new Error("Invalid persisted participant add result"); } };
export function createPrismaSalesParticipantAddCommandStore(prisma: PrismaClient): SalesParticipantAddCommandStore {
  return {
    async admit(input) {
      const existing = await prisma.salesParticipantAddCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } });
      const target = input.targetKey ? await prisma.salesParticipantAddCommand.findUnique({ where: { customerId_sessionId_targetKey: { customerId: input.customerId, sessionId: input.sessionId, targetKey: input.targetKey } } }) : null;
      if (target && target.commandId !== input.commandId) return { kind: "existing", state: target.state as AddCommandState, result: result(target.resultJson) };
      if (existing) {
        if (existing.payloadHash !== hash(input.payloadHash)) return { kind: "mismatch" };
        // A process may have died after crossing the fence. This is an
        // ambiguous provider write: persist attention and never return 202.
        if (existing.state === "dispatched" && !existing.resultJson) {
          const attention: SalesParticipantWorkspaceAddParticipantResult = { status: 409, body: { outcome: "needs_attention", code: "participant_add_no_replay", error: "Participant add requires attention." } };
          await prisma.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, state: "dispatched", resultJson: null }, data: { state: "needs_attention", status: 409, resultJson: JSON.stringify(attention), updatedAt: input.now } });
          return { kind: "existing", state: "needs_attention", result: attention };
        }
        return { kind: "existing", state: existing.state as AddCommandState, result: result(existing.resultJson) };
      }
      try { await prisma.salesParticipantAddCommand.create({ data: { customerId: input.customerId, commandId: input.commandId, sessionId: input.sessionId, targetKey: input.targetKey ?? `command:${input.commandId}`, payloadHash: hash(input.payloadHash), state: "admitted", createdAt: input.now, updatedAt: input.now } }); return { kind: "new" }; }
      catch { const row = await prisma.salesParticipantAddCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } }); const winner = row ?? (input.targetKey ? await prisma.salesParticipantAddCommand.findUniqueOrThrow({ where: { customerId_sessionId_targetKey: { customerId: input.customerId, sessionId: input.sessionId, targetKey: input.targetKey } } }) : null); if (!winner) throw new Error("Participant add admission failed"); return row && row.payloadHash !== hash(input.payloadHash) ? { kind: "mismatch" } : { kind: "existing", state: winner.state as AddCommandState, result: result(winner.resultJson) }; }
    },
    async markDispatched(input) { const changed = await prisma.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, state: "admitted" }, data: { state: "dispatched", updatedAt: input.now } }); return changed.count === 1; },
    async settle(input) {
      const current = await prisma.salesParticipantAddCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, select: { state: true, targetKey: true } });
      if (!current) throw new Error("Participant add command not found");
      const preDispatch = current.state === "admitted";
      const changed = await prisma.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, state: current.state, targetKey: current.targetKey }, data: { state: input.state, targetKey: preDispatch ? `command:${input.commandId}` : current.targetKey, status: input.result.status, resultJson: JSON.stringify(input.result), correlationId: input.result.body.correlationId ?? null, updatedAt: input.now } });
      if (changed.count !== 1) throw new Error("Participant add command settlement lost its ownership fence");
    },
  };
}
