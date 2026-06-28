import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  authorizeCandidateExamAttemptAccess,
  buildCandidateExamAttemptAccessDeps,
} from "@/api/candidate-exam-attempt-access";
import {
  buildCandidateRuntimeDiagnosticsDeps,
  handleRecordCandidateLabLaunchFailure,
  type CandidateLabLaunchAttemptedAction,
  type CandidateLabLaunchFailureReason,
} from "@/api/candidate-runtime-diagnostics";

function isAttemptedAction(value: unknown): value is CandidateLabLaunchAttemptedAction {
  return value === "enter" || value === "resume" || value === "open";
}

function isFailureReason(value: unknown): value is CandidateLabLaunchFailureReason {
  return value === "popup_blocked" || value === "open_failed";
}

export async function POST(request: Request) {
  const services = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = body as {
    examAttemptId?: unknown;
    attemptedAction?: unknown;
    failureReason?: unknown;
    candidateMessage?: unknown;
    attemptStatus?: unknown;
  };

  const examAttemptId =
    typeof parsed.examAttemptId === "string" ? parsed.examAttemptId.trim() : "";
  if (!examAttemptId) {
    return NextResponse.json({ error: "examAttemptId is required" }, { status: 400 });
  }
  if (!isAttemptedAction(parsed.attemptedAction)) {
    return NextResponse.json({ error: "attemptedAction is required" }, { status: 400 });
  }
  if (!isFailureReason(parsed.failureReason)) {
    return NextResponse.json({ error: "failureReason is required" }, { status: 400 });
  }
  if (
    typeof parsed.candidateMessage !== "string" ||
    parsed.candidateMessage.trim().length === 0
  ) {
    return NextResponse.json({ error: "candidateMessage is required" }, { status: 400 });
  }

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const accessDeps = buildCandidateExamAttemptAccessDeps(services);
  const session = await accessDeps.getPortalSession(sessionId);
  const access = await authorizeCandidateExamAttemptAccess(accessDeps, {
    sessionId,
    examAttemptId,
  });
  if (!access.ok) {
    return NextResponse.json(access.response.body, { status: access.response.status });
  }

  const response = await handleRecordCandidateLabLaunchFailure(
    buildCandidateRuntimeDiagnosticsDeps(services),
    {
      attempt: access.attempt,
      candidateId: access.session.userId,
      candidateEmail: session?.email ?? null,
      attemptedAction: parsed.attemptedAction,
      failureReason: parsed.failureReason,
      candidateMessage: parsed.candidateMessage.trim(),
      reportedAttemptStatus:
        typeof parsed.attemptStatus === "string" ? parsed.attemptStatus : null,
    },
  );

  return NextResponse.json(response.body, { status: response.status });
}
