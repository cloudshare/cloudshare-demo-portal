import { readFileSync } from "node:fs";

export const LOCAL_COHORT_RATE_LIMIT_SCENARIO = "cohort-participant-429";

export function readSafeLocalDatabaseUrl(env, envFile = ".env") {
  const databaseUrl = env.DATABASE_URL ?? readDatabaseUrlFromEnvFile(envFile);
  if (env.PORTAL_LOCAL_QA_SCENARIO !== LOCAL_COHORT_RATE_LIMIT_SCENARIO) {
    throw new Error("Refusing to seed local QA data: set PORTAL_LOCAL_QA_SCENARIO=cohort-participant-429 explicitly.");
  }
  // Prisma SQLite URLs are the only supported local target. Relative paths keep
  // the command scoped to this checkout rather than an arbitrary machine file.
  if (typeof databaseUrl !== "string" || !/^file:\.\/[A-Za-z0-9_.-]+$/.test(databaseUrl)) {
    throw new Error("Refusing to seed local QA data: DATABASE_URL must be a relative SQLite file URL such as file:./dev.db.");
  }
  return databaseUrl;
}

function readDatabaseUrlFromEnvFile(envFile) {
  const match = readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.+)$/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}
