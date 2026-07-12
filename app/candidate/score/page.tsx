import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { getPortalSessionServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { ScoreDisplay } from "@/web/score-display";
import { pageShellStyle } from "@/web/page-shell";
import { PortalPageHeader } from "@/web/portal-page-header";

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
    redirect("/login");
  }
  if (session.role !== "candidate") {
    redirect("/admin");
  }

  const { examAttemptId } = await searchParams;

  if (!examAttemptId) {
    return (
      <main style={pageShellStyle}>
        <PortalPageHeader
          eyebrow="Candidate score"
          title="Session complete"
          description="Review your final Guided Journey result and any CloudShare scoring limitations for this ExamAttempt."
          email={session.email}
        />
        <p style={{ color: "#555" }}>Missing examAttemptId.</p>
      </main>
    );
  }

  return (
    <main style={pageShellStyle}>
      <ScoreDisplay examAttemptId={examAttemptId} email={session.email} />
    </main>
  );
}
