import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  handleGetCloudShareConnection,
  handleSaveCloudShareConnection,
  handleTestCloudShareConnection,
} from "./admin-cloudshare";
import type { Logger } from "@/observability/logger";
import { createSecretBox } from "@/security/secret-box";
import { createCloudShareConnectionRepository } from "@/persistence/cloudshare-connection-repository";
import { PrismaClient } from "@prisma/client";
import type { CloudShareClientFactory } from "@/domain/cloudshare-connection";

const prisma = new PrismaClient();

afterEach(async () => {
  await prisma.portalSession.deleteMany();
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: "@helios",
      },
    },
  });
  await prisma.cloudShareConnection.deleteMany();
  await prisma.customer.deleteMany({
    where: {
      slug: {
        startsWith: "helios-",
      },
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function makeDeps() {
  const customer = await prisma.customer.create({
    data: {
      slug: `helios-${Date.now()}-${Math.random()}`,
      name: "Helios CX",
    },
  });
  return {
    customerId: customer.id,
    connections: createCloudShareConnectionRepository(
      prisma,
      createSecretBox(Buffer.alloc(32, 8)),
    ),
    cloudshare: {
      forConnection: () => ({
        requestV3Text: async () => "pong",
        requestV3: async () => {
          throw new Error("not used");
        },
        requestV4: async () => {
          throw new Error("not used");
        },
      }),
    } satisfies CloudShareClientFactory,
    logger: makeLogger(),
    now: () => new Date("2026-06-13T18:10:00.000Z"),
  };
}

describe("admin CloudShare handlers", () => {
  it("persists a CloudShare Connection and reports only connection status metadata", async () => {
    const deps = await makeDeps();

    const save = await handleSaveCloudShareConnection(deps, {
      customerId: deps.customerId,
      body: {
        apiId: "api-id",
        apiKey: "api-key",
        webhookSecret: "whsec",
      },
    });
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ hasConnection: true, verifiedAt: null });

    const get = await handleGetCloudShareConnection(deps, {
      customerId: deps.customerId,
    });
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ hasConnection: true });
    expect(JSON.stringify(get.body)).not.toContain("api-key");
  });

  it("tests the stored connection with a v3 ping and returns pong", async () => {
    const deps = await makeDeps();
    await handleSaveCloudShareConnection(deps, {
      customerId: deps.customerId,
      body: {
        apiId: "api-id",
        apiKey: "api-key",
        webhookSecret: "whsec",
      },
    });

    const response = await handleTestCloudShareConnection(deps, {
      customerId: deps.customerId,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "connected",
      message: "pong",
      verifiedAt: "2026-06-13T18:10:00.000Z",
    });
  });
});
