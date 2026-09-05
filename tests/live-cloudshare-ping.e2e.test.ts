import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CloudShareError,
  createCloudShareIntegrationForConnection,
  createCloudShareNoopObservationPort,
  pingCloudShareV3,
} from "@/integrations/cloudshare";

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equals = line.indexOf("=");
    if (equals === -1) continue;

    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function readSeedConnection(): {
  readonly apiId: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
} | null {
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const env = {
    ...parseEnvFile(resolve(process.cwd(), ".env")),
    ...processEnv,
  };
  const configured = env.PORTAL_SEED_CONFIG_PATH;
  const candidates = configured
    ? [configured]
    : [
        "./config/portal-seed.local.json",
        "D:/Code_projects/cloudshare-demo-portal/config/portal-seed.local.json",
      ];

  for (const candidate of candidates) {
    const path = /^(?:[A-Za-z]:)?[\\/]/.test(candidate)
      ? candidate
      : resolve(process.cwd(), candidate);
    if (!existsSync(path)) continue;

    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      heliosCloudShareConnection?: {
        apiId?: unknown;
        apiKey?: unknown;
        webhookSecret?: unknown;
      } | null;
    };
    const connection = parsed.heliosCloudShareConnection;
    if (
      connection &&
      typeof connection.apiId === "string" &&
      typeof connection.apiKey === "string" &&
      typeof connection.webhookSecret === "string"
    ) {
      return {
        apiId: connection.apiId,
        apiKey: connection.apiKey,
        webhookSecret: connection.webhookSecret,
      };
    }
  }

  return null;
}

const localEnv = parseEnvFile(resolve(process.cwd(), ".env.e2e.local"));
const processEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
const e2eEnv = { ...localEnv, ...processEnv };
const seedConnection = readSeedConnection();
const apiId =
  e2eEnv.CLOUDSHARE_E2E_API_ID ??
  e2eEnv.HELIOS_SEED_CLOUDSHARE_API_ID ??
  seedConnection?.apiId ??
  "";
const apiKey =
  e2eEnv.CLOUDSHARE_E2E_API_KEY ??
  e2eEnv.HELIOS_SEED_CLOUDSHARE_API_KEY ??
  seedConnection?.apiKey ??
  "";
const webhookSecret =
  e2eEnv.CLOUDSHARE_E2E_WEBHOOK_SECRET ??
  e2eEnv.HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET ??
  seedConnection?.webhookSecret ??
  "local-e2e-webhook-secret";

describe("live CloudShare connection E2E", () => {
  it("has locally stored CloudShare API credentials", () => {
    expect(
      apiId,
      "Set CLOUDSHARE_E2E_API_ID in .env.e2e.local or configure a portal seed file with CloudShare credentials.",
    ).not.toBe("");
    expect(
      apiKey,
      "Set CLOUDSHARE_E2E_API_KEY in .env.e2e.local or configure a portal seed file with CloudShare credentials.",
    ).not.toBe("");
  });

  it.runIf(apiId && apiKey)(
    "verifies the local API ID/key with a real v3 ping",
    async () => {
      const client = createCloudShareIntegrationForConnection({
        mode: "live",
        observer: createCloudShareNoopObservationPort(),
        connection: { apiId, apiKey, webhookSecret },
      });

      try {
        const result = await pingCloudShareV3(client);
        expect(result).toBe("pong");
      } catch (error) {
        if (error instanceof CloudShareError) {
          throw new Error(
            `Live CloudShare ping failed: ${error.message}; context=${JSON.stringify(error.context)}`,
          );
        }
        throw error;
      }
    },
    20_000,
  );
});
