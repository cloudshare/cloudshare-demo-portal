import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaSalesDemoSessionRepository } from "./prisma-sales-demo-session-repository";

const prisma = new PrismaClient();
const createdCustomerIds = new Set<string>();

afterAll(async () => { await prisma.$disconnect(); });
afterEach(async () => {
  const ids = [...createdCustomerIds];
  createdCustomerIds.clear();
  if (ids.length > 0) await prisma.customer.deleteMany({ where: { id: { in: ids } } });
});

describe("Prisma Sales Enablement Session repository discardReservation", () => {
  it("deletes exactly one matching pending reservation and preserves every mismatched or advanced row", async () => {
    const suffix = randomUUID();
    const certalisId = `sales-reservation-certalis-${suffix}`;
    const heliosId = `sales-reservation-helios-${suffix}`;
    const certalisOpportunityId = `sales-reservation-opportunity-certalis-${suffix}`;
    const heliosOpportunityId = `sales-reservation-opportunity-helios-${suffix}`;
    const itemId = `sales-reservation-item-${suffix}`;
    const sessionId = `sales-reservation-session-${suffix}`;
    createdCustomerIds.add(certalisId); createdCustomerIds.add(heliosId);
    await prisma.customer.createMany({ data: [
      { id: certalisId, slug: `sales-reservation-certalis-${suffix}`, name: "Certalis" },
      { id: heliosId, slug: `sales-reservation-helios-${suffix}`, name: "Helios" },
    ] });
    const createdAt = new Date();
    await prisma.salesAccount.createMany({ data: [
      { id: `sales-reservation-account-certalis-${suffix}`, customerId: certalisId, name: "Certalis account", kind: "prospect", createdAt, updatedAt: createdAt },
      { id: `sales-reservation-account-helios-${suffix}`, customerId: heliosId, name: "Helios account", kind: "prospect", createdAt, updatedAt: createdAt },
    ] });
    await prisma.salesOpportunity.createMany({ data: [
      { id: certalisOpportunityId, customerId: certalisId, accountId: `sales-reservation-account-certalis-${suffix}`, name: "Certalis opportunity", status: "open", createdAt, updatedAt: createdAt },
      { id: heliosOpportunityId, customerId: heliosId, accountId: `sales-reservation-account-helios-${suffix}`, name: "Helios opportunity", status: "open", createdAt, updatedAt: createdAt },
    ] });
    await prisma.item.create({ data: { id: itemId, customerId: certalisId, name: "Reservation item", description: "", projectId: "project-1", projectName: "Project", blueprintsJson: "[]", policyId: "policy-1", policyName: "Policy", regionsJson: "[]", defaultDurationMinutes: 60, status: "active", createdAt, updatedAt: createdAt } });
    const reservation = { id: sessionId, customerId: certalisId, opportunityId: certalisOpportunityId, revision: 1, cloudShareSalesExperienceId: `pending:${sessionId}`, operationalStatus: "provisioning" as const };
    await prisma.salesDemoSession.create({ data: { ...reservation, itemId, externalId: `external-${suffix}`, type: "demo", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Sales Admin", registrationType: "registeredParticipantsOnly", sendInvitations: "salesProsAndParticipants", sessionName: "Reservation", createdAt: new Date() } });
    const repository = createPrismaSalesDemoSessionRepository(prisma);
    const stillPresent = async () => expect(await prisma.salesDemoSession.findUnique({ where: { id: sessionId } })).not.toBeNull();

    await expect(repository.discardReservation!({ ...reservation, id: `other-${sessionId}` })).resolves.toBe(false); await stillPresent();
    await expect(repository.discardReservation!({ ...reservation, customerId: heliosId })).resolves.toBe(false); await stillPresent();
    await expect(repository.discardReservation!({ ...reservation, opportunityId: heliosOpportunityId })).resolves.toBe(false); await stillPresent();
    await expect(repository.discardReservation!({ ...reservation, revision: 2 })).resolves.toBe(false); await stillPresent();
    await expect(repository.discardReservation!({ ...reservation, cloudShareSalesExperienceId: "pending:other" })).resolves.toBe(false); await stillPresent();
    await prisma.salesDemoSession.update({ where: { id: sessionId }, data: { operationalStatus: "active" } });
    await expect(repository.discardReservation!(reservation)).resolves.toBe(false); await stillPresent();
    await prisma.salesDemoSession.update({ where: { id: sessionId }, data: { operationalStatus: "provisioning" } });
    await expect(repository.discardReservation!(reservation)).resolves.toBe(true);
    await expect(prisma.salesDemoSession.findUnique({ where: { id: sessionId } })).resolves.toBeNull();
  });
});
