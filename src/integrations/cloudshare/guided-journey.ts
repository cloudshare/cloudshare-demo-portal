import { z } from "zod";
import type { CloudShareClient } from "./client";
import type { ParticipantProgress, ScoreRetrievalProvider } from "@/domain/score-result";

/**
 * CloudShare implementation of the {@link ScoreRetrievalProvider} port.
 * Calls the Guided Journey participants endpoint on the v4 API and maps
 * the **first participant's** progress to the domain type.
 *
 * One-candidate-per-experience assumption: proctored exams provision one student
 * per experience, so the first (and only) participant is returned. If multiple
 * participants are present only the first is used. Flagged for the Slice 12 gap report.
 *
 * NOTE (assumptions to verify against a live tenant, isolated in this module):
 * - Path: GET /experiences/{id}/journey/participants
 * - Response envelope: { participants: [...] }
 * - Per-participant fields: progress (0-100), completedTasks, totalTasks, tasks[{id, name, completed}]
 * All assumptions are documented here; only this file changes if they differ.
 */

/**
 * Known limitations of CloudShare Guided Journey scoring.
 * Exported here (the integration layer) because these are CloudShare-specific
 * product constraints, not abstract domain knowledge.
 */
export const SCORING_LIMITATIONS = [
  "Scoring uses bitmap checkpoints: visual state comparison only, not process-level capture.",
  "End-state verification only — approach and intermediate steps are not assessed.",
  "Deterministic script-based verification is not generally available until Q3 2026.",
  "Final certification score weighting is determined by Genesys, not this portal.",
] as const;

const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  completed: z.boolean(),
});

const participantSchema = z
  .object({
    email: z.string().optional(),
    progress: z.number().min(0).max(100),
    completedTasks: z.number().int().nonnegative(),
    totalTasks: z.number().int().nonnegative(),
    tasks: z.array(taskSchema),
  })
  .refine((p) => p.completedTasks <= p.totalTasks, {
    message: "completedTasks must not exceed totalTasks",
    path: ["completedTasks"],
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
