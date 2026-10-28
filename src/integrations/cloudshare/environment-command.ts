import { z } from "zod";
import type { CloudShareClient } from "./client";

/** One dispatch, never retries: lifecycle owners hold the durable dispatch fence.
 * Keep text/empty responses intact; successful transport is an acknowledgement,
 * not proof that the asynchronous environment transition completed. */
export async function dispatchEnvironmentCommand(
  client: CloudShareClient,
  environmentId: string,
  action: "archive" | "extend",
) {
  if (action === "extend") {
    const spec = { method: "POST", path: `/environments/${encodeURIComponent(environmentId)}/extend`, allowEmptyResponse: true, schema: z.void() } as const;
    // Production clients supply physical exchange evidence; legacy injected clients
    // retain the documented empty acknowledgement without a v3 fallback.
    const detailed = client.requestV4Detailed ? await client.requestV4Detailed(spec) : null;
    if (!detailed) await client.requestV4(spec);
    return { spec, detailed: detailed ?? { data: undefined, host: "", integrationSurface: "cloudshare.v4", request: { method: "POST" as const, path: `/v4${spec.path}` }, response: { status: 204, body: undefined } }, text: null };
  }
  const spec = { method: "PUT", path: `/envs/actions/${action}`, query: { envId: environmentId } } as const;
  if (client.requestV3TextDetailed) {
    return { spec, detailed: await client.requestV3TextDetailed(spec), text: null };
  }
  return { spec, detailed: null, text: await client.requestV3Text(spec) };
}
