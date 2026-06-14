import { z } from "zod";
import type { CloudShareClient } from "./client";
import type { CloudShareResourceLister } from "@/domain/resource-sync";

const blueprintVersionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean(),
});

const blueprintDetailSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createFromVersions: z.array(blueprintVersionSchema),
});

export interface CloudShareBlueprintSnapshot {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface CloudShareBlueprintDetail {
  readonly id: string;
  readonly name: string;
  readonly defaultSnapshotId: string | null;
  readonly snapshots: CloudShareBlueprintSnapshot[];
}

export interface CloudShareExamAuthoringSource {
  listProjects(): Promise<Array<{ id: string; name: string }>>;
  listRegions(): Promise<Array<{ id: string; name: string }>>;
  listProjectBlueprints(projectId: string): Promise<Array<{ id: string; name: string }>>;
  listProjectPolicies(projectId: string): Promise<Array<{ id: string; name: string }>>;
  getBlueprintDetail(projectId: string, blueprintId: string): Promise<CloudShareBlueprintDetail>;
}

/**
 * CloudShare implementation of the {@link CloudShareResourceLister} port.
 * Fetches the reference lists (blueprints, policies, projects, regions) used
 * to populate the resource ID mapping table. IDs are dynamic and must be
 * refreshed via the Sync Resources admin action rather than hard-coded.
 *
 * NOTE (assumptions to verify against a live tenant, isolated in this module):
 * - Projects: GET /projects (v3 Classic)
 * - Regions: GET /regions (v3 Classic)
 * - Blueprints: GET /projects/{id}/blueprints (v3 Classic)
 * - Policies: GET /policies (v3 Classic)
 */

const resourceListSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().min(1) }),
);

export function createCloudShareResourceLister(client: CloudShareClient): CloudShareResourceLister {
  return {
    async listProjects() {
      return client.requestV3({ method: "GET", path: "/projects", schema: resourceListSchema });
    },
    async listRegions() {
      return client.requestV3({ method: "GET", path: "/regions", schema: resourceListSchema });
    },
    async listBlueprints() {
      const projects = await client.requestV3({
        method: "GET",
        path: "/projects",
        schema: resourceListSchema,
      });

      const blueprintsByProject = await Promise.all(
        projects.map((project) =>
          client.requestV3({
            method: "GET",
            path: `/projects/${project.id}/blueprints`,
            schema: resourceListSchema,
          }),
        ),
      );

      return blueprintsByProject.flat();
    },
    async listPolicies() {
      return client.requestV3({ method: "GET", path: "/policies", schema: resourceListSchema });
    },
  };
}

export function createCloudShareExamAuthoringSource(
  client: CloudShareClient,
): CloudShareExamAuthoringSource {
  return {
    async listProjects() {
      return client.requestV3({ method: "GET", path: "/projects", schema: resourceListSchema });
    },
    async listRegions() {
      return client.requestV3({ method: "GET", path: "/regions", schema: resourceListSchema });
    },
    async listProjectBlueprints(projectId) {
      return client.requestV3({
        method: "GET",
        path: `/projects/${projectId}/blueprints`,
        schema: resourceListSchema,
      });
    },
    async listProjectPolicies(projectId) {
      return client.requestV3({
        method: "GET",
        path: `/projects/${projectId}/policies`,
        schema: resourceListSchema,
      });
    },
    async getBlueprintDetail(projectId, blueprintId) {
      const detail = await client.requestV3({
        method: "GET",
        path: `/projects/${projectId}/blueprints/${blueprintId}`,
        schema: blueprintDetailSchema,
      });

      return {
        id: detail.id,
        name: detail.name,
        defaultSnapshotId:
          detail.createFromVersions.find((snapshot) => snapshot.isDefault)?.id ?? null,
        snapshots: detail.createFromVersions,
      };
    },
  };
}
