import {
  createCloudShareClient,
  type CloudShareClient,
  type CloudShareEndpoints,
} from "./client";
import { createFetchHttpClient } from "./http";
import { createFixtureHttpClient } from "./fixtures";
import { bundledFixtures } from "./fixtures/index";
import { createV4TokenProvider } from "./v4-auth";

/**
 * Public surface of the CloudShare integration. Other layers import only from
 * here, and only the typed {@link CloudShareClient} — never the HTTP, signing,
 * or auth internals.
 */

export * from "./errors";
export type { HttpClient, HttpRequest, HttpResponse } from "./http";
export type {
  CloudShareClient,
  CloudShareEndpoints,
  V3RequestSpec,
  V4RequestSpec,
} from "./client";
export { createFixtureHttpClient, loadFixturesFromDir, type FixtureMap } from "./fixtures";

/** Well-known CloudShare API roots; overridable for staging or a recording proxy. */
export const CLOUDSHARE_DEFAULT_ENDPOINTS: CloudShareEndpoints = {
  v4BaseUrl: "https://use.cloudshare.com/api/v4",
  v3BaseUrl: "https://use.cloudshare.com/api/v3",
};

export type CloudShareMode = "live" | "fixture";

export interface CloudShareIntegrationOptions {
  /** "live" makes real calls; "fixture" replays the recorded corpus. */
  readonly mode: CloudShareMode;
  readonly v4: { readonly clientId: string; readonly clientSecret: string };
  readonly v3: { readonly apiId: string; readonly apiKey: string };
  readonly endpoints?: CloudShareEndpoints;
}

/**
 * Build a {@link CloudShareClient} for the given mode. This is the one place
 * that decides between the live `fetch` transport and the fixture replay
 * transport; the client behaves identically with either.
 */
export function createCloudShareIntegration(
  opts: CloudShareIntegrationOptions,
): CloudShareClient {
  const endpoints = opts.endpoints ?? CLOUDSHARE_DEFAULT_ENDPOINTS;
  const http =
    opts.mode === "fixture"
      ? createFixtureHttpClient(bundledFixtures)
      : createFetchHttpClient();

  const tokenProvider = createV4TokenProvider({
    http,
    baseUrl: endpoints.v4BaseUrl,
    clientId: opts.v4.clientId,
    clientSecret: opts.v4.clientSecret,
  });

  return createCloudShareClient({ http, endpoints, tokenProvider, v3: opts.v3 });
}
