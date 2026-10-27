import type { CloudShareClient } from "./client";

/** One dispatch, never retries: lifecycle owners hold the durable dispatch fence.
 * Keep text/empty responses intact; successful transport is an acknowledgement,
 * not proof that the asynchronous environment transition completed. */
export async function dispatchEnvironmentCommand(
  client: CloudShareClient,
  environmentId: string,
  action: "archive" | "extend",
) {
  const spec = { method: "PUT", path: `/envs/actions/${action}`, query: { envId: environmentId } } as const;
  if (client.requestV3TextDetailed) {
    return { spec, detailed: await client.requestV3TextDetailed(spec), text: null };
  }
  return { spec, detailed: null, text: await client.requestV3Text(spec) };
}
