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
      if (existing) return existing.payloadHash !== hash(input.payloadHash) ? { kind: "mismatch" } : { kind: "existing", state: existing.state as AddCommandState, result: result(existing.resultJson) };
      try { await prisma.salesParticipantAddCommand.create({ data: { customerId: input.customerId, commandId: input.commandId, sessionId: input.sessionId, payloadHash: hash(input.payloadHash), state: "admitted", createdAt: input.now, updatedAt: input.now } }); return { kind: "new" }; }
      catch { const row = await prisma.salesParticipantAddCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } }); return row.payloadHash !== hash(input.payloadHash) ? { kind: "mismatch" } : { kind: "existing", state: row.state as AddCommandState, result: result(row.resultJson) }; }
    },
    async markDispatched(input) { const changed = await prisma.salesParticipantAddCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, state: "admitted" }, data: { state: "dispatched", updatedAt: input.now } }); return changed.count === 1; },
    async settle(input) { await prisma.salesParticipantAddCommand.update({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, data: { state: input.state, status: input.result.status, resultJson: JSON.stringify(input.result), correlationId: input.result.body.correlationId ?? null, updatedAt: input.now } }); },
  };
}
