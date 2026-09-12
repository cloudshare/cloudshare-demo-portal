import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPrismaSalesParticipantInvitationLedger } from "./prisma-sales-participant-invitation-ledger";

const prisma = new PrismaClient();
const customers = new Set<string>();
afterAll(() => prisma.$disconnect());
afterEach(async () => { for (const id of customers) await prisma.customer.delete({ where: { id } }).catch(() => undefined); customers.clear(); });

async function fixture() {
  const suffix = randomUUID(), customerId = `ledger-${suffix}`, accountId = `account-${suffix}`, opportunityId = `opportunity-${suffix}`, itemId = `item-${suffix}`, sessionId = `session-${suffix}`, contactId = `contact-${suffix}`, participantId = `participant-${suffix}`;
  customers.add(customerId);
  const now = new Date("2026-09-12T10:00:00.000Z");
  await prisma.customer.create({ data: { id: customerId, slug: customerId, name: "Ledger" } });
  await prisma.salesAccount.create({ data: { id: accountId, customerId, name: "Account", kind: "prospect", createdAt: now, updatedAt: now } });
  await prisma.salesOpportunity.create({ data: { id: opportunityId, customerId, accountId, name: "Opportunity", status: "open", createdAt: now, updatedAt: now } });
  await prisma.item.create({ data: { id: itemId, customerId, name: "Item", description: "", projectId: "project", projectName: "Project", blueprintsJson: "[]", policyId: "policy", policyName: "Policy", regionsJson: "[]", defaultDurationMinutes: 60, status: "active", createdAt: now, updatedAt: now } });
  await prisma.salesDemoSession.create({ data: { id: sessionId, customerId, opportunityId, itemId, cloudShareSalesExperienceId: `cloud-${suffix}`, externalId: `external-${suffix}`, type: "demo", start: "2026-09-12T09:00", end: "2026-09-12T11:00", timeZone: "UTC", salesProEmail: "sales@example.test", salesProDisplayName: "Sales", registrationType: "registeredParticipantsOnly", sendInvitations: "salesProsAndParticipants", createdAt: now } });
  await prisma.opportunityContact.create({ data: { id: contactId, customerId, opportunityId, firstName: "Ada", lastName: "Lovelace", email: `${suffix}@example.test`, createdAt: now, updatedAt: now } });
  const participant = await prisma.salesSessionParticipant.create({ data: { id: participantId, customerId, salesDemoSessionId: sessionId, opportunityContactId: contactId, cloudShareParticipantId: `cloud-participant-${suffix}`, invitationStatus: "notSent", participationStatus: "pending", lastReconciledAt: now, createdAt: now, updatedAt: now } });
  return { customerId, sessionId, participant };
}

describe("Prisma invitation ledger", () => {
  it("admits one exact target, reads the fence, and returns same-command replay", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma);
    const input = { customerId: f.customerId, sessionId: f.sessionId, targets: [{ participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }], commandId: randomUUID(), at: new Date("2026-09-12T10:00:00.000Z") };
    const admission = await ledger.admitBatch(input);
    expect(admission.kind).toBe("admitted");
    await expect(ledger.readCurrent(f.customerId, f.participant.id)).rejects.toThrow("invalid persisted invitation outcome");
    await expect(ledger.admitBatch(input)).resolves.toMatchObject({ kind: "same_command", commandId: input.commandId });
  });

  it("rejects stale revision and duplicate targets atomically", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const commandId = randomUUID();
    const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: "stale" };
    await expect(ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at: new Date() })).resolves.toMatchObject({ kind: "blocked" });
    await expect(ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target, target], commandId: randomUUID(), at: new Date() })).resolves.toMatchObject({ kind: "blocked" });
    await expect(prisma.salesParticipantInvitationCommand.count({ where: { customerId: f.customerId } })).resolves.toBe(0);
  });
});
