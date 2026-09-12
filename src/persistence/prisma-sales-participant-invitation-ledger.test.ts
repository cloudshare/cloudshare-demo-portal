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
  async function secondParticipant(f: Awaited<ReturnType<typeof fixture>>, suffix = randomUUID()) {
    const contact = await prisma.opportunityContact.create({ data: { id: `contact-${suffix}`, customerId: f.customerId, opportunityId: (await prisma.salesDemoSession.findUniqueOrThrow({ where: { id: f.sessionId } })).opportunityId, firstName: "Grace", lastName: "Hopper", email: `${suffix}@example.test`, createdAt: new Date(), updatedAt: new Date() } });
    return prisma.salesSessionParticipant.create({ data: { id: `participant-${suffix}`, customerId: f.customerId, salesDemoSessionId: f.sessionId, opportunityContactId: contact.id, cloudShareParticipantId: `cloud-${suffix}`, invitationStatus: "notSent", participationStatus: "pending", lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() } });
  }

  it("admits an all-or-none multi-target batch and fences each participant", async () => {
    const f = await fixture(); const p2 = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z");
    const input = { customerId: f.customerId, sessionId: f.sessionId, targets: [f.participant, p2].map((p) => ({ participantId: p.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: p.updatedAt.toISOString() })), commandId: randomUUID(), at };
    await expect(ledger.admitBatch(input)).resolves.toMatchObject({ kind: "admitted" });
    await expect(ledger.readCurrent(f.customerId, p2.id)).rejects.toThrow("invalid persisted invitation outcome");
    await expect(ledger.admitBatch({ ...input, commandId: randomUUID(), targets: input.targets.map((t, i) => i ? { ...t, participantRevision: "stale" } : t) })).resolves.toMatchObject({ kind: "blocked" });
  });

  it("blocks missing and cross-Customer participants without partial command state", async () => {
    const f = await fixture(); const other = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const base = { sessionId: f.sessionId, commandId: randomUUID(), at: new Date() };
    await expect(ledger.admitBatch({ ...base, customerId: f.customerId, targets: [{ participantId: "missing", intent: "invite", expectedInvitationStatus: "notSent", participantRevision: "x" }] })).resolves.toMatchObject({ kind: "blocked" });
    await expect(ledger.admitBatch({ ...base, commandId: randomUUID(), customerId: f.customerId, targets: [{ participantId: other.participant.id, intent: "invite", expectedInvitationStatus: "notSent", participantRevision: other.participant.updatedAt.toISOString() }] })).resolves.toMatchObject({ kind: "blocked" });
    await expect(prisma.salesParticipantInvitationCommand.count({ where: { customerId: f.customerId } })).resolves.toBe(0);
  });

  it("finishes mixed outcomes atomically and retains only blocked fences", async () => {
    const f = await fixture(); const p2 = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const targets = [f.participant, p2].map((p) => ({ participantId: p.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: p.updatedAt.toISOString() })); const commandId = randomUUID();
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets, commandId, at }); const dispatching = await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: dispatching.revision, expectedPhase: "dispatching", phase: "settled", correlationId: "corr", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmed", reason: null }, { participantId: p2.id, outcome: "no_replay", reason: "ambiguous_after_dispatch" }] })).resolves.toMatchObject({ phase: "settled", revision: 3 });
    await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toBeNull();
    await expect(ledger.readCurrent(f.customerId, p2.id)).resolves.toMatchObject({ outcome: { outcome: "blocked" } });
  });

  it("rejects incomplete, duplicate, and extra finish targets without mutation", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const commandId = randomUUID(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }; const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at }); const d = await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    const outcome = { participantId: f.participant.id, outcome: "confirmed" as const, reason: null };
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, targetOutcomes: [outcome, outcome] })).rejects.toThrow();
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, targetOutcomes: [{ ...outcome, participantId: "extra" }] })).rejects.toThrow();
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, targetOutcomes: [outcome] })).resolves.toMatchObject({ phase: "settled" });
  });
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

  it("rejects wrong admission credentials and expires an admitted command fail-closed", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z"); const commandId = randomUUID();
    const admission = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [{ participantId: f.participant.id, intent: "invite", expectedInvitationStatus: "notSent", participantRevision: f.participant.updatedAt.toISOString() }], commandId, at });
    expect(admission.kind).toBe("admitted");
    await expect(ledger.markBatchDispatching(f.customerId, commandId, "wrong-token", 1, new Date(at.getTime() + 1))).rejects.toThrow();
    const expired = await ledger.expireAdmitted(f.customerId, commandId, 1, new Date(at.getTime() + 31_000));
    expect(expired.phase).toBe("settled");
    await expect(ledger.markBatchDispatching(f.customerId, commandId, admission.admissionToken!, 1, new Date(at.getTime() + 32_000))).rejects.toThrow();
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId } })).resolves.toBe(0);
    await expect(prisma.salesParticipantInvitationTarget.findFirst({ where: { customerId: f.customerId } })).resolves.toMatchObject({ outcome: "failed_retryable" });
  });
});
