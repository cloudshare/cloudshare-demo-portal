import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";
import { redactCloudShareAdminSupportValue } from "./diagnostic-redaction";
import type {
  ParticipantProgressDiagnosticRequest,
  ParticipantProgressDiagnosticResponse,
  DiagnosticScoreRetrievalProvider,
  ParticipantProgress,
  ParticipantProgressDiagnostics,
  ScoreRetrievalProvider,
} from "@/domain/score-result";
import { CloudShareRequestError, CloudShareResponseError } from "./errors";

export interface AggregateGuidedJourneySectionStatus {
  readonly sectionNumber: number;
  readonly title: string;
  readonly status: string | null;
  readonly avgExploredRate: number;
  readonly avgInProgressRate: number;
  readonly avgNotStartedRate: number;
  readonly avgPassedRate: number;
  readonly avgFailedRate: number;
  readonly avgNotInitiatedRate: number;
  readonly avgTimeSpentSeconds: number | null;
}

export interface AggregateGuidedJourneyProgress {
  readonly avgExploredRate: number;
  readonly avgInProgressRate: number;
  readonly avgNotStartedRate: number;
  readonly avgPassedRate: number;
  readonly avgFailedRate: number;
  readonly avgNotInitiatedRate: number;
  readonly aggSectionStatuses: readonly AggregateGuidedJourneySectionStatus[];
}

export interface AggregateGuidedJourneyProvider {
  getAggregateProgress(experienceId: string): Promise<AggregateGuidedJourneyProgress | null>;
}

export interface AggregateGuidedJourneyDiagnostics {
  readonly progress: AggregateGuidedJourneyProgress | null;
  readonly request: ParticipantProgressDiagnosticRequest;
  readonly response: ParticipantProgressDiagnosticResponse | null;
}

export interface DiagnosticAggregateGuidedJourneyProvider extends AggregateGuidedJourneyProvider {
  getAggregateProgressForDiagnostics(experienceId: string): Promise<AggregateGuidedJourneyDiagnostics>;
}

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
    exploredRate: z.number().min(0).max(1),
    inProgressRate: z.number().min(0).max(1),
    notStartedRate: z.number().min(0).max(1),
    passedRate: z.number().min(0).max(1),
    failedRate: z.number().min(0).max(1),
    notInitiatedRate: z.number().min(0).max(1),
    steps: z.array(
      z.object({
        stepId: z.string().min(1),
        title: z.string().min(1),
        completed: z.boolean(),
        status: z.string().min(1).nullable().optional(),
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

  const parsed = normalizedProgressSchema.safeParse(normalized);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue(issue);
    }
    return z.NEVER;
  }

  return parsed.data;
});

const aggregateGuidedJourneyProgressSchema = z.unknown().transform<AggregateGuidedJourneyProgress | null>((payload, ctx) => {
  const normalized = normalizeAggregateGuidedJourneyProgress(payload);
  if (normalized === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Unsupported aggregate Guided Journey progress payload",
    });
    return z.NEVER;
  }

  if (normalized === null) {
    return null;
  }

  const parsed = z.object({
    avgExploredRate: z.number().min(0).max(1),
    avgInProgressRate: z.number().min(0).max(1),
    avgNotStartedRate: z.number().min(0).max(1),
    avgPassedRate: z.number().min(0).max(1),
    avgFailedRate: z.number().min(0).max(1),
    avgNotInitiatedRate: z.number().min(0).max(1),
    aggSectionStatuses: z.array(
      z.object({
        sectionNumber: z.number().int().nonnegative(),
        title: z.string().min(1),
        status: z.string().min(1).nullable(),
        avgExploredRate: z.number().min(0).max(1),
        avgInProgressRate: z.number().min(0).max(1),
        avgNotStartedRate: z.number().min(0).max(1),
        avgPassedRate: z.number().min(0).max(1),
        avgFailedRate: z.number().min(0).max(1),
        avgNotInitiatedRate: z.number().min(0).max(1),
        avgTimeSpentSeconds: z.number().nonnegative().nullable(),
      }),
    ),
  }).safeParse(normalized);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue(issue);
    }
    return z.NEVER;
  }

  return parsed.data;
});

