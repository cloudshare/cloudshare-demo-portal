import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";

export default function setup() {
  const dbPath = join(process.cwd(), "test.db");
  const journalPath = `${dbPath}-journal`;

  if (existsSync(dbPath)) {
    rmSync(dbPath, { force: true });
  }
  if (existsSync(journalPath)) {
    rmSync(journalPath, { force: true });
  }
  closeSync(openSync(dbPath, "w"));

  const prismaCliPath = require.resolve("prisma/build/index.js");

  execFileSync(process.execPath, [
    prismaCliPath,
    "db",
    "push",
    "--accept-data-loss",
    "--skip-generate",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: "file:./test.db",
    },
    stdio: "pipe",
  });
}
