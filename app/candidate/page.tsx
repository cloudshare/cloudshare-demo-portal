import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { CandidateHome } from "@/web/candidate-home";
import { parseCandidateTaskRoute } from "@/web/candidate-task-route";
import { getExpiredPortalLoginPath, getSafePortalTargetFromSearchParams } from "@/auth/portal-return-target";

type CandidatePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CandidatePage({ searchParams }: CandidatePageProps) {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const params = (await searchParams) ?? {};
  const session = await getPortalSession(services, sessionId);
  if (!session) {
    redirect(getExpiredPortalLoginPath(getSafePortalTargetFromSearchParams("/candidate", params)) ?? "/login");
  }
  if (session.role !== "candidate") {
    redirect(getPortalHomePath(session));
  }

  return <CandidateHome email={session.email} initialRoute={parseCandidateTaskRoute(params)} />;
}
