import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("support diagnostics persistence guardrails", () => {
  it("keeps DiagnosticLogEntry as the active support model and removes SupportLogEntry from the schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");

    expect(schema).toContain("model DiagnosticLogEntry");
    expect(schema).not.toContain("model SupportLogEntry");
  });

  it("adds a forward migration that drops the legacy SupportLogEntry table", () => {
    const migrationDir = "prisma/migrations";
    const migrations = readdirSync(migrationDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const migrationSql = migrations.map((name) =>
      readFileSync(join(migrationDir, name, "migration.sql"), "utf8"),
    );

    expect(
      migrationSql.some((sql) => sql.includes('DROP TABLE IF EXISTS "SupportLogEntry"')),
    ).toBe(true);
  });
});
