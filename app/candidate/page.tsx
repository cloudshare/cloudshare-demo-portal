import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { CandidateHome } from "@/web/candidate-home";

export default async function CandidatePage() {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session) {
    redirect("/login");
  }
  if (session.role !== "candidate") {
    redirect("/admin");
  }

  return <CandidateHome email={session.email} />;
}
