import { CloudShareResponseError } from "./errors";
import type { CloudShareClient } from "./client";

export async function pingCloudShareV3(client: CloudShareClient): Promise<"pong"> {
  const response = (await client.requestV3Text({
    method: "GET",
    path: "/ping",
  }))
    .trim()
    .replace(/^"|"$/g, "");

  if (response.toLowerCase() !== "pong") {
    throw new CloudShareResponseError("CloudShare ping did not return pong", {
      response,
    });
  }

  return "pong";
}
