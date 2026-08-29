import type {
  CloudShareConnectionRecord,
  SaveCloudShareConnectionInput,
} from "@/domain/cloudshare-connection";
import type { PortalUserRecord, PortalUserRole, PortalCustomerWorkspace } from "@/auth";
import type { PortalUserSeedInput } from "@/persistence/portal-auth-repository";

export interface SeedAdmin {
  readonly email: string;
  readonly password: string;
}

export interface SeedConnection {
  readonly apiId: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
}

export interface PortalSeedConfig {
  readonly heliosAdmin: SeedAdmin | null;
  readonly heliosCloudShareConnection: SeedConnection | null;
  readonly certalisSalesAdmin: SeedAdmin | null;
  readonly certalisSalesCloudShareConnection: SeedConnection | null;
}

export interface PortalSeedApplicationDeps {
  readonly portalUsers: {
    upsertSeedUser(input: PortalUserSeedInput): Promise<PortalUserRecord>;
    upsertSalesTrialConfiguration(customerId: string): Promise<void>;
  };
  readonly cloudshareConnections: {
    save(input: SaveCloudShareConnectionInput): Promise<unknown>;
    findByCustomerId(customerId: string): Promise<CloudShareConnectionRecord | null>;
  };
  hashPassword(password: string): Promise<string>;
}

const PLACEHOLDER_PREFIX = "replace-with-";

export function isSeedPlaceholder(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase().startsWith(PLACEHOLDER_PREFIX) ?? false;
}

export function normalizeSeedAdmin(input: {
  readonly email: string;
  readonly password: string;
} | null | undefined): SeedAdmin | null {
  if (!input) {
    return null;
  }

  if (isSeedPlaceholder(input.password)) {
    return null;
  }

  return {
    email: input.email,
    password: input.password,
  };
}

export function normalizeSeedConnection(input: {
  readonly apiId?: string | null;
  readonly apiKey?: string | null;
  readonly webhookSecret?: string | null;
} | null | undefined): SeedConnection | null {
  if (!input) {
    return null;
  }

  const apiId = input.apiId?.trim() ?? "";
  const apiKey = input.apiKey?.trim() ?? "";
  const webhookSecret = input.webhookSecret?.trim() ?? "";

  if (!apiId || !apiKey || !webhookSecret) {
    return null;
  }

  if (
    isSeedPlaceholder(apiId) ||
    isSeedPlaceholder(apiKey) ||
    isSeedPlaceholder(webhookSecret)
  ) {
    return null;
  }

  return {
    apiId: input.apiId!,
    apiKey: input.apiKey!,
    webhookSecret: input.webhookSecret!,
  };
}

export async function applyPortalSeed(
  deps: PortalSeedApplicationDeps,
  seed: PortalSeedConfig,
): Promise<void> {
  const heliosUser = seed.heliosAdmin
    ? await upsertSeedAdmin(deps, {
        customerSlug: "helios-cx",
        customerName: "Helios CX",
        admin: seed.heliosAdmin,
        role: "admin",
        workspace: "certification",
      })
    : null;

  const certalisUser = seed.certalisSalesAdmin
    ? await upsertSeedAdmin(deps, {
        customerSlug: "certalis",
        customerName: "Certalis",
        admin: seed.certalisSalesAdmin,
        role: "admin",
        workspace: "sales",
      })
    : null;

  if (certalisUser) {
    await deps.portalUsers.upsertSalesTrialConfiguration(certalisUser.customerId);
  }

  if (certalisUser && seed.certalisSalesCloudShareConnection) {
    await saveSeedConnectionIfMissing(deps, certalisUser.customerId, seed.certalisSalesCloudShareConnection);
  }

  if (heliosUser && seed.heliosCloudShareConnection) {
    await saveSeedConnectionIfMissing(deps, heliosUser.customerId, seed.heliosCloudShareConnection);
  }
}

async function upsertSeedAdmin(
  deps: PortalSeedApplicationDeps,
  input: {
    readonly customerSlug: string;
    readonly customerName: string;
    readonly admin: SeedAdmin;
    readonly role: PortalUserRole;
    readonly workspace: PortalCustomerWorkspace;
  },
): Promise<PortalUserRecord> {
  return deps.portalUsers.upsertSeedUser({
    customerSlug: input.customerSlug,
    customerName: input.customerName,
    email: input.admin.email,
    passwordHash: await deps.hashPassword(input.admin.password),
    role: input.role,
    workspace: input.workspace,
  });
}

async function saveSeedConnectionIfMissing(
  deps: PortalSeedApplicationDeps,
  customerId: string,
  connection: SeedConnection,
): Promise<void> {
  const existing = await deps.cloudshareConnections.findByCustomerId(customerId);
  if (existing) {
    return;
  }

  await deps.cloudshareConnections.save({
    customerId,
    apiId: connection.apiId,
    apiKey: connection.apiKey,
    webhookSecret: connection.webhookSecret,
  });
}