/** @internal TrainingDelivery implementation detail; active runtimes use training-delivery.ts. */
export function createCloudShareGuidedJourneyProvider(
  client: CloudShareClient,
): ScoreRetrievalProvider & DiagnosticScoreRetrievalProvider {
  return {
    async getParticipantProgress(
      experienceId: string,
      participantId: string,
    ): Promise<ParticipantProgress | null> {
      const result = await fetchParticipantProgressForDiagnostics(client, experienceId, participantId);
      return result.progress;
    },
    async getParticipantProgressForDiagnostics(
      experienceId: string,
      participantId: string,
    ): Promise<ParticipantProgressDiagnostics> {
      return fetchParticipantProgressForDiagnostics(client, experienceId, participantId);
    },
  };
}

/** @internal TrainingDelivery implementation detail; active runtimes use training-delivery.ts. */
export function createCloudShareAggregateGuidedJourneyProvider(
  client: CloudShareClient,
): AggregateGuidedJourneyProvider & DiagnosticAggregateGuidedJourneyProvider {
  return {
    async getAggregateProgress(experienceId: string): Promise<AggregateGuidedJourneyProgress | null> {
      const result = await fetchAggregateProgressForDiagnostics(client, experienceId);
      return result.progress;
    },
    async getAggregateProgressForDiagnostics(experienceId: string): Promise<AggregateGuidedJourneyDiagnostics> {
      return fetchAggregateProgressForDiagnostics(client, experienceId);
    },
  };
}

async function fetchAggregateProgressForDiagnostics(
  client: CloudShareClient,
  experienceId: string,
): Promise<AggregateGuidedJourneyDiagnostics> {
  const path = `/guided-journey/progress/${experienceId}`;
  const request = { method: "GET", path } as const;

  let responseBody: unknown;
  let detailedResponse: CloudShareDetailedResult<unknown> | null = null;
  try {
    if (typeof client.requestV4Detailed === "function") {
      detailedResponse = await client.requestV4Detailed<unknown>({
        method: request.method,
        path: request.path,
        schema: z.unknown(),
      });
      responseBody = detailedResponse.data;
    } else {
      responseBody = await client.requestV4<unknown>({
        method: request.method,
        path: request.path,
        schema: z.unknown(),
      });
    }
  } catch (error) {
    if (error instanceof CloudShareRequestError && error.status === 404) {
      return {
        progress: null,
        request: {
          ...request,
          ...(error.context?.requestHeaders
            ? { headers: error.context.requestHeaders as Record<string, string> }
            : {}),
          ...(error.context?.requestBody !== undefined
            ? { body: error.context.requestBody }
            : {}),
        },
        response: {
          status: 404,
          body: null,
          ...(error.context?.responseHeaders
            ? { headers: error.context.responseHeaders as Record<string, string | string[]> }
            : {}),
        },
      };
    }
    throw error;
  }

  const parsed = aggregateGuidedJourneyProgressSchema.safeParse(responseBody);
  if (!parsed.success) {
    throw new CloudShareResponseError(
      "CloudShare aggregate Guided Journey progress payload was unsupported",
      {
        method: request.method,
        path: request.path,
        integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
        responseBody: serializeGuidedJourneyResponseBody(responseBody),
        issues: parsed.error.issues.map((issue) => issue.message),
      },
    );
  }

  return {
    progress: parsed.data,
    request: detailedResponse?.request ?? request,
    response: {
      status: detailedResponse?.response.status ?? 200,
      ...(detailedResponse?.response.headers
        ? { headers: detailedResponse.response.headers }
        : {}),
      body: detailedResponse?.response.body ?? responseBody,
    },
  };
}

