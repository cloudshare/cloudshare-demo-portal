import type { CloudShareClient } from "./client";
import { createCloudShareSalesEnvironmentModule, type SalesEnvironmentSource } from "./environment-observation";

// Compatibility facade for historical numeric fixtures and monitoring. New v4
// observations carry explicit source/status; numeric values are derived only.
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
