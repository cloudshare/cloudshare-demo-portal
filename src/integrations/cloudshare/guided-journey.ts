import { z } from "zod";
import type { CloudShareClient } from "./client";
import type { ParticipantProgress, ScoreRetrievalProvider } from "@/domain/score-result";
import { CloudShareRequestError } from "./errors";

/**
 * CloudShare implementation of the {@link ScoreRetrievalProvider} port.
 * Calls the Guided Journey progress endpoint on the v4 API and maps the
 * participant-specific progress payload to the domain type.
 *
 * NOTE (assumptions to verify against a live tenant, isolated in this module):
 * - Path: GET /guided-journey/progress/{experienceId}/{participantId}
 * - Response shape exposes a progress rate plus section/step statuses rather than
 *   the older participants envelope we previously assumed.
 * - Section/task status can arrive as either strings or numeric codes. Until the
 *   exact enum is live-confirmed for this tenant, the adapter treats `2`/`3`
 *   as completed-style statuses (`explored` / `completed-or-passed`) because
 *   user/docs context indicates those numeric values represent completed progress.
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
  "Final certification decisions may use criteria outside this portal's Guided Journey score.",
] as const;

const normalizedProgressSchema = z
  .object({
    percentComplete: z.number().min(0).max(100),
    stepsCompleted: z.number().int().nonnegative(),
    stepsTotal: z.number().int().nonnegative(),
    steps: z.array(
      z.object({
        stepId: z.string().min(1),
        title: z.string().min(1),
        completed: z.boolean(),
      }),
    ),
  })
  .refine((progress) => progress.stepsCompleted <= progress.stepsTotal, {
    message: "stepsCompleted must not exceed stepsTotal",
    path: ["stepsCompleted"],
  });

const guidedJourneyProgressSchema = z.unknown().transform<ParticipantProgress | null>((payload, ctx) => {
  const normalized = normalizeGuidedJourneyProgress(payload);
  if (normalized === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Unsupported Guided Journey progress payload",
    });
    return z.NEVER;
  }

  if (normalized === null) {
    return null;
  }

  return normalizedProgressSchema.parse(normalized);
});

export function createCloudShareGuidedJourneyProvider(
  client: CloudShareClient,
): ScoreRetrievalProvider {
  return {
    async getParticipantProgress(
      experienceId: string,
      participantId: string,
    ): Promise<ParticipantProgress | null> {
      let response: ParticipantProgress | null;
      try {
        response = await client.requestV4<ParticipantProgress | null>({
          method: "GET",
          path: `/guided-journey/progress/${experienceId}/${participantId}`,
          schema: guidedJourneyProgressSchema,
        });
      } catch (error) {
        if (error instanceof CloudShareRequestError && error.status === 404) {
          return null;
        }
        throw error;
      }

      return response;
    },
  };
}

function normalizeGuidedJourneyProgress(payload: unknown): ParticipantProgress | null | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const steps = normalizeProgressSteps(
    Array.isArray(payload.sections)
      ? payload.sections
      : Array.isArray(payload.steps)
        ? payload.steps
        : Array.isArray(payload.tasks)
          ? payload.tasks
          : [],
  );

  const explicitPercent = readNumberCandidate(payload, [
    "progressRate",
    "progress",
    "progressPercentage",
    "completionRate",
  ]);
  const explicitCompleted = readNumberCandidate(payload, [
    "completedSections",
    "completedSteps",
    "completedTasks",
  ]);
  const explicitTotal = readNumberCandidate(payload, [
    "totalSections",
    "totalSteps",
    "totalTasks",
  ]);

  if (
    steps.length === 0 &&
    (explicitPercent ?? 0) === 0 &&
    (explicitCompleted ?? 0) === 0 &&
    (explicitTotal ?? 0) === 0
  ) {
    return null;
  }

  const stepsCompleted = explicitCompleted ?? steps.filter((step) => step.completed).length;
  const stepsTotal = explicitTotal ?? steps.length;
  const percentComplete = explicitPercent ?? (
    stepsTotal > 0 ? Math.round((stepsCompleted / stepsTotal) * 100) : 0
  );

  return {
    percentComplete,
    stepsCompleted,
    stepsTotal,
    steps,
  };
}

function normalizeProgressSteps(rows: unknown[]): ParticipantProgress["steps"] {
  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }

    const stepId = readStringCandidate(row, ["id", "sectionId", "stepId", "taskId"]);
    const title = readStringCandidate(row, ["name", "title", "sectionName", "stepName", "taskName"]);
    if (!stepId || !title) {
      return [];
    }

    const completed =
      readBooleanCandidate(row, ["completed", "isCompleted"]) ??
      isCompletedStatus(
        readStringCandidate(row, ["status", "sectionStatus", "stepStatus", "taskStatus"]),
        readNumberCandidate(row, ["status", "sectionStatus", "stepStatus", "taskStatus"]),
      );

    return [{
      stepId,
      title,
      completed,
    }];
  });
}

function isCompletedStatus(status: string | null, numericStatus: number | null): boolean {
  if (numericStatus !== null) {
    switch (numericStatus) {
      case 2:
      case 3:
        return true;
      default:
        return false;
    }
  }

  if (!status) {
    return false;
  }

  switch (status.trim().toLowerCase()) {
    case "completed":
    case "complete":
    case "explored":
    case "done":
    case "passed":
    case "success":
    case "verified":
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringCandidate(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readNumberCandidate(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readBooleanCandidate(record: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}
