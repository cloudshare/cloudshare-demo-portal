import { z } from "zod";
import type {
  CloudShareClient,
  CloudShareDetailedResult,
  CloudShareRequestDiagnostics,
  CloudShareResponseDiagnostics,
} from "./client";
import { CloudShareResponseError } from "./errors";
import { toCloudShareExternalId } from "./external-id";

const experienceSchema = z.object({ id: z.string().min(1) });
type ProjectTeam = { id: string; name: string };
const projectTeamsSchema = z.preprocess(
  (payload) => {
    const rows =
      typeof payload === "object" && payload !== null && "rows" in payload
        ? (payload as { rows: unknown }).rows
        : typeof payload === "object" && payload !== null && "Rows" in payload
          ? (payload as { Rows: unknown }).Rows
          : payload;
    if (!Array.isArray(rows)) {
      return rows;
    }
    return rows.map((team) => {
      if (!team || typeof team !== "object") return team;
      const record = team as Record<string, unknown>;
      return {
        id: record.id ?? record.Id,
        name: record.name ?? record.Name ?? "",
      };
    });
  },
  z.array(z.object({ id: z.string().min(1), name: z.string() })),
);

export interface CreateOnDemandExperienceRequest {
  readonly name: string;
  readonly startsAt: Date;
  readonly endsAt?: Date | null;
  readonly externalId?: string;
  readonly projectId: string;
  readonly blueprintId: string;
  readonly policyId: string;
  readonly regionIds: readonly string[];
  readonly instructorId: string;
  readonly passphrase: string;
  readonly timeZoneId: string;
}

export interface CreateOnDemandExperienceResult {
  readonly trainingId: string;
  readonly experienceId: string;
  readonly teamId: string;
  readonly teamCount: number;
  readonly integrationSurface: string;
  readonly request: CloudShareRequestDiagnostics;
  readonly response: CloudShareResponseDiagnostics;
}

export interface CloudShareOnDemandExperienceCreator {
  createOnDemandExperience(input: CreateOnDemandExperienceRequest): Promise<CreateOnDemandExperienceResult>;
}

function requireDetailedV4Client(client: CloudShareClient): NonNullable<CloudShareClient["requestV4Detailed"]> {
  if (typeof client.requestV4Detailed !== "function") {
    throw new Error("CloudShare on-demand Experience creation requires requestV4Detailed support.");
  }
  return client.requestV4Detailed.bind(client);
}

export function createCloudShareOnDemandExperienceCreator(
  client: CloudShareClient,
): CloudShareOnDemandExperienceCreator {
  const requestV4Detailed = requireDetailedV4Client(client);

  async function requestV4WithDiagnostics<T>(spec: {
    readonly method: "GET" | "POST" | "PUT" | "DELETE";
    readonly path: string;
    readonly body?: unknown;
    readonly schema: z.ZodType<T, z.ZodType["_def"], unknown>;
  }): Promise<CloudShareDetailedResult<T>> {
    return requestV4Detailed(spec) as Promise<CloudShareDetailedResult<T>>;
  }

  return {
    async createOnDemandExperience(input: CreateOnDemandExperienceRequest): Promise<CreateOnDemandExperienceResult> {
      const teams = (await client.requestV3({
        method: "GET",
        path: "/teams",
        query: {
          getRows: "true",
          projectId: input.projectId,
          sortBy: "name",
          sortAscending: "true",
          skip: "0",
          take: "20",
        },
        schema: projectTeamsSchema,
      })) as ProjectTeam[];
      const teamId = teams[0]?.id;
      if (!teamId) {
        throw new CloudShareResponseError(`No CloudShare Team was returned for Project ${input.projectId}.`, {
          method: "GET",
          path: "/teams",
          integrationSurface: "cloudshare.v3.teams",
          requestQuery: {
            getRows: "true",
            projectId: input.projectId,
            sortBy: "name",
            sortAscending: "true",
            skip: "0",
            take: "20",
          },
          responseBody: { teamCount: teams.length },
          issues: [`No CloudShare Team was returned for Project ${input.projectId}.`],
        });
      }

      const body = {
        Name: input.name,
        Start: input.startsAt.toISOString(),
        ...(input.endsAt ? { End: input.endsAt.toISOString() } : {}),
        Type: "selfPaced",
        ProjectId: input.projectId,
        TeamId: teamId,
        BlueprintIds: [input.blueprintId],
        PolicyId: input.policyId,
        CloudshareRegionIds: [...input.regionIds],
        MainInstructor: { Email: input.instructorId },
        TimeZone: input.timeZoneId,
        Passphrase: input.passphrase,
        ...(input.externalId ? { ExternalId: toCloudShareExternalId(input.externalId) } : {}),
        RegistrationType: "registeredStudentsOnly",
        UsersEarlyAccess: { GrantEarlyAccess: 2 },
      };
      const created = await requestV4WithDiagnostics({
        method: "POST",
        path: "/trainings",
        body,
        schema: experienceSchema,
      });
      return {
        trainingId: created.data.id,
        experienceId: created.data.id,
        teamId,
        teamCount: teams.length,
        integrationSurface: created.integrationSurface,
        request: created.request,
        response: created.response,
      };
    },
  };
}
