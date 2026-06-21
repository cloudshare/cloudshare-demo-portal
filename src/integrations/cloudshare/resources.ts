import { z } from "zod";
import type { CloudShareClient } from "./client";
import type { CloudShareResourceLister } from "@/domain/resource-sync";

const REDACTED = "[REDACTED]";
const SNAPSHOT_DIAGNOSTIC_LIMIT = 25;
const MACHINE_DIAGNOSTIC_LIMIT = 25;

const redactableQueryKeyPatterns = ["token", "bearer", "secret", "signature", "auth", "key"];
const sensitiveTextPatterns = [/bearer\s+[a-z0-9._-]+/i, /authorization:/i, /\b(password|secret)\b/i];

function nullishToUndefined(value: unknown): unknown {
  return value ?? undefined;
}

const optionalStringSchema = z.preprocess(
  nullishToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalLooseStringSchema = z.preprocess(
  nullishToUndefined,
  z.string().optional(),
);
const optionalBooleanSchema = z.preprocess(nullishToUndefined, z.boolean().optional());
const optionalRecordSchema = z.preprocess(
  nullishToUndefined,
  z.record(z.string(), z.unknown()).optional(),
);
const optionalStringOrNumberSchema = z.preprocess(
  nullishToUndefined,
  z.union([z.string(), z.number()]).optional(),
);

const machineSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: optionalStringSchema,
    osTypeName: optionalStringSchema,
    resources: optionalRecordSchema,
    isSaaS: optionalBooleanSchema,
    httpAccessEnabled: optionalBooleanSchema,
    resumeType: optionalStringOrNumberSchema,
    bootOrder: optionalStringOrNumberSchema,
    canAddMultipleInstances: optionalBooleanSchema,
  })
  .passthrough();

const blueprintVersionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean(),
  number: optionalStringOrNumberSchema,
  isLatest: optionalBooleanSchema,
  type: optionalStringOrNumberSchema,
  createTime: optionalStringSchema,
  description: optionalLooseStringSchema,
  comment: optionalLooseStringSchema,
  resources: optionalRecordSchema,
  machines: z.array(machineSchema).optional(),
  regions: z
    .array(
      z.union([
        z.string().min(1),
        z.object({
          id: z.string().min(1),
          name: z.string().min(1).optional(),
        }).passthrough(),
      ]),
    )
    .optional()
    .default([]),
})
  .passthrough();

const blueprintDetailSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.preprocess(nullishToUndefined, z.string().optional()).default(""),
  type: optionalStringOrNumberSchema,
  creationDate: optionalStringSchema,
  resources: optionalRecordSchema,
  numberOfMachines: z.number().int().nonnegative().optional(),
  imageUrl: optionalStringSchema,
  createFromVersions: z.preprocess(
    (value) => value ?? [],
    z.array(blueprintVersionSchema),
  ),
})
  .passthrough();

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
  readonly diagnosticSummary?: Record<string, unknown>;
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
        schema: z.preprocess(
          (value) => normalizeBlueprintDetailPayload(value, blueprintId),
          blueprintDetailSchema,
        ),
      });

      return {
        id: detail.id,
        name: detail.name,
        description: detail.description ?? "",
        defaultSnapshotId:
          detail.createFromVersions.find((snapshot) => snapshot.isDefault)?.id ?? null,
        diagnosticSummary: summarizeBlueprintDetailForDiagnostics(detail),
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

function summarizeBlueprintDetailForDiagnostics(
  detail: z.infer<typeof blueprintDetailSchema>,
): Record<string, unknown> {
  const snapshots = detail.createFromVersions.slice(0, SNAPSHOT_DIAGNOSTIC_LIMIT);
  const summary: Record<string, unknown> = {
    blueprintId: detail.id,
    name: detail.name,
    description: sanitizeFreeText(detail.description) ?? "",
    defaultSnapshotId:
      detail.createFromVersions.find((snapshot) => snapshot.isDefault)?.id ?? null,
    snapshotCount: detail.createFromVersions.length,
    snapshots: snapshots.map((snapshot) => summarizeSnapshotForDiagnostics(snapshot)),
  };

  if (detail.type !== undefined) {
    summary.type = detail.type;
  }
  if (detail.creationDate) {
    summary.creationDate = detail.creationDate;
  }
  if (detail.resources) {
    summary.resources = detail.resources;
  }
  if (detail.numberOfMachines !== undefined) {
    summary.numberOfMachines = detail.numberOfMachines;
  }
  summary.imageUrl = summarizeImageUrl(detail.imageUrl);

  if (detail.createFromVersions.length > snapshots.length) {
    summary.truncation = {
      snapshotsIncluded: snapshots.length,
      totalSnapshots: detail.createFromVersions.length,
    };
  }

  return summary;
}

function normalizeBlueprintDetailPayload(
  value: unknown,
  blueprintId: string,
): unknown {
  const record = asRecord(value);
  if (!record) {
    return value;
  }

  const createFromVersions = readField(record, "createFromVersions", "CreateFromVersions");
  const id = readField(record, "id", "Id");
  const name = readField(record, "name", "Name");
  const hasCreateFromVersionsField = hasAnyField(record, "createFromVersions", "CreateFromVersions");
  const hasExplicitIdentity = id !== undefined && name !== undefined;
  const canSynthesizeIdentity = hasCreateFromVersionsField;

  if (!hasExplicitIdentity && !canSynthesizeIdentity) {
    return value;
  }

  return {
    ...record,
    id: id ?? blueprintId,
    name: name ?? blueprintId,
    description: readField(record, "description", "Description") ?? "",
    type: readField(record, "type", "Type"),
    creationDate: readField(record, "creationDate", "CreationDate"),
    resources: readField(record, "resources", "Resources"),
    numberOfMachines: readField(record, "numberOfMachines", "NumberOfMachines"),
    imageUrl: readField(record, "imageUrl", "ImageUrl"),
    createFromVersions: Array.isArray(createFromVersions)
      ? createFromVersions.map((version) => normalizeBlueprintVersionPayload(version))
      : createFromVersions,
  };
}

function normalizeBlueprintVersionPayload(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return value;
  }

  const machines = readField(record, "machines", "Machines");
  const regions = readField(record, "regions", "Regions");

  return {
    ...record,
    id: readField(record, "id", "Id"),
    name: readField(record, "name", "Name"),
    isDefault: readField(record, "isDefault", "IsDefault"),
    number: readField(record, "number", "Number"),
    isLatest: readField(record, "isLatest", "IsLatest"),
    type: readField(record, "type", "Type"),
    createTime: readField(record, "createTime", "CreateTime"),
    description: readField(record, "description", "Description"),
    comment: readField(record, "comment", "Comment"),
    resources: readField(record, "resources", "Resources"),
    machines: Array.isArray(machines)
      ? machines.map((machine) => normalizeMachinePayload(machine))
      : machines,
    regions: Array.isArray(regions)
      ? regions.map((region) => normalizeRegionPayload(region))
      : regions,
  };
}

function normalizeMachinePayload(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return value;
  }

  return {
    ...record,
    id: readField(record, "id", "Id"),
    name: readField(record, "name", "Name"),
    osTypeName: readField(record, "osTypeName", "OsTypeName"),
    resources: readField(record, "resources", "Resources"),
    isSaaS: readField(record, "isSaaS", "IsSaaS"),
    httpAccessEnabled: readField(record, "httpAccessEnabled", "HttpAccessEnabled"),
    resumeType: readField(record, "resumeType", "ResumeType"),
    bootOrder: readField(record, "bootOrder", "BootOrder"),
    canAddMultipleInstances: readField(
      record,
      "canAddMultipleInstances",
      "CanAddMultipleInstances",
    ),
  };
}

