import { z } from "zod";
import type { ParticipantLister, TrainingParticipant } from "@/domain/environment-correlation";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";

const trainingExperienceIdPattern = /^EX[A-Za-z0-9_-]+$/;

const normalizedParticipantsSchema = z.array(
  z.object({
    email: z.string().email(),
    environmentId: z.string().min(1).nullable(),
    environmentStatus: z.string().min(1).nullable(),
    participationStatus: z.string().min(1).nullable(),
    firstJoinedAt: z.string().min(1).nullable(),
    firstName: z.string().min(1).nullable(),
    lastName: z.string().min(1).nullable(),
    displayName: z.string().min(1).nullable(),
    studentId: z.string().min(1).nullable(),
    certalisExamAttemptId: z.string().min(1).nullable(),
    certalisCohortSessionId: z.string().min(1).nullable(),
    certalisCandidateId: z.string().min(1).nullable(),
  }),
);

export function isCloudShareTrainingExperienceId(value: string): boolean {
  return trainingExperienceIdPattern.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNested(record: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function readStringCandidate(record: Record<string, unknown>, paths: readonly (readonly string[])[]): string | null {
  for (const path of paths) {
    const value = readNested(record, path);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function unwrapParticipantRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }

  const wrapped =
    payload.students ??
    payload.Students ??
    payload.rows ??
    payload.Rows ??
    payload.items ??
    payload.Items ??
    payload.data ??
    payload.Data;

  return Array.isArray(wrapped) ? wrapped : [];
}

function normalizeCustomPropertyBag(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const pairs = value.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }
      const key = readStringCandidate(entry, [
        ["key"],
        ["Key"],
        ["name"],
        ["Name"],
      ]);
      const propertyValue = readStringCandidate(entry, [
        ["value"],
        ["Value"],
      ]);
      if (!key || !propertyValue) {
        return [];
      }
      return [[key, propertyValue] as const];
    });
    return Object.fromEntries(pairs);
  }

  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, propertyValue]) =>
      typeof propertyValue === "string" && propertyValue.trim().length > 0
        ? [[key, propertyValue.trim()] as const]
        : [],
    ),
  );
}

function readCustomProperties(record: Record<string, unknown>): Record<string, string> {
  const bags = [
    record.customProperties,
    record.CustomProperties,
    record.userCustomProperties,
    record.UserCustomProperties,
    readNested(record, ["user", "customProperties"]),
    readNested(record, ["user", "CustomProperties"]),
    readNested(record, ["User", "customProperties"]),
    readNested(record, ["User", "CustomProperties"]),
    readNested(record, ["student", "customProperties"]),
    readNested(record, ["student", "CustomProperties"]),
    readNested(record, ["Student", "customProperties"]),
    readNested(record, ["Student", "CustomProperties"]),
  ];

  return Object.assign({}, ...bags.map(normalizeCustomPropertyBag));
}

