export interface LaunchResponseData {
  loginUrl: string;
  environmentExternalId: string;
}

/** Parse and validate the JSON body returned by POST /api/lab/launch. */
export function parseLaunchResponse(json: unknown): LaunchResponseData {
  if (typeof json !== "object" || json === null) throw new Error("invalid launch response");
  const { loginUrl, environmentExternalId } = json as Record<string, unknown>;
  if (typeof loginUrl !== "string") throw new Error("launch response missing loginUrl");
  if (typeof environmentExternalId !== "string")
    throw new Error("launch response missing environmentExternalId");
  return { loginUrl, environmentExternalId };
}
