import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CloudShareError,
  createCloudShareIntegrationForConnection,
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

const localEnv = parseEnvFile(resolve(process.cwd(), ".env.e2e.local"));
const e2eEnv = { ...localEnv, ...process.env };
const apiId =
  e2eEnv.CLOUDSHARE_E2E_API_ID ?? e2eEnv.HELIOS_SEED_CLOUDSHARE_API_ID ?? "";
const apiKey =
  e2eEnv.CLOUDSHARE_E2E_API_KEY ?? e2eEnv.HELIOS_SEED_CLOUDSHARE_API_KEY ?? "";
const webhookSecret =
  e2eEnv.CLOUDSHARE_E2E_WEBHOOK_SECRET ??
  e2eEnv.HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET ??
  "local-e2e-webhook-secret";

describe("live CloudShare connection E2E", () => {
  it("has locally stored CloudShare API credentials", () => {
    expect(apiId, "Set CLOUDSHARE_E2E_API_ID in .env.e2e.local").not.toBe("");
    expect(apiKey, "Set CLOUDSHARE_E2E_API_KEY in .env.e2e.local").not.toBe("");
  });

  it.runIf(apiId && apiKey)(
    "verifies the local API ID/key with a real v3 ping",
    async () => {
      const client = createCloudShareIntegrationForConnection({
        mode: "live",
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
