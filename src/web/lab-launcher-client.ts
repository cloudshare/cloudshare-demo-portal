type AttemptStatus = "ready" | "in_progress" | "suspended" | "completed";

export type CandidateLabStatus = {
  examAttemptId: string;
  examTitle: string;
  timeLimitMinutes: number;
  status: AttemptStatus;
  scheduledFor: string | null;
};

interface JsonResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<JsonResponse>;

export async function loadCandidateLabStatus(
  fetchImpl: FetchLike,
  examAttemptId: string,
): Promise<CandidateLabStatus> {
  const response = await fetchImpl(
    `/api/exam/status?examAttemptId=${encodeURIComponent(examAttemptId)}`,
    { cache: "no-store" },
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readError(json, "Failed to load exam details."));
  }
  return json as CandidateLabStatus;
}

export async function preflightLabAction(
  fetchImpl: FetchLike,
  input: {
    examAttemptId: string;
    action: "enter" | "resume";
  },
):
  Promise<
    | { kind: "proceed"; labStatus: CandidateLabStatus }
    | { kind: "completed"; labStatus: CandidateLabStatus; message: string }
    | { kind: "blocked"; labStatus: CandidateLabStatus; message: string }
  > {
  const labStatus = await loadCandidateLabStatus(fetchImpl, input.examAttemptId);

  if (labStatus.status === "completed") {
    return {
      kind: "completed",
      labStatus,
      message: "Examination complete.",
    };
  }

  const validStatus = input.action === "resume"
    ? labStatus.status === "suspended"
    : labStatus.status === "ready" || labStatus.status === "in_progress";

  if (!validStatus) {
    return {
      kind: "blocked",
      labStatus,
      message:
        input.action === "resume"
          ? "Exam resume is not available for this attempt."
          : "Exam entry is not available for this attempt.",
    };
  }

  return { kind: "proceed", labStatus };
}

export async function suspendLabAttempt(
  fetchImpl: FetchLike,
  examAttemptId: string,
):
  Promise<
    | { kind: "suspended"; message: string }
    | { kind: "completed"; labStatus: CandidateLabStatus; message: string }
    | { kind: "blocked"; labStatus: CandidateLabStatus | null; message: string }
  > {
  const response = await fetchImpl("/api/exam/suspend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ examAttemptId }),
  });

  if (response.ok) {
    return {
      kind: "suspended",
      message: "Lab suspended. You can resume your session when ready.",
    };
  }

  const detail = await response.json().catch(() => ({}));
  if (response.status === 409) {
    const labStatus = await loadCandidateLabStatus(fetchImpl, examAttemptId).catch(() => null);
    if (labStatus?.status === "completed") {
      return {
        kind: "completed",
        labStatus,
        message: "Examination complete.",
      };
    }
    return {
      kind: "blocked",
      labStatus,
      message: readError(detail, "Exam suspend is not available for this attempt."),
    };
  }

  throw new Error(readError(detail, `suspend failed (${response.status})`));
}

function readError(json: unknown, fallback: string): string {
  if (typeof json === "object" && json !== null && typeof (json as { error?: unknown }).error === "string") {
    return (json as { error: string }).error;
  }
  return fallback;
}
