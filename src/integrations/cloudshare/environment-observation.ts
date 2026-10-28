import type { SalesEnvironmentModule, SalesEnvironmentReading, SalesEnvironmentState, EnvironmentExchange } from "@/domain/environment-observation";
import type { EnvironmentStatus } from "@/domain/environment";
import { dispatchEnvironmentCommand } from "./environment-command";
import { z } from "zod";
import { readV4Environment, listV4Environments, invalid, withEnvironmentExchanges } from "./environments-v4";
import type { CloudShareClient, CloudShareRequestDiagnostics, CloudShareResponseDiagnostics } from "./client";

export const cloudShareV3SalesEnvironmentStatusCodeSchema = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(7), z.literal(8), z.literal(9)]);
export type CloudShareV3SalesEnvironmentStatusCode = z.infer<typeof cloudShareV3SalesEnvironmentStatusCodeSchema>;
export interface SalesEnvironmentObservation {
  readonly environmentId: string;
  readonly statusCode: number;
  readonly status?: string;
  readonly source?: "cloudshare_v4_environment";
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
    const result = await readV4Environment(client, environmentId);
    return { environmentId, statusCode: v4CompatibilityCode(result.data.status), status: result.data.status, source: "cloudshare_v4_environment", expirationTime: result.data.expirationTime, exchanges: [{ request: result.request, response: result.response }] };
  }
  return {
    async observe({ ownerEmail, projectId }) {
      const listed = await listV4Environments(client, ownerEmail);
      const exchanges = listed.reads.map(({ request, response }) => ({ request, response }));
      const matches = listed.items.filter(environment => environment.projectId === projectId && environment.ownerEmail?.trim().toLowerCase() === ownerEmail.trim().toLowerCase());
      if (matches.length !== 1) throw new SalesEnvironmentResolutionError(matches.length === 0 ? "environment_not_found_for_project" : "environment_ambiguous_for_project", exchanges);
      try {
      const result = await readV4Environment(client, matches[0]!.id);
      if (result.data.projectId !== projectId || result.data.ownerEmail?.trim().toLowerCase() !== ownerEmail.trim().toLowerCase()) throw invalid(result, "Environment owner or Project changed");
      return { environmentId: result.data.id, statusCode: v4CompatibilityCode(result.data.status), status: result.data.status, source: "cloudshare_v4_environment" as const, expirationTime: result.data.expirationTime, exchanges: [...exchanges, { request: result.request, response: result.response }] };
      } catch (error) { throw withEnvironmentExchanges(error, exchanges); }
    },
    observeById,
    async extendById(environmentId: string): Promise<SalesEnvironmentExtensionResult> {
      const dispatched = await dispatchEnvironmentCommand(client, environmentId, "extend");
      const extended = dispatched.detailed!;
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
  readonly status?: string;
  readonly source?: "cloudshare_v4_environment";
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
  const state = observation.source === "cloudshare_v4_environment" ? v4SalesState(observation.status ?? "unknown") : states[observation.statusCode] ?? "unknown";
  const trial = new Date(observation.expirationTime);
  return {
    compatibility: observation, ...(observation.source ? { source: observation.source, providerStatus: observation.status } : {}), environmentId: observation.environmentId, state, persistedStatus: persistedStatuses[state] ?? null,
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


function v4SalesState(status: string): SalesEnvironmentState {
  switch (status) {
    case "ready": case "suspended": case "archived": case "deleted": case "preparing": return status;
    case "creationFailed": return "creation_failed";
    case "publishing": case "inGrace": case "futureAllocationScheduled": case "allocationScheduledNoRun": case "editingNetworks": case "stopping": return status;
    default: return "unknown";
  }
}
// Derived compatibility only; never present these numbers as fresh v3 evidence.
function v4CompatibilityCode(status: string): number {
  return ({ ready: 2, suspended: 3, archived: 4, deleted: 5, publishing: 7, preparing: 8, creationFailed: 9 } as Record<string, number>)[status] ?? 0;
}

export function mapV4EnvironmentStatus(status: string): EnvironmentStatus {
  switch (status) {
    case "ready": return "running";
    case "suspended": return "suspended";
    case "preparing": return "created";
    case "archived": return "archived";
    case "deleted": return "deleted";
    default: return "unknown";
  }
}
