import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CloudShareRequestError, createCloudShareIntegrationForConnection } from "@/integrations/cloudshare";

function certalisConnection() {
  const path = process.env.PORTAL_SEED_CONFIG_PATH ?? "D:/Code_projects/cloudshare-demo-portal/config/portal-seed.local.json";
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as { certalisSalesCloudShareConnection?: { apiId?: string; apiKey?: string; webhookSecret?: string } | null; certalisSalesShareConnection?: { apiId?: string; apiKey?: string; webhookSecret?: string } | null };
  const connection = parsed.certalisSalesCloudShareConnection ?? parsed.certalisSalesShareConnection;
  return connection?.apiId && connection.apiKey && connection.webhookSecret ? { apiId: connection.apiId, apiKey: connection.apiKey, webhookSecret: connection.webhookSecret } : null;
}

const connection = certalisConnection();

describe("live Certalis Sales-Pro preflight probe", () => {
  it.runIf(connection)("confirms that the inferred Get/salespros preflight path is absent", async () => {
    const client = createCloudShareIntegrationForConnection({ mode: "live", connection: connection! });
    await expect(client.requestV4Detailed!({ method: "GET", path: "/salespros", schema: z.object({ count: z.number().optional(), salesPros: z.array(z.object({ email: z.string().email() })) }) })).rejects.toMatchObject({ name: CloudShareRequestError.name, status: 404, context: { method: "GET", path: "/v4/salespros" } });
  }, 20_000);
});
