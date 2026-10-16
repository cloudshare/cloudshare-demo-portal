import type { CloudShareClient } from "./client";
import { createCloudShareSalesEnvironmentModule, type SalesEnvironmentSource } from "./environment-observation";

// Compatibility facade for persisted projections and unmerged cancellation PR448.
// New lifecycle callers consume the semantic module. Remove this projection only
// after PR448 rebases and its exact-head tests migrate to the semantic interface.
export { SalesEnvironmentResolutionError, cloudShareV3SalesEnvironmentStatusCodeSchema } from "./environment-observation";
export type { SalesEnvironmentSource, SalesEnvironmentObservation, SalesEnvironmentExtensionResult, CloudShareV3SalesEnvironmentStatusCode } from "./environment-observation";

export function createCloudShareSalesEnvironmentSource(client: CloudShareClient): SalesEnvironmentSource {
  const environments = createCloudShareSalesEnvironmentModule(client);
  return {
    async observe(input) { return (await environments.observe(input)).compatibility; },
    async observeById(id) { return (await environments.observeById(id)).compatibility; },
    extendById: environments.extendById,
  };
}
