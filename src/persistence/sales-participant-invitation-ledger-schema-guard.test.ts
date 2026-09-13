import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sales Participant invitation ledger migration", () => {
  it("ships target ordering on the same table as the Prisma model and index", () => {
    const migration = readFileSync(
      "prisma/migrations/20260912100000_add_sales_participant_invitation_ledger/migration.sql",
      "utf8",
    );
    const commandTable = migration.split('CREATE TABLE "SalesParticipantInvitationTarget"')[0]!;
    const targetTable = migration.split('CREATE TABLE "SalesParticipantInvitationTarget"')[1]!
      .split('CREATE TABLE "SalesParticipantInvitationFence"')[0]!;

    expect(commandTable).not.toContain('"ordinal" INTEGER');
    expect(targetTable).toContain('"ordinal" INTEGER NOT NULL');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "SalesParticipantInvitationTarget_customerId_commandId_ordinal_key" ON "SalesParticipantInvitationTarget"("customerId", "commandId", "ordinal")',
    );
  });
});
