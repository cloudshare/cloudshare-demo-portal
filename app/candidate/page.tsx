import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { CandidateHome } from "@/web/candidate-home";
import { parseCandidateTaskRoute } from "@/web/candidate-task-route";

export default async function CandidatePage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; attemptId?: string; examId?: string }>;
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

  return <CandidateHome email={session.email} initialRoute={parseCandidateTaskRoute(await searchParams)} />;
}
