import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { ScoreDisplay } from "@/web/score-display";
import { pageShellStyle } from "@/web/page-shell";
import { getExpiredPortalLoginPath } from "@/auth/portal-return-target";
import { ProtectedPortalFallback } from "@/web/protected-portal-fallback";

/**
 * Candidate score page. Shown after the lab session completes.
 * Renders the Guided Journey ScoreResult for the exam attempt, including
 * CloudShare's known scoring limitations surfaced inline.
 */
export default async function CandidateScorePage({
  searchParams,
}: {
  searchParams: Promise<{ examAttemptId?: string }>;
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

  const { examAttemptId } = await searchParams;

  if (!examAttemptId) {
    return (
      <ProtectedPortalFallback title="Session complete" message="Missing examAttemptId." />
    );
  }

  return (
    <main style={pageShellStyle}>
      <ScoreDisplay examAttemptId={examAttemptId} email={session.email} />
    </main>
  );
}
