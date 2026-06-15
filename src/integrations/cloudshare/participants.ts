import { z } from "zod";
import type { ParticipantLister, TrainingParticipant } from "@/domain/environment-correlation";
import type { CloudShareClient } from "./client";

const trainingParticipantsSchema = z.preprocess(
  (payload) => {
    const rows =
      Array.isArray(payload)
        ? payload
        : typeof payload === "object" && payload !== null && "students" in payload
          ? (payload as { students: unknown }).students
          : typeof payload === "object" && payload !== null && "Students" in payload
            ? (payload as { Students: unknown }).Students
            : payload;

    if (!Array.isArray(rows)) {
      return rows;
    }

    return rows.map((participant) => {
      if (!participant || typeof participant !== "object") {
        return participant;
      }

      const record = participant as Record<string, unknown>;
      return {
        email: record.email ?? record.Email,
        environmentId:
          record.environmentId ??
          record.EnvironmentId ??
          record.environmentID ??
          record.EnvironmentID ??
          null,
        studentId: record.studentId ?? record.StudentId ?? record.id ?? record.Id ?? null,
      };
    });
  },
  z.array(
    z.object({
      email: z.string().email(),
      environmentId: z.string().min(1).nullable(),
      studentId: z.string().min(1).nullable(),
    }),
  ),
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
