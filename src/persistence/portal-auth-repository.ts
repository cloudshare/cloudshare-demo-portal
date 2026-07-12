import type { PrismaClient } from "@prisma/client";
import type {
  CreatePortalUserInput,
  PortalCustomerRecord,
  PortalSession,
  PortalSessionStore,
  PortalUserRecord,
  PortalUserRole,
  PortalCustomerWorkspace,
  PortalUserProvisioningStore,
  PortalUserStore,
} from "@/auth";

export interface PortalUserSeedInput {
  readonly customerSlug: string;
  readonly customerName: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: PortalUserRole;
  readonly workspace?: PortalCustomerWorkspace;
}

export interface PortalUserRepository extends PortalUserProvisioningStore {
  upsertSeedUser(input: PortalUserSeedInput): Promise<PortalUserRecord>;
}

export function createPortalUserRepository(
  prisma: PrismaClient,
): PortalUserRepository {
  return {
    async findByEmail(email: string): Promise<PortalUserRecord | null> {
      const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        include: { customer: true },
      });
      if (!user) {
        return null;
      }

      return {
        id: user.id,
        customerId: user.customerId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        passwordHash: user.passwordHash,
        role: asPortalUserRole(user.role),
        workspace: asPortalCustomerWorkspace(user.customer.workspace),
      };
    },

    async findCustomerBySlug(slug: string): Promise<PortalCustomerRecord | null> {
      const customer = await prisma.customer.findUnique({
        where: { slug: slug.trim() },
      });
      if (!customer) {
        return null;
      }

      return {
        id: customer.id,
        slug: customer.slug,
        name: customer.name,
        workspace: asPortalCustomerWorkspace(customer.workspace),
      };
    },

    async createUser(input: CreatePortalUserInput): Promise<PortalUserRecord> {
      const user = await prisma.user.create({
        data: {
          customerId: input.customerId,
          email: input.email.trim().toLowerCase(),
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          passwordHash: input.passwordHash,
          role: input.role,
        },
      });

      return {
        id: user.id,
        customerId: user.customerId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        passwordHash: user.passwordHash,
        role: asPortalUserRole(user.role),
        workspace: "certification",
      };
    },

    async upsertSeedUser(input: PortalUserSeedInput): Promise<PortalUserRecord> {
      const customer = await prisma.customer.upsert({
        where: { slug: input.customerSlug },
        update: { name: input.customerName, workspace: input.workspace ?? "certification" },
        create: {
          slug: input.customerSlug,
          name: input.customerName,
          workspace: input.workspace ?? "certification",
        },
      });

      const user = await prisma.user.upsert({
        where: { email: input.email.trim().toLowerCase() },
        update: {
          customerId: customer.id,
          passwordHash: input.passwordHash,
          role: input.role,
          firstName: null,
          lastName: null,
        },
        create: {
          customerId: customer.id,
          email: input.email.trim().toLowerCase(),
          firstName: null,
          lastName: null,
          passwordHash: input.passwordHash,
          role: input.role,
        },
      });

      return {
        id: user.id,
        customerId: user.customerId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        passwordHash: user.passwordHash,
        role: asPortalUserRole(user.role),
        workspace: input.workspace ?? "certification",
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
        include: { user: { include: { customer: true } } },
      });
      if (!session) {
        return null;
      }

      return {
        sessionId: session.id,
        userId: session.user.id,
        customerId: session.user.customerId,
        role: asPortalUserRole(session.user.role),
        workspace: asPortalCustomerWorkspace(session.user.customer.workspace),
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        issuedAtMs: session.createdAt.getTime(),
      };
    },

    async deleteById(sessionId: string): Promise<void> {
      await prisma.portalSession.deleteMany({
        where: { id: sessionId },
      });
    },
  };
}

function asPortalUserRole(role: string): PortalUserRole {
  return role === "admin" ? "admin" : "candidate";
}

function asPortalCustomerWorkspace(value: string): PortalCustomerWorkspace {
  return value === "sales" || value === "both" ? value : "certification";
}
