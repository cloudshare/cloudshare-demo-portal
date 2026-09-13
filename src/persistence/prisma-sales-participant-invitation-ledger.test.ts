import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPrismaSalesParticipantInvitationLedger } from "./prisma-sales-participant-invitation-ledger";

const databasePath = path.join(os.tmpdir(), `cloudshare-stage3-ledger-${randomUUID()}.sqlite`);
fs.copyFileSync(path.resolve("prisma/test.db"), databasePath);
const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath.replaceAll("\\", "/")}` } } });
const customers = new Set<string>();
afterAll(async () => { await prisma.$disconnect(); fs.rmSync(databasePath, { force: true }); });
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
    await expect(ledger.readCurrent(f.customerId, p2.id)).resolves.toMatchObject({ command: { phase: "admitted" }, outcome: { outcome: "in_progress" } });
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

  it("rolls back ledger, fences, and every participant when one projection is stale", async () => {
    const f = await fixture(); const p2 = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const targets = [f.participant, p2].map((p) => ({ participantId: p.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: p.updatedAt.toISOString() })); const commandId = randomUUID();
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets, commandId, at }); await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    const before = await prisma.salesSessionParticipant.findMany({ where: { customerId: f.customerId }, orderBy: { id: "asc" } }); const fencesBefore = await prisma.salesParticipantInvitationFence.findMany({ where: { customerId: f.customerId, commandId }, orderBy: { salesSessionParticipantId: "asc" } });
    const projection = (p: typeof f.participant, revision = p.updatedAt.toISOString()) => ({ participantId: p.id, expectedParticipantRevision: revision, cloudShareParticipantId: p.cloudShareParticipantId, invitationStatus: "sent" as const, lastInvitedAt: at.toISOString(), invitedBy: "sender@example.test", participationStatus: "pending" as const, firstJoined: null, cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentStatusCode: null, environmentObservedAt: null, environmentAttentionReason: null, environmentAttentionSource: null, lastReconciledAt: at.toISOString() });
    await expect(ledger.finishBatchWithParticipantProjections({ customerId: f.customerId, commandId, expectedRevision: 2, expectedPhase: "dispatching", phase: "settled", correlationId: "corr", targetOutcomes: targets.map((target) => ({ participantId: target.participantId, outcome: "confirmed" as const, reason: null })), projections: [projection(f.participant), projection(p2, new Date(0).toISOString())] })).rejects.toThrow("participant projection is no longer current");
    await expect(prisma.salesSessionParticipant.findMany({ where: { customerId: f.customerId }, orderBy: { id: "asc" } })).resolves.toEqual(before);
    await expect(prisma.salesParticipantInvitationFence.findMany({ where: { customerId: f.customerId, commandId }, orderBy: { salesSessionParticipantId: "asc" } })).resolves.toEqual(fencesBefore);
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { phase: "dispatching", revision: 2 }, outcome: { outcome: "in_progress" } });
  });

  it("rejects incomplete, duplicate, and extra finish targets without mutation", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const commandId = randomUUID(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }; const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at }); const d = await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    const outcome = { participantId: f.participant.id, outcome: "confirmed" as const, reason: null };
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, targetOutcomes: [outcome, outcome] })).rejects.toThrow();
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, targetOutcomes: [{ ...outcome, participantId: "extra" }] })).rejects.toThrow();
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, targetOutcomes: [outcome] })).resolves.toMatchObject({ phase: "settled" });
  });

  it("fails closed for tampered persisted phase, outcome, and reason", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const commandId = randomUUID(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }; const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at });
    await prisma.salesParticipantInvitationCommand.update({ where: { customerId_commandId: { customerId: f.customerId, commandId } }, data: { phase: "corrupted" } });
    await expect(ledger.readCurrent(f.customerId, f.participant.id)).rejects.toThrow("invalid persisted invitation phase");
    await prisma.salesParticipantInvitationCommand.update({ where: { customerId_commandId: { customerId: f.customerId, commandId } }, data: { phase: "admitted" } });
    await prisma.salesParticipantInvitationTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId: f.customerId, commandId, salesSessionParticipantId: f.participant.id } }, data: { outcome: "confirmed", reason: "secret-provider-body" } });
    await expect(ledger.readCurrent(f.customerId, f.participant.id)).rejects.toThrow("invalid persisted invitation reason");
    expect(admitted.kind).toBe("admitted");
  });

  it("admits exactly one concurrent command for the same participant and independent commands for different participants", async () => {
    const f = await fixture(); const p2 = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date();
    const make = (participantId: string, revision: string, commandId = randomUUID()) => ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [{ participantId, intent: "invite", expectedInvitationStatus: "notSent", participantRevision: revision }], commandId, at });
    const same = await Promise.allSettled([make(f.participant.id, f.participant.updatedAt.toISOString()), make(f.participant.id, f.participant.updatedAt.toISOString())]);
    expect(same.every((result) => result.status === "fulfilled")).toBe(true);
    expect(same.filter((r) => r.status === "fulfilled" && r.value.kind === "admitted")).toHaveLength(1);
    expect(same.filter((r) => r.status === "fulfilled" && r.value.kind === "blocked" && r.value.admissionToken === undefined)).toHaveLength(1);
    const independent = await make(p2.id, p2.updatedAt.toISOString()); expect(independent.kind).toBe("admitted");
  });

  it("returns one admission token and a tokenless same-command result under a concurrent identical admission", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z"); const commandId = randomUUID();
    const input = { customerId: f.customerId, sessionId: f.sessionId, targets: [{ participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }], commandId, at };
    const results = await Promise.all([ledger.admitBatch(input), ledger.admitBatch(input)]);
    expect(results.map((result) => result.kind).sort()).toEqual(["admitted", "same_command"]);
    expect(results.filter((result) => result.kind === "admitted" && typeof result.admissionToken === "string")).toHaveLength(1);
    expect(results.find((result) => result.kind === "same_command")?.admissionToken).toBeUndefined();
    await expect(prisma.salesParticipantInvitationCommand.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(1);
  });

  it("guards dispatch against customer, token, revision, phase, lease, and fence changes", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }; const commandId = randomUUID(); const a = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at });
    await expect(ledger.markBatchDispatching("wrong-customer", commandId, a.admissionToken!, 1, at)).rejects.toThrow(); await expect(ledger.markBatchDispatching(f.customerId, commandId, "bad", 1, at)).rejects.toThrow(); await expect(ledger.markBatchDispatching(f.customerId, commandId, a.admissionToken!, 2, at)).rejects.toThrow();
    await prisma.salesParticipantInvitationFence.deleteMany({ where: { customerId: f.customerId, commandId } }); await expect(ledger.markBatchDispatching(f.customerId, commandId, a.admissionToken!, 1, at)).rejects.toThrow();
    const b = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId: randomUUID(), at }); await expect(ledger.markBatchDispatching(f.customerId, b.commandId, b.admissionToken!, 1, new Date(at.getTime() + 31_000))).rejects.toThrow();
  });

  it("guards finish and expiry with phase and revision CAS", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }; const commandId = randomUUID(); const a = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at });
    await expect(ledger.expireAdmitted("wrong", commandId, 1, new Date(at.getTime() + 31_000))).rejects.toThrow(); await expect(ledger.expireAdmitted(f.customerId, commandId, 2, new Date(at.getTime() + 31_000))).rejects.toThrow(); await expect(ledger.expireAdmitted(f.customerId, commandId, 1, at)).rejects.toThrow();
    const d = await ledger.markBatchDispatching(f.customerId, commandId, a.admissionToken!, 1, new Date(at.getTime() + 1)); const o = { participantId: f.participant.id, outcome: "confirmed" as const, reason: null };
    await expect(ledger.finishBatch({ customerId: "wrong", commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, targetOutcomes: [o] })).rejects.toThrow(); await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: 99, expectedPhase: "dispatching", phase: "settled", correlationId: null, targetOutcomes: [o] })).rejects.toThrow(); await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "evaluating_confirmation", phase: "settled", correlationId: null, targetOutcomes: [o] })).rejects.toThrow();
  });

  it("recovers only an expired, exact Customer/Session/command/token fence before dispatch", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z"); const commandId = randomUUID();
    const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() };
    await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at });
    await expect(ledger.recoverExpiredInvitationCommand!({ customerId: f.customerId, sessionId: f.sessionId, commandId, expectedRevision: 1, at: new Date(at.getTime() + 29_999) })).resolves.toBeNull();
    await expect(ledger.recoverExpiredInvitationCommand!({ customerId: f.customerId, sessionId: "wrong", commandId, expectedRevision: 1, at: new Date(at.getTime() + 30_001) })).resolves.toBeNull();
    await prisma.salesParticipantInvitationCommand.update({ where: { customerId_commandId: { customerId: f.customerId, commandId } }, data: { admissionTokenHash: "intervening-token-hash" } });
    const recovered = await ledger.recoverExpiredInvitationCommand!({ customerId: f.customerId, sessionId: f.sessionId, commandId, expectedRevision: 1, at: new Date(at.getTime() + 30_001) });
    expect(recovered).toMatchObject({ phase: "settled", revision: 2 });
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ outcome: { outcome: "failed_retryable" } });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(0);
  });

  it("converts an expired post-dispatch command to retained no-replay and never releases its fence", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z"); const commandId = randomUUID();
    const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() };
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at });
    await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    await expect(ledger.recoverExpiredInvitationCommand!({ customerId: f.customerId, sessionId: f.sessionId, commandId, expectedRevision: 2, at: new Date(at.getTime() + 30_001) })).resolves.toMatchObject({ phase: "settled", revision: 3 });
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { phase: "settled" }, outcome: { outcome: "blocked", targets: [{ outcome: "no_replay", reason: "ambiguous_after_dispatch" }] } });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(1);
    await expect(ledger.recoverExpiredInvitationCommand!({ customerId: f.customerId, sessionId: f.sessionId, commandId, expectedRevision: 2, at: new Date(at.getTime() + 31_000) })).resolves.toBeNull();
  });

  it("reads dispatching, evaluating confirmation, and settled retained no-replay states after restart", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }; const commandId = randomUUID(); const a = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at }); const d = await ledger.markBatchDispatching(f.customerId, commandId, a.admissionToken!, 1, new Date(at.getTime() + 1)); await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toMatchObject({ command: { phase: "dispatching", revision: 2 } });
    const e = await ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "evaluating_confirmation", correlationId: "c", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmation_required", reason: "confirmation_required" }] }); await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toMatchObject({ command: { phase: "evaluating_confirmation", revision: 3 }, outcome: { outcome: "confirmation_required" } });
    await ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: e.revision, expectedPhase: "evaluating_confirmation", phase: "settled", correlationId: "c", targetOutcomes: [{ participantId: f.participant.id, outcome: "no_replay", reason: "ambiguous_after_dispatch" }] }); await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toMatchObject({ command: { phase: "settled", revision: 4 }, outcome: { outcome: "blocked" } });
  });
  it("admits one exact target, reads the fence, and returns same-command replay", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma);
    const input = { customerId: f.customerId, sessionId: f.sessionId, targets: [{ participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }], commandId: randomUUID(), at: new Date("2026-09-12T10:00:00.000Z") };
    const admission = await ledger.admitBatch(input);
    expect(admission.kind).toBe("admitted");
    await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toMatchObject({ command: { phase: "admitted" }, outcome: { outcome: "in_progress" } });
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
