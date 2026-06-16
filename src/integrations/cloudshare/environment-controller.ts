import type { CloudShareClient } from "./client";
import type { EnvironmentController } from "@/domain/environment";

/**
 * CloudShare implementation of the {@link EnvironmentController} port — issues
 * suspend and resume commands to a CloudShare environment via the documented v3
 * env-action endpoints, using the CloudShare `envId` discovered from the
 * training-students list.
 */

export function createCloudShareEnvironmentController(
  client: CloudShareClient,
): EnvironmentController {
  return {
    async suspendEnvironment(environmentExternalId: string): Promise<void> {
      await client.requestV3Text({
        method: "PUT",
        path: "/envs/actions/suspend",
        query: { envId: environmentExternalId },
      });
    },

    async resumeEnvironment(environmentExternalId: string): Promise<void> {
      await client.requestV3Text({
        method: "PUT",
        path: "/envs/actions/resume",
        query: { envId: environmentExternalId },
      });
    },
  };
}
