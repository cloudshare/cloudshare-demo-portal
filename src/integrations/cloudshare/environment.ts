import { z } from "zod";
import type { EnvironmentStateSource, EnvironmentStatus } from "@/domain/environment";
import type { CloudShareClient } from "./client";
import { CloudShareRequestError } from "./errors";

/**
 * The live `GET environment` poll — the authoritative state source the reconcile
 * flow drives off. Webhooks only *hint* that something changed; this is what
 * actually reads the truth from CloudShare and maps it onto the domain vocabulary.
 *
 * Live training launches discover CloudShare's own `envId` from the v4
 * training-students list. That `envId` is then used for the authoritative v3
 * environment poll here. All endpoint/path/shape quirks stay isolated in this
 * adapter.
 */

const v3EnvironmentSchema = z
  .object({
    status: z.string().min(1).optional(),
    envStatus: z.string().min(1).optional(),
  })
  .refine((value) => typeof value.status === "string" || typeof value.envStatus === "string", {
    message: "Expected CloudShare environment status field",
  });

/** Fold a raw CloudShare status string onto the domain {@link EnvironmentStatus}. */
export function mapCloudShareEnvironmentStatus(raw: string): EnvironmentStatus {
  switch (raw.trim().toLowerCase()) {
    case "ready":
    case "running":
    case "started":
    case "resumed":
      return "running";
    case "suspended":
    case "stopped":
    case "paused":
    case "off":
      return "suspended";
    case "created":
    case "creating":
    case "preparing":
    case "pending":
      return "created";
    case "archived":
      return "archived";
    case "deleted":
    case "deleting":
      return "deleted";
    default:
      return "unknown";
  }
}

export function createCloudShareEnvironmentSource(
  client: CloudShareClient,
): EnvironmentStateSource {
  return {
    async getEnvironmentState(environmentExternalId: string) {
      try {
        const request = {
          method: "GET",
          path: `/envs/${environmentExternalId}`,
          schema: v3EnvironmentSchema,
        } as const;
        const detailed = client.requestV3Detailed
          ? await client.requestV3Detailed(request)
          : null;
        const env = detailed ? detailed.data : await client.requestV3(request);
        return {
          environmentExternalId,
          status: mapCloudShareEnvironmentStatus(env.envStatus ?? env.status ?? "unknown"),
          request: detailed?.request ? { ...detailed.request } : null,
          response: detailed?.response ? { ...detailed.response } : null,
        };
      } catch (err) {
        // A 404 means "no such environment" — a legitimate null, not a failure.
        if (err instanceof CloudShareRequestError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },
  };
}
