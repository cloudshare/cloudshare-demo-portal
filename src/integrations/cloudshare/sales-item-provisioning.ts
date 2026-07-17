import type { Item } from "@/domain/item";
import { CloudShareSalesResourceReadError, createCloudShareSalesItemResourceSource, type CloudShareDetailedResourceRead } from "./resources";
import type { CloudShareClient } from "./client";

export interface SalesItemProvisioningValidator {
  revalidate(item: Item): Promise<readonly CloudShareDetailedResourceRead<unknown>[]>;
}

/** Rechecks mutable CloudShare Item references at the delivery seam so an Item
 * cannot provision a moved Snapshot Region or deleted Policy/Blueprint. */
export function createCloudShareSalesItemProvisioningValidator(client: CloudShareClient): SalesItemProvisioningValidator {
  return {
    async revalidate(item) {
      const source = createCloudShareSalesItemResourceSource(client);
      const settled = await Promise.allSettled([
        source.readProjectBlueprints(item.project.id), source.readProjectBlueprintDetails(item.project.id, item.blueprints.map((blueprint) => blueprint.id)), source.readProjectPolicies(item.project.id),
      ]);
      const reads: CloudShareDetailedResourceRead<unknown>[] = [];
      const [blueprintResult, detailResult, policyResult] = settled;
      if (blueprintResult.status === "fulfilled") reads.push(blueprintResult.value);
      if (detailResult.status === "fulfilled") reads.push(...detailResult.value);
      if (policyResult.status === "fulfilled") reads.push(...policyResult.value.reads);
      const resourceReadFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (resourceReadFailure) {
        const cause = resourceReadFailure.reason;
        if (cause instanceof CloudShareSalesResourceReadError) reads.push(...cause.completedReads);
        throw new SalesItemProvisioningReadError("CloudShare could not fully revalidate this Item before provisioning.", reads, cause instanceof CloudShareSalesResourceReadError ? cause.cause : cause);
      }
      // The settled rejection above is exhaustive; retain individual guards so
      // TypeScript can narrow each heterogeneous Promise result.
      if (blueprintResult.status !== "fulfilled" || detailResult.status !== "fulfilled" || policyResult.status !== "fulfilled") throw new Error("Unreachable Sales Item revalidation state.");
      const blueprints = blueprintResult.value;
      const details = detailResult.value;
      const policies = policyResult.value;
      const liveBlueprintIds = new Set(blueprints.data.map((blueprint) => blueprint.id));
      if (item.blueprints.some((blueprint) => !liveBlueprintIds.has(blueprint.id))) throw new SalesItemProvisioningValidationError("A selected Item Blueprint is no longer available in its CloudShare Project.", reads);
      if (!policies.policies.some((policy) => policy.id === item.policy.id)) throw new SalesItemProvisioningValidationError("The selected Item Policy is no longer available in its CloudShare Project.", reads);
      const sharedRegions = details.map((detail) => new Set(detail.data.snapshots.find((snapshot) => snapshot.isDefault)?.regionIds ?? [])).reduce((shared, regions) => new Set([...shared].filter((id) => regions.has(id))));
      if (item.regions.some((region) => !sharedRegions.has(region.id))) throw new SalesItemProvisioningValidationError("A selected Item Region is no longer available on every current default Snapshot.", reads);
      return reads;
    },
  };
}

export class SalesItemProvisioningValidationError extends Error {
  constructor(message: string, readonly completedReads: readonly CloudShareDetailedResourceRead<unknown>[]) { super(message); this.name = "SalesItemProvisioningValidationError"; }
}

/** A typed read failure is distinct from stale Item configuration: the portal
 * preserves all completed v3 exchanges and surfaces the original typed cause. */
export class SalesItemProvisioningReadError extends Error {
  constructor(message: string, readonly completedReads: readonly CloudShareDetailedResourceRead<unknown>[], readonly cause: unknown) { super(message); this.name = "SalesItemProvisioningReadError"; }
}
