import { z } from "zod";
import type {
  CloudShareClient,
  CloudShareDetailedResult,
  CloudShareRequestDiagnostics,
  CloudShareResponseDiagnostics,
  V4RequestSpec,
} from "./client";
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
  projectId: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
});

const policyDetailSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  runtimeMinutes: z.number().int().positive().optional(),
  storageMinutes: z.number().int().positive().optional(),
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
  readonly diagnosticResponse?: Record<string, unknown>;
}

export interface CloudShareExamAuthoringPolicy {
  readonly id: string;
  readonly name: string;
  readonly runtimeLeaseMinutes: number | null;
  readonly storageLeaseMinutes?: number | null;
  readonly diagnosticRequest?: Record<string, unknown>;
  readonly diagnosticResponse?: Record<string, unknown>;
}

export interface CloudShareExamAuthoringSource {
  listProjects(): Promise<Array<{ id: string; name: string }>>;
  listRegions(): Promise<Array<{ id: string; name: string; friendlyName?: string }>>;
  listProjectBlueprints(
    projectId: string,
  ): Promise<Array<{ id: string; name: string; description: string }>>;
  listProjectPolicies(projectId: string): Promise<CloudShareExamAuthoringPolicy[]>;
  getBlueprintDetail(projectId: string, blueprintId: string): Promise<CloudShareBlueprintDetail>;
}

/** The authoring adapter owns the provider exchange. Its observer lets the
 * runtime persist that complete, sanitized exchange without adding CloudShare
 * wire models to its public resource values. */
export interface CloudShareExamAuthoringSourceOptions {
  readonly onReadSuccess?: (spec: {
    readonly operation: string;
    readonly integrationSurface: string;
    readonly path: string;
    readonly resourceType: string;
    readonly resourceIds?: Record<string, string>;
    readonly request: Record<string, unknown>;
    readonly response: Record<string, unknown>;
  }) => Promise<void> | void;
}

/** Detailed resource reads used by Sales Item authoring. Keeping the raw
 * HTTP exchange at this adapter boundary lets API handlers persist redacted,
 * supportable evidence without coupling domain code to CloudShare wire models. */
export interface CloudShareSalesItemResourceSource {
  readProjects(): Promise<{ data: Array<{ id: string; name: string }>; reads: readonly CloudShareDetailedResourceRead<unknown>[] }>;
  readRegions(): Promise<CloudShareDetailedResourceRead<Array<{ id: string; name: string; friendlyName?: string }>>>;
  readProjectBlueprints(projectId: string): Promise<CloudShareDetailedResourceRead<Array<{ id: string; name: string }>>>;
  readProjectBlueprintDetails(projectId: string, blueprintIds: readonly string[]): Promise<readonly CloudShareDetailedResourceRead<CloudShareBlueprintDetail>[]>;
  readProjectPolicies(projectId: string): Promise<{
    readonly policies: CloudShareExamAuthoringPolicy[];
    readonly reads: readonly CloudShareDetailedResourceRead<unknown>[];
  }>;
}

export interface CloudShareDetailedResourceRead<T> {
  readonly data: T;
  readonly exchangeId?: string;
  readonly request: Record<string, unknown>;
  readonly response: Record<string, unknown>;
  readonly integrationSurface: string;
}

/** Preserves completed exchanges when a grouped resource read only partly fails. */
export class CloudShareSalesResourceReadError extends Error {
  constructor(
    readonly completedReads: readonly CloudShareDetailedResourceRead<unknown>[],
    readonly cause: unknown,
  ) {
    super("CloudShare Sales resource read failed.");
    this.name = "CloudShareSalesResourceReadError";
  }
}

/** Single-resource retrieval and normalization shared by authoring adapters.
 * Grouping, observer timing, cache and authoring rules belong to the callers. */
