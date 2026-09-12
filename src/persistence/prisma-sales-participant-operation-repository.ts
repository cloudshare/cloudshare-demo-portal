import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantOperationCapability, SalesParticipantOperationDisposition, SalesParticipantOperationRepository, SalesParticipantOperationState } from "@/domain/sales-participant-operation";

const capabilities = new Set<SalesParticipantOperationCapability>(["email", "launch"]);
const dispositions = new Set<SalesParticipantOperationDisposition>(["ready", "pending_confirmation", "no_replay", "confirmed", "failed_retryable"]);

function project(row: any): SalesParticipantOperationState | null {
  if (!capabilities.has(row.capability) || !dispositions.has(row.disposition) || typeof row.resultMetadata !== "object" || row.resultMetadata === null || Array.isArray(row.resultMetadata)) return null;
  return { customerId: row.customerId, participantId: row.salesSessionParticipantId, capability: row.capability, disposition: row.disposition, correlationId: row.correlationId, resultMetadata: row.resultMetadata, startedAt: row.startedAt, updatedAt: row.updatedAt, confirmedAt: row.confirmedAt };
}

export function createPrismaSalesParticipantOperationRepository(prisma: PrismaClient): SalesParticipantOperationRepository {
  return {
    async get(customerId, participantId, capability) {
      const row = await prisma.salesParticipantOperationState.findUnique({ where: { customerId_salesSessionParticipantId_capability: { customerId, salesSessionParticipantId: participantId, capability } } });
      return row ? project(row) : null;
    },
    async save(state) {
      await prisma.salesParticipantOperationState.upsert({
        where: { customerId_salesSessionParticipantId_capability: { customerId: state.customerId, salesSessionParticipantId: state.participantId, capability: state.capability } },
        create: { id: `${state.participantId}:${state.capability}`, customerId: state.customerId, salesSessionParticipantId: state.participantId, capability: state.capability, disposition: state.disposition, correlationId: state.correlationId, resultMetadata: state.resultMetadata, startedAt: state.startedAt, updatedAt: state.updatedAt, confirmedAt: state.confirmedAt },
        update: { disposition: state.disposition, correlationId: state.correlationId, resultMetadata: state.resultMetadata, startedAt: state.startedAt, updatedAt: state.updatedAt, confirmedAt: state.confirmedAt },
      });
    },
    async listForParticipants(customerId, participantIds) {
      const rows = await prisma.salesParticipantOperationState.findMany({ where: { customerId, salesSessionParticipantId: { in: [...participantIds] } } });
      return rows.map(project).filter((row): row is SalesParticipantOperationState => row !== null);
    },
  };
}
