import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, expect, it } from "vitest";
import { createPrismaSalesParticipantExtensionCommandStore } from "./prisma-sales-participant-extension-command";
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
it("persists revision fencing, immutable binding, restart recovery and cross-command exclusion in SQLite", async () => {
  const id = randomUUID(), now = new Date();
  await prisma.customer.create({ data: { id, slug: id, name: "Extension fixture" } });
  try {
    await prisma.salesAccount.create({ data: { id, customerId: id, name: "Account", kind: "prospect", createdAt: now, updatedAt: now } });
    await prisma.salesOpportunity.create({ data: { id, customerId: id, accountId: id, name: "Opportunity", status: "open", createdAt: now, updatedAt: now } });
    await prisma.item.create({ data: { id, customerId: id, name: "Item", description: "", projectId: "project", projectName: "Project", blueprintsJson: "[]", policyId: "policy", policyName: "Policy", regionsJson: "[]", defaultDurationMinutes: 60, status: "active", createdAt: now, updatedAt: now } });
    await prisma.salesDemoSession.create({ data: { id, customerId: id, opportunityId: id, itemId: id, externalId: id, cloudShareSalesExperienceId: id, type: "demo", start: "2026-09-19T09:00", end: "2026-09-20T09:00", timeZone: "UTC", salesProEmail: "sales@example.test", salesProDisplayName: "Sales", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", sessionName: "Session", revision: 1, operationalStatus: "active", createdAt: now } });
    await prisma.opportunityContact.create({ data: { id, customerId: id, opportunityId: id, firstName: "Ada", lastName: "Example", email: "ada@example.test", createdAt: now, updatedAt: now } });
    await prisma.salesSessionParticipant.create({ data: { id, customerId: id, salesDemoSessionId: id, opportunityContactId: id, cloudShareParticipantId: id, invitationStatus: "notSent", participationStatus: "inProgress", lastReconciledAt: now, createdAt: now, updatedAt: now } });
    const store = createPrismaSalesParticipantExtensionCommandStore(prisma);
    const input = { customerId: id, sessionId: id, commandId: "one", experienceId: id, timeZone: "UTC", selectionKey: "all", targets: [{ participantId: id, participantRevision: now.toISOString(), providerParticipantId: id, contactId: id, email: "ada@example.test", projectId: "project", environmentId: "opaque", preExpiry: "2026-09-20T09:00:00Z" }] };
    const admitted = await store.admit(input);
    expect(admitted.kind).toBe("new");
    expect((await store.admit({ ...input, commandId: "two" })).kind).toBe("blocked");
    const dispatched = { ...admitted.command!, targets: admitted.command!.targets.map(t => ({ ...t, state: "dispatched" as const })) };
    expect(await store.save(dispatched, 1)).toBe(true);
    expect(await store.save({ ...dispatched, finished: true }, 1)).toBe(false);
    const restarted = createPrismaSalesParticipantExtensionCommandStore(prisma);
    expect((await restarted.latest(id, id))?.targets[0]?.state).toBe("dispatched");
    expect((await restarted.admit({ ...input, targets: [{ ...input.targets[0]!, environmentId: "other" }] })).kind).toBe("mismatch");
    expect(await restarted.read("other-customer", "one")).toBeNull();
    expect((await restarted.admit({ ...input, commandId: "two" })).kind).toBe("blocked");
    expect(await restarted.save({ ...dispatched, revision: 2, finished: true }, 2)).toBe(true);
    expect((await restarted.admit({ ...input, commandId: "two" })).kind).toBe("new");
  } finally { await prisma.customer.delete({ where: { id } }); }
});
