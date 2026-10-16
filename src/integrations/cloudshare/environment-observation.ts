import type { SalesEnvironmentModule, SalesEnvironmentReading, SalesEnvironmentState, EnvironmentExchange } from "@/domain/environment-observation";
import type { EnvironmentStatus } from "@/domain/environment";
import { dispatchEnvironmentCommand } from "./environment-command";
import { z } from "zod";
import type { CloudShareClient, CloudShareRequestDiagnostics, CloudShareResponseDiagnostics } from "./client";

const environmentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  project: z.object({ id: z.string().min(1) }).optional(),
}).passthrough();
const environmentListSchema = z.union([
  z.array(environmentSchema),
  z.object({ items: z.array(environmentSchema) }).transform(({ items }) => items),
]);
export const cloudShareV3SalesEnvironmentStatusCodeSchema = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(7), z.literal(8), z.literal(9)]);
export type CloudShareV3SalesEnvironmentStatusCode = z.infer<typeof cloudShareV3SalesEnvironmentStatusCodeSchema>;
const extendedSchema = z.object({
  statusCode: cloudShareV3SalesEnvironmentStatusCodeSchema,
  expirationTime: z.string().min(1),
}).passthrough();

export interface SalesEnvironmentObservation {
  readonly environmentId: string;
  readonly statusCode: CloudShareV3SalesEnvironmentStatusCode;
  readonly expirationTime: string;
  readonly exchanges: readonly { readonly request: CloudShareRequestDiagnostics; readonly response: CloudShareResponseDiagnostics }[];
}

export interface SalesEnvironmentExtensionResult {
  readonly environmentId: string;
  readonly exchange: {
    readonly request: CloudShareRequestDiagnostics;
    readonly response: CloudShareResponseDiagnostics;
  };
}

export class SalesEnvironmentResolutionError extends Error {
  constructor(
    readonly reason: "environment_not_found_for_project" | "environment_ambiguous_for_project",
    readonly exchanges: SalesEnvironmentObservation["exchanges"],
  ) {
    super(reason === "environment_not_found_for_project"
      ? "CloudShare returned no Environment for this participant in the Session Item project."
      : "CloudShare returned multiple Environments for this participant in the Session Item project.");
    this.name = "SalesEnvironmentResolutionError";
  }
}

export interface SalesEnvironmentSource {
  observe(input: { readonly ownerEmail: string; readonly projectId: string }): Promise<SalesEnvironmentObservation>;
  observeById?(environmentId: string): Promise<SalesEnvironmentObservation>;
  extendById?(environmentId: string): Promise<SalesEnvironmentExtensionResult>;
}

function createCloudShareSalesEnvironmentTransport(client: CloudShareClient): SalesEnvironmentSource {
  async function observeById(environmentId: string): Promise<SalesEnvironmentObservation> {
    const extendedSpec = { method: "GET", path: "/envs/actions/getextended", query: { envId: environmentId }, schema: extendedSchema } as const;
    const extended = client.requestV3Detailed
      ? await client.requestV3Detailed(extendedSpec)
      : { data: await client.requestV3(extendedSpec), request: { method: "GET" as const, path: extendedSpec.path, query: extendedSpec.query }, response: { status: 200, body: undefined }, host: "", integrationSurface: "cloudshare.v3" };
    return { environmentId, statusCode: extended.data.statusCode, expirationTime: extended.data.expirationTime, exchanges: [{ request: extended.request, response: extended.response }] };
  }
  return {
    async observe({ ownerEmail, projectId }) {
      const listSpec = { method: "GET", path: "/envs", query: { ownerEmail, brief: "false" }, schema: environmentListSchema } as const;
      const listed = client.requestV3Detailed
        ? await client.requestV3Detailed(listSpec)
        : { data: await client.requestV3(listSpec), request: { method: "GET" as const, path: "/envs", query: listSpec.query }, response: { status: 200, body: undefined }, host: "", integrationSurface: "cloudshare.v3" };
      const exchanges: SalesEnvironmentObservation["exchanges"] = [{ request: listed.request, response: listed.response }];
      const matches = listed.data.filter((environment) => (environment.projectId ?? environment.project?.id) === projectId);
      if (matches.length !== 1) {
        throw new SalesEnvironmentResolutionError(matches.length === 0 ? "environment_not_found_for_project" : "environment_ambiguous_for_project", exchanges);
      }
      const environmentId = matches[0]!.id;
      const observation = await observeById(environmentId);
      return { ...observation, exchanges: [...exchanges, ...observation.exchanges] };
    },
    observeById,
    async extendById(environmentId: string): Promise<SalesEnvironmentExtensionResult> {
      const dispatched = await dispatchEnvironmentCommand(client, environmentId, "extend");
      // Preserve the historical Sales fallback: status 200 with an undefined
      // body, unlike Certification's text/null command evidence.
      const extended = dispatched.detailed ?? {
        request: { method: "PUT" as const, path: "/api/v3/envs/actions/extend", query: dispatched.spec.query },
        response: { status: 200, body: undefined },
      };
      return {
        environmentId,
        exchange: {
          request: extended.request,
          response: extended.response,
        },
      };
    },
  };
}

