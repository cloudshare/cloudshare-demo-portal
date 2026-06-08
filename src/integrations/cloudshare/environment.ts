import { z } from "zod";
import type { EnvironmentStateSource, EnvironmentStatus } from "@/domain/environment";
import type { CloudShareClient } from "./client";
import { CloudShareRequestError } from "./errors";

/**
 * The live `GET environment` poll — the authoritative state source the reconcile
 * flow drives off. Webhooks only *hint* that something changed; this is what
 * actually reads the truth from CloudShare and maps it onto the domain vocabulary.
 *
 * NOTE (assumptions to verify against a live tenant — isolated behind this module,
 * tracked in the Slice 12 gap report):
 *  - The v3 path/shape below. We correlate by the `externalId` we set at experience
 *    creation; the exact v3 endpoint that resolves an environment by external id is
 *    a known gap. Only this file changes when it is confirmed.
 *  - CloudShare's environment status strings; {@link mapCloudShareEnvironmentStatus}
 *    folds them onto the domain set, defaulting to `unknown` rather than guessing.
 */

const v3EnvironmentSchema = z.object({ status: z.string().min(1) });

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
        const env = await client.requestV3({
          method: "GET",
          path: "/environments",
          query: { externalId: environmentExternalId },
          schema: v3EnvironmentSchema,
        });
        return {
          environmentExternalId,
          status: mapCloudShareEnvironmentStatus(env.status),
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
