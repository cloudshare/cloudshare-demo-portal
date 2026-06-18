import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaSupportLogRepository } from "./support-log-repository";

const prisma = new PrismaClient();
const TEST_MESSAGE_PREFIX = "support-log-test-";

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.supportLogEntry.deleteMany({
    where: {
      message: {
        startsWith: TEST_MESSAGE_PREFIX,
      },
    },
  });
});

describe("createPrismaSupportLogRepository", () => {
  it("persists structured CloudShare diagnostics across repository instances", async () => {
    const first = createPrismaSupportLogRepository(prisma);

    await first.append({
      timestamp: new Date("2026-06-16T07:00:00.000Z"),
      level: "info",
      message: `${TEST_MESSAGE_PREFIX}cloudshare response received`,
      fields: {
        operation: "cloudshare_http",
        method: "PUT",
        path: "/api/v3/envs/actions/suspend",
        integrationSurface: "cloudshare.v3",
        requestHeaders: {
          authorization: "cs_sha1 userapiid:abc;token:[REDACTED];hmac:[REDACTED]",
        },
        responseStatus: 204,
        responseBody: "",
      },
    });

    const second = createPrismaSupportLogRepository(prisma);
    const records = await second.listAll();

    expect(records).toEqual([
      {
        timestamp: new Date("2026-06-16T07:00:00.000Z"),
        level: "info",
        message: `${TEST_MESSAGE_PREFIX}cloudshare response received`,
        fields: {
          operation: "cloudshare_http",
          method: "PUT",
          path: "/api/v3/envs/actions/suspend",
          integrationSurface: "cloudshare.v3",
          requestHeaders: {
            authorization: "cs_sha1 userapiid:abc;token:[REDACTED];hmac:[REDACTED]",
          },
          responseStatus: 204,
          responseBody: "",
        },
      },
    ]);
  });

  it("returns newest records first and respects limits", async () => {
    const repo = createPrismaSupportLogRepository(prisma);
    await repo.append({
      timestamp: new Date("2026-06-16T07:00:00.000Z"),
      level: "info",
      message: `${TEST_MESSAGE_PREFIX}older`,
      fields: {},
    });
    await repo.append({
      timestamp: new Date("2026-06-16T07:01:00.000Z"),
      level: "warn",
      message: `${TEST_MESSAGE_PREFIX}newer`,
      fields: {},
    });

    await expect(repo.listAll(1)).resolves.toMatchObject([
      {
        level: "warn",
        message: `${TEST_MESSAGE_PREFIX}newer`,
      },
    ]);
  });
});
