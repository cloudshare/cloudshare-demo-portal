import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createPortalAuthenticator, hashPassword } from "@/auth";
import {
  createPortalSessionStore,
  createPortalUserRepository,
} from "./portal-auth-repository";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.portalSession.deleteMany({
    where: {
      id: {
        startsWith: "portal-session-",
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: "@portal-auth.example",
      },
    },
  });
  await prisma.customer.deleteMany({
    where: {
      slug: {
        startsWith: "portal-auth-",
      },
    },
  });
});

describe("Prisma portal auth stores", () => {
  it("supports seeded Helios admin login and DB-backed session resume", async () => {
    const users = createPortalUserRepository(prisma);
    const sessions = createPortalSessionStore(prisma);

    const suffix = randomUUID();
    const email = `admin-${suffix}@portal-auth.example`;
    await users.upsertSeedUser({
      customerSlug: `portal-auth-${suffix}`,
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

  it("deletes a DB-backed session on sign-out", async () => {
    const users = createPortalUserRepository(prisma);
    const sessions = createPortalSessionStore(prisma);

    const suffix = randomUUID();
    const email = `admin-${suffix}@portal-auth.example`;
    await users.upsertSeedUser({
      customerSlug: `portal-auth-${suffix}`,
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
    await auth.signOut(session.sessionId);

    await expect(auth.resume(session.sessionId)).resolves.toBeNull();
  });

  it("creates a Candidate user under an existing customer", async () => {
    const users = createPortalUserRepository(prisma);

    const suffix = randomUUID();
    const customerSlug = `portal-auth-${suffix}`;
    await users.upsertSeedUser({
      customerSlug,
      customerName: "Helios CX",
      email: `admin-${suffix}@portal-auth.example`,
      passwordHash: await hashPassword("correct-horse-battery-staple"),
      role: "admin",
    });

    const customer = await users.findCustomerBySlug(customerSlug);
    expect(customer).toMatchObject({ slug: customerSlug, name: "Helios CX" });

    const candidate = await users.createUser({
      customerId: customer!.id,
      email: `candidate-${suffix}@portal-auth.example`,
      passwordHash: await hashPassword("candidate-password"),
      role: "candidate",
    });

    expect(candidate).toMatchObject({
      customerId: customer!.id,
      email: `candidate-${suffix}@portal-auth.example`,
      role: "candidate",
    });
    await expect(users.findByEmail(candidate.email)).resolves.toEqual(candidate);
  });

  it("allows the same email address in different Customers and resolves the scoped lookup only", async () => {
    const users = createPortalUserRepository(prisma);

    const suffix = randomUUID();
    await users.upsertSeedUser({
      customerSlug: `portal-auth-helios-${suffix}`,
      customerName: "Helios CX",
      email: `shared-${suffix}@portal-auth.example`,
      passwordHash: await hashPassword("admin-password"),
      role: "admin",
      workspace: "certification",
    });
    await users.upsertSeedUser({
      customerSlug: `portal-auth-certalis-${suffix}`,
      customerName: "Certalis",
      email: `sales-admin-${suffix}@portal-auth.example`,
      passwordHash: await hashPassword("admin-password"),
      role: "admin",
      workspace: "sales",
    });
    await users.upsertSeedUser({
      customerSlug: `portal-auth-unconfigured-sales-${suffix}`,
      customerName: "Another Sales Customer",
      email: `other-sales-admin-${suffix}@portal-auth.example`,
      passwordHash: await hashPassword("admin-password"),
      role: "admin",
      workspace: "sales",
    });

    const configuredCustomer = await users.findCustomerBySlug(`portal-auth-certalis-${suffix}`);
    await users.upsertSalesTrialConfiguration(configuredCustomer!.id);
    const salesCustomer = await users.findSalesTrialRegistrationCustomer();
    expect(salesCustomer).toMatchObject({ id: configuredCustomer!.id });
    const participant = await users.createUser({
      customerId: salesCustomer!.id,
      email: `shared-${suffix}@portal-auth.example`,
      firstName: "Ari",
      lastName: "Visitor",
      passwordHash: await hashPassword("trial-password"),
      role: "sales_trial_participant",
    });

    await expect(
      users.findByEmail(participant.email, { customerId: salesCustomer!.id }),
    ).resolves.toEqual(participant);
    await expect(users.findByEmail(participant.email)).resolves.toMatchObject({
      customerId: expect.not.stringMatching(salesCustomer!.id),
      email: participant.email,
      role: "admin",
    });
  });
});
