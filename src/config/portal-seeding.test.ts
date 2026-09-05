import { describe, expect, it, vi } from "vitest";
import { applyPortalSeed, type PortalSeedApplicationDeps } from "./portal-seeding";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";

type SavedConnection = CloudShareConnectionRecord;

type TestDeps = PortalSeedApplicationDeps & {
  cloudshareConnections: PortalSeedApplicationDeps["cloudshareConnections"] & {
    findByCustomerId(customerId: string): Promise<SavedConnection | null>;
  };
  setVerifiedAt(customerId: string, verifiedAt: Date): Promise<void>;
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
      upsertSalesTrialConfiguration: vi.fn(async () => undefined),
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
        } satisfies SavedConnection;
        savedConnections.set(input.customerId, next);
        return next;
      }),
      findByCustomerId: vi.fn(async (customerId) => savedConnections.get(customerId) ?? null),
    },
    hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
    async setVerifiedAt(customerId: string, verifiedAt: Date): Promise<void> {
      const existing = savedConnections.get(customerId);
      if (!existing) {
        throw new Error(`Missing saved connection for ${customerId}`);
      }
      savedConnections.set(customerId, {
        ...existing,
        verifiedAt,
      });
    },
  };
}

describe("applyPortalSeed", () => {
  it("persists a deliberate local seed once and skips re-saving on restart", async () => {
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
    expect(deps.portalUsers.upsertSalesTrialConfiguration).toHaveBeenCalledTimes(2);
    expect(deps.cloudshareConnections.save).toHaveBeenCalledTimes(2);
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
    await deps.setVerifiedAt("customer-1", new Date("2026-08-22T10:00:00.000Z"));

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

  it("preserves an existing verified UI-managed connection when a complete real seed connection is configured", async () => {
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
    await deps.setVerifiedAt("customer-1", new Date("2026-08-22T10:00:00.000Z"));

    await applyPortalSeed(deps, {
      heliosAdmin: {
        email: "admin@helioscx.demo",
        password: "HeliosReal123!",
      },
      heliosCloudShareConnection: {
        apiId: "seed-api-id",
        apiKey: "seed-api-key",
        webhookSecret: "seed-webhook-secret",
      },
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
