import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { CandidateHome } from "@/web/candidate-home";
import { getExpiredPortalLoginPath } from "@/auth/portal-return-target";

export default async function CandidatePage() {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session) {
    redirect(getExpiredPortalLoginPath("/candidate") ?? "/login");
  }
  if (session.role !== "candidate") {
    redirect(getPortalHomePath(session));
  }

  return <CandidateHome email={session.email} />;
}
