import { z } from "zod";
import type { CloudShareClient } from "./client";
import type { EnvironmentController } from "@/domain/timer-sync";

/**
 * CloudShare implementation of the {@link EnvironmentController} port — issues
 * suspend and resume commands to a CloudShare environment via the V4 API.
 *
 * NOTE (assumptions to verify against a live tenant — isolated behind this module,
 * tracked in the Slice 12 gap report):
 *  - The exact V4 action paths: `POST /environments/{id}/actions/suspend` and
 *    `POST /environments/{id}/actions/resume`. Only this file changes if they differ.
 *  - The correlation id used here is `environmentExternalId`; if the live API
 *    requires CloudShare's internal numeric environment id instead, the adapter
 *    needs a lookup step.
 */

const actionResponseSchema = z.object({}).passthrough();

export function createCloudShareEnvironmentController(
  client: CloudShareClient,
): EnvironmentController {
  return {
    async suspendEnvironment(environmentExternalId: string): Promise<void> {
      await client.requestV4({
        method: "POST",
        path: `/environments/${environmentExternalId}/actions/suspend`,
        schema: actionResponseSchema,
      });
    },

    async resumeEnvironment(environmentExternalId: string): Promise<void> {
      await client.requestV4({
        method: "POST",
        path: `/environments/${environmentExternalId}/actions/resume`,
        schema: actionResponseSchema,
      });
    },
  };
}
