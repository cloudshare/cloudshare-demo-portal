// @ts-expect-error JavaScript command helper is deliberately imported at its public seam.
import { readSafeLocalDatabaseUrl } from "../../../scripts/local-qa-safety.mjs";
import { describe, expect, it } from "vitest";

describe("local QA seed safety", () => {
  it("refuses a production-style database URL before Prisma can initialize", () => {
    expect(() =>
      readSafeLocalDatabaseUrl({
        PORTAL_LOCAL_QA_SCENARIO: "cohort-participant-429",
        DATABASE_URL: "postgresql://production.example/portal",
      }),
    ).toThrow("DATABASE_URL must be a relative SQLite file URL");
  });

  it("requires explicit local QA acknowledgement", () => {
    expect(() => readSafeLocalDatabaseUrl({ DATABASE_URL: "file:./dev.db" })).toThrow(
      "PORTAL_LOCAL_QA_SCENARIO=cohort-participant-429",
    );
  });
});