export function createCloudShareResourceDiscovery(client: CloudShareClient) {
  async function read<T>(path: string, schema: z.ZodType<T, unknown>, integrationSurface: string): Promise<CloudShareDetailedResourceRead<T>> {
    const detailed = await requestV3WithDiagnostics(client, { method: "GET", path, schema });
    return { data: detailed.data, ...toDiagnosticExchange(detailed), integrationSurface };
  }
  return {
    async readProjects(onPage?: (read: CloudShareDetailedResourceRead<unknown>) => Promise<void>) {
      const data: Array<{ id: string; name: string }> = [];
      const reads: CloudShareDetailedResourceRead<unknown>[] = [];
      let count: number | undefined;
      try {
        do {
          const detailed = await requestV4WithDiagnostics(client, {
            method: "GET", path: "/projects",
            query: { Count: "true", Offset: String(data.length), Limit: "100" },
            schema: z.object({ count: z.number().int().nonnegative(), items: projectListSchema.max(100) }).refine((page) => {
              const ids = [...data, ...page.items].map((project) => project.id);
              return (count === undefined || page.count === count) &&
                ids.length <= page.count && new Set(ids).size === ids.length &&
                (page.items.length > 0 || ids.length === page.count);
            }, "Project pagination was incomplete or inconsistent; refresh discovery."),
          });
          const page = { data: detailed.data, ...toDiagnosticExchange(detailed), integrationSurface: "cloudshare.v4.projects" };
          reads.push(page);
          await onPage?.(page);
          count = detailed.data.count;
          data.push(...detailed.data.items);
        } while (data.length < count);
      } catch (error) {
        throw new CloudShareSalesResourceReadError(reads, error);
      }
      return { data, reads };
    },
    readRegions: async () => {
      const result = await read("/regions", regionListSchema, "cloudshare.v3.regions");
      return { ...result, data: result.data.map((region) => ({
        id: region.id, name: region.name,
        ...(region.friendlyName ? { friendlyName: region.friendlyName } : {}),
      })) };
    },
    readProjectBlueprints: async (projectId: string) => {
      const result = await read(`/projects/${projectId}/blueprints`, blueprintListSchema, "cloudshare.v3.projects.blueprints");
      return { ...result, data: result.data.map((blueprint) => ({
        id: blueprint.id, name: blueprint.name, description: blueprint.description ?? "",
      })) };
    },
    readBlueprintDetail: async (projectId: string, blueprintId: string): Promise<CloudShareDetailedResourceRead<CloudShareBlueprintDetail>> => {
      const result = await read(`/projects/${projectId}/blueprints/${blueprintId}`, z.preprocess(
        (value) => normalizeBlueprintDetailPayload(value, blueprintId), blueprintDetailSchema,
      ), "cloudshare.v3.projects.blueprint_detail");
      const detail = result.data;
      return { ...result, data: {
        id: detail.id, name: detail.name, description: detail.description ?? "",
        defaultSnapshotId: detail.createFromVersions.find((snapshot) => snapshot.isDefault)?.id ?? null,
        snapshots: detail.createFromVersions.map((snapshot) => ({
          id: snapshot.id, name: snapshot.name, isDefault: snapshot.isDefault,
          regionIds: (snapshot.regions ?? []).map((region) => typeof region === "string" ? region : region.id),
        })),
        diagnosticSummary: summarizeBlueprintDetailForDiagnostics(detail),
      } };
    },
    readProjectPolicies: async (projectId: string) => {
      const detailed = await requestV4WithDiagnostics(client, {
        method: "GET", path: `/projects/${encodeURIComponent(projectId)}/policies`, query: { Count: "true" },
        schema: z.object({ count: z.number().int().nonnegative(), items: policyListSchema }).refine((page) =>
          page.count === page.items.length && page.items.every((policy) => policy.projectId === projectId) &&
          new Set(page.items.map((policy) => policy.id)).size === page.items.length,
        "Policy list was incomplete or belonged to another Project."),
      });
      return { data: detailed.data.items, ...toDiagnosticExchange(detailed), integrationSurface: "cloudshare.v4.projects.policies" };
    },
    readPolicyDetail: async (projectId: string, policy: { id: string; name: string }): Promise<{ read: CloudShareDetailedResourceRead<z.infer<typeof policyDetailSchema>>; policy: CloudShareExamAuthoringPolicy }> => {
      const detailed = await requestV4WithDiagnostics(client, { method: "GET", path: `/projects/${encodeURIComponent(projectId)}/policies/${encodeURIComponent(policy.id)}`, schema: policyDetailSchema.refine((detail) => detail.id === policy.id && detail.projectId === projectId, "Policy identity did not match the requested Project and Policy.") });
      const result = { data: detailed.data, ...toDiagnosticExchange(detailed), integrationSurface: "cloudshare.v4.projects.policy_detail" };
      return { read: result, policy: {
        id: policy.id, name: policy.name,
        runtimeLeaseMinutes: result.data.runtimeMinutes ?? null,
        storageLeaseMinutes: result.data.storageMinutes ?? null,
        diagnosticRequest: result.request, diagnosticResponse: result.response,
      } };
    },
  };
}

