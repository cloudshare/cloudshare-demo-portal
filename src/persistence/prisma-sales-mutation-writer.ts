import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { redactAuditDetails, type AuditRecord } from "@/domain/audit-trail";
import type { DiagnosticLogEntryInput } from "@/domain/diagnostic-log";
import type { SalesMutationWriter } from "@/domain/sales-mutation-writer";

export function createPrismaSalesMutationWriter(prisma: PrismaClient): SalesMutationWriter {
  return {
    async commit(input) {
      return prisma.$transaction(async (tx) => {
        if (input.activeParentGuard && !await reserveActiveParent(tx, input.activeParentGuard)) {
          await tx.auditTrailEntry.create({ data: toAuditRow(input.activeParentGuard.deniedAudit) });
          await tx.diagnosticLogEntry.create({ data: toDiagnosticRow(input.activeParentGuard.deniedDiagnostic) });
          return { outcome: "parent_archived" } as const;
        }
        if (input.record?.type === "account") await tx.salesAccount.upsert({ where: { id: input.record.value.id }, update: input.record.value, create: input.record.value });
        if (input.record?.type === "opportunity") await tx.salesOpportunity.upsert({ where: { id: input.record.value.id }, update: input.record.value, create: input.record.value });
        if (input.record?.type === "opportunity_contact") await tx.opportunityContact.upsert({ where: { id: input.record.value.id }, update: input.record.value, create: input.record.value });
        await tx.auditTrailEntry.create({ data: toAuditRow(input.audit) });
        await tx.diagnosticLogEntry.create({ data: toDiagnosticRow(input.diagnostic) });
        return { outcome: "committed" } as const;
      });
    },
  };
}

/**
 * A conditional no-op update makes the active-parent predicate part of the
 * transaction's write set. That serializes a concurrent archive with the child
 * write without changing any displayed parent field.
 */
async function reserveActiveParent(
  tx: Prisma.TransactionClient,
  guard: import("@/domain/sales-mutation-writer").ActiveSalesParentGuard,
): Promise<boolean> {
  const where = { id: guard.id, customerId: guard.customerId, archivedAt: null };
  const result = guard.type === "account"
    ? await tx.salesAccount.updateMany({ where, data: { id: guard.id } })
    : await tx.salesOpportunity.updateMany({ where, data: { id: guard.id } });
  return result.count === 1;
}

function toAuditRow(record: AuditRecord) {
  const details = redactAuditDetails(record.details);
  return { id: record.id, occurredAt: record.occurredAt, customerId: record.customerId ?? null, actorType: record.actorType ?? null, actorId: record.actorId ?? null, actorEmail: record.actorEmail?.toLowerCase() ?? null, action: record.action, subjectType: record.subjectType ?? null, subjectId: record.subjectId ?? null, outcome: record.outcome, candidateId: record.candidateId ?? null, candidateEmail: record.candidateEmail?.toLowerCase() ?? null, examId: record.examId ?? null, examAttemptId: record.examAttemptId ?? null, correlationId: record.correlationId ?? null, detailsJson: details ? JSON.stringify(details) : null, error: record.error ?? null };
}

function toDiagnosticRow(input: DiagnosticLogEntryInput) {
  return { id: randomUUID(), occurredAt: input.occurredAt ?? new Date(), level: input.level ?? "info", source: input.source, operation: input.operation, outcome: input.outcome, customerId: input.customerId ?? null, actorType: input.actor?.type ?? null, actorId: input.actor?.id ?? null, actorEmail: input.actor?.email?.toLowerCase() ?? null, subjectType: input.subject?.type ?? null, subjectId: input.subject?.id ?? null, message: input.message, correlationId: input.correlationId ?? null, candidateEmail: input.candidateEmail?.toLowerCase() ?? null, examId: input.examId ?? null, examAttemptId: input.examAttemptId ?? null, externalIdsJson: input.externalIds ? JSON.stringify(input.externalIds) : null, requestJson: input.request ? JSON.stringify(input.request) : null, responseJson: input.response ? JSON.stringify(input.response) : null, detailsJson: input.details ? JSON.stringify(input.details) : null };
}
