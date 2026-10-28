import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPrismaSalesSessionQueueRepository } from "./prisma-sales-session-queue-repository";

const prisma = new PrismaClient();
const customers = new Set<string>();
afterAll(async () => prisma.$disconnect());
afterEach(async () => {
  const ids = [...customers]; customers.clear();
  if (ids.length) await prisma.customer.deleteMany({ where: { id: { in: ids } } });
});

describe("Prisma Sales Session queue repository integration", () => {
  it("isolates Customers and applies view, relationship, search, stable page, and target rules in SQLite", async () => {
    const suffix = randomUUID();
    const customerA = `queue-a-${suffix}`; const customerB = `queue-b-${suffix}`;
    customers.add(customerA); customers.add(customerB);
    await prisma.customer.createMany({ data: [
      { id: customerA, slug: customerA, name: "Queue A" },
      { id: customerB, slug: customerB, name: "Queue B" },
    ] });
    const accountA = `account-a-${suffix}`; const accountB = `account-b-${suffix}`;
    const opportunityA = `opportunity-a-${suffix}`; const opportunityB = `opportunity-b-${suffix}`;
    const itemA = `item-a-${suffix}`; const itemB = `item-b-${suffix}`;
    const createdAt = new Date("2026-07-23T08:00:00.000Z");
    await prisma.salesAccount.createMany({ data: [
      { id: accountA, customerId: customerA, name: "Acme", kind: "prospect", createdAt, updatedAt: createdAt },
      { id: accountB, customerId: customerB, name: "Hidden", kind: "prospect", createdAt, updatedAt: createdAt },
    ] });
    await prisma.salesOpportunity.createMany({ data: [
      { id: opportunityA, customerId: customerA, accountId: accountA, name: "Evaluation", status: "open", createdAt, updatedAt: createdAt },
      { id: opportunityB, customerId: customerB, accountId: accountB, name: "Hidden", status: "open", createdAt, updatedAt: createdAt },
    ] });
    const item = (id: string, customerId: string) => ({ id, customerId, name: "Item", description: "", projectId: "project", projectName: "Project", blueprintsJson: "[]", policyId: "policy", policyName: "Policy", regionsJson: "[]", defaultDurationMinutes: 60, status: "active", createdAt, updatedAt: createdAt });
    await prisma.item.createMany({ data: [item(itemA, customerA), item(itemB, customerB)] });
    const session = (id: string, customerId: string, opportunityId: string, itemId: string, start: string, end: string, name: string, revision: number) => ({
      id, customerId, opportunityId, itemId, externalId: `external-${id}`, type: "demo", start, end, timeZone: "UTC",
      salesProEmail: "sales@example.test", salesProDisplayName: "Sales", registrationType: "registeredParticipantsOnly",
      sendInvitations: "dontSend", sessionName: name, revision, cloudShareSalesExperienceId: `sales-${id}`,
      operationalStatus: "active", createdAt,
    });
    await prisma.salesDemoSession.createMany({ data: [
      session(`active-1-${suffix}`, customerA, opportunityA, itemA, "2026-07-24T09:00", "2026-07-24T10:00", "Acme A", 1),
      session(`active-2-${suffix}`, customerA, opportunityA, itemA, "2026-07-25T09:00", "2026-07-25T10:00", "Acme B", 2),
      session(`history-${suffix}`, customerA, opportunityA, itemA, "2026-07-20T09:00", "2026-07-20T10:00", "Acme History", 3),
      { ...session(`pacific-${suffix}`, customerA, opportunityA, itemA, "2026-07-23T05:30", "2026-07-23T06:30", "Acme Pacific", 4), timeZone: "Pacific Standard Time" },
      session(`hidden-${suffix}`, customerB, opportunityB, itemB, "2026-07-24T09:00", "2026-07-24T10:00", "Hidden", 1),
    ] });
    await prisma.opportunityContact.createMany({ data: [1, 2].map((number) => ({
      id: `contact-${number}-${suffix}`, customerId: customerA, opportunityId: opportunityA,
      firstName: `Participant${number}`, lastName: "Queue", email: `participant-${number}-${suffix}@example.test`,
      createdAt, updatedAt: createdAt,
    })) });
    await prisma.salesSessionParticipant.createMany({ data: [1, 2].map((number) => ({
      id: `participant-${number}-${suffix}`, customerId: customerA, salesDemoSessionId: `active-1-${suffix}`,
      opportunityContactId: `contact-${number}-${suffix}`, cloudShareParticipantId: `cloudshare-participant-${number}-${suffix}`,
      invitationStatus: "notSent", participationStatus: "pending", environmentStatus: number === 1 ? "Ready" : null,
      environmentObservedAt: number === 1 ? createdAt : null,
      environmentAttentionReason: number === 2 ? "Participant environment is not correlated." : null,
      environmentAttentionSource: number === 2 ? "certalis_correlation" : null,
      lastReconciledAt: createdAt, createdAt, updatedAt: createdAt,
    })) });
    const repository = createPrismaSalesSessionQueueRepository(prisma);
    const now = new Date("2026-07-23T12:00:00.000Z");

    const first = await repository.read({ customerId: customerA, view: "active", accountId: accountA, opportunityId: opportunityA, search: "Acme", sort: "start_asc", offset: 0, limit: 1, now });
    const second = await repository.read({ customerId: customerA, view: "active", sort: "start_asc", offset: 1, limit: 1, now });
    expect(first.total).toBe(3);
    expect(first.rows.map((row) => row.sessionName)).toEqual(["Acme Pacific"]);
    expect(second.rows.map((row) => row.sessionName)).toEqual(["Acme A"]);
    expect(second.rows[0]?.participantEnvironment?.observation).toMatchObject({ value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: createdAt.toISOString() });
    const history = await repository.read({ customerId: customerA, view: "history", sort: "start_desc", offset: 0, limit: 25, now });
    expect(history.rows.map((row) => row.sessionName)).toEqual(["Acme History"]);
    await expect(repository.findTarget(customerA, `hidden-${suffix}`)).resolves.toBeNull();
    await expect(repository.findTarget(customerA, `missing-${suffix}`)).resolves.toBeNull();
    await prisma.salesOpportunity.update({ where: { id: opportunityA }, data: { archivedAt: now } });
    await expect(repository.findTarget(customerA, `active-1-${suffix}`)).resolves.toEqual({ id: `active-1-${suffix}`, archived: true });
    await prisma.salesOpportunity.update({ where: { id: opportunityA }, data: { archivedAt: null } });

    await prisma.salesDemoSession.createMany({ data: Array.from({ length: 197 }, (_, index) =>
      session(`scale-${index}-${suffix}`, customerA, opportunityA, itemA, `2026-08-${String(1 + Math.floor(index / 20)).padStart(2, "0")}T${String(index % 20).padStart(2, "0")}:00`, "2026-09-01T00:00", `Scale ${String(index).padStart(3, "0")}`, index + 5),
    ) });
    const scalePage = await repository.read({ customerId: customerA, view: "active", sort: "name_asc", offset: 175, limit: 25, now });
    expect(scalePage.total).toBe(200);
    expect(scalePage.rows).toHaveLength(25);
  }, 10_000);
});
