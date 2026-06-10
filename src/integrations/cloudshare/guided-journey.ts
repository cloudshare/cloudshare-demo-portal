import { z } from "zod";
import type { CloudShareClient } from "./client";
import type { ParticipantProgress, ScoreRetrievalProvider } from "@/domain/score-result";

/**
 * CloudShare implementation of the {@link ScoreRetrievalProvider} port.
 * Calls the Guided Journey participants endpoint on the v4 API and maps
 * the first participant's progress to the domain type.
 *
 * NOTE (assumptions to verify against a live tenant, isolated in this module):
 * - Path: GET /experiences/{id}/journey/participants
 * - Response envelope: { participants: [...] }
 * - Per-participant fields: progress (0-100), completedTasks, totalTasks, tasks[{id, name, completed}]
 * All assumptions are documented here; only this file changes if they differ.
 */

const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  completed: z.boolean(),
});

const participantSchema = z.object({
  email: z.string().optional(),
  progress: z.number().min(0).max(100),
  completedTasks: z.number().int().nonnegative(),
  totalTasks: z.number().int().nonnegative(),
  tasks: z.array(taskSchema),
});

const participantsResponseSchema = z.object({
  participants: z.array(participantSchema),
});

export function createCloudShareGuidedJourneyProvider(
  client: CloudShareClient,
): ScoreRetrievalProvider {
  return {
    async getParticipantProgress(experienceId: string): Promise<ParticipantProgress | null> {
      const response = await client.requestV4({
        method: "GET",
        path: `/experiences/${experienceId}/journey/participants`,
        schema: participantsResponseSchema,
      });

      const first = response.participants[0];
      if (!first) return null;

      return {
        percentComplete: first.progress,
        stepsCompleted: first.completedTasks,
        stepsTotal: first.totalTasks,
        steps: first.tasks.map((t) => ({
          stepId: t.id,
          title: t.name,
          completed: t.completed,
        })),
      };
    },
  };
}
