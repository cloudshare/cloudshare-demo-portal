import type { PrismaClient } from "@prisma/client";
import type {
  CreatePortalUserInput,
  PortalCustomerRecord,
  PortalCustomerWorkspace,
  PortalSession,
  PortalSessionStore,
  PortalUserLookupScope,
  PortalUserRecord,
  PortalUserRole,
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
  upsertSalesTrialConfiguration(customerId: string): Promise<void>;
}

export function createPortalUserRepository(
  prisma: PrismaClient,
): PortalUserRepository {
  return {
    async findByEmail(
      email: string,
      scope?: PortalUserLookupScope,
    ): Promise<PortalUserRecord | null> {
      const users = await prisma.user.findMany({
        where: {
          email: email.trim().toLowerCase(),
          ...(scope?.customerId ? { customerId: scope.customerId } : {}),
          ...(scope?.role ? { role: scope.role } : {}),
        },
        take: 2,
        include: { customer: true },
      });
      const user = selectUserMatch(users, scope);
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

    async findSalesTrialRegistrationCustomer(): Promise<PortalCustomerRecord | null> {
      const configurations = await prisma.salesTrialPortalConfiguration.findMany({
        where: {
          registrationEnabled: true,
        },
        orderBy: { createdAt: "asc" },
        take: 2,
        include: { customer: true },
      });
      if (configurations.length !== 1) {
        return null;
      }

      const customer = configurations[0]!.customer;
      return {
        id: customer.id,
        slug: customer.slug,
        name: customer.name,
        workspace: asPortalCustomerWorkspace(customer.workspace),
      };
    },

    async upsertSalesTrialConfiguration(customerId: string): Promise<void> {
      await prisma.salesTrialPortalConfiguration.upsert({
        where: { customerId },
        update: { registrationEnabled: true },
        create: { customerId, registrationEnabled: true },
      });
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
        include: { customer: true },
      });

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
        where: {
          customerId_email: {
            customerId: customer.id,
            email: input.email.trim().toLowerCase(),
          },
        },
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
        include: { customer: true },
      });

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
  if (role === "admin") {
    return "admin";
  }
  if (role === "sales_trial_participant") {
    return "sales_trial_participant";
  }
  return "candidate";
}

function selectUserMatch(
  users: readonly ({
    id: string;
    customerId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    passwordHash: string;
    role: string;
    customer: { workspace: string };
  })[],
  scope?: PortalUserLookupScope,
) {
  if (users.length === 1) {
    return users[0];
  }
  if (scope || users.length === 0) {
    return null;
  }

  const nonSalesTrialUsers = users.filter(
    (user) => user.role !== "sales_trial_participant",
  );
  return nonSalesTrialUsers.length === 1 ? nonSalesTrialUsers[0] : null;
}

function asPortalCustomerWorkspace(value: string): PortalCustomerWorkspace {
  return value === "sales" || value === "both" ? value : "certification";
}
