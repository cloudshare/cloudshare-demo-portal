export interface CandidateDashboardData {
  readonly exams: Array<{
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly timeLimitMinutes: number;
    readonly scoreRetrievalEnabled: boolean;
  }>;
  readonly attempts: Array<{
    readonly id: string;
    readonly examId: string;
    readonly scheduledFor: string | null;
    readonly status:
      | "scheduled"
      | "ready"
      | "in_progress"
      | "suspended"
      | "completed"
      | "expired";
  }>;
}

export interface ScheduleCandidateExamResult {
    readonly attempt: {
      readonly id: string;
      readonly examId: string;
      readonly scheduledFor: string;
      readonly status: "scheduled" | "ready";
    };
  readonly coldStartLikely: boolean;
  readonly correlationId: string;
}

export function shouldShowPublishedExamList(input: {
  readonly loading: boolean;
  readonly examCount: number;
}): boolean {
  return !input.loading && input.examCount > 0;
}

export function shouldShowNoPublishedExams(input: {
  readonly loading: boolean;
  readonly examCount: number;
}): boolean {
  return !input.loading && input.examCount === 0;
}

interface JsonResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<JsonResponse>;

export async function loadCandidateDashboard(fetchImpl: FetchLike): Promise<CandidateDashboardData> {
  const response = await fetchImpl("/api/candidate/exams");
  const json = await response.json();
  assertNoLoginUrl(json);
  if (!response.ok) {
    throw new Error(readError(json, "Failed to load candidate dashboard"));
  }
  return json as CandidateDashboardData;
}

export async function scheduleCandidateExam(
  fetchImpl: FetchLike,
  input: { examId: string; scheduledFor: string },
): Promise<ScheduleCandidateExamResult> {
  const response = await fetchImpl("/api/candidate/exams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  assertNoLoginUrl(json);
  if (!response.ok) {
    throw new Error(readError(json, "Failed to schedule exam"));
  }
  return json as ScheduleCandidateExamResult;
}

function readError(json: unknown, fallback: string): string {
  if (typeof json === "object" && json !== null && typeof (json as { error?: unknown }).error === "string") {
    const error = (json as { error: string }).error;
    const correlationId = (json as { correlationId?: unknown }).correlationId;
    return typeof correlationId === "string" && correlationId.length > 0
      ? `${error} Reference ID: ${correlationId}.`
      : error;
  }
  return fallback;
}

function assertNoLoginUrl(json: unknown): void {
  if (containsLoginUrl(json)) {
    throw new Error("Candidate API response must not contain loginUrl.");
  }
}

function containsLoginUrl(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsLoginUrl);
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.entries(value).some(([key, child]) => key === "loginUrl" || containsLoginUrl(child));
}
