import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSecretBox } from "@/security/secret-box";
import { createCloudShareConnectionRepository } from "./cloudshare-connection-repository";

const prisma = new PrismaClient();
const secrets = createSecretBox(Buffer.alloc(32, 3));

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.cloudShareConnection.deleteMany();
  await prisma.customer.deleteMany({
    where: {
      slug: {
        startsWith: "helios-",
      },
    },
  });
});

describe("CloudShareConnectionRepository", () => {
  it("stores a per-Customer CloudShare connection encrypted at rest and decrypts on read", async () => {
    const slug = `helios-${Date.now()}`;
    const customer = await prisma.customer.create({
      data: { slug, name: "Helios CX" },
    });
    const repo = createCloudShareConnectionRepository(prisma, secrets);

    await repo.save({
      customerId: customer.id,
      apiId: "api-id-123",
      apiKey: "api-key-456",
      webhookSecret: "webhook-secret-789",
    });

    const raw = await prisma.cloudShareConnection.findUniqueOrThrow({
      where: { customerId: customer.id },
    });
    expect(raw.apiIdCiphertext).not.toContain("api-id-123");
    expect(raw.apiKeyCiphertext).not.toContain("api-key-456");
    expect(raw.webhookSecretCiphertext).not.toContain("webhook-secret-789");

    await expect(repo.findByCustomerId(customer.id)).resolves.toMatchObject({
      customerId: customer.id,
      apiId: "api-id-123",
      apiKey: "api-key-456",
      webhookSecret: "webhook-secret-789",
    });
  });

  it("clears verifiedAt when saved credentials are changed", async () => {
    const slug = `helios-${Date.now()}-verified`;
    const customer = await prisma.customer.create({
      data: { slug, name: "Helios CX" },
    });
    const repo = createCloudShareConnectionRepository(prisma, secrets);

    await repo.save({
      customerId: customer.id,
      apiId: "api-id-123",
      apiKey: "api-key-456",
      webhookSecret: "webhook-secret-789",
    });
    await repo.markVerified(customer.id, new Date("2026-06-14T01:00:00.000Z"));

    const updated = await repo.save({
      customerId: customer.id,
      apiId: "api-id-123",
      apiKey: "api-key-999",
      webhookSecret: "webhook-secret-789",
    });

    expect(updated.verifiedAt).toBeNull();
  });
});
