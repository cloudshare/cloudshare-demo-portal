import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";
import { CloudShareResponseError } from "./errors";
import { toCloudShareExternalId } from "./external-id";
import type {
  AddParticipantInput,
  AddParticipantResult,
  CertalisTrainingUserPropertyKey,
  AddStudentInput,
  CreateExperienceInput,
  CreateExperienceResult,
  CreateTrainingInput,
  CreateTrainingResult,
  CreateSponsoredLinkInput,
  CreateSponsoredLinkResult,
  GetTrainingStartStateInput,
  GetTrainingStartStateResult,
  EnsureTrainingUserPropertyKeysInput,
  EnsureTrainingUserPropertyKeysResult,
  LabProvisioner,
  TrainingUserPropertyDefinition,
} from "@/domain/lab-launch";
import { CERTALIS_TRAINING_USER_PROPERTY_KEYS as CERTALIS_PROPERTY_KEYS } from "@/domain/lab-launch";

/**
 * CloudShare implementation of the {@link LabProvisioner} port, built on the v4
 * adapter. It performs the three Accelerate calls the lab-launch flow needs, with
 * Zod-validated responses; failures surface as the adapter's typed CloudShareErrors.
 *
 * NOTE (assumptions to verify against a live tenant, isolated behind this module):
 * the exact v4 paths/bodies below are modelled on the documented Accelerate
 * flow and live 400 diagnostics. Only this file changes if the live v4 contract differs.
 */

const experienceSchema = z.object({ id: z.string().min(1) });
const addTrainingStudentsSchema = z.array(z.object({}).passthrough());
const addExperienceStudentSchema = z.object({}).passthrough();
const sponsoredLinkSchema = z.object({ loginUrl: z.string().url() });
const trainingUserPropertyDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.number().int().nullable().optional(),
    isRequired: z.boolean().optional(),
    regex: z.string().nullable().optional(),
    defaultValue: z.string().nullable().optional(),
    value: z.string().nullable().optional(),
  })
  .passthrough();
const trainingUserPropertyDefinitionsSchema = z.preprocess(
  (payload) => {
    if (payload == null) {
      return [];
    }
    const rows =
      typeof payload === "object" && payload !== null && "items" in payload
        ? (payload as { items: unknown }).items
        : typeof payload === "object" && payload !== null && "Items" in payload
          ? (payload as { Items: unknown }).Items
          : typeof payload === "object" && payload !== null && "userProperties" in payload
            ? (payload as { userProperties: unknown }).userProperties
            : typeof payload === "object" && payload !== null && "UserProperties" in payload
              ? (payload as { UserProperties: unknown }).UserProperties
              : payload;
    if (!Array.isArray(rows)) {
      return rows;
    }
    return rows.map((row) => {
      if (!row || typeof row !== "object") {
        return row;
      }
      const record = row as Record<string, unknown>;
      return {
        id: record.id ?? record.Id ?? record.name ?? record.Name,
        name: record.name ?? record.Name,
        type: record.type ?? record.Type ?? null,
        isRequired: record.isRequired ?? record.IsRequired,
        regex: record.regex ?? record.Regex ?? null,
        defaultValue: record.defaultValue ?? record.DefaultValue ?? null,
        value: record.value ?? record.Value ?? null,
      };
    });
  },
  z.array(trainingUserPropertyDefinitionSchema),
);
const createdTrainingUserPropertiesSchema = trainingUserPropertyDefinitionsSchema;
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

/** @internal TrainingDelivery implementation detail; active runtimes use training-delivery.ts. */
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
          ...(input.externalId ? { ExternalId: toCloudShareExternalId(input.externalId) } : {}),
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

    async ensureTrainingUserPropertyKeys(
      input: EnsureTrainingUserPropertyKeysInput,
    ): Promise<EnsureTrainingUserPropertyKeysResult> {
      const detailed = await requestV4WithDiagnostics({
        method: "GET",
        path: `/trainings/${input.trainingId}/users/properties`,
        schema: trainingUserPropertyDefinitionsSchema,
      });
      const existingDefinitions = detailed.data;
      const availableKeys = existingDefinitions.map((definition) => definition.name);
      const missingKeys = input.requiredKeys.filter((requiredKey) => !availableKeys.includes(requiredKey));

      let createdDefinitions: TrainingUserPropertyDefinition[] = [];
      let created:
        | CloudShareDetailedResult<TrainingUserPropertyDefinition[]>
        | undefined;
      if (missingKeys.length > 0) {
        created = await requestV4WithDiagnostics({
          method: "POST",
          path: `/trainings/${input.trainingId}/users/properties`,
          body: missingKeys.map((missingKey) => ({ name: missingKey })),
          schema: createdTrainingUserPropertiesSchema,
        });
        createdDefinitions = [...created.data];
      }
      const definitions = [...existingDefinitions, ...createdDefinitions];
      const ensuredKeys = definitions.map((definition) => definition.name);
      const stillMissingKeys = input.requiredKeys.filter((requiredKey) => !ensuredKeys.includes(requiredKey));
      if (stillMissingKeys.length > 0) {
        const evidence = created ?? detailed;
        throw new CloudShareResponseError("CloudShare training user-property provisioning did not return all required keys.", {
          method: evidence.request.method,
          path: evidence.request.path,
          requestHeaders: evidence.request.headers,
          requestBody: evidence.request.body,
          integrationSurface: "cloudshare.v4.training.user_properties",
          status: evidence.response.status,
          responseHeaders: evidence.response.headers,
          responseBody: evidence.response.body,
          cause: "missing_training_user_property_keys_after_create",
          issues: stillMissingKeys.map(
            (missingKey) =>
              `Required CloudShare training user-property key '${missingKey}' was not returned for training ${input.trainingId}.`,
          ),
        });
      }
      const exchanges = [detailed, ...(created ? [created] : [])];
      const primaryEvidence = created ?? detailed;

      return {
        trainingId: input.trainingId,
        ...(input.experienceId ? { experienceId: input.experienceId } : {}),
        requiredKeys: [...input.requiredKeys],
        availableKeys: ensuredKeys,
        definitions: definitions as TrainingUserPropertyDefinition[],
        integrationSurface: "cloudshare.v4.training.user_properties",
        request: primaryEvidence.request,
        response: primaryEvidence.response,
        requests: exchanges.map((exchange) => exchange.request),
        responses: exchanges.map((exchange) => exchange.response),
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
            customProperties: buildParticipantCustomProperties(input),
          },
        ],
        schema: addTrainingStudentsSchema,
      });
      return {
        participantId: readParticipantId(detailed.data),
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

function buildParticipantCustomProperties(
  input: AddParticipantInput,
): Array<{ Name: string; Value: string | null }> | undefined {
  const values: Record<CertalisTrainingUserPropertyKey, string | undefined> = {
    certalisExamAttemptId: input.certalisExamAttemptId,
    certalisCandidateId: input.certalisCandidateId,
  };
  const entries = CERTALIS_PROPERTY_KEYS.flatMap((key) => {
    const value = values[key];
    return (
    typeof value === "string" && value.trim().length > 0
      ? [{ Name: key, Value: value.trim() }]
      : []
    );
  });

  return entries.length > 0 ? entries : undefined;
}

function readParticipantId(rows: unknown): string | undefined {
  if (!Array.isArray(rows)) {
    return undefined;
  }

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const candidate = record.id ?? record.Id ?? record.studentId ?? record.StudentId;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
}
