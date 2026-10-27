import { z } from "zod";
import { dispatchEnvironmentCommand } from "./environment-command";
import type { CloudShareClient } from "./client";
import type { EnvironmentCommandResult, EnvironmentController } from "@/domain/environment";

/** Environment commands retain the exact Customer-correlated opaque ID.
 * v4 acknowledgement is not completion: lifecycle owners confirm through observation.
 * Archive deliberately retains its existing v3 action; it is never DELETE.
 */
export function createCloudShareEnvironmentController(client: CloudShareClient): EnvironmentController {
  async function runV4Command(environmentExternalId: string, action: "suspend" | "resume"): Promise<EnvironmentCommandResult> {
    const spec = { method: "POST", path: `/environments/${encodeURIComponent(environmentExternalId)}/${action}`, allowEmptyResponse: true, schema: z.void() } as const;
    const result = client.requestV4Detailed ? await client.requestV4Detailed(spec) : null;
    if (!result) await client.requestV4(spec);
    return {
      attemptedOperation: `${action}_environment`, integrationSurface: `cloudshare.v4.environments.${action}`,
      method: "POST", path: `/v4${spec.path}`, externalIds: { environmentId: environmentExternalId },
      ...(result ? { host: result.host } : {}),
      request: result ? { ...result.request } : { method: "POST", path: `/v4${spec.path}` },
      response: result ? { ...result.response } : null,
    };
  }

  async function runLegacyCommand(environmentExternalId: string, action: "archive"): Promise<EnvironmentCommandResult> {
    const path = `/envs/actions/${action}`;
    const dispatched = await dispatchEnvironmentCommand(client, environmentExternalId, action);
    const result = dispatched.detailed;
    return {
      attemptedOperation: `${action}_environment`, integrationSurface: `cloudshare.v3.env.action.${action}`,
      method: "PUT", path: `/api/v3${path}`, externalIds: { environmentId: environmentExternalId },
      ...(result ? { host: result.host } : {}),
      request: result ? { ...result.request } : { method: "PUT", path: `/api/v3${path}` },
      response: result ? { ...result.response } : dispatched.text!.length > 0 ? { body: dispatched.text } : null,
    };
  }
  return { suspendEnvironment: id => runV4Command(id, "suspend"), resumeEnvironment: id => runV4Command(id, "resume"), archiveEnvironment: id => runLegacyCommand(id, "archive") };
}
