import type { CloudShareClient } from "./client";
import type { EnvironmentCommandResult, EnvironmentController } from "@/domain/environment";

/**
 * CloudShare implementation of the {@link EnvironmentController} port — issues
 * suspend and resume commands to a CloudShare environment via the documented v3
 * env-action endpoints, using the CloudShare `envId` discovered from the
 * training-students list.
 */

export function createCloudShareEnvironmentController(
  client: CloudShareClient,
): EnvironmentController {
  async function runCommand(
    environmentExternalId: string,
    action: "suspend" | "resume",
  ): Promise<EnvironmentCommandResult> {
    const path = `/envs/actions/${action}`;
    const attemptedOperation = `${action}_environment` as const;
    const integrationSurface = `cloudshare.v3.env.action.${action}`;

    if (client.requestV3TextDetailed) {
      const result = await client.requestV3TextDetailed({
        method: "PUT",
        path,
        query: { envId: environmentExternalId },
      });
      return {
        attemptedOperation,
        integrationSurface,
        method: "PUT",
        path: `/api/v3${path}`,
        host: result.host,
        externalIds: { environmentId: environmentExternalId },
        request: { ...result.request },
        response: { ...result.response },
      };
    }

    const body = await client.requestV3Text({
      method: "PUT",
      path,
      query: { envId: environmentExternalId },
    });
    return {
      attemptedOperation,
      integrationSurface,
      method: "PUT",
      path: `/api/v3${path}`,
      externalIds: { environmentId: environmentExternalId },
      request: {
        method: "PUT",
        path: `/api/v3${path}`,
      },
      response: body.length > 0 ? { body } : null,
    };
  }

  return {
    async suspendEnvironment(environmentExternalId: string): Promise<EnvironmentCommandResult> {
      return runCommand(environmentExternalId, "suspend");
    },

    async resumeEnvironment(environmentExternalId: string): Promise<EnvironmentCommandResult> {
      return runCommand(environmentExternalId, "resume");
    },
  };
}
