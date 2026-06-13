import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPortalAuthenticator, hashPassword } from "@/auth";
import {
  createPortalSessionStore,
  createPortalUserRepository,
} from "./portal-auth-repository";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Prisma portal auth stores", () => {
  it("supports seeded Helios admin login and DB-backed session resume", async () => {
    const users = createPortalUserRepository(prisma);
    const sessions = createPortalSessionStore(prisma);

    const email = `admin-${Date.now()}@helios.example`;
    await users.upsertSeedUser({
      customerSlug: `helios-${Date.now()}`,
      customerName: "Helios CX",
      email,
      passwordHash: await hashPassword("correct-horse-battery-staple"),
      role: "admin",
    });

    const auth = createPortalAuthenticator({
      users,
      sessions,
      now: () => 1_700_000_000_000,
      newSessionId: () => `portal-session-${Date.now()}`,
    });

    const session = await auth.signIn(email, "correct-horse-battery-staple");
    const resumed = await auth.resume(session.sessionId);

    expect(resumed).toEqual(session);
  });
});
