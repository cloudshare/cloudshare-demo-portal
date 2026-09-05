import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createCloudShareIntegrationForConnection, createCloudShareNoopObservationPort } from "@/integrations/cloudshare";
import { createCloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";

function certalisConnection() {
  const path = process.env.PORTAL_SEED_CONFIG_PATH ?? "D:/Code_projects/cloudshare-demo-portal/config/portal-seed.local.json";
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as { certalisSalesCloudShareConnection?: { apiId?: string; apiKey?: string; webhookSecret?: string } | null; certalisSalesShareConnection?: { apiId?: string; apiKey?: string; webhookSecret?: string } | null };
  const connection = parsed.certalisSalesCloudShareConnection ?? parsed.certalisSalesShareConnection;
  return connection?.apiId && connection.apiKey && connection.webhookSecret ? { apiId: connection.apiId, apiKey: connection.apiKey, webhookSecret: connection.webhookSecret } : null;
}

const connection = certalisConnection();

describe("live Certalis Sales-Pro preflight probe", () => {
  it.runIf(connection)("reads active members for a live Certalis Project through the GUI contract", async () => {
    const client = createCloudShareIntegrationForConnection({
      mode: "live",
      connection: connection!,
      observer: createCloudShareNoopObservationPort(),
    });
    const projects = await client.requestV3Detailed!({ method: "GET", path: "/projects", schema: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })) });
    const project = projects.data[0];
    expect(project).toBeDefined();
    const read = await createCloudShareProjectMemberSource(client).listActiveProjectMembers(project!.id);
    expect(read.response.status).toBe(200);
    expect(read.members).toEqual(expect.any(Array));
    expect(read.request.query).toEqual({ projectUsers: "true", status: "active", loggedIn: "ever", projectId: project!.id, getRows: "true" });
  }, 20_000);
});
