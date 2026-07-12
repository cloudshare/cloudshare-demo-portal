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
});
