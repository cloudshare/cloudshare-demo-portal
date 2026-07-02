export type AttemptStatus = "ready" | "in_progress" | "suspended" | "completed";

export type CandidateLabStatus = {
  examAttemptId: string;
  examTitle: string;
  timeLimitMinutes: number;
  openPeriodMinutes?: number;
  scoreRetrievalEnabled?: boolean;
  status: AttemptStatus;
  scheduledFor: string | null;
  openPeriodEndsAt?: string | null;
  openPeriodClosed?: boolean;
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
    if (response.status === 401) {
      throw new Error("Your portal session has expired. Log in again to continue.");
    }
    throw new Error(readError(json, "Failed to load exam details."));
  }
  return json as CandidateLabStatus;
}

export function readHeartbeatAttemptStatus(payload: unknown): AttemptStatus | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const attemptStatus = (payload as { attemptStatus?: unknown }).attemptStatus;
  return attemptStatus === "in_progress" ||
    attemptStatus === "suspended" ||
    attemptStatus === "completed"
    ? attemptStatus
    : null;
}

export async function preflightLabAction(
  fetchImpl: FetchLike,
  input: {
    examAttemptId: string;
    action: "enter" | "resume";
    now?: () => Date;
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

  if (labStatus.openPeriodClosed === true) {
    return {
      kind: "blocked",
      labStatus,
      message:
        input.action === "resume"
          ? "Exam resume is not available after the Exam open period has closed."
          : "Exam entry is not available after the Exam open period has closed.",
    };
  }

  if (
    input.action === "enter" &&
    labStatus.status === "ready" &&
    !isReadyAttemptEnterable(labStatus, input.now)
  ) {
    return {
      kind: "blocked",
      labStatus,
      message: "Exam entry is not available before the scheduled start time.",
    };
  }

  const validStatus = input.action === "resume"
    ? labStatus.status === "suspended" || labStatus.status === "in_progress"
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
    | { kind: "pending"; labStatus: CandidateLabStatus | null; message: string }
    | { kind: "completed"; labStatus: CandidateLabStatus; message: string }
    | { kind: "blocked"; labStatus: CandidateLabStatus | null; message: string }
  > {
  const response = await fetchImpl("/api/exam/suspend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ examAttemptId }),
  });
  const detail = await response.json().catch(() => ({}));

  if (response.status === 202) {
    const labStatus = await loadCandidateLabStatus(fetchImpl, examAttemptId).catch(() => null);
    return {
      kind: "pending",
      labStatus,
      message: readError(detail, "Suspend is still processing. Wait a few seconds, then retry."),
    };
  }

  if (response.ok) {
    return {
      kind: "suspended",
      message: "Lab suspended. You can resume your session when ready.",
    };
  }

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

export async function resumeLabAttempt(
  fetchImpl: FetchLike,
  examAttemptId: string,
): Promise<
  | { kind: "resumed"; disposition: "resumed" | "already_active" }
  | { kind: "pending"; labStatus: CandidateLabStatus | null; message: string }
  | { kind: "completed"; labStatus: CandidateLabStatus; message: string }
  | { kind: "blocked"; labStatus: CandidateLabStatus | null; message: string }
> {
  const response = await fetchImpl("/api/exam/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ examAttemptId }),
  });

  const detail = await response.json().catch(() => ({}));
  if (response.status === 202) {
    const labStatus = await loadCandidateLabStatus(fetchImpl, examAttemptId).catch(() => null);
    return {
      kind: "pending",
      labStatus,
      message: readError(
        detail,
        "CloudShare is still resuming your lab. Wait a few seconds, then retry Resume exam.",
      ),
    };
  }

  if (response.ok) {
    const disposition =
      typeof (detail as { resumeDisposition?: unknown }).resumeDisposition === "string"
        ? (detail as { resumeDisposition: "resumed" | "already_active" }).resumeDisposition
        : "resumed";
    return {
      kind: "resumed",
      disposition,
    };
  }

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
      message: readError(detail, "Exam resume is not available for this attempt."),
    };
  }

  const labStatus = await loadCandidateLabStatus(fetchImpl, examAttemptId).catch(() => null);
  if (labStatus?.openPeriodClosed === true) {
    return {
      kind: "blocked",
      labStatus,
      message: "Exam entry is not available after the Exam open period has closed.",
    };
  }
  if (labStatus?.status === "completed") {
    return {
      kind: "completed",
      labStatus,
      message: "Examination complete.",
    };
  }
  if (labStatus?.status === "in_progress") {
    return {
      kind: "resumed",
      disposition: "already_active",
    };
  }
  if (labStatus?.status === "suspended") {
    return {
      kind: "blocked",
      labStatus,
      message: readError(detail, "Exam resume is not available for this attempt."),
    };
  }

  throw new Error(readError(detail, `resume failed (${response.status})`));
}

function readError(json: unknown, fallback: string): string {
  if (typeof json === "object" && json !== null && typeof (json as { error?: unknown }).error === "string") {
    return (json as { error: string }).error;
  }
  return fallback;
}

function isReadyAttemptEnterable(
  labStatus: Pick<CandidateLabStatus, "status" | "scheduledFor">,
  now: (() => Date) | undefined,
): boolean {
  if (labStatus.status !== "ready" || !labStatus.scheduledFor) {
    return true;
  }

  const scheduledForMs = new Date(labStatus.scheduledFor).getTime();
  if (Number.isNaN(scheduledForMs)) {
    return true;
  }

  return scheduledForMs <= (now ?? (() => new Date()))().getTime();
}
