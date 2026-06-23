import type { AttemptStatus } from "./lab-launcher-client";

interface JsonResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<JsonResponse>;

export type LabLaunchAttemptedAction = "enter" | "resume" | "open";
export type LabLaunchFailureReason = "popup_blocked" | "open_failed";

export function formatLaunchError(error: unknown, attemptStatus: AttemptStatus): string {
  const fallback = error instanceof Error ? error.message : "launch failed";
  if (typeof fallback !== "string") {
    return "launch failed";
  }
  if (!/popup blocked|could not be opened/i.test(fallback)) {
    return fallback;
  }
  return attemptStatus === "in_progress"
    ? "The exam window was blocked by your browser. Allow popups for this site, then use Open exam window to retry."
    : "The exam window was blocked by your browser. Allow popups for this site, then try again.";
}

export async function reportCandidateLabLaunchFailure(
  fetchImpl: FetchLike,
  input: {
    readonly examAttemptId: string;
    readonly attemptedAction: LabLaunchAttemptedAction;
    readonly attemptStatus: AttemptStatus;
    readonly failureReason: LabLaunchFailureReason;
    readonly candidateMessage: string;
  },
): Promise<void> {
  const response = await fetchImpl("/api/candidate/runtime-diagnostics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      examAttemptId: input.examAttemptId,
      attemptedAction: input.attemptedAction,
      attemptStatus: input.attemptStatus,
      failureReason: input.failureReason,
      candidateMessage: input.candidateMessage,
    }),
  });

  if (response.ok) {
    return;
  }

  const detail = await response.json().catch(() => ({}));
  throw new Error(readError(detail, `candidate runtime diagnostics failed (${response.status})`));
}

export async function describeAndReportLaunchFailure(
  fetchImpl: FetchLike,
  input: {
    readonly error: unknown;
    readonly examAttemptId: string;
    readonly attemptedAction: LabLaunchAttemptedAction;
    readonly attemptStatus: AttemptStatus;
  },
): Promise<string> {
  const candidateMessage = formatLaunchError(input.error, input.attemptStatus);
  const failureReason = isPopupBlockedError(input.error) ? "popup_blocked" : "open_failed";

  await reportCandidateLabLaunchFailure(fetchImpl, {
    examAttemptId: input.examAttemptId,
    attemptedAction: input.attemptedAction,
    attemptStatus: input.attemptStatus,
    failureReason,
    candidateMessage,
  }).catch(() => {
    // Diagnostics are best-effort. Candidate recovery must still render.
  });

  return candidateMessage;
}

function isPopupBlockedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /popup blocked|could not be opened/i.test(error.message)
  );
}

function readError(json: unknown, fallback: string): string {
  if (
    typeof json === "object" &&
    json !== null &&
    typeof (json as { error?: unknown }).error === "string"
  ) {
    return (json as { error: string }).error;
  }
  return fallback;
}