/** Input bridge for the retained facade and existing injected provider fixtures. */
interface LegacyReading {
  readonly environmentId: string;
  readonly statusCode: number;
  readonly expirationTime: string;
  readonly exchanges: readonly EnvironmentExchange[];
}
interface LegacySource {
  observe(input: { readonly ownerEmail: string; readonly projectId: string }): Promise<LegacyReading>;
  observeById?(id: string): Promise<LegacyReading>;
  extendById?(id: string): Promise<{ readonly environmentId: string; readonly exchange: EnvironmentExchange }>;
}

const states: Readonly<Record<number, SalesEnvironmentState>> = {
  2: "ready", 3: "suspended", 4: "archived", 5: "deleted", 7: "taking_snapshot", 8: "preparing", 9: "creation_failed",
};
const persistedStatuses: Readonly<Partial<Record<SalesEnvironmentState, string>>> = {
  ready: "Ready", suspended: "Suspended", archived: "Archived", deleted: "Deleted", preparing: "Preparing", creation_failed: "CreationFailed",
};

export function parseSessionEnvironmentExpiry(value: string): Date | null {
  const date = (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function reading<T extends LegacyReading>(observation: T): SalesEnvironmentReading & { readonly compatibility: T } {
  const state = states[observation.statusCode] ?? "unknown";
  const trial = new Date(observation.expirationTime);
  return {
    compatibility: observation, environmentId: observation.environmentId, state, persistedStatus: persistedStatuses[state] ?? null,
    expiry: { raw: observation.expirationTime, session: parseSessionEnvironmentExpiry(observation.expirationTime), trial: Number.isNaN(trial.getTime()) ? null : trial },
    exchanges: observation.exchanges,
  };
}

/** Normalization adapter for the retained v3 facade, including injected fixtures.
 * Resolution and transport remain inside the CloudShare implementation; callers
 * receive semantic state and both intentionally different expiry interpretations. */
export function createSalesEnvironmentModule(source: LegacySource): SalesEnvironmentModule {
  return {
    async observe(input) { return reading(await source.observe(input)); },
    ...(source.observeById ? { async observeById(id: string) { return reading(await source.observeById!(id)); } } : {}),
    ...(source.extendById ? { extendById: (id: string) => source.extendById!(id) } : {}),
  };
}

export function createCloudShareSalesEnvironmentModule(client: CloudShareClient) {
  const transport = createCloudShareSalesEnvironmentTransport(client);
  return {
    async observe(input: { readonly ownerEmail: string; readonly projectId: string }) { return reading(await transport.observe(input)); },
    async observeById(id: string) { return reading(await transport.observeById!(id)); },
    extendById: (id: string) => transport.extendById!(id),
  };
}

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

/** Exact v3 Environment statusCode; used by Sales read models without reusing v4 roster envStatus. */
export function cloudShareV3EnvironmentStatusCode(value: unknown): number | null {
  return typeof value === "number" && states[value] !== undefined ? value : null;
}

