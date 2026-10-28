import { mapV4EnvironmentStatus } from "./environment-observation";
import { readV4Environment } from "./environments-v4";
import type { EnvironmentStateEvidenceSource, EnvironmentStateReadEvidence } from "@/domain/environment";
import type { CloudShareClient } from "./client";
import { CloudShareRequestError } from "./errors";

/**
 * The live `GET environment` poll — the authoritative state source the reconcile
 * flow drives off. Webhooks only *hint* that something changed; this is what
 * actually reads the truth from CloudShare and maps it onto the domain vocabulary.
 *
 * Live training launches discover CloudShare's own `envId` from the v4
 * training-students list. That `envId` is then used for the authoritative v4
 * environment poll here. All endpoint/path/shape quirks stay isolated in this
 * adapter.
 */

// Compatibility exports remain available to external-lease and existing callers.
export { mapCloudShareEnvironmentStatus, cloudShareV3EnvironmentStatusCode } from "./environment-observation";

export function createCloudShareEnvironmentSource(
  client: CloudShareClient,
): EnvironmentStateEvidenceSource {
  async function readEnvironmentState(environmentExternalId: string): Promise<EnvironmentStateReadEvidence> {
    const request = { method: "GET", path: `/v4/environments/${encodeURIComponent(environmentExternalId)}` } as const;
    try {
      const detailed = await readV4Environment(client, environmentExternalId);
      const env = detailed.data;
      const snapshot = {
        environmentExternalId,
        status: mapV4EnvironmentStatus(env.status),
        source: "cloudshare_v4_environment" as const,
        providerStatus: env.status,
        request: detailed?.request ? { ...detailed.request } : { method: request.method, path: request.path },
        response: detailed?.response ? { ...detailed.response } : { status: 200, body: env },
      };
      return { snapshot, request: snapshot.request, response: snapshot.response };
    } catch (error) {
      if (error instanceof CloudShareRequestError && error.status === 404) {
        const exchange = exchangeFromError(error, request);
        return { snapshot: null, request: exchange.request, response: exchange.response };
      }
      throw error;
    }
  }
  return {
    async getEnvironmentState(environmentExternalId: string) {
      return (await readEnvironmentState(environmentExternalId)).snapshot;
    },
    readEnvironmentState,
  };
}

function exchangeFromError(error: CloudShareRequestError, fallback: { readonly method: "GET"; readonly path: string }) {
  const context = error.context ?? {};
  return {
    request: { method: typeof context.method === "string" ? context.method : fallback.method, path: typeof context.path === "string" ? context.path : fallback.path, ...(context.requestHeaders ? { headers: context.requestHeaders } : {}), ...(context.requestQuery ? { query: context.requestQuery } : {}) },
    response: { status: typeof context.responseStatus === "number" ? context.responseStatus : error.status, ...(context.responseHeaders ? { headers: context.responseHeaders } : {}), ...(context.responseBody !== undefined ? { body: context.responseBody } : {}) },
  };
}
