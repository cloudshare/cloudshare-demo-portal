import { CloudShareResponseError } from "./errors";
import type { CloudShareClient } from "./client";

export async function pingCloudShareV3(client: CloudShareClient): Promise<"pong"> {
  const response = (await client.requestV3Text({
    method: "GET",
    path: "/ping",
  })).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    throw new CloudShareResponseError("CloudShare ping did not return valid JSON", {
      response,
    });
  }

  const pong =
    typeof parsed === "object" &&
    parsed !== null &&
    "result" in parsed &&
    typeof (parsed as { result?: unknown }).result === "string"
      ? (parsed as { result: string }).result
      : null;

  if (pong?.toLowerCase() !== "pong") {
    throw new CloudShareResponseError("CloudShare ping did not return pong", {
      response: parsed,
    });
  }

  return "pong";
}
