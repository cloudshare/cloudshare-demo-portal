import { describe, expect, it, vi } from "vitest";
import { applyPortalSeed, type PortalSeedApplicationDeps } from "./portal-seeding";

type SavedConnection = {
  customerId: string;
  apiId: string;
  apiKey: string;
  webhookSecret: string;
  webhookPathToken?: string;
  connectedAt?: Date;
  verifiedAt?: Date | null;
};

type TestDeps = PortalSeedApplicationDeps & {
  cloudshareConnections: PortalSeedApplicationDeps["cloudshareConnections"] & {
    findByCustomerId(customerId: string): Promise<SavedConnection | null>;
  };
};

function createDeps(): TestDeps {
  const savedConnections = new Map<string, SavedConnection>();
  const usersByEmail = new Map<string, { customerId: string; email: string }>();
  let customerSequence = 0;

  return {
    portalUsers: {
      upsertSeedUser: vi.fn(async (input) => {
        const existing = usersByEmail.get(input.email);
        const user = existing ?? {
          customerId: `customer-${++customerSequence}`,
          email: input.email,
        };
        usersByEmail.set(input.email, user);
        return {
          id: `${user.customerId}-user`,
          customerId: user.customerId,
          email: user.email,
          passwordHash: input.passwordHash,
          role: input.role,
          workspace: input.workspace ?? "certification",
          firstName: null,
          lastName: null,
        };
      }),
    },
    cloudshareConnections: {
      save: vi.fn(async (input) => {
        const existing = savedConnections.get(input.customerId);
        const next = {
          customerId: input.customerId,
          apiId: input.apiId,
          apiKey: input.apiKey,
          webhookSecret: input.webhookSecret,
          webhookPathToken: existing?.webhookPathToken ?? `token-${input.customerId}`,
          connectedAt: existing?.connectedAt ?? new Date("2026-08-22T09:00:00.000Z"),
          verifiedAt: null,
        };
        savedConnections.set(input.customerId, next);
        return next;
      }),
      findByCustomerId: vi.fn(async (customerId) => savedConnections.get(customerId) ?? null),
    },
    hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
  };
}

describe("applyPortalSeed", () => {
  it("persists a deliberate local seed and remains idempotent across restarts", async () => {
    const deps = createDeps();
    const seed = {
      heliosAdmin: {
        email: "admin@helioscx.demo",
        password: "HeliosReal123!",
      },
      heliosCloudShareConnection: {
        apiId: "helios-api-id",
        apiKey: "helios-api-key",
        webhookSecret: "helios-webhook-secret",
      },
      certalisSalesAdmin: {
        email: "sales-admin@certalis.demo",
        password: "CertalisReal123!",
      },
      certalisSalesCloudShareConnection: {
        apiId: "certalis-api-id",
        apiKey: "certalis-api-key",
        webhookSecret: "certalis-webhook-secret",
      },
    };

    await applyPortalSeed(deps, seed);
    await applyPortalSeed(deps, seed);

    expect(deps.portalUsers.upsertSeedUser).toHaveBeenCalledTimes(4);
    expect(deps.cloudshareConnections.save).toHaveBeenCalledTimes(4);
    await expect(deps.cloudshareConnections.findByCustomerId("customer-1")).resolves.toMatchObject({
      apiId: "helios-api-id",
      apiKey: "helios-api-key",
      webhookSecret: "helios-webhook-secret",
    });
    await expect(deps.cloudshareConnections.findByCustomerId("customer-2")).resolves.toMatchObject({
      apiId: "certalis-api-id",
      apiKey: "certalis-api-key",
      webhookSecret: "certalis-webhook-secret",
    });
  });

  it("does not overwrite an existing verified UI-managed connection when the seed connection is absent", async () => {
    const deps = createDeps();
    await deps.portalUsers.upsertSeedUser({
      customerSlug: "helios-cx",
      customerName: "Helios CX",
      email: "admin@helioscx.demo",
      passwordHash: "hashed:existing",
      role: "admin",
      workspace: "certification",
    });
    await deps.cloudshareConnections.save({
      customerId: "customer-1",
      apiId: "ui-api-id",
      apiKey: "ui-api-key",
      webhookSecret: "ui-webhook-secret",
    });
    const saved = (await deps.cloudshareConnections.findByCustomerId("customer-1")) as SavedConnection | null;
    saved!.verifiedAt = new Date("2026-08-22T10:00:00.000Z");

    await applyPortalSeed(deps, {
      heliosAdmin: null,
      heliosCloudShareConnection: null,
      certalisSalesAdmin: null,
      certalisSalesCloudShareConnection: null,
    });

    expect(deps.cloudshareConnections.save).toHaveBeenCalledTimes(1);
    await expect(deps.cloudshareConnections.findByCustomerId("customer-1")).resolves.toMatchObject({
      apiId: "ui-api-id",
      apiKey: "ui-api-key",
      webhookSecret: "ui-webhook-secret",
      verifiedAt: new Date("2026-08-22T10:00:00.000Z"),
    });
  });
});
