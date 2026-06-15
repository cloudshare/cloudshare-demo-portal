import { z } from "zod";
import type { ParticipantLister, TrainingParticipant } from "@/domain/environment-correlation";
import type { CloudShareClient } from "./client";

const normalizedParticipantsSchema = z.array(
  z.object({
    email: z.string().email(),
    environmentId: z.string().min(1).nullable(),
    studentId: z.string().min(1).nullable(),
  }),
);

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

    return [{ email, environmentId, studentId }];
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
      return (await client.requestV4({
        method: "GET",
        path: `/trainings/${trainingId}/students`,
        schema: trainingParticipantsSchema,
      })) as readonly TrainingParticipant[];
    },
  };
}