export function normalizeTrainingParticipants(payload: unknown): TrainingParticipant[] {
  const rows = unwrapParticipantRows(payload);
  const participants = rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }

    const email = readStringCandidate(row, [
      ["email"],
      ["Email"],
      ["user", "email"],
      ["user", "Email"],
      ["User", "email"],
      ["User", "Email"],
      ["student", "email"],
      ["student", "Email"],
      ["Student", "email"],
      ["Student", "Email"],
    ]);

    if (!email) {
      return [];
    }

    const environmentId =
      readStringCandidate(row, [
        ["envId"],
        ["EnvId"],
        ["envID"],
        ["EnvID"],
        ["environmentId"],
        ["EnvironmentId"],
        ["environmentID"],
        ["EnvironmentID"],
        ["environment", "id"],
        ["environment", "Id"],
        ["Environment", "id"],
        ["Environment", "Id"],
      ]) ?? null;

    const environmentStatus =
      readStringCandidate(row, [
        ["envStatus"],
        ["EnvStatus"],
        ["environmentStatus"],
        ["EnvironmentStatus"],
        ["environment", "status"],
        ["environment", "Status"],
        ["Environment", "status"],
        ["Environment", "Status"],
      ]) ?? null;

    const participationStatus =
      readStringCandidate(row, [
        ["participationStatus"],
        ["ParticipationStatus"],
        ["participantStatus"],
        ["ParticipantStatus"],
        ["status"],
        ["Status"],
      ]) ?? null;

    const studentId =
      readStringCandidate(row, [
        ["studentId"],
        ["StudentId"],
        ["id"],
        ["Id"],
        ["student", "id"],
        ["student", "Id"],
        ["Student", "id"],
        ["Student", "Id"],
        ["user", "id"],
        ["user", "Id"],
        ["User", "id"],
        ["User", "Id"],
      ]) ?? null;

    const firstJoinedAt =
      readStringCandidate(row, [
        ["firstJoined"],
        ["FirstJoined"],
        ["firstJoinedAt"],
        ["FirstJoinedAt"],
        ["user", "firstJoined"],
        ["user", "FirstJoined"],
        ["User", "firstJoined"],
        ["User", "FirstJoined"],
      ]) ?? null;

    const firstName =
      readStringCandidate(row, [
        ["firstName"],
        ["FirstName"],
        ["user", "firstName"],
        ["user", "FirstName"],
        ["User", "firstName"],
        ["User", "FirstName"],
        ["student", "firstName"],
        ["student", "FirstName"],
        ["Student", "firstName"],
        ["Student", "FirstName"],
      ]) ?? null;

    const lastName =
      readStringCandidate(row, [
        ["lastName"],
        ["LastName"],
        ["user", "lastName"],
        ["user", "LastName"],
        ["User", "lastName"],
        ["User", "LastName"],
        ["student", "lastName"],
        ["student", "LastName"],
        ["Student", "lastName"],
        ["Student", "LastName"],
      ]) ?? null;

    const explicitDisplayName =
      readStringCandidate(row, [
        ["name"],
        ["Name"],
        ["displayName"],
        ["DisplayName"],
        ["user", "name"],
        ["user", "Name"],
        ["User", "name"],
        ["User", "Name"],
        ["student", "name"],
        ["student", "Name"],
        ["Student", "name"],
        ["Student", "Name"],
      ]) ?? null;
    const composedDisplayName = `${firstName ?? ""} ${lastName ?? ""}`.trim() || null;
    const displayName = explicitDisplayName ?? composedDisplayName;
    const customProperties = readCustomProperties(row);

    return [
      {
        email,
        environmentId,
        environmentStatus,
        participationStatus,
        firstJoinedAt,
        firstName,
        lastName,
        displayName,
        studentId,
        certalisExamAttemptId: customProperties.certalisExamAttemptId ?? null,
        certalisCohortSessionId: customProperties.certalisCohortSessionId ?? null,
        certalisCandidateId: customProperties.certalisCandidateId ?? null,
      },
    ];
  });

  return normalizedParticipantsSchema.parse(participants);
}

const trainingParticipantsSchema = z.preprocess(
  (payload) => normalizeTrainingParticipants(payload),
  normalizedParticipantsSchema,
);

export function createCloudShareParticipantLister(
  client: CloudShareClient,
): ParticipantLister {
  return {
    async listParticipants(trainingId: string): Promise<readonly TrainingParticipant[]> {
      if (!isCloudShareTrainingExperienceId(trainingId)) {
        // Training experience IDs are CloudShare-generated EX... identifiers.
        // Refuse local placeholders before they can hit the live API.
        return [];
      }

      return (await client.requestV4({
        method: "GET",
        path: `/trainings/${trainingId}/students`,
        schema: trainingParticipantsSchema,
      })) as readonly TrainingParticipant[];
    },
  };
}

export interface TrainingParticipantReadResult {
  readonly participants: readonly TrainingParticipant[];
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

export interface TrainingParticipantReader {
  readParticipants(trainingId: string): Promise<TrainingParticipantReadResult>;
}

export function createCloudShareTrainingParticipantReader(
  client: CloudShareClient,
): TrainingParticipantReader {
  return {
    async readParticipants(trainingId: string): Promise<TrainingParticipantReadResult> {
      if (!isCloudShareTrainingExperienceId(trainingId)) {
        return {
          participants: [],
          integrationSurface: "cloudshare.v4.training.participant",
          request: {
            method: "GET",
            path: "/v4/trainings/{trainingId}/students",
          },
          response: {
            status: 200,
            body: [],
          },
        };
      }

      if (typeof client.requestV4Detailed === "function") {
        const result = (await client.requestV4Detailed({
          method: "GET",
          path: `/trainings/${trainingId}/students`,
          schema: trainingParticipantsSchema,
        })) as CloudShareDetailedResult<readonly TrainingParticipant[]>;

        return {
          participants: result.data,
          integrationSurface: result.integrationSurface,
          request: result.request,
          response: result.response,
        };
      }

      const participants = (await client.requestV4({
        method: "GET",
        path: `/trainings/${trainingId}/students`,
        schema: trainingParticipantsSchema,
      })) as readonly TrainingParticipant[];

      return {
        participants,
        integrationSurface: "cloudshare.v4.training.participant",
        request: {
          method: "GET",
          path: `/v4/trainings/${trainingId}/students`,
        },
        response: {
          status: 200,
          body: participants,
        },
      };
    },
  };
}
