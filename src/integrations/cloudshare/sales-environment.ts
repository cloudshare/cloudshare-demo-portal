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

export function createCloudShareSalesEnvironmentSource(client: CloudShareClient): SalesEnvironmentSource {
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
      const extendSpec = { method: "PUT", path: "/envs/actions/extend", query: { envId: environmentId } } as const;
      const extended = client.requestV3TextDetailed
        ? await client.requestV3TextDetailed(extendSpec)
        : {
            data: await client.requestV3Text(extendSpec),
            request: { method: "PUT" as const, path: "/api/v3/envs/actions/extend", query: extendSpec.query },
            response: { status: 200, body: undefined },
            host: "",
            integrationSurface: "cloudshare.v3",
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
