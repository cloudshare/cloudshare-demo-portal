import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { CandidateLabShell } from "@/web/candidate-lab-shell";
import { getExpiredPortalLoginPath } from "@/auth/portal-return-target";
import { ProtectedPortalFallback } from "@/web/protected-portal-fallback";

/**
 * Minimal candidate lab page. Reads the ExamAttempt from the query string and
 * renders the launcher. The entitlement decision is made server-side by the
 * launch route, never here.
 */
export default async function CandidateLabPage({
  searchParams,
}: {
  searchParams: Promise<{ examAttemptId?: string; attemptStatus?: string }>;
}) {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session) {
    redirect(getExpiredPortalLoginPath("/candidate") ?? "/login");
  }
  if (session.role !== "candidate") {
    redirect(getPortalHomePath(session));
  }

  const { examAttemptId, attemptStatus } = await searchParams;

  if (!examAttemptId) {
    return (
      <ProtectedPortalFallback title="Launch lab" message="Missing examAttemptId." />
    );
  }

  const initialAttemptStatus =
    attemptStatus === "ready" ||
    attemptStatus === "in_progress" ||
    attemptStatus === "suspended" ||
    attemptStatus === "completed"
      ? attemptStatus
      : "ready";

  return (
    <CandidateLabShell
      email={session.email}
      examAttemptId={examAttemptId}
      initialAttemptStatus={initialAttemptStatus}
    />
  );
}
