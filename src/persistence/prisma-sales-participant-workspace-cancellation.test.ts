import { createPrismaSalesSessionParticipantRepository } from "./prisma-sales-session-participant-repository";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, expect, it } from "vitest";
import { createPrismaSalesParticipantWorkspaceReader } from "./prisma-sales-participant-workspace-reader";
import { cancellationIdentity, type SalesCancellationCommand } from "@/domain/sales-session-cancellation";
import { createPrismaSalesCancellationStore } from "./prisma-sales-session-cancellation";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
it("projects retained archive confirmation without rewriting stale provider participation or roster evidence", async () => {
  const id = randomUUID(), now = new Date("2026-10-26T14:00:00Z");
  await prisma.customer.create({ data: { id, slug: id, name: "Cancellation read fixture" } });
  try {
    await prisma.salesAccount.create({ data: { id, customerId: id, name: "Account", kind: "prospect", createdAt: now, updatedAt: now } });
    await prisma.salesOpportunity.create({ data: { id, customerId: id, accountId: id, name: "Opportunity", status: "open", createdAt: now, updatedAt: now } });
    await prisma.item.create({ data: { id, customerId: id, name: "Item", description: "", projectId: "project", projectName: "Project", blueprintsJson: "[]", policyId: "policy", policyName: "Policy", regionsJson: "[]", defaultDurationMinutes: 60, status: "active", createdAt: now, updatedAt: now } });
    await prisma.salesDemoSession.create({ data: { id, customerId: id, opportunityId: id, itemId: id, externalId: id, cloudShareSalesExperienceId: id, type: "demo", start: "2026-10-26T13:00", end: "2026-10-26T14:01", timeZone: "UTC", salesProEmail: "sales@example.test", salesProDisplayName: "Sales", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", createdAt: now } });
    await prisma.opportunityContact.create({ data: { id, customerId: id, opportunityId: id, firstName: "Ada", lastName: "Example", email: "ada@example.test", createdAt: now, updatedAt: now } });
    await prisma.salesSessionParticipant.create({ data: { id, customerId: id, salesDemoSessionId: id, opportunityContactId: id, cloudShareParticipantId: id, invitationStatus: "notSent", participationStatus: "inProgress", environmentStatus: "Preparing", environmentObservedAt: now, lastReconciledAt: now, createdAt: now, updatedAt: now } });
    const store = createPrismaSalesCancellationStore(prisma);
    const admitted = await store.admit({ customerId: id, sessionId: id, commandId: "cancel", experienceId: id, cancelledAt: now.toISOString(), actor: { type: "admin", id: "actor" }, timeZone: "UTC", targetEnd: "2026-10-26T14:01", targets: [{ participantId: id, providerParticipantId: id, contactId: id, email: "ada@example.test", projectId: "project", environmentId: "opaque-environment", state: "pending" }] });
    const command = admitted.command!;
    const reader = createPrismaSalesParticipantWorkspaceReader(prisma);
    const read = () => reader.readPage({ customerId: id, sessionId: id, query: "", offset: 0, limit: 25, now });
    expect((await read())?.participants[0]?.environment.value).toBe("Preparing");
    await store.save({ ...command, finished: true, accessState: "confirmed", targets: command.targets.map(t => ({ ...t, state: "archived" })) }, command.revision);
    expect((await read())?.participants[0]).toMatchObject({ participationStatus: "inProgress", sessionCancelled: true, environment: { value: "Archived", source: "confirmed_session_cancellation", confirmedAt: expect.any(String) } });
    const confirmed = (await store.read(id, "cancel"))!;
    const target = confirmed.targets[0]!;
    const mismatches: Partial<SalesCancellationCommand>[] = [
      { accessState: "pending" }, { accessState: "dispatched" }, { finished: false },
      { customerId: "other" }, { sessionId: "other" }, { experienceId: "other" },
      ...(["pending", "dispatched", "no_environment"] as const).map(state => ({ targets: [{ ...target, state }] })),
      ...["participantId", "providerParticipantId", "contactId", "email", "projectId", "environmentId"].map(key => ({ targets: [{ ...target, [key]: "other" }] })),
      { targets: [{ ...target, environmentId: null }] },
    ];
    for (const mismatch of mismatches) {
      // Corrupt disposable evidence independently of its immutable identity so
      // the public read must reject the actual scope/binding mismatch too.
      const changed = { ...confirmed, ...mismatch };
      await prisma.salesParticipantExtensionCommand.update({ where: { customerId_commandId: { customerId: id, commandId: "cancel" } }, data: { state: JSON.stringify(changed), identity: cancellationIdentity(changed) } });
      expect((await read())?.participants[0]?.environment, JSON.stringify(mismatch)).toMatchObject({ value: "Preparing", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-10-26T14:00:00.000Z" });
    }
    await prisma.salesParticipantExtensionCommand.update({ where: { customerId_commandId: { customerId: id, commandId: "cancel" } }, data: { state: JSON.stringify(confirmed), identity: cancellationIdentity(confirmed) } });
    expect((await read())?.participants[0]?.environment.value).toBe("Archived");
    expect(await reader.readPage({ customerId: "other", sessionId: id, query: "", offset: 0, limit: 25, now })).toBeNull();
    expect(JSON.stringify(await read())).not.toContain("opaque-environment");

  } finally { await prisma.customer.delete({ where: { id } }); }
});

it("retains old numeric and roster history while persisting a separate v4 observation and enforcing Customer ownership", async () => {
  const id = randomUUID(), now = new Date("2026-10-26T14:00:00Z");
  await prisma.customer.create({ data: { id, slug: id, name: "Cancellation read fixture" } });
  try {
    await prisma.salesAccount.create({ data: { id, customerId: id, name: "Account", kind: "prospect", createdAt: now, updatedAt: now } });
    await prisma.salesOpportunity.create({ data: { id, customerId: id, accountId: id, name: "Opportunity", status: "open", createdAt: now, updatedAt: now } });
    await prisma.item.create({ data: { id, customerId: id, name: "Item", description: "", projectId: "project", projectName: "Project", blueprintsJson: "[]", policyId: "policy", policyName: "Policy", regionsJson: "[]", defaultDurationMinutes: 60, status: "active", createdAt: now, updatedAt: now } });
    await prisma.salesDemoSession.create({ data: { id, customerId: id, opportunityId: id, itemId: id, externalId: id, cloudShareSalesExperienceId: id, type: "demo", start: "2026-10-26T13:00", end: "2026-10-26T14:01", timeZone: "UTC", salesProEmail: "sales@example.test", salesProDisplayName: "Sales", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", createdAt: now } });
    await prisma.opportunityContact.create({ data: { id, customerId: id, opportunityId: id, firstName: "Ada", lastName: "Example", email: "ada@example.test", createdAt: now, updatedAt: now } });
    await prisma.salesSessionParticipant.create({ data: { id, customerId: id, salesDemoSessionId: id, opportunityContactId: id, cloudShareParticipantId: id, invitationStatus: "notSent", participationStatus: "inProgress", environmentStatus: "Preparing", environmentObservedAt: now, lastReconciledAt: now, createdAt: now, updatedAt: now } });

    const repository = createPrismaSalesSessionParticipantRepository(prisma);
    const reader = createPrismaSalesParticipantWorkspaceReader(prisma);
    const read = () => reader.readPage({ customerId: id, sessionId: id, query: "", offset: 0, limit: 25, now });
    await repository.recordEnvironmentObservation(id, id, { statusCode: 2, observedAt: now });
    const observedAt = new Date("2026-10-26T15:00:00Z");
    await repository.recordEnvironmentObservation(id, id, { statusCode: 3, observedAt, preserveHistory: true, v4EnvironmentStatus: "suspended", v4EnvironmentObservedAt: observedAt });
    expect((await repository.list(id, id))[0]).toMatchObject({ environmentStatus: "Preparing", environmentStatusCode: 2, environmentObservedAt: now, v4EnvironmentStatus: "suspended", v4EnvironmentObservedAt: observedAt });
    expect((await read())?.participants[0]?.environment).toEqual({ dimension: "cloudshare_environment", value: "Suspended", source: "cloudshare_v4_environment", observedAt: "2026-10-26T15:00:00.000Z" });
    await repository.recordEnvironmentObservation(id, id, { statusCode: null, observedAt: null, preserveHistory: true, attentionReason: "environment_not_found_for_project", attentionSource: "cloudshare_v4_owner_email_item_project" });
    expect((await read())?.participants[0]?.environment).toMatchObject({ value: "Suspended", source: "cloudshare_v4_environment" });
    await expect(repository.recordEnvironmentObservation("other", id, { statusCode: 4, observedAt })).rejects.toThrow();
    expect(await repository.list("other", id)).toEqual([]);
  } finally { await prisma.customer.delete({ where: { id } }); }
});
