import type { Item } from "@/domain/item";
import { createCloudShareSalesItemResourceSource, type CloudShareDetailedResourceRead } from "./resources";
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
      const [blueprints, details, policies] = await Promise.all([
        source.readProjectBlueprints(item.project.id), source.readProjectBlueprintDetails(item.project.id, item.blueprints.map((blueprint) => blueprint.id)), source.readProjectPolicies(item.project.id),
      ]);
      const reads: CloudShareDetailedResourceRead<unknown>[] = [blueprints, ...details, ...policies.reads];
      const liveBlueprintIds = new Set(blueprints.data.map((blueprint) => blueprint.id));
      if (item.blueprints.some((blueprint) => !liveBlueprintIds.has(blueprint.id))) throw new SalesItemProvisioningValidationError("A selected Demo Item Blueprint is no longer available in its CloudShare Project.", reads);
      if (!policies.policies.some((policy) => policy.id === item.policy.id)) throw new SalesItemProvisioningValidationError("The selected Demo Item Policy is no longer available in its CloudShare Project.", reads);
      const sharedRegions = details.map((detail) => new Set(detail.data.snapshots.find((snapshot) => snapshot.isDefault)?.regionIds ?? [])).reduce((shared, regions) => new Set([...shared].filter((id) => regions.has(id))));
      if (item.regions.some((region) => !sharedRegions.has(region.id))) throw new SalesItemProvisioningValidationError("A selected Demo Item Region is no longer available on every current default Snapshot.", reads);
      return reads;
    },
  };
}

export class SalesItemProvisioningValidationError extends Error {
  constructor(message: string, readonly completedReads: readonly CloudShareDetailedResourceRead<unknown>[]) { super(message); this.name = "SalesItemProvisioningValidationError"; }
}
