import { z } from "zod";
import type { CloudShareClient } from "./client";
import type { CloudShareResourceLister } from "@/domain/resource-sync";

const blueprintVersionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean(),
  regions: z
    .array(
      z.union([
        z.string().min(1),
        z.object({
          id: z.string().min(1),
          name: z.string().min(1).optional(),
        }),
      ]),
    )
    .optional()
    .default([]),
});

const blueprintDetailSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  createFromVersions: z.array(blueprintVersionSchema),
});

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const regionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  friendlyName: z.string().min(1).optional(),
});

const blueprintSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(""),
});

const policySummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const policyDetailSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  runtimeLeaseMinutes: z.number().int().positive().optional(),
});

export interface CloudShareBlueprintSnapshot {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly regionIds: string[];
}

export interface CloudShareBlueprintDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultSnapshotId: string | null;
  readonly snapshots: CloudShareBlueprintSnapshot[];
}

export interface CloudShareExamAuthoringSource {
  listProjects(): Promise<Array<{ id: string; name: string }>>;
  listRegions(): Promise<Array<{ id: string; name: string; friendlyName?: string }>>;
  listProjectBlueprints(
    projectId: string,
  ): Promise<Array<{ id: string; name: string; description: string }>>;
  listProjectPolicies(
    projectId: string,
  ): Promise<Array<{ id: string; name: string; runtimeLeaseMinutes: number | null }>>;
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

const projectListSchema = z.array(projectSchema);
const regionListSchema = z.array(regionSchema);
const blueprintListSchema = z.array(blueprintSummarySchema);
const policyListSchema = z.array(policySummarySchema);

export interface CloudShareResourceReadSuccess {
  readonly operation: string;
  readonly integrationSurface: string;
  readonly path: string;
  readonly resourceType: "project" | "region" | "blueprint" | "policy";
  readonly resourceIds?: Record<string, string>;
  readonly response: Record<string, unknown>;
}

export interface CloudShareResourceReadFailure {
  readonly operation: string;
  readonly integrationSurface: string;
  readonly path: string;
  readonly resourceType: "project" | "region" | "blueprint" | "policy";
  readonly resourceIds?: Record<string, string>;
  readonly error: unknown;
}

export interface CloudShareResourceListerOptions {
  readonly onReadSuccess?: (spec: CloudShareResourceReadSuccess) => Promise<void> | void;
  readonly onReadFailure?: (spec: CloudShareResourceReadFailure) => Promise<void> | void;
}

export function createCloudShareResourceLister(
  client: CloudShareClient,
  options: CloudShareResourceListerOptions = {},
): CloudShareResourceLister {
  let projectsPromise: Promise<Array<{ id: string; name: string }>> | undefined;
  let regionsPromise:
    | Promise<Array<{ id: string; name: string; friendlyName?: string }>>
    | undefined;

  function loadProjects(): Promise<Array<{ id: string; name: string }>> {
    if (!projectsPromise) {
      projectsPromise = client
        .requestV3({ method: "GET", path: "/projects", schema: projectListSchema })
        .then(async (projects) => {
          await options.onReadSuccess?.({
            operation: "cloudshare.resource_sync.projects.read",
            integrationSurface: "cloudshare.v3.projects",
            path: "/projects",
            resourceType: "project",
            response: {
              itemCount: projects.length,
              resourceIds: projects.map((project) => project.id),
            },
          });
          return projects;
        })
        .catch(async (error) => {
          await options.onReadFailure?.({
            operation: "cloudshare.resource_sync.projects.read",
            integrationSurface: "cloudshare.v3.projects",
            path: "/projects",
            resourceType: "project",
            error,
          });
          throw error;
        });
    }
    return projectsPromise;
  }

  function loadRegions(): Promise<Array<{ id: string; name: string; friendlyName?: string }>> {
    if (!regionsPromise) {
      regionsPromise = client
        .requestV3({
          method: "GET",
          path: "/regions",
          schema: regionListSchema,
        })
        .then(async (regions) => {
          const mapped = regions.map((region) => ({
            id: region.id,
            name: region.name,
            ...(region.friendlyName ? { friendlyName: region.friendlyName } : {}),
          }));
          await options.onReadSuccess?.({
            operation: "cloudshare.resource_sync.regions.read",
            integrationSurface: "cloudshare.v3.regions",
            path: "/regions",
            resourceType: "region",
            response: {
              itemCount: mapped.length,
              resourceIds: mapped.map((region) => region.id),
            },
          });
          return mapped;
        })
        .catch(async (error) => {
          await options.onReadFailure?.({
            operation: "cloudshare.resource_sync.regions.read",
            integrationSurface: "cloudshare.v3.regions",
            path: "/regions",
            resourceType: "region",
            error,
          });
          throw error;
        });
    }
    return regionsPromise;
  }

  return {
    async listProjects() {
      return loadProjects();
    },
    async listRegions() {
      return loadRegions();
    },
    async listBlueprints() {
      const projects = await loadProjects();
      const blueprints = await Promise.all(
        projects.map(async (project) => {
          const path = `/projects/${project.id}/blueprints`;
          try {
            const result = await client.requestV3({
              method: "GET",
              path,
              schema: blueprintListSchema,
            });
            await options.onReadSuccess?.({
              operation: "cloudshare.resource_sync.blueprints.read",
              integrationSurface: "cloudshare.v3.projects.blueprints",
              path,
              resourceType: "blueprint",
              resourceIds: { projectId: project.id },
              response: {
                itemCount: result.length,
                resourceIds: result.map((blueprint) => blueprint.id),
              },
            });
            return result.map((blueprint) => ({
              id: blueprint.id,
              name: blueprint.name,
            }));
          } catch (error) {
            await options.onReadFailure?.({
              operation: "cloudshare.resource_sync.blueprints.read",
              integrationSurface: "cloudshare.v3.projects.blueprints",
              path,
              resourceType: "blueprint",
              resourceIds: { projectId: project.id },
              error,
            });
            throw error;
          }
        }),
      );
      return blueprints.flat();
    },
    async listPolicies() {
      const projects = await loadProjects();
      const policies = await Promise.all(
        projects.map(async (project) => {
          const path = `/projects/${project.id}/policies`;
          try {
            const result = await client.requestV3({
              method: "GET",
              path,
              schema: policyListSchema,
            });
            await options.onReadSuccess?.({
              operation: "cloudshare.resource_sync.policies.read",
              integrationSurface: "cloudshare.v3.projects.policies",
              path,
              resourceType: "policy",
              resourceIds: { projectId: project.id },
              response: {
                itemCount: result.length,
                resourceIds: result.map((policy) => policy.id),
              },
            });
            return result.map((policy) => ({
              id: policy.id,
              name: policy.name,
            }));
          } catch (error) {
            await options.onReadFailure?.({
              operation: "cloudshare.resource_sync.policies.read",
              integrationSurface: "cloudshare.v3.projects.policies",
              path,
              resourceType: "policy",
              resourceIds: { projectId: project.id },
              error,
            });
            throw error;
          }
        }),
      );
      return policies.flat();
    },
  };
}

export function createCloudShareExamAuthoringSource(
  client: CloudShareClient,
): CloudShareExamAuthoringSource {
  return {
    async listProjects() {
      return client.requestV3({ method: "GET", path: "/projects", schema: projectListSchema });
    },
    async listRegions() {
      const regions = await client.requestV3({
        method: "GET",
        path: "/regions",
        schema: regionListSchema,
      });
      return regions.map((region) => ({
        id: region.id,
        name: region.name,
        ...(region.friendlyName ? { friendlyName: region.friendlyName } : {}),
      }));
    },
    async listProjectBlueprints(projectId) {
      const blueprints = await client.requestV3({
        method: "GET",
        path: `/projects/${projectId}/blueprints`,
        schema: blueprintListSchema,
      });
      return blueprints.map((blueprint) => ({
        id: blueprint.id,
        name: blueprint.name,
        description: blueprint.description ?? "",
      }));
    },
    async listProjectPolicies(projectId) {
      const policies = await client.requestV3({
        method: "GET",
        path: `/projects/${projectId}/policies`,
        schema: policyListSchema,
      });
      return Promise.all(
        policies.map(async (policy) => {
          const detail = await client.requestV3({
            method: "GET",
            path: `/projects/${projectId}/policies/${policy.id}`,
            schema: policyDetailSchema,
          });
          return {
            id: policy.id,
            name: policy.name,
            runtimeLeaseMinutes: detail.runtimeLeaseMinutes ?? null,
          };
        }),
      );
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
        description: detail.description ?? "",
        defaultSnapshotId:
          detail.createFromVersions.find((snapshot) => snapshot.isDefault)?.id ?? null,
        snapshots: detail.createFromVersions.map((snapshot) => ({
          id: snapshot.id,
          name: snapshot.name,
          isDefault: snapshot.isDefault,
          regionIds: (snapshot.regions ?? []).map((region) =>
            typeof region === "string" ? region : region.id,
          ),
        })),
      };
    },
  };
}
