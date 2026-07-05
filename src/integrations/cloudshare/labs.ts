import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";
import type {
  AddParticipantInput,
  AddParticipantResult,
  AddStudentInput,
  CreateExperienceInput,
  CreateExperienceResult,
  CreateTrainingInput,
  CreateTrainingResult,
  CreateSponsoredLinkInput,
  CreateSponsoredLinkResult,
  GetTrainingStartStateInput,
  GetTrainingStartStateResult,
  LabProvisioner,
} from "@/domain/lab-launch";

/**
 * CloudShare implementation of the {@link LabProvisioner} port, built on the v4
 * adapter. It performs the three Accelerate calls the lab-launch flow needs, with
 * Zod-validated responses; failures surface as the adapter's typed CloudShareErrors.
 *
 * NOTE (assumptions to verify against a live tenant, isolated behind this module):
 * the exact v4 paths/bodies below are modelled on the documented Accelerate
 * flow, the v3 class contract, and live 400 diagnostics. Only this file changes
 * if the live v4 contract differs.
 */

const experienceSchema = z.object({ id: z.string().min(1) });
const addTrainingStudentsSchema = z.array(z.object({}).passthrough());
const addExperienceStudentSchema = z.object({}).passthrough();
const sponsoredLinkSchema = z.object({ loginUrl: z.string().url() });
const trainingStartStateSchema = z
  .object({
    id: z.string().min(1),
    start: z.string().min(1).optional(),
    Start: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    Status: z.string().min(1).optional(),
    timeZone: z.string().min(1).optional(),
    TimeZone: z.string().min(1).optional(),
  })
  .passthrough();
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
      if (!team || typeof team !== "object") {
        return team;
      }
      const record = team as Record<string, unknown>;
      return {
        id: record.id ?? record.Id,
        name: record.name ?? record.Name ?? "",
      };
    });
  },
  z.array(z.object({ id: z.string().min(1), name: z.string() })),
);

export interface CloudShareTeamReadSuccessEvent {
  readonly projectId: string;
  readonly selectedTeamId: string;
  readonly teamIds: readonly string[];
  readonly itemCount: number;
}

export interface CloudShareTeamReadFailureEvent {
  readonly projectId: string;
  readonly integrationSurface: string;
  readonly failureMode: "http_status" | "transport" | "unexpected_response" | "cloudshare_error";
  readonly responseStatus?: number;
}

export interface CloudShareLabProvisionerObserver {
  onTeamReadSuccess?(event: CloudShareTeamReadSuccessEvent): void | Promise<void>;
  onTeamReadFailure?(event: CloudShareTeamReadFailureEvent): void | Promise<void>;
}

function requireDetailedV4Client(client: CloudShareClient): NonNullable<CloudShareClient["requestV4Detailed"]> {
  if (typeof client.requestV4Detailed !== "function") {
    throw new Error("CloudShare lab provisioning diagnostics require requestV4Detailed support.");
  }
  return client.requestV4Detailed.bind(client);
}

function inferFailureMode(error: unknown): CloudShareTeamReadFailureEvent["failureMode"] {
  const name = (error as { name?: unknown } | undefined)?.name;
  if (name === "CloudShareRequestError") return "http_status";
  if (name === "CloudShareTransportError") return "transport";
  if (name === "CloudShareResponseError") return "unexpected_response";
  return "cloudshare_error";
}

