import type { PrismaClient } from "@prisma/client";
import type {
  PortalSession,
  PortalSessionStore,
  PortalUserRecord,
  PortalUserRole,
  PortalUserStore,
} from "@/auth";

export interface PortalUserSeedInput {
  readonly customerSlug: string;
  readonly customerName: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: PortalUserRole;
}

export interface PortalUserRepository extends PortalUserStore {
  upsertSeedUser(input: PortalUserSeedInput): Promise<PortalUserRecord>;
}

export function createPortalUserRepository(
  prisma: PrismaClient,
): PortalUserRepository {
  return {
    async findByEmail(email: string): Promise<PortalUserRecord | null> {
      const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
      });
      if (!user) {
        return null;
      }

      return {
        id: user.id,
        customerId: user.customerId,
        email: user.email,
        passwordHash: user.passwordHash,
        role: asPortalUserRole(user.role),
      };
    },

    async upsertSeedUser(input: PortalUserSeedInput): Promise<PortalUserRecord> {
      const customer = await prisma.customer.upsert({
        where: { slug: input.customerSlug },
        update: { name: input.customerName },
        create: {
          slug: input.customerSlug,
          name: input.customerName,
        },
      });

      const user = await prisma.user.upsert({
        where: { email: input.email.trim().toLowerCase() },
        update: {
          customerId: customer.id,
          passwordHash: input.passwordHash,
          role: input.role,
        },
        create: {
          customerId: customer.id,
          email: input.email.trim().toLowerCase(),
          passwordHash: input.passwordHash,
          role: input.role,
        },
      });

      return {
        id: user.id,
        customerId: user.customerId,
        email: user.email,
        passwordHash: user.passwordHash,
        role: asPortalUserRole(user.role),
      };
    },
  };
}

export function createPortalSessionStore(
  prisma: PrismaClient,
): PortalSessionStore {
  return {
    async save(session: PortalSession): Promise<void> {
      await prisma.portalSession.upsert({
        where: { id: session.sessionId },
        update: { userId: session.userId },
        create: {
          id: session.sessionId,
          userId: session.userId,
          createdAt: new Date(session.issuedAtMs),
        },
      });
    },

    async findById(sessionId: string): Promise<PortalSession | null> {
      const session = await prisma.portalSession.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (!session) {
        return null;
      }

      return {
        sessionId: session.id,
        userId: session.user.id,
        customerId: session.user.customerId,
        role: asPortalUserRole(session.user.role),
        email: session.user.email,
        issuedAtMs: session.createdAt.getTime(),
      };
    },
  };
}

function asPortalUserRole(role: string): PortalUserRole {
  return role === "candidate" ? "candidate" : "admin";
}