function normalizeRegionPayload(value: unknown): unknown {
  if (typeof value === "string") {
    return value;
  }

  const record = asRecord(value);
  if (!record) {
    return value;
  }

  return {
    ...record,
    id: readField(record, "id", "Id"),
    name: readField(record, "name", "Name"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readField(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function hasAnyField(record: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => key in record);
}

function summarizeSnapshotForDiagnostics(
  snapshot: z.infer<typeof blueprintVersionSchema>,
): Record<string, unknown> {
  const machines = (snapshot.machines ?? []).slice(0, MACHINE_DIAGNOSTIC_LIMIT);
  const summary: Record<string, unknown> = {
    id: snapshot.id,
    name: snapshot.name,
    isDefault: snapshot.isDefault,
    machineCount: snapshot.machines?.length ?? 0,
    machines: machines.map((machine) => summarizeMachineForDiagnostics(machine)),
  };

  if (snapshot.number !== undefined) {
    summary.number = snapshot.number;
  }
  if (snapshot.isLatest !== undefined) {
    summary.isLatest = snapshot.isLatest;
  }
  if (snapshot.type !== undefined) {
    summary.type = snapshot.type;
  }
  if (snapshot.createTime) {
    summary.createTime = snapshot.createTime;
  }
  const description = sanitizeFreeText(snapshot.description);
  if (description) {
    summary.description = description;
  }
  const comment = sanitizeFreeText(snapshot.comment);
  if (comment) {
    summary.comment = comment;
  }
  if (snapshot.regions.length > 0) {
    summary.regions = snapshot.regions.map((region) =>
      typeof region === "string"
        ? { id: region }
        : { id: region.id, ...(region.name ? { name: region.name } : {}) },
    );
  }
  if (snapshot.resources) {
    summary.resources = snapshot.resources;
  }
  if ((snapshot.machines ?? []).length > machines.length) {
    summary.truncation = {
      machinesIncluded: machines.length,
      totalMachines: snapshot.machines?.length ?? machines.length,
    };
  }

  return summary;
}

function summarizeMachineForDiagnostics(
  machine: z.infer<typeof machineSchema>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = { id: machine.id };

  if (machine.name) {
    summary.name = machine.name;
  }
  if (machine.osTypeName) {
    summary.osTypeName = machine.osTypeName;
  }
  if (machine.resources) {
    summary.resources = machine.resources;
  }
  if (machine.isSaaS !== undefined) {
    summary.isSaaS = machine.isSaaS;
  }
  if (machine.httpAccessEnabled !== undefined) {
    summary.httpAccessEnabled = machine.httpAccessEnabled;
  }
  if (machine.resumeType !== undefined) {
    summary.resumeType = machine.resumeType;
  }
  if (machine.bootOrder !== undefined) {
    summary.bootOrder = machine.bootOrder;
  }
  if (machine.canAddMultipleInstances !== undefined) {
    summary.canAddMultipleInstances = machine.canAddMultipleInstances;
  }

  return summary;
}

function summarizeImageUrl(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return { present: false };
  }

  try {
    const url = new URL(value, "https://cloudshare.invalid");
    const query = summarizeImageUrlQuery(url.searchParams);
    return {
      present: true,
      path: url.pathname,
      ...(Object.keys(query).length > 0 ? { query } : {}),
    };
  } catch {
    const [rawPath, rawQuery = ""] = value.split("?", 2);
    const query = summarizeImageUrlQuery(new URLSearchParams(rawQuery));
    return {
      present: true,
      path: sanitizeFreeText(rawPath) ?? "[UNPARSEABLE]",
      ...(Object.keys(query).length > 0 ? { query } : {}),
    };
  }
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return redactableQueryKeyPatterns.some((pattern) => normalized.includes(pattern));
}

function summarizeImageUrlQuery(
  searchParams: URLSearchParams,
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, paramValue] of searchParams.entries()) {
    query[key] = isSensitiveQueryKey(key) ? REDACTED : paramValue;
  }
  return query;
}

function sanitizeFreeText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (sensitiveTextPatterns.some((pattern) => pattern.test(value))) {
    return REDACTED;
  }
  return value;
}