export function createCloudShareLabProvisioner(
  client: CloudShareClient,
  observer?: CloudShareLabProvisionerObserver,
): LabProvisioner {
  const requestV4Detailed = requireDetailedV4Client(client);

  async function requestV4WithDiagnostics<T>(
    spec: {
      readonly method: "GET" | "POST" | "PUT" | "DELETE";
      readonly path: string;
      readonly body?: unknown;
      readonly schema: z.ZodType<T, z.ZodType["_def"], unknown>;
    },
  ): Promise<CloudShareDetailedResult<T>> {
    return requestV4Detailed(spec) as Promise<CloudShareDetailedResult<T>>;
  }

  return {
    async createTraining(input: CreateTrainingInput): Promise<CreateTrainingResult> {
      let teams: ProjectTeam[];
      try {
        teams = (await client.requestV3({
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
      } catch (error) {
        await observer?.onTeamReadFailure?.({
          projectId: input.projectId,
          integrationSurface:
            ((error as { context?: { integrationSurface?: unknown } }).context?.integrationSurface as string | undefined) ??
            "cloudshare.v3.teams",
          failureMode: inferFailureMode(error),
          responseStatus:
            typeof (error as { status?: unknown }).status === "number"
              ? ((error as { status: number }).status)
              : undefined,
        });
        throw error;
      }
      const teamId = teams[0]?.id;
      if (!teamId) {
        throw new Error(`No CloudShare Team was returned for Project ${input.projectId}.`);
      }
      await observer?.onTeamReadSuccess?.({
        projectId: input.projectId,
        selectedTeamId: teamId,
        teamIds: teams.map((team) => team.id),
        itemCount: teams.length,
      });

      const training = await requestV4WithDiagnostics({
        method: "POST",
        path: "/trainings",
        body: {
          Name: input.title,
          Start: input.scheduledFor.toISOString(),
          End: input.endsAt.toISOString(),
          Type: "instructorLed",
          ProjectId: input.projectId,
          TeamId: teamId,
          BlueprintIds: [input.blueprintId],
          PolicyId: input.policyId,
          CloudshareRegionIds: input.regionIds,
          MainInstructor: { Email: input.instructorId },
          TimeZone: input.timeZoneId,
          Passphrase: input.passphrase,
          // Matches the v3 class API value for "No early access allowed".
          UsersEarlyAccess: { GrantEarlyAccess: 2 },
        },
        schema: experienceSchema,
      });
      return {
        trainingId: training.data.id,
        teamId,
        teamCount: teams.length,
        integrationSurface: training.integrationSurface,
        request: training.request,
        response: {
          status: training.response.status,
          ...(training.response.headers ? { headers: training.response.headers } : {}),
          body: training.response.body,
        },
      };
    },

    async getTrainingStartState(
      input: GetTrainingStartStateInput,
    ): Promise<GetTrainingStartStateResult> {
      const detailed = await requestV4WithDiagnostics({
        method: "GET",
        path: `/trainings/${input.trainingId}`,
        schema: trainingStartStateSchema,
      });
      const rawStartsAt = detailed.data.start ?? detailed.data.Start;
      const timeZone = detailed.data.timeZone ?? detailed.data.TimeZone;
      const startsAt = rawStartsAt
        ? parseCloudShareTrainingDate(rawStartsAt, timeZone)
        : undefined;
      return {
        trainingId: detailed.data.id,
        status: detailed.data.status ?? detailed.data.Status,
        ...(rawStartsAt ? { rawStartsAt } : {}),
        ...(startsAt ? { startsAt } : {}),
        ...(timeZone ? { timeZone } : {}),
        integrationSurface: detailed.integrationSurface,
        request: detailed.request,
        response: {
          status: detailed.response.status,
          ...(detailed.response.headers ? { headers: detailed.response.headers } : {}),
          body: detailed.response.body,
        },
      };
    },

    async addParticipant(input: AddParticipantInput): Promise<AddParticipantResult> {
      const detailed = await requestV4WithDiagnostics({
        method: "POST",
        path: `/trainings/${input.trainingId}/students`,
        body: [
          {
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
          },
        ],
        schema: addTrainingStudentsSchema,
      });
      return {
        integrationSurface: detailed.integrationSurface,
        request: detailed.request,
        response: {
          status: detailed.response.status,
          ...(detailed.response.headers ? { headers: detailed.response.headers } : {}),
          body: detailed.response.body,
        },
      };
    },

    async createExperience(input: CreateExperienceInput): Promise<CreateExperienceResult> {
      const experience = await client.requestV4({
        method: "POST",
        path: "/experiences",
        body: {
          title: input.title,
          // The security-critical setting: the experience admits only students
          // explicitly registered via Add Student.
          visibility: "RegisteredStudentsOnly",
          // Correlation id we set at creation and persist for later matching.
          externalId: input.environmentExternalId,
        },
        schema: experienceSchema,
      });
      return { experienceId: experience.id };
    },

    async addStudent(input: AddStudentInput): Promise<void> {
      // A non-2xx response throws CloudShareRequestError inside the adapter, so a
      // failed/skipped registration can never resolve successfully.
      await client.requestV4({
        method: "POST",
        path: `/experiences/${input.experienceId}/students`,
        body: { candidateId: input.candidateId },
        schema: addExperienceStudentSchema,
      });
    },

    async createSponsoredLink(
      input: CreateSponsoredLinkInput,
    ): Promise<CreateSponsoredLinkResult> {
      const link = await requestV4WithDiagnostics({
        method: "POST",
        path:
          input.trainingId !== undefined
            ? `/trainings/${input.trainingId}/sponsored-link`
            : `/experiences/${input.experienceId}/sponsoredLinks`,
        body:
          input.trainingId !== undefined
            ? {
                email: input.email,
                firstName: input.firstName,
                lastName: input.lastName,
              }
            : undefined,
        schema: sponsoredLinkSchema,
      });
      return {
        loginUrl: link.data.loginUrl,
        integrationSurface: link.integrationSurface,
        request: link.request,
        response: {
          status: link.response.status,
          ...(link.response.headers ? { headers: link.response.headers } : {}),
          body: link.response.body,
        },
      };
    },
  };
}

function parseCloudShareTrainingDate(value: string, timeZone?: string): Date | undefined {
  const normalized =
    !/[zZ]$/.test(value) && !/[+-]\d{2}:\d{2}$/.test(value)
      ? `${value}Z`
      : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