export function createCloudShareSalesItemResourceSource(client: CloudShareClient): CloudShareSalesItemResourceSource {
  const discovery = createCloudShareResourceDiscovery(client);
  return {
    readProjects: discovery.readProjects,
    readRegions: discovery.readRegions,
    readProjectBlueprints: async (projectId) => {
      const result = await discovery.readProjectBlueprints(projectId);
      return { ...result, data: result.data.map(({ id, name }) => ({ id, name })) };
    },
    readProjectBlueprintDetails: async (projectId, blueprintIds) => {
      const settled = await Promise.allSettled(blueprintIds.map((blueprintId) => discovery.readBlueprintDetail(projectId, blueprintId)));
      const reads: CloudShareDetailedResourceRead<CloudShareBlueprintDetail>[] = [];
      let failure: unknown;
      for (const result of settled) {
        if (result.status === "fulfilled") reads.push(result.value);
        else failure ??= result.reason;
      }
      if (failure !== undefined) throw new CloudShareSalesResourceReadError(reads, failure);
      return reads;
    },
    readProjectPolicies: async (projectId) => {
      const list = await discovery.readProjectPolicies(projectId);
      const settled = await Promise.allSettled(list.data.map((policy) => discovery.readPolicyDetail(projectId, policy)));
      const details = settled.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof discovery.readPolicyDetail>>> => result.status === "fulfilled").map((result) => result.value);
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      const reads = [list, ...details.map((detail) => detail.read)];
      if (failed) throw new CloudShareSalesResourceReadError(reads, failed.reason);
      return { policies: details.map((detail) => detail.policy), reads };
    },
  };
}

/**
 * CloudShare implementation of the {@link CloudShareResourceLister} port.
 * Fetches the reference lists (blueprints, policies, projects, regions) used
 * to populate the resource ID mapping table. IDs are dynamic and must be
 * refreshed via the Sync Resources admin action rather than hard-coded.
 *
 * NOTE (assumptions to verify against a live tenant, isolated in this module):
 * - Projects: GET /projects (v4 Infrastructure, all pages)
 * - Regions: GET /regions (v3 Classic)
 * - Blueprints: GET /projects/{id}/blueprints (v3 Classic)
 * - Policies: GET /projects/{id}/policies (v4 Infrastructure, active policies)
 */

const projectListSchema = z.array(projectSchema);
const regionListSchema = z.array(regionSchema);
const blueprintListSchema = z.array(blueprintSummarySchema);
const policyListSchema = z.array(policySummarySchema);

