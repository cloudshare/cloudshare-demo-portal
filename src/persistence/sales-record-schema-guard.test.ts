import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sales record tenant-aware database relations", () => {
  it("makes Opportunity and Contact parent references Customer-aware in the shipped migration", () => {
    const migration = readFileSync("prisma/migrations/20260712170000_add_sales_records/migration.sql", "utf8");

    expect(migration).toContain('FOREIGN KEY ("customerId", "accountId") REFERENCES "SalesAccount" ("customerId", "id")');
    expect(migration).toContain('FOREIGN KEY ("customerId", "opportunityId") REFERENCES "SalesOpportunity" ("customerId", "id")');
    expect(migration).toContain('CREATE UNIQUE INDEX "SalesAccount_customerId_id_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "SalesOpportunity_customerId_id_key"');
  });

  it("adds an archive timestamp for Opportunity Contacts without a destructive migration", () => {
    const migration = readFileSync("prisma/migrations/20260712233000_archive_opportunity_contacts/migration.sql", "utf8");

    expect(migration).toContain('ADD COLUMN "archivedAt" DATETIME');
    expect(migration).not.toContain("DROP");
  });

  it("keeps Sales Trial roster-status defaults aligned with the shipped migrations", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const participationMigration = readFileSync(
      "prisma/migrations/20260831225000_add_sales_trial_enrollment_participation_status/migration.sql",
      "utf8",
    );

    expect(schema).toContain('participationStatus                String   @default("pending")');
    expect(participationMigration).toContain("DEFAULT 'pending'");
  });
});
