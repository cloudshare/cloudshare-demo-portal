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
import { CloudShareRequestError } from "@/integrations/cloudshare";
import { createInMemoryExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";

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
        requestV3Text: async () => "{\"result\":\"Pong\"}",
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
      correlationId: expect.any(String),
      occurredAt: "2026-06-13T18:10:00.000Z",
    });
  });

  it("allows partial updates for an existing CloudShare Connection", async () => {
    const deps = await makeDeps();
    await handleSaveCloudShareConnection(deps, {
      customerId: deps.customerId,
      body: {
        apiId: "api-id",
        apiKey: "api-key",
        webhookSecret: "whsec",
      },
    });

    const update = await handleSaveCloudShareConnection(deps, {
      customerId: deps.customerId,
      body: {
        apiId: "",
        apiKey: "new-api-key",
        webhookSecret: "",
      },
    });

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ verifiedAt: null });
    const stored = await deps.connections.findByCustomerId(deps.customerId);
    expect(stored).toMatchObject({
      apiId: "api-id",
      apiKey: "new-api-key",
      webhookSecret: "whsec",
    });
  });

  it("clears cached exam authoring resources when the CloudShare Connection changes", async () => {
    const deps = await makeDeps();
    const cache = createInMemoryExamAuthoringCacheRepository();
    await cache.saveBootstrap(deps.customerId, {
      projects: [{ id: "project-1", name: "Helios Exams" }],
      regions: [{ id: "region-1", name: "EU West" }],
    });
    await cache.saveProjectResources(deps.customerId, "project-1", {
      blueprints: [{ id: "bp-1", name: "Exam Blueprint" }],
      policies: [{ id: "policy-1", name: "Timed Policy" }],
    });

    const response = await handleSaveCloudShareConnection(
      { ...deps, examAuthoringCache: cache },
      {
        customerId: deps.customerId,
        body: {
          apiId: "api-id",
          apiKey: "new-api-key",
          webhookSecret: "whsec",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(cache.getBootstrap(deps.customerId)).resolves.toBeNull();
    await expect(cache.getProjectResources(deps.customerId, "project-1")).resolves.toBeNull();
  });

  it("returns support diagnostics and a correlation id on test failure", async () => {
    const deps = await makeDeps();
    await handleSaveCloudShareConnection(deps, {
      customerId: deps.customerId,
      body: {
        apiId: "api-id",
        apiKey: "api-key",
        webhookSecret: "whsec",
      },
    });

    const failingDeps = {
      ...deps,
      cloudshare: {
        forConnection: () => ({
          requestV3Text: async () => {
            throw new CloudShareRequestError("401 unauthorized", 401);
          },
          requestV3: async () => {
            throw new Error("not used");
          },
          requestV4: async () => {
            throw new Error("not used");
          },
        }),
      } satisfies CloudShareClientFactory,
      newCorrelationId: () => "corr-123",
    };

    const response = await handleTestCloudShareConnection(failingDeps, {
      customerId: deps.customerId,
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "CloudShare returned 401 to the v3 ping. Check API ID and API key.",
      correlationId: "corr-123",
      occurredAt: "2026-06-13T18:10:00.000Z",
      diagnostic: {
        operation: "test_connection",
        integrationSurface: "cloudshare.v3.ping",
        integrationLabel: "CloudShare Classic v3 ping",
        method: "GET",
        path: "/ping",
        requestUrl: "https://use.cloudshare.com/api/v3/ping",
        failureMode: "http_status",
        responseStatus: 401,
      },
    });
  });
});
