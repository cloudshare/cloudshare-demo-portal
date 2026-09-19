import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, expect, it } from "vitest";
import { createPrismaSalesCancellationStore } from "./prisma-sales-session-cancellation";
import { createPrismaSalesParticipantExtensionCommandStore } from "./prisma-sales-participant-extension-command";
import { createPrismaSalesParticipantAddCommandStore } from "./prisma-sales-participant-add-command";
import { createPrismaInvitationStore } from "./prisma-sales-participant-invitation-ledger";
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
    const store = createPrismaSalesCancellationStore(prisma);
    const input = { customerId: id, sessionId: id, commandId: "cancel", experienceId: id, cancelledAt: now.toISOString(), actor: { type: "admin", id: "actor" }, timeZone: "UTC", targetEnd: "2026-09-19T10:00", targets: [{ participantId: id, providerParticipantId: id, contactId: id, email: "ada@example.test", projectId: "project", environmentId: "opaque/v3-id+value", state: "pending" as const }] };
    const adds = createPrismaSalesParticipantAddCommandStore(prisma);
    const add = { customerId: id, sessionId: id, commandId: "concurrent-add", payloadHash: "person", now };
    // Cancellation's roster was captured above; Add has passed its early access read.
    expect((await adds.admit(add)).kind).toBe("new");
    expect((await store.admit(input)).kind).toBe("blocked");
    expect(await adds.markDispatched(add)).toBe(true);
    expect((await store.admit(input)).kind).toBe("blocked");
    await adds.settle({ ...add, state: "needs_attention", result: { status: 409, body: { outcome: "needs_attention" } } });
    expect((await store.admit(input)).kind).toBe("blocked");
    expect(await adds.markDispatched(add)).toBe(false); // Ambiguity never replays.
    // Read-only reconciliation can settle the existing binding; inventory is rechecked.
    await adds.settle({ ...add, state: "settled", result: { status: 200, body: { outcome: "already_registered", participantId: id } } });
    // A settled Add can change the roster between inventory and admission.
    await prisma.salesSessionParticipant.update({ where: { id }, data: { cloudShareParticipantId: "new-provider-binding" } });
    expect((await store.admit(input)).kind).toBe("blocked");
    await prisma.salesSessionParticipant.update({ where: { id }, data: { cloudShareParticipantId: id } });
    const invitations = createPrismaInvitationStore(prisma);
    const invite = { customerId: id, sessionId: id, commandId: "concurrent-invite", at: now, allowNew: true, targets: [{ participantId: id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: now.toISOString() }] };
    const invitation = await invitations.begin(invite);
    expect(invitation.kind).toBe("started");
    expect((await store.admit(input)).kind).toBe("blocked");
    if (invitation.kind !== "started") throw new Error("Expected invitation admission");
    await invitations.failBeforeDispatch(invitation.handle, { at: now, httpStatus: 502, resultCode: "not_dispatched", reason: "not_dispatched" });
    const admitted = await store.admit(input);
    expect(admitted.kind).toBe("new");
    // Stale application allowNew cannot authorize a later provider publication.
    expect((await adds.admit({ ...add, commandId: "late-add" })).kind).toBe("blocked");
    expect((await invitations.begin({ ...invite, commandId: "late-invite" })).kind).toBe("blocked");
    expect(admitted.command?.targets[0]?.environmentId).toBe("opaque/v3-id+value");
    const command = admitted.command!;
    expect(await store.save({ ...command, targets: command.targets.map(t => ({ ...t, state: "dispatched" })) }, 1)).toBe(true);
    const restarted = createPrismaSalesCancellationStore(prisma);
    expect((await restarted.read(id, "cancel"))?.targets[0]?.state).toBe("dispatched");
    expect(await restarted.read("other-customer", "cancel")).toBeNull();
    expect((await restarted.admit({ ...input, experienceId: "other-experience" })).kind).toBe("mismatch");
    expect((await restarted.admit({ ...input, targets: [{ ...input.targets[0]!, environmentId: "replacement" }] })).kind).toBe("mismatch");
    expect(await restarted.save(command, 1)).toBe(false);
    const extensions = createPrismaSalesParticipantExtensionCommandStore(prisma);
    expect(await extensions.latest(id, id)).toBeNull();
    expect((await extensions.admit({ customerId: id, sessionId: id, commandId: "extension", experienceId: id, timeZone: "UTC", selectionKey: "all", targets: [{ participantId: id, participantRevision: now.toISOString(), providerParticipantId: id, contactId: id, email: "ada@example.test", projectId: "project", environmentId: "opaque/v3-id+value", preExpiry: "2026-09-20T09:00:00Z" }] })).kind).toBe("blocked");
    // Disposable test data only: race both operations for a fresh Session fence.
    await prisma.salesParticipantExtensionCommand.deleteMany({ where: { customerId: id } });
    await prisma.salesDemoSession.update({ where: { id }, data: { cancellationRequestedAt: null } });
    const extension = { customerId: id, sessionId: id, commandId: "extension-race", experienceId: id, timeZone: "UTC", selectionKey: "all", targets: [{ participantId: id, participantRevision: now.toISOString(), providerParticipantId: id, contactId: id, email: "ada@example.test", projectId: "project", environmentId: "opaque/v3-id+value", preExpiry: "2026-09-20T09:00:00Z" }] };
    const race = await Promise.all([extensions.admit(extension), restarted.admit({ ...input, commandId: "cancel-race" })]);
    expect(race.map(result => result.kind).sort()).toEqual(["blocked", "new"]);
    if (race[0]!.kind === "new") expect((await prisma.salesParticipantExtensionCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId: id, commandId: "extension-race" } } })).operation).toBe("extension");
  } finally { await prisma.customer.delete({ where: { id } }); }
});
