import {
  createCloudShareClient,
  type CloudShareClient,
  type CloudShareRequestObservation,
  type CloudShareRequestObserver,
  type CloudShareEndpoints,
} from "./client";
import { createFetchHttpClient } from "./http";
import { createFixtureHttpClient } from "./fixtures";
import { bundledFixtures } from "./fixtures/index";
import { createV4TokenProvider, type V4TokenAcquisitionEvent } from "./v4-auth";

export type { CloudShareRequestObservation, CloudShareRequestObserver } from "./client";
export type { V4TokenAcquisitionEvent } from "./v4-auth";

/**
 * Public surface of the CloudShare integration. Other layers import only from
 * here, and only the typed {@link CloudShareClient} — never the HTTP, signing,
 * or auth internals.
 */

export * from "./errors";
export type { HttpClient, HttpRequest, HttpResponse } from "./http";
export type {
  CloudShareClient,
  CloudShareDetailedResult,
  CloudShareEndpoints,
  CloudShareRequestDiagnostics,
  CloudShareResponseDiagnostics,
  V3RequestSpec,
  V4RequestSpec,
} from "./client";
export { createFixtureHttpClient, loadFixturesFromDir, type FixtureMap } from "./fixtures";
export { pingCloudShareV3 } from "./ping";
export { createCloudShareDiagnosticObserver } from "./diagnostic-observer";

export interface CloudShareObservationPort extends CloudShareRequestObserver {
  readonly onAcquisition: (event: V4TokenAcquisitionEvent) => Promise<void> | void;
}

/** Explicit opt-out for tests and isolated live probes that do not persist diagnostics. */
export function createCloudShareNoopObservationPort(): CloudShareObservationPort {
  return { onRequest: () => undefined, onAcquisition: () => undefined };
}

export function composeCloudShareObservers<TRequest>(
  first?: (event: TRequest) => Promise<void> | void,
  second?: (event: TRequest) => Promise<void> | void,
): (event: TRequest) => Promise<void> {
  return async (event) => {
    await Promise.allSettled([first?.(event), second?.(event)]);
  };
}

/** Well-known CloudShare API roots; overridable for staging or a recording proxy. */
export const CLOUDSHARE_DEFAULT_ENDPOINTS: CloudShareEndpoints = {
  v4BaseUrl: "https://api.accelerate.cloudshare.com/v4",
  v3BaseUrl: "https://use.cloudshare.com/api/v3",
};

export type CloudShareMode = "live" | "fixture";

export interface CloudShareConnectionCredentials {
  readonly customerId?: string;
  readonly apiId: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
}

export interface CloudShareIntegrationOptions {
  /** "live" makes real calls; "fixture" replays the recorded corpus. */
  readonly mode: CloudShareMode;
  readonly customerId?: string;
  readonly v4: { readonly clientId: string; readonly clientSecret: string };
  readonly v3: { readonly apiId: string; readonly apiKey: string };
  readonly endpoints?: CloudShareEndpoints;
  readonly trace?: Parameters<typeof createCloudShareClient>[0]["trace"];
  readonly observer: CloudShareObservationPort;
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
    onAcquisition: opts.observer.onAcquisition,
  });

  return createCloudShareClient({
    http,
    endpoints,
    tokenProvider,
    customerId: opts.customerId,
    v3: opts.v3,
    trace: opts.trace,
    observer: opts.observer,
  });
}

export function createCloudShareIntegrationForConnection(
  opts: Omit<CloudShareIntegrationOptions, "v3" | "v4"> & {
    readonly connection: CloudShareConnectionCredentials;
  },
): CloudShareClient {
  // CloudShare's v3 and Accelerate v4 APIs reuse the same API ID + API key pair;
  // only the request-time auth mechanism differs.
  return createCloudShareIntegration({
    mode: opts.mode,
    endpoints: opts.endpoints,
    trace: opts.trace,
    observer: opts.observer,
    customerId: opts.connection.customerId,
    v3: {
      apiId: opts.connection.apiId,
      apiKey: opts.connection.apiKey,
    },
    v4: {
      clientId: opts.connection.apiId,
      clientSecret: opts.connection.apiKey,
    },
  });
}
