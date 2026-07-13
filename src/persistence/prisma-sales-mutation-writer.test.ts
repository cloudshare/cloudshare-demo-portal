import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaSalesMutationWriter } from "./prisma-sales-mutation-writer";

const prisma = new PrismaClient();
const createdCustomerIds = new Set<string>();

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  const ids = [...createdCustomerIds];
  createdCustomerIds.clear();
  if (ids.length > 0) await prisma.customer.deleteMany({ where: { id: { in: ids } } });
});

describe("createPrismaSalesMutationWriter", () => {
  it("atomically denies a child mutation when its Customer-scoped parent is archived", async () => {
    const suffix = Date.now().toString();
    const customerId = `sales-writer-${suffix}`;
    const accountId = `sales-account-${suffix}`;
    const opportunityId = `sales-opportunity-${suffix}`;
    const occurredAt = new Date("2026-07-12T17:00:00.000Z");
    createdCustomerIds.add(customerId);
    await prisma.customer.create({ data: { id: customerId, slug: `sales-writer-${suffix}`, name: "Certalis" } });
    await prisma.salesAccount.create({ data: { id: accountId, customerId, name: "Archived account", kind: "prospect", archivedAt: occurredAt, createdAt: occurredAt, updatedAt: occurredAt } });

    const result = await createPrismaSalesMutationWriter(prisma).commit({
      record: { type: "opportunity", value: { id: opportunityId, customerId, accountId, name: "Late proof", status: "open", archivedAt: null, createdAt: occurredAt, updatedAt: occurredAt } },
      audit: { id: `audit-success-${suffix}`, occurredAt, customerId, actorType: "admin", actorId: "admin-1", action: "opportunity.created", subjectType: "opportunity", subjectId: opportunityId, outcome: "success" },
      diagnostic: { source: "sales-records", operation: "opportunity.created", outcome: "success", customerId, message: "should not be written" },
      activeParentGuard: {
        type: "account",
        id: accountId,
        customerId,
        deniedAudit: { id: `audit-denied-${suffix}`, occurredAt, customerId, actorType: "admin", actorId: "admin-1", action: "opportunity.created", subjectType: "account", subjectId: accountId, outcome: "denied" },
        deniedDiagnostic: { source: "sales-records", operation: "opportunity.created", outcome: "failure", customerId, level: "warn", message: "parent archived" },
      },
    });

    expect(result).toEqual({ outcome: "parent_archived" });
    await expect(prisma.salesOpportunity.findUnique({ where: { id: opportunityId } })).resolves.toBeNull();
    await expect(prisma.auditTrailEntry.findUnique({ where: { id: `audit-denied-${suffix}` } })).resolves.toMatchObject({ outcome: "denied", customerId, subjectId: accountId });
    await expect(prisma.auditTrailEntry.findUnique({ where: { id: `audit-success-${suffix}` } })).resolves.toBeNull();
    await expect(prisma.diagnosticLogEntry.findFirst({ where: { customerId, operation: "opportunity.created" } })).resolves.toMatchObject({ outcome: "failure" });
    await expect(prisma.diagnosticLogEntry.findMany({ where: { customerId, outcome: "success" } })).resolves.toEqual([]);
  });

  it("never lets a stale active patch reactivate an archived record", async () => {
    const suffix = `${Date.now()}-patch`;
    const customerId = `sales-writer-${suffix}`;
    const accountId = `sales-account-${suffix}`;
    const occurredAt = new Date("2026-07-12T17:00:00.000Z");
    createdCustomerIds.add(customerId);
    await prisma.customer.create({ data: { id: customerId, slug: `sales-writer-${suffix}`, name: "Certalis" } });
    await prisma.salesAccount.create({ data: { id: accountId, customerId, name: "Archived account", kind: "prospect", archivedAt: occurredAt, createdAt: occurredAt, updatedAt: occurredAt } });

    const result = await createPrismaSalesMutationWriter(prisma).commit({
      record: { type: "account", value: { id: accountId, customerId, name: "Stale rename", kind: "prospect", archivedAt: null, createdAt: occurredAt, updatedAt: new Date("2026-07-12T17:01:00.000Z") } },
      audit: { id: `audit-success-${suffix}`, occurredAt, customerId, actorType: "admin", actorId: "admin-1", action: "account.updated", subjectType: "account", subjectId: accountId, outcome: "success" },
      diagnostic: { source: "sales-records", operation: "account.updated", outcome: "success", customerId, message: "should not be written" },
      activeRecordGuard: {
        type: "account",
        id: accountId,
        customerId,
        deniedAudit: { id: `audit-denied-${suffix}`, occurredAt, customerId, actorType: "admin", actorId: "admin-1", action: "account.updated", subjectType: "account", subjectId: accountId, outcome: "denied" },
        deniedDiagnostic: { source: "sales-records", operation: "account.updated", outcome: "failure", customerId, level: "warn", message: "record archived" },
      },
    });

    expect(result).toEqual({ outcome: "record_archived" });
    await expect(prisma.salesAccount.findUnique({ where: { id: accountId } })).resolves.toMatchObject({ name: "Archived account", archivedAt: occurredAt });
    await expect(prisma.auditTrailEntry.findUnique({ where: { id: `audit-denied-${suffix}` } })).resolves.toMatchObject({ outcome: "denied", customerId, subjectId: accountId });
    await expect(prisma.auditTrailEntry.findUnique({ where: { id: `audit-success-${suffix}` } })).resolves.toBeNull();
    await expect(prisma.diagnosticLogEntry.findMany({ where: { customerId, outcome: "success" } })).resolves.toEqual([]);
  });

  it("guards stale Opportunity and Contact patches in their real Prisma branches", async () => {
    const suffix = `${Date.now()}-children`;
    const customerId = `sales-writer-${suffix}`;
    const accountId = `sales-account-${suffix}`;
    const opportunityId = `sales-opportunity-${suffix}`;
    const contactId = `sales-contact-${suffix}`;
    const occurredAt = new Date("2026-07-12T17:00:00.000Z");
    createdCustomerIds.add(customerId);
    await prisma.customer.create({ data: { id: customerId, slug: `sales-writer-${suffix}`, name: "Certalis" } });
    await prisma.salesAccount.create({ data: { id: accountId, customerId, name: "Account", kind: "prospect", archivedAt: null, createdAt: occurredAt, updatedAt: occurredAt } });
    await prisma.salesOpportunity.create({ data: { id: opportunityId, customerId, accountId, name: "Archived opportunity", status: "lost", archivedAt: occurredAt, createdAt: occurredAt, updatedAt: occurredAt } });
    await prisma.opportunityContact.create({ data: { id: contactId, customerId, opportunityId, firstName: "Ada", lastName: "Lovelace", email: `ada-${suffix}@acme.test`, archivedAt: occurredAt, createdAt: occurredAt, updatedAt: occurredAt } });
    const writer = createPrismaSalesMutationWriter(prisma);

    const opportunityResult = await writer.commit({
      record: { type: "opportunity", value: { id: opportunityId, customerId, accountId, name: "Stale rename", status: "won", archivedAt: null, createdAt: occurredAt, updatedAt: new Date("2026-07-12T17:01:00.000Z") } },
      audit: { id: `audit-success-opportunity-${suffix}`, occurredAt, customerId, action: "opportunity.updated", outcome: "success" },
      diagnostic: { source: "sales-records", operation: "opportunity.updated", outcome: "success", customerId, message: "should not be written" },
      activeRecordGuard: deniedRecordGuard("opportunity", opportunityId, customerId, occurredAt, suffix),
    });
    const contactResult = await writer.commit({
      record: { type: "opportunity_contact", value: { id: contactId, customerId, opportunityId, firstName: "Ada", lastName: "Byron", email: `ada-${suffix}@acme.test`, archivedAt: null, createdAt: occurredAt, updatedAt: new Date("2026-07-12T17:01:00.000Z") } },
      audit: { id: `audit-success-contact-${suffix}`, occurredAt, customerId, action: "opportunity_contact.updated", outcome: "success" },
      diagnostic: { source: "sales-records", operation: "opportunity_contact.updated", outcome: "success", customerId, message: "should not be written" },
      activeRecordGuard: deniedRecordGuard("opportunity_contact", contactId, customerId, occurredAt, suffix),
    });

    expect(opportunityResult).toEqual({ outcome: "record_archived" });
    expect(contactResult).toEqual({ outcome: "record_archived" });
    await expect(prisma.salesOpportunity.findUnique({ where: { id: opportunityId } })).resolves.toMatchObject({ name: "Archived opportunity", archivedAt: occurredAt });
    await expect(prisma.opportunityContact.findUnique({ where: { id: contactId } })).resolves.toMatchObject({ lastName: "Lovelace", archivedAt: occurredAt });
    await expect(prisma.auditTrailEntry.findMany({ where: { customerId, outcome: "success" } })).resolves.toEqual([]);
    await expect(prisma.diagnosticLogEntry.findMany({ where: { customerId, outcome: "success" } })).resolves.toEqual([]);
    await expect(prisma.auditTrailEntry.findMany({ where: { customerId, outcome: "denied" } })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "opportunity.updated", subjectId: opportunityId }),
      expect.objectContaining({ action: "opportunity_contact.updated", subjectId: contactId }),
    ]));
    await expect(prisma.diagnosticLogEntry.findMany({ where: { customerId, outcome: "failure" } })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "opportunity.updated" }),
      expect.objectContaining({ operation: "opportunity_contact.updated" }),
    ]));
  });
});

function deniedRecordGuard(type: "opportunity" | "opportunity_contact", id: string, customerId: string, occurredAt: Date, suffix: string) {
  return {
    type,
    id,
    customerId,
    deniedAudit: { id: `audit-denied-${type}-${suffix}`, occurredAt, customerId, action: `${type}.updated`, subjectType: type, subjectId: id, outcome: "denied" as const },
    deniedDiagnostic: { source: "sales-records", operation: `${type}.updated`, outcome: "failure" as const, customerId, level: "warn" as const, message: "record archived" },
  };
}
