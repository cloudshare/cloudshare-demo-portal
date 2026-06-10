import { z } from "zod";
import type { CloudShareClient } from "./client";
import type { CloudShareResourceLister } from "@/domain/resource-sync";

/**
 * CloudShare implementation of the {@link CloudShareResourceLister} port.
 * Fetches the reference lists (blueprints, policies, projects, regions) used
 * to populate the resource ID mapping table. IDs are dynamic and must be
 * refreshed via the Sync Resources admin action rather than hard-coded.
 *
 * NOTE (assumptions to verify against a live tenant, isolated in this module):
 * - Projects: GET /projects (v4 Accelerate)
 * - Regions: GET /regions (v3 Classic)
 * - Blueprints: GET /blueprints (v3 Classic)
 * - Policies: GET /policies (v3 Classic)
 */

const resourceListSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().min(1) }),
);

export function createCloudShareResourceLister(client: CloudShareClient): CloudShareResourceLister {
  return {
    async listProjects() {
      return client.requestV4({ method: "GET", path: "/projects", schema: resourceListSchema });
    },
    async listRegions() {
      return client.requestV3({ method: "GET", path: "/regions", schema: resourceListSchema });
    },
    async listBlueprints() {
      return client.requestV3({ method: "GET", path: "/blueprints", schema: resourceListSchema });
    },
    async listPolicies() {
      return client.requestV3({ method: "GET", path: "/policies", schema: resourceListSchema });
    },
  };
}
