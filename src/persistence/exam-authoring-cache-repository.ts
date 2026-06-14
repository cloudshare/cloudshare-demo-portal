import type { CloudShareBlueprintDetail } from "@/integrations/cloudshare/resources";

export interface NamedCloudShareResource {
  readonly id: string;
  readonly name: string;
  readonly friendlyName?: string;
  readonly description?: string;
  readonly runtimeLeaseMinutes?: number | null;
}

export interface ExamAuthoringCacheRepository {
  clearCustomer(customerId: string): Promise<void>;
  getBootstrap(customerId: string): Promise<{
    readonly projects: NamedCloudShareResource[];
    readonly regions: NamedCloudShareResource[];
  } | null>;
  saveBootstrap(
    customerId: string,
    snapshot: {
      readonly projects: NamedCloudShareResource[];
      readonly regions: NamedCloudShareResource[];
    },
  ): Promise<void>;
  getProjectResources(customerId: string, projectId: string): Promise<{
    readonly blueprints: NamedCloudShareResource[];
    readonly policies: NamedCloudShareResource[];
  } | null>;
  saveProjectResources(
    customerId: string,
    projectId: string,
    snapshot: {
      readonly blueprints: NamedCloudShareResource[];
      readonly policies: NamedCloudShareResource[];
    },
  ): Promise<void>;
  getBlueprintDetail(
    customerId: string,
    projectId: string,
    blueprintId: string,
  ): Promise<CloudShareBlueprintDetail | null>;
  saveBlueprintDetail(
    customerId: string,
    projectId: string,
    blueprintId: string,
    detail: CloudShareBlueprintDetail,
  ): Promise<void>;
}

export function createInMemoryExamAuthoringCacheRepository(): ExamAuthoringCacheRepository & {
  reset(): void;
} {
  const bootstrapByCustomer = new Map<string, { projects: NamedCloudShareResource[]; regions: NamedCloudShareResource[] }>();
  const projectResourcesByKey = new Map<string, { blueprints: NamedCloudShareResource[]; policies: NamedCloudShareResource[] }>();
  const blueprintDetailsByKey = new Map<string, CloudShareBlueprintDetail>();

  function projectKey(customerId: string, projectId: string): string {
    return `${customerId}:${projectId}`;
  }

  function blueprintKey(customerId: string, projectId: string, blueprintId: string): string {
    return `${customerId}:${projectId}:${blueprintId}`;
  }

  return {
    async clearCustomer(customerId) {
      bootstrapByCustomer.delete(customerId);
      for (const key of projectResourcesByKey.keys()) {
        if (key.startsWith(`${customerId}:`)) {
          projectResourcesByKey.delete(key);
        }
      }
      for (const key of blueprintDetailsByKey.keys()) {
        if (key.startsWith(`${customerId}:`)) {
          blueprintDetailsByKey.delete(key);
        }
      }
    },
    async getBootstrap(customerId) {
      return bootstrapByCustomer.get(customerId) ?? null;
    },
    async saveBootstrap(customerId, snapshot) {
      bootstrapByCustomer.set(customerId, snapshot);
    },
    async getProjectResources(customerId, projectId) {
      return projectResourcesByKey.get(projectKey(customerId, projectId)) ?? null;
    },
    async saveProjectResources(customerId, projectId, snapshot) {
      projectResourcesByKey.set(projectKey(customerId, projectId), snapshot);
    },
    async getBlueprintDetail(customerId, projectId, blueprintId) {
      return blueprintDetailsByKey.get(blueprintKey(customerId, projectId, blueprintId)) ?? null;
    },
    async saveBlueprintDetail(customerId, projectId, blueprintId, detail) {
      blueprintDetailsByKey.set(blueprintKey(customerId, projectId, blueprintId), detail);
    },
    reset() {
      bootstrapByCustomer.clear();
      projectResourcesByKey.clear();
      blueprintDetailsByKey.clear();
    },
  };
}
