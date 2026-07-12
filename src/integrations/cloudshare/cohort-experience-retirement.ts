import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";
import { CloudShareResponseError } from "./errors";

const updatedTrainingSchema = z
  .object({
    id: z.string().min(1),
    end: z.string().min(1).nullable().optional(),
    End: z.string().min(1).nullable().optional(),
  })
  .passthrough();

const trainingDetailSchema = z
  .object({
    id: z.string().min(1),
    end: z.string().min(1).nullable().optional(),
    End: z.string().min(1).nullable().optional(),
  })
  .passthrough();

const CLOUD_SHARE_END_CONFIRMATION_TOLERANCE_MS = 1_000;
const TRAINING_UPDATE_FIELD_ALIASES = [
  ["Name", "name"],
  ["Start", "start"],
  ["Type", "type"],
  ["TeamId", "teamId"],
  ["PolicyId", "policyId"],
  ["TimeZone", "timeZone"],
  ["ProjectId", "projectId"],
  ["Passphrase", "passphrase"],
  ["MaxStudents", "maxStudents"],
  ["BlueprintIds", "blueprintIds"],
  ["MainInstructor", "mainInstructor"],
  ["UsersEarlyAccess", "usersEarlyAccess"],
  ["CloudshareRegionIds", "cloudshareRegionIds"],
  ["RegistrationType", "registrationType"],
  ["AdditionalInstructors", "additionalInstructors"],
  ["MaxConcurrentStudents", "maxConcurrentStudents"],
  ["AccessType", "accessType"],
  ["Description", "description"],
  ["Labels", "labels"],
  ["ExternalId", "externalId"],
  ["AllowMultipleEnvironmentActivations", "allowMultipleEnvironmentActivations"],
  ["SendInvitations", "sendInvitations"],
  ["EmailDomainBlocklist", "emailDomainBlocklist"],
  ["BlockFreeEmailDomains", "blockFreeEmailDomains"],
  ["CustomFields", "customFields"],
  ["AllowParticipantsSwitchSteps", "allowParticipantsSwitchSteps"],
  ["UseCustomInvitationEmail", "useCustomInvitationEmail"],
  ["PreConfigureParticipantEnvironments", "preConfigureParticipantEnvironments"],
  ["AllowAudioVideo", "allowAudioVideo"],
] as const;

export interface RetireCloudShareTrainingResult {
  readonly trainingId: string;
  readonly end: string | null;
  readonly integrationSurface: string;
  readonly request: {
    readonly method: string;
    readonly path: string;
    readonly query?: Record<string, string>;
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
  };
  readonly response: {
    readonly status: number;
    readonly headers?: Record<string, string | string[]>;
    readonly body: unknown;
  };
}

export interface CloudShareTrainingRetirementWriter {
  retireTrainingToEnd(input: {
    readonly trainingId: string;
    readonly end: Date;
  }): Promise<RetireCloudShareTrainingResult>;
}

/** @internal TrainingDelivery implementation detail; active runtimes use training-delivery.ts. */
export function createCloudShareTrainingRetirementWriter(
  client: CloudShareClient,
): CloudShareTrainingRetirementWriter {
  if (typeof client.requestV4Detailed !== "function") {
    throw new Error("CloudShare training retirement requires requestV4Detailed support.");
  }

  return {
    async retireTrainingToEnd(input): Promise<RetireCloudShareTrainingResult> {
      const expectedEnd = input.end.toISOString();
      const expectedEndTime = input.end.getTime();
      const current = (await client.requestV4Detailed!({
        method: "GET",
        path: `/trainings/${input.trainingId}`,
        schema: trainingDetailSchema,
      })) as CloudShareDetailedResult<z.infer<typeof trainingDetailSchema>>;
      const updateBody = buildRetireTrainingUpdateBody(current.data, expectedEnd);
      const result = (await client.requestV4Detailed!({
        method: "PUT",
        path: `/trainings/${input.trainingId}`,
        body: updateBody,
        schema: updatedTrainingSchema,
      })) as CloudShareDetailedResult<z.infer<typeof updatedTrainingSchema>>;
      const updateEnd = result.data.end ?? result.data.End ?? null;

      if (!matchesCloudShareTrainingInstant(updateEnd, expectedEndTime)) {
        const readback = (await client.requestV4Detailed!({
          method: "GET",
          path: `/trainings/${input.trainingId}`,
          schema: trainingDetailSchema,
        })) as CloudShareDetailedResult<z.infer<typeof trainingDetailSchema>>;
        const confirmedEnd = readback.data.end ?? readback.data.End ?? null;

        if (!matchesCloudShareTrainingInstant(confirmedEnd, expectedEndTime)) {
          throw new CloudShareResponseError(
            "CloudShare did not confirm the Cohort Exam Session retirement end time.",
            {
              method: result.request.method,
              path: result.request.path,
              requestBody: result.request.body,
              integrationSurface: result.integrationSurface,
              responseBody: {
                update: result.response.body,
                readback: readback.response.body,
              },
              cause: "retire_training_end_unconfirmed",
              expectedEnd,
              confirmedEnd,
            },
          );
        }

        return {
          trainingId: result.data.id,
          end: confirmedEnd,
          integrationSurface: result.integrationSurface,
          request: result.request,
          response: result.response,
        };
      }

      return {
        trainingId: result.data.id,
        end: updateEnd,
        integrationSurface: result.integrationSurface,
        request: result.request,
        response: result.response,
      };
    },
  };
}

function buildRetireTrainingUpdateBody(
  training: z.infer<typeof trainingDetailSchema>,
  expectedEnd: string,
): Record<string, unknown> {
  const source = training as Record<string, unknown>;
  const body: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (/^[A-Z]/.test(key)) {
      body[key] = value;
    }
  }

  for (const [pascalKey, camelKey] of TRAINING_UPDATE_FIELD_ALIASES) {
    const value = source[pascalKey] ?? source[camelKey];
    if (value !== undefined) {
      body[pascalKey] = normalizeTrainingUpdateField(pascalKey, value);
    }
  }

  body.End = expectedEnd;
  return body;
}

function normalizeTrainingUpdateField(key: string, value: unknown): unknown {
  if (key === "MainInstructor" && value && typeof value === "object") {
    const instructor = value as Record<string, unknown>;
    return {
      Email: instructor.Email ?? instructor.email,
    };
  }

  if (key === "UsersEarlyAccess" && value && typeof value === "object") {
    const earlyAccess = value as Record<string, unknown>;
    return {
      GrantEarlyAccess: earlyAccess.GrantEarlyAccess ?? earlyAccess.grantEarlyAccess,
      ...(earlyAccess.EarlyAccessTime !== undefined || earlyAccess.earlyAccessTime !== undefined
        ? { EarlyAccessTime: earlyAccess.EarlyAccessTime ?? earlyAccess.earlyAccessTime }
        : {}),
    };
  }

  return value;
}

function matchesCloudShareTrainingInstant(value: string | null, expectedTime: number): boolean {
  if (!value) {
    return false;
  }
  const parsed = parseCloudShareTrainingDate(value);
  if (!parsed) {
    return false;
  }
  return Math.abs(parsed.getTime() - expectedTime) <= CLOUD_SHARE_END_CONFIRMATION_TOLERANCE_MS;
}

function parseCloudShareTrainingDate(value: string): Date | undefined {
  const normalized =
    !/[zZ]$/.test(value) && !/[+-]\d{2}:\d{2}$/.test(value)
      ? `${value}Z`
      : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
