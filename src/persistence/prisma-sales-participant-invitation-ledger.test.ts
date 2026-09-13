import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { invitationLedgerInternalsForTest } from "./prisma-sales-participant-invitation-ledger";

const createPrismaSalesParticipantInvitationLedger = invitationLedgerInternalsForTest.create;

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
  const confirmedProjection = (participant: Awaited<ReturnType<typeof fixture>>["participant"], at: Date) => ({ participantId: participant.id, expectedParticipantRevision: participant.updatedAt.toISOString(), cloudShareParticipantId: participant.cloudShareParticipantId, invitationStatus: "sent" as const, lastInvitedAt: at.toISOString(), invitedBy: "sales@example.test", participationStatus: "pending" as const, firstJoined: null, cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentStatusCode: null, environmentObservedAt: null, environmentAttentionReason: null, environmentAttentionSource: null, lastReconciledAt: at.toISOString() });
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

  it("settles a uniformly rejected dispatch and releases every fence", async () => {
    const f = await fixture(); const p2 = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const targets = [f.participant, p2].map((p) => ({ participantId: p.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: p.updatedAt.toISOString() })); const commandId = randomUUID();
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets, commandId, at }); const dispatching = await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: dispatching.revision, expectedPhase: "dispatching", phase: "settled", correlationId: "corr", httpStatus: 502, resultCode: "provider_rejected", targetOutcomes: [{ participantId: f.participant.id, outcome: "failed_retryable", reason: "provider_rejected" }, { participantId: p2.id, outcome: "failed_retryable", reason: "provider_rejected" }] })).resolves.toMatchObject({ phase: "settled", revision: 3 });
    await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toBeNull();
    await expect(ledger.readCurrent(f.customerId, p2.id)).resolves.toBeNull();
  });

  it("rolls back ledger, fences, and every participant when one projection is stale", async () => {
    const f = await fixture(); const p2 = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const targets = [f.participant, p2].map((p) => ({ participantId: p.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: p.updatedAt.toISOString() })); const commandId = randomUUID();
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets, commandId, at }); await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    const before = await prisma.salesSessionParticipant.findMany({ where: { customerId: f.customerId }, orderBy: { id: "asc" } });
    const projection = (p: typeof f.participant, revision = p.updatedAt.toISOString()) => ({ participantId: p.id, expectedParticipantRevision: revision, cloudShareParticipantId: p.cloudShareParticipantId, invitationStatus: "sent" as const, lastInvitedAt: at.toISOString(), invitedBy: "sender@example.test", participationStatus: "pending" as const, firstJoined: null, cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentStatusCode: null, environmentObservedAt: null, environmentAttentionReason: null, environmentAttentionSource: null, lastReconciledAt: at.toISOString() });
    await ledger.markBatchEvaluatingConfirmation!({ customerId: f.customerId, commandId, admissionToken: admitted.admissionToken!, expectedRevision: 2, correlationId: "corr", targetOutcomes: targets.map((target) => ({ participantId: target.participantId, outcome: "confirmation_required", reason: "confirmation_required" })), at });
    const fencesBefore = await prisma.salesParticipantInvitationFence.findMany({ where: { customerId: f.customerId, commandId }, orderBy: { salesSessionParticipantId: "asc" } });
    await expect(ledger.finishBatchWithParticipantProjections({ customerId: f.customerId, commandId, expectedRevision: 3, expectedPhase: "evaluating_confirmation", phase: "settled", correlationId: "corr", targetOutcomes: targets.map((target) => ({ participantId: target.participantId, outcome: "confirmed" as const, reason: null })), projections: [projection(f.participant), projection(p2, new Date(0).toISOString())] })).rejects.toThrow("invitation command is no longer current");
    await expect(prisma.salesSessionParticipant.findMany({ where: { customerId: f.customerId }, orderBy: { id: "asc" } })).resolves.toEqual(before);
    await expect(prisma.salesParticipantInvitationFence.findMany({ where: { customerId: f.customerId, commandId }, orderBy: { salesSessionParticipantId: "asc" } })).resolves.toEqual(fencesBefore);
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { phase: "evaluating_confirmation", revision: 3 }, outcome: { outcome: "confirmation_required" } });
  });

  it("rejects incomplete, duplicate, and extra finish targets without mutation", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const commandId = randomUUID(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() }; const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at }); const d = await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    const outcome = { participantId: f.participant.id, outcome: "failed_retryable" as const, reason: "provider_rejected" as const };
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, httpStatus: 502, resultCode: "provider_rejected", targetOutcomes: [outcome, outcome] })).rejects.toThrow();
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, httpStatus: 502, resultCode: "provider_rejected", targetOutcomes: [{ ...outcome, participantId: "extra" }] })).rejects.toThrow();
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "settled", correlationId: null, httpStatus: 502, resultCode: "provider_rejected", targetOutcomes: [outcome] })).resolves.toMatchObject({ phase: "settled" });
  });

  it("only settles a dispatching retryable failure with typed provider metadata", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const commandId = randomUUID(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() };
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at }); const dispatching = await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, at);
    for (const invalid of [
      { reason: "failed_retryable" as const, httpStatus: 502, resultCode: "provider_rejected" as const },
      { reason: "stale_revision" as const, httpStatus: 502, resultCode: "provider_rejected" as const },
      { reason: "blocked_by_fence" as const, httpStatus: 502, resultCode: "provider_rejected" as const },
      { reason: "provider_rejected" as const, httpStatus: 409, resultCode: "provider_rejected" as const },
      { reason: "provider_rejected" as const, httpStatus: 502, resultCode: "not_dispatched" as const },
    ]) await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: dispatching.revision, expectedPhase: "dispatching", phase: "settled", correlationId: "corr", httpStatus: invalid.httpStatus, resultCode: invalid.resultCode, targetOutcomes: [{ participantId: f.participant.id, outcome: "failed_retryable", reason: invalid.reason }] })).rejects.toThrow("invitation command is no longer current");
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { phase: "dispatching", revision: 2 } });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(1);
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: dispatching.revision, expectedPhase: "dispatching", phase: "settled", correlationId: "corr", httpStatus: 502, resultCode: "not_dispatched", targetOutcomes: [{ participantId: f.participant.id, outcome: "failed_retryable", reason: "not_dispatched" }] })).resolves.toMatchObject({ phase: "settled", httpStatus: 502, resultCode: "not_dispatched" });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(0);
  });

  it("rejects non-uniform dispatch classifications and retains every fence", async () => {
    const f = await fixture(); const p2 = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const commandId = randomUUID(); const targets = [f.participant, p2].map((participant) => ({ participantId: participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: participant.updatedAt.toISOString() }));
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets, commandId, at }); const dispatching = await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, at);
    const noReplay = (participantId: string) => ({ participantId, outcome: "no_replay" as const, reason: "ambiguous_after_dispatch" as const });
    const retry = (participantId: string, reason: "not_dispatched" | "provider_rejected") => ({ participantId, outcome: "failed_retryable" as const, reason });
    const invalid = [
      { httpStatus: 409, resultCode: "invitation_no_replay" as const, outcomes: [noReplay(f.participant.id), retry(p2.id, "provider_rejected")] },
      { httpStatus: 502, resultCode: "provider_rejected" as const, outcomes: [retry(f.participant.id, "provider_rejected"), retry(p2.id, "not_dispatched")] },
      { httpStatus: 502, resultCode: "provider_rejected" as const, outcomes: [noReplay(f.participant.id), noReplay(p2.id)] },
      { httpStatus: 409, resultCode: "provider_rejected" as const, outcomes: [noReplay(f.participant.id), noReplay(p2.id)] },
    ];
    for (const attempt of invalid) await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: dispatching.revision, expectedPhase: "dispatching", phase: "settled", correlationId: "corr", httpStatus: attempt.httpStatus, resultCode: attempt.resultCode, targetOutcomes: attempt.outcomes })).rejects.toThrow("invitation command is no longer current");
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { phase: "dispatching", revision: 2 } });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(2);
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: dispatching.revision, expectedPhase: "dispatching", phase: "settled", correlationId: "corr", httpStatus: 409, resultCode: "invitation_no_replay", targetOutcomes: [noReplay(f.participant.id), noReplay(p2.id)] })).resolves.toMatchObject({ phase: "settled", httpStatus: 409, resultCode: "invitation_no_replay" });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(2);
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
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: d.revision, expectedPhase: "dispatching", phase: "evaluating_confirmation", correlationId: "c", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmation_required", reason: "confirmation_required" }] })).rejects.toThrow("invitation command is no longer current");
    await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toMatchObject({ command: { phase: "dispatching", revision: 2 } });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(1);
    const e = await ledger.markBatchEvaluatingConfirmation!({ customerId: f.customerId, commandId, admissionToken: a.admissionToken!, expectedRevision: d.revision, correlationId: "c", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmation_required", reason: "confirmation_required" }], at }); await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toMatchObject({ command: { phase: "evaluating_confirmation", revision: 3 }, outcome: { outcome: "confirmation_required" } });
    await ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: e.revision, expectedPhase: "evaluating_confirmation", phase: "settled", correlationId: "c", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmation_required", reason: "confirmation_required" }] }); await expect(ledger.readCurrent(f.customerId, f.participant.id)).resolves.toMatchObject({ command: { phase: "settled", revision: 4 }, outcome: { outcome: "confirmation_required" } });
  });

  it("rejects rewriting a settled Resend no-replay outcome and retains its fence", async () => {
    const f = await fixture(); await prisma.salesSessionParticipant.update({ where: { id: f.participant.id }, data: { invitationStatus: "sent" } });
    const participant = await prisma.salesSessionParticipant.findUniqueOrThrow({ where: { id: f.participant.id } }); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z"); const commandId = randomUUID();
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, commandId, at, targets: [{ participantId: participant.id, intent: "resend", expectedInvitationStatus: "sent", participantRevision: participant.updatedAt.toISOString() }] });
    await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, at);
    await ledger.recoverExpiredInvitationCommand!({ customerId: f.customerId, sessionId: f.sessionId, commandId, expectedRevision: 2, at: new Date(at.getTime() + 30_001) });
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: 3, expectedPhase: "settled", phase: "settled", correlationId: "corr", targetOutcomes: [{ participantId: participant.id, outcome: "accepted_unconfirmed", reason: null }] })).rejects.toThrow("invitation command is no longer current");
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ outcome: { targets: [{ outcome: "no_replay" }] } });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(1);
  });

  it("allows a settled initial Invite no-replay to be proven by reconciliation and releases its fence", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z"); const commandId = randomUUID();
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, commandId, at, targets: [{ participantId: f.participant.id, intent: "invite", expectedInvitationStatus: "notSent", participantRevision: f.participant.updatedAt.toISOString() }] });
    await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, at);
    await ledger.recoverExpiredInvitationCommand!({ customerId: f.customerId, sessionId: f.sessionId, commandId, expectedRevision: 2, at: new Date(at.getTime() + 30_001) });
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: 3, expectedPhase: "settled", phase: "settled", correlationId: "corr", httpStatus: 200, resultCode: "command_reconciled", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmed_by_reconciliation", reason: null }] })).rejects.toThrow("invitation command is no longer current");
    await expect(ledger.finishBatchWithParticipantProjections({ customerId: f.customerId, commandId, expectedRevision: 3, expectedPhase: "settled", phase: "settled", correlationId: "corr", httpStatus: 200, resultCode: "command_reconciled", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmed_by_reconciliation", reason: null }], projections: [confirmedProjection(f.participant, at)] })).resolves.toMatchObject({ phase: "settled", revision: 4 });
    await expect(prisma.salesParticipantInvitationFence.count({ where: { customerId: f.customerId, commandId } })).resolves.toBe(0);
  });

  it("rejects direct confirmed when recovering a settled confirmation-required Invite", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z"); const commandId = randomUUID();
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, commandId, at, targets: [{ participantId: f.participant.id, intent: "invite", expectedInvitationStatus: "notSent", participantRevision: f.participant.updatedAt.toISOString() }] });
    await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, at); await ledger.markBatchEvaluatingConfirmation!({ customerId: f.customerId, commandId, admissionToken: admitted.admissionToken!, expectedRevision: 2, correlationId: "corr", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmation_required", reason: "confirmation_required" }], at });
    await ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: 3, expectedPhase: "evaluating_confirmation", phase: "settled", correlationId: "corr", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmation_required", reason: "confirmation_required" }] });
    await expect(ledger.finishBatchWithParticipantProjections({ customerId: f.customerId, commandId, expectedRevision: 4, expectedPhase: "settled", phase: "settled", correlationId: "corr", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmed", reason: null }], projections: [confirmedProjection(f.participant, at)] })).rejects.toThrow("invitation command is no longer current");
  });

  it("persists acknowledged dispatch with exact token, command revision, and every fence before confirmation", async () => {
    const f = await fixture(); const p2 = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:00:00.000Z"); const commandId = randomUUID();
    const targets = [f.participant, p2].map((p) => ({ participantId: p.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: p.updatedAt.toISOString() }));
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets, commandId, at });
    await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, new Date(at.getTime() + 1));
    const outcomes = targets.map((target) => ({ participantId: target.participantId, outcome: "confirmation_required" as const, reason: "confirmation_required" as const }));
    await expect(ledger.markBatchEvaluatingConfirmation!({ customerId: f.customerId, commandId, admissionToken: "wrong", expectedRevision: 2, correlationId: "corr", targetOutcomes: outcomes, at })).rejects.toThrow();
    await expect(ledger.markBatchEvaluatingConfirmation!({ customerId: f.customerId, commandId, admissionToken: admitted.admissionToken!, expectedRevision: 2, correlationId: "corr", targetOutcomes: outcomes, at })).resolves.toMatchObject({ phase: "evaluating_confirmation", revision: 3, correlationId: "corr" });
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { phase: "evaluating_confirmation", revision: 3 }, outcome: { outcome: "confirmation_required" } });
    await expect(prisma.salesParticipantInvitationFence.findMany({ where: { customerId: f.customerId, commandId } })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ revision: 3 }), expect.objectContaining({ revision: 3 })]));
  });

  it("rolls back a stale-fence finish CAS without changing command, targets, or participants", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date(); const commandId = randomUUID(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() };
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at }); await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, at);
    await prisma.salesParticipantInvitationFence.update({ where: { customerId_salesSessionParticipantId: { customerId: f.customerId, salesSessionParticipantId: f.participant.id } }, data: { revision: 99 } });
    const beforeParticipant = await prisma.salesSessionParticipant.findUniqueOrThrow({ where: { id: f.participant.id } });
    await expect(ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: 2, expectedPhase: "dispatching", phase: "settled", correlationId: "corr", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmed", reason: null }] })).rejects.toThrow("invitation command is no longer current");
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { phase: "dispatching", revision: 2 }, outcome: { outcome: "in_progress" } });
    await expect(prisma.salesSessionParticipant.findUniqueOrThrow({ where: { id: f.participant.id } })).resolves.toEqual(beforeParticipant);
  });

  it("preserves the immutable admitted revision while using the current projection revision for later reconciliation", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:01:00.000Z"); const commandId = randomUUID(); const target = { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() };
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [target], commandId, at }); await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, at);
    const evaluating = await ledger.markBatchEvaluatingConfirmation!({ customerId: f.customerId, commandId, admissionToken: admitted.admissionToken!, expectedRevision: 2, correlationId: "corr", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmation_required", reason: "confirmation_required" }], at });
    const projection = { participantId: f.participant.id, expectedParticipantRevision: f.participant.updatedAt.toISOString(), cloudShareParticipantId: f.participant.cloudShareParticipantId, invitationStatus: "notSent" as const, lastInvitedAt: null, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentStatusCode: null, environmentObservedAt: null, environmentAttentionReason: null, environmentAttentionSource: null, lastReconciledAt: at.toISOString() };
    const stored = await prisma.salesSessionParticipant.findUniqueOrThrow({ where: { id: f.participant.id } }); const current = await ledger.readCommand(f.customerId, commandId);
    expect(current?.targets?.[0]?.participantRevision).toBe(target.participantRevision);
    await expect(ledger.finishBatchWithParticipantProjections({ customerId: f.customerId, commandId, expectedRevision: evaluating.revision, expectedPhase: "evaluating_confirmation", phase: "settled", correlationId: "corr", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmed_by_reconciliation", reason: null }], projections: [{ ...projection, expectedParticipantRevision: stored.updatedAt.toISOString(), invitationStatus: "sent" }] })).resolves.toMatchObject({ phase: "settled" });
  });
  it("reconciles a retained invite in a mixed command after the resend fence was released", async () => {
    const f = await fixture(); const resend = await secondParticipant(f); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const at = new Date("2026-09-12T10:01:00.000Z"); const commandId = randomUUID();
    await prisma.salesSessionParticipant.update({ where: { id: resend.id }, data: { invitationStatus: "sent" } });
    const refreshedResend = await prisma.salesSessionParticipant.findUniqueOrThrow({ where: { id: resend.id } });
    const targets = [
      { participantId: f.participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: f.participant.updatedAt.toISOString() },
      { participantId: resend.id, intent: "resend" as const, expectedInvitationStatus: "sent" as const, participantRevision: refreshedResend.updatedAt.toISOString() },
    ];
    const admitted = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets, commandId, at });
    await ledger.markBatchDispatching(f.customerId, commandId, admitted.admissionToken!, 1, at);
    await ledger.markBatchEvaluatingConfirmation!({ customerId: f.customerId, commandId, admissionToken: admitted.admissionToken!, expectedRevision: 2, correlationId: "corr", targetOutcomes: targets.map((target) => ({ participantId: target.participantId, outcome: "confirmation_required", reason: "confirmation_required" })), at });
    const mixed = await ledger.finishBatch({ customerId: f.customerId, commandId, expectedRevision: 3, expectedPhase: "evaluating_confirmation", phase: "settled", correlationId: "corr", httpStatus: 202, resultCode: "participant_roster_incomplete", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmation_required", reason: "confirmation_required" }, { participantId: resend.id, outcome: "accepted_unconfirmed", reason: null }] });
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { httpStatus: 202, resultCode: "participant_roster_incomplete" } });
    await expect(prisma.salesParticipantInvitationFence.findMany({ where: { customerId: f.customerId, commandId } })).resolves.toEqual([expect.objectContaining({ salesSessionParticipantId: f.participant.id })]);
    await expect(ledger.finishBatchWithParticipantProjections({ customerId: f.customerId, commandId, expectedRevision: mixed.revision, expectedPhase: "settled", phase: "settled", correlationId: "corr", targetOutcomes: [{ participantId: f.participant.id, outcome: "confirmed_by_reconciliation", reason: null }, { participantId: resend.id, outcome: "accepted_unconfirmed", reason: null }], projections: [confirmedProjection(f.participant, at)] })).resolves.toMatchObject({ phase: "settled" });
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ outcome: { outcome: "completed_with_unconfirmed", targets: [{ participantId: f.participant.id, outcome: "confirmed_by_reconciliation" }, { participantId: resend.id, outcome: "accepted_unconfirmed" }] } });
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
  it("durably preserves a typed pre-dispatch failure for exact replay and rejects corrupt metadata", async () => {
    const f = await fixture(); const ledger = createPrismaSalesParticipantInvitationLedger(prisma); const commandId = randomUUID();
    const admission = await ledger.admitBatch({ customerId: f.customerId, sessionId: f.sessionId, targets: [{ participantId: f.participant.id, intent: "invite", expectedInvitationStatus: "notSent", participantRevision: f.participant.updatedAt.toISOString() }], commandId, at: new Date() });
    await ledger.failAdmitted(f.customerId, commandId, 1, new Date(), { httpStatus: 502, resultCode: "not_dispatched", reason: "not_dispatched" });
    await expect(ledger.readCommand(f.customerId, commandId)).resolves.toMatchObject({ command: { httpStatus: 502, resultCode: "not_dispatched" }, outcome: { targets: [{ reason: "not_dispatched" }] } });
    await prisma.salesParticipantInvitationCommand.update({ where: { customerId_commandId: { customerId: f.customerId, commandId } }, data: { httpStatus: 999 } });
    await expect(ledger.readCommand(f.customerId, commandId)).rejects.toThrow("invalid persisted invitation status");
    expect(admission.kind).toBe("admitted");
  });
});