export interface CloudShareResourceReadSuccess {
  readonly exchangeId?: string;
  readonly operation: string;
  readonly integrationSurface: string;
  readonly path: string;
  readonly resourceType: "project" | "region" | "blueprint" | "policy";
  readonly resourceIds?: Record<string, string>;
  readonly request?: Record<string, unknown>;
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

function toDiagnosticExchange(
  detailed: {
    readonly exchangeId?: string;
    readonly request: CloudShareRequestDiagnostics;
    readonly response: CloudShareResponseDiagnostics;
  },
): { request: Record<string, unknown>; response: Record<string, unknown>; exchangeId?: string } {
  return {
    ...(detailed.exchangeId ? { exchangeId: detailed.exchangeId } : {}),
    request: {
      method: detailed.request.method,
      path: detailed.request.path,
      ...(detailed.request.query ? { query: detailed.request.query } : {}),
      ...(detailed.request.headers ? { headers: detailed.request.headers } : {}),
      ...(detailed.request.body !== undefined ? { body: detailed.request.body } : {}),
    },
    response: {
      status: detailed.response.status,
      ...(detailed.response.headers ? { headers: detailed.response.headers } : {}),
      body: detailed.response.body,
    },
  };
}

async function requestV3WithDiagnostics<T>(
  client: CloudShareClient,
  spec: {
    readonly method: "GET" | "POST" | "PUT" | "DELETE";
    readonly path: string;
    readonly schema: z.ZodType<T, unknown>;
  },
): Promise<{
  data: T;
  request: CloudShareRequestDiagnostics;
  response: CloudShareResponseDiagnostics;
}> {
  if ("requestV3Detailed" in client && typeof client.requestV3Detailed === "function") {
    return client.requestV3Detailed(spec) as Promise<CloudShareDetailedResult<T>>;
  }

  const data = await client.requestV3(spec);
  return {
    data,
    request: { method: spec.method, path: spec.path },
    response: { status: 200, body: data },
  };
}

async function requestV4WithDiagnostics<T>(client: CloudShareClient, spec: V4RequestSpec<T>) {
  if (client.requestV4Detailed) return client.requestV4Detailed(spec);
  const data = await client.requestV4(spec);
  return { data, request: { method: spec.method, path: spec.path, ...(spec.query ? { query: spec.query } : {}) }, response: { status: 200, body: data } };
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
      projectsPromise = createCloudShareResourceDiscovery(client).readProjects(async (read) => {
        await options.onReadSuccess?.({
          operation: "cloudshare.resource_sync.projects.read",
          path: "/projects", resourceType: "project", ...read,
        });
      }).then((result) => result.data)
        .catch(async (error) => {
          if (error instanceof CloudShareSalesResourceReadError) error = error.cause;
          await options.onReadFailure?.({
            operation: "cloudshare.resource_sync.projects.read",
            integrationSurface: "cloudshare.v4.projects",
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
      regionsPromise = requestV3WithDiagnostics(client, {
          method: "GET",
          path: "/regions",
          schema: regionListSchema,
        })
        .then(async (detailed) => {
          const regions = detailed.data;
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
            ...toDiagnosticExchange(detailed),
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
            const detailed = await requestV3WithDiagnostics(client, {
              method: "GET",
              path,
              schema: blueprintListSchema,
            });
            const result = detailed.data;
            await options.onReadSuccess?.({
              operation: "cloudshare.resource_sync.blueprints.read",
              integrationSurface: "cloudshare.v3.projects.blueprints",
              path,
              resourceType: "blueprint",
              resourceIds: { projectId: project.id },
              ...toDiagnosticExchange(detailed),
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
            const read = await createCloudShareResourceDiscovery(client).readProjectPolicies(project.id);
            const result = read.data;
            await options.onReadSuccess?.({
              operation: "cloudshare.resource_sync.policies.read",
              path,
              resourceType: "policy",
              resourceIds: { projectId: project.id },
              ...read,
            });
            return result.map((policy) => ({
              id: policy.id,
              name: policy.name,
            }));
          } catch (error) {
            await options.onReadFailure?.({
              operation: "cloudshare.resource_sync.policies.read",
              integrationSurface: "cloudshare.v4.projects.policies",
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
  options: CloudShareExamAuthoringSourceOptions = {},
): CloudShareExamAuthoringSource {
  const discovery = createCloudShareResourceDiscovery(client);
  // Observer anchors and awaiting each observer remain an Exam contract. In
  // particular the list observer completes before any Policy detail is started.
  async function observe<T>(
    read: CloudShareDetailedResourceRead<T>,
    operation: string,
    path: string,
    resourceType: string,
    resourceIds?: Record<string, string>,
  ): Promise<void> {
    await options.onReadSuccess?.({
      operation, integrationSurface: read.integrationSurface, path, resourceType,
      ...(resourceIds ? { resourceIds } : {}),
      ...(read.exchangeId ? { exchangeId: read.exchangeId } : {}),
      request: read.request, response: read.response,
    });
  }
  return {
    async listProjects() {
      try {
        const result = await discovery.readProjects((page) => observe(page, "cloudshare.resource_sync.projects.read", "/projects", "project"));
        return result.data;
      } catch (error) {
        throw error instanceof CloudShareSalesResourceReadError ? error.cause : error;
      }
    },
    async listRegions() {
      const read = await discovery.readRegions();
      await observe(read, "cloudshare.resource_sync.regions.read", "/regions", "region");
      return read.data;
    },
    async listProjectBlueprints(projectId) {
      const read = await discovery.readProjectBlueprints(projectId);
      await observe(read, "cloudshare.resource_sync.blueprints.read", `/projects/${projectId}/blueprints`, "blueprint", { projectId });
      return read.data;
    },
    async listProjectPolicies(projectId) {
      const list = await discovery.readProjectPolicies(projectId);
      await observe(list, "cloudshare.resource_sync.policies.read", `/projects/${projectId}/policies`, "policy", { projectId });
      return Promise.all(list.data.map(async (policy) => {
        const detail = await discovery.readPolicyDetail(projectId, policy);
        await observe(detail.read, "cloudshare.resource_sync.policy_detail.read", `/projects/${projectId}/policies/${policy.id}`, "policy_detail", { projectId, policyId: policy.id });
        return detail.policy;
      }));
    },
    async getBlueprintDetail(projectId, blueprintId) {
      const read = await discovery.readBlueprintDetail(projectId, blueprintId);
      await observe(read, "cloudshare.resource_sync.blueprint_detail.read", `/projects/${projectId}/blueprints/${blueprintId}`, "blueprint_detail", { projectId, blueprintId });
      return { ...read.data, diagnosticResponse: read.response };
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