async function fetchParticipantProgressForDiagnostics(
  client: CloudShareClient,
  experienceId: string,
  participantId: string,
): Promise<ParticipantProgressDiagnostics> {
  const path = `/guided-journey/progress/${experienceId}/${participantId}`;
  const request = { method: "GET", path } as const;

  let responseBody: unknown;
  let detailedResponse: CloudShareDetailedResult<unknown> | null = null;
  try {
    if (typeof client.requestV4Detailed === "function") {
      detailedResponse = await client.requestV4Detailed<unknown>({
        method: request.method,
        path: request.path,
        schema: z.unknown(),
      });
      responseBody = detailedResponse.data;
    } else {
      responseBody = await client.requestV4<unknown>({
        method: request.method,
        path: request.path,
        schema: z.unknown(),
      });
    }
  } catch (error) {
    if (error instanceof CloudShareRequestError && error.status === 404) {
      return {
        progress: null,
        request: {
          ...request,
          ...(error.context?.requestHeaders
            ? { headers: error.context.requestHeaders as Record<string, string> }
            : {}),
          ...(error.context?.requestBody !== undefined
            ? { body: error.context.requestBody }
            : {}),
        },
        response: {
          status: 404,
          body: null,
          ...(error.context?.responseHeaders
            ? { headers: error.context.responseHeaders as Record<string, string | string[]> }
            : {}),
        },
      };
    }
    throw error;
  }

  let progress: ParticipantProgress | null;
  const parsed = guidedJourneyProgressSchema.safeParse(responseBody);
  if (!parsed.success) {
    throw new CloudShareResponseError(
      "CloudShare Guided Journey progress payload was unsupported",
      {
        method: request.method,
        path: request.path,
        integrationSurface: "cloudshare.v4.guided_journey.progress",
        responseBody: serializeGuidedJourneyResponseBody(responseBody),
        issues: parsed.error.issues.map((issue) => issue.message),
      },
    );
  }
  progress = parsed.data;

  return {
    progress,
    request: detailedResponse?.request ?? request,
    response: {
      status: detailedResponse?.response.status ?? 200,
      ...(detailedResponse?.response.headers
        ? { headers: detailedResponse.response.headers }
        : {}),
      body: detailedResponse?.response.body ?? responseBody,
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
          : Array.isArray(payload.sectionStatuses)
            ? payload.sectionStatuses
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
  const exploredRate = readNumberCandidate(payload, ["exploredRate"]) ?? 0;
  const inProgressRate = readNumberCandidate(payload, ["inProgressRate"]) ?? 0;
  const notStartedRate = readNumberCandidate(payload, ["notStartedRate"]) ?? 0;
  const passedRate = readNumberCandidate(payload, ["passedRate"]) ?? 0;
  const failedRate = readNumberCandidate(payload, ["failedRate"]) ?? 0;
  const notInitiatedRate = readNumberCandidate(payload, ["notInitiatedRate"]) ?? 0;
  const hasExplicitRates =
    exploredRate > 0 ||
    inProgressRate > 0 ||
    notStartedRate > 0 ||
    passedRate > 0 ||
    failedRate > 0 ||
    notInitiatedRate > 0;

  if (
    steps.length === 0 &&
    (explicitPercent ?? 0) === 0 &&
    (explicitCompleted ?? 0) === 0 &&
    (explicitTotal ?? 0) === 0 &&
    !hasExplicitRates
  ) {
    return null;
  }

  const stepsCompleted = explicitCompleted ?? steps.filter((step) => step.completed).length;
  const stepsTotal = explicitTotal ?? steps.length;
  const percentComplete =
    explicitPercent ??
    (stepsTotal > 0 ? Math.round((stepsCompleted / stepsTotal) * 100) : 0);

  return {
    percentComplete,
    stepsCompleted,
    stepsTotal,
    steps,
    exploredRate,
    inProgressRate,
    notStartedRate,
    passedRate,
    failedRate,
    notInitiatedRate,
  };
}

function normalizeAggregateGuidedJourneyProgress(
  payload: unknown,
): AggregateGuidedJourneyProgress | null | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const avgExploredRate = readNumberCandidate(payload, ["avgExploredRate"]);
  const avgInProgressRate = readNumberCandidate(payload, ["avgInProgressRate"]);
  const avgNotStartedRate = readNumberCandidate(payload, ["avgNotStartedRate"]);
  const avgPassedRate = readNumberCandidate(payload, ["avgPassedRate"]);
  const avgFailedRate = readNumberCandidate(payload, ["avgFailedRate"]);
  const avgNotInitiatedRate = readNumberCandidate(payload, ["avgNotInitiatedRate"]);
  const rawSections = payload.aggSectionStatuses;

  if (
    avgExploredRate === null &&
    avgInProgressRate === null &&
    avgNotStartedRate === null &&
    avgPassedRate === null &&
    avgFailedRate === null &&
    avgNotInitiatedRate === null &&
    rawSections === undefined
  ) {
    return null;
  }

  if (!Array.isArray(rawSections)) {
    return undefined;
  }

  const aggSectionStatuses: AggregateGuidedJourneySectionStatus[] = [];
  for (const row of rawSections) {
    if (!isRecord(row)) {
      return undefined;
    }

    const sectionNumber = readNumberCandidate(row, ["number", "sectionNumber", "index"]);
    const title = readStringCandidate(row, ["name", "title", "sectionName"]);

    if (sectionNumber === null || title === null) {
      return undefined;
    }

    aggSectionStatuses.push({
      sectionNumber,
      title,
      status: normalizeStatusLabel(readStringCandidate(row, ["status", "sectionStatus"])),
      avgExploredRate: readNumberCandidate(row, ["avgExploredRate"]) ?? 0,
      avgInProgressRate: readNumberCandidate(row, ["avgInProgressRate"]) ?? 0,
      avgNotStartedRate: readNumberCandidate(row, ["avgNotStartedRate"]) ?? 0,
      avgPassedRate: readNumberCandidate(row, ["avgPassedRate"]) ?? 0,
      avgFailedRate: readNumberCandidate(row, ["avgFailedRate"]) ?? 0,
      avgNotInitiatedRate: readNumberCandidate(row, ["avgNotInitiatedRate"]) ?? 0,
      avgTimeSpentSeconds: readNumberCandidate(row, ["avgTimeSpent", "avgTimeSpentSeconds"]),
    });
  }

  return {
    avgExploredRate: avgExploredRate ?? 0,
    avgInProgressRate: avgInProgressRate ?? 0,
    avgNotStartedRate: avgNotStartedRate ?? 0,
    avgPassedRate: avgPassedRate ?? 0,
    avgFailedRate: avgFailedRate ?? 0,
    avgNotInitiatedRate: avgNotInitiatedRate ?? 0,
    aggSectionStatuses,
  };
}

function normalizeProgressSteps(rows: unknown[]): ParticipantProgress["steps"] {
  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }

    const stepId = readStringCandidate(row, ["id", "sectionId", "stepId", "taskId"]);
    const title = readStringCandidate(row, ["name", "title", "sectionName", "stepName", "taskName"]);
    const numericOrder = readNumberCandidate(row, ["number", "order", "index"]);
    const fallbackStepId =
      title !== null
        ? `${numericOrder ?? "section"}:${title}`
        : null;
    const normalizedStatus = normalizeStatusLabel(
      readStringCandidate(row, ["status", "sectionStatus", "stepStatus", "taskStatus"]),
    );
    if ((!stepId && !fallbackStepId) || !title) {
      return [];
    }

    const completed =
      readBooleanCandidate(row, ["completed", "isCompleted"]) ??
      isCompletedStatus(
        normalizedStatus,
        readNumberCandidate(row, ["status", "sectionStatus", "stepStatus", "taskStatus"]),
      );

    return [{
      stepId: stepId ?? fallbackStepId!,
      title,
      completed,
      status: normalizedStatus,
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
    case "explore":
    case "done":
    case "passed":
    case "success":
    case "verified":
      return true;
    default:
      return false;
  }
}

function normalizeStatusLabel(status: string | null): string | null {
  if (!status) {
    return null;
  }

  const trimmed = status.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function serializeGuidedJourneyResponseBody(body: unknown): string {
  try {
    return JSON.stringify(redactCloudShareAdminSupportValue(body));
  } catch {
    return String(body);
  }
}
