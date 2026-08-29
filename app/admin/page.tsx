import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { AdminConsole } from "@/web/admin-console";
import { parseAdminConsoleRouteState } from "@/web/admin-shell-route";

interface AdminPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  const routeState = parseAdminConsoleRouteState((await searchParams) ?? {});

  if (!session) {
    redirect("/login");
  }
  if (session.role !== "admin") {
    redirect(getPortalHomePath(session));
  }
  if (session.workspace === "sales") {
    redirect("/sales");
  }

  return (
    <AdminConsole
      key={`${routeState.tab}:${routeState.examView}:${routeState.examId ?? ""}:${routeState.cohortSessionId ?? ""}:${routeState.supportView}:${JSON.stringify(routeState.diagnosticFilters)}`}
      email={session.email}
      initialTab={routeState.tab}
      initialExamView={routeState.examView}
      initialExamId={routeState.examId}
      initialCohortSessionId={routeState.cohortSessionId}
      initialSupportView={routeState.supportView}
      initialDiagnosticFilters={routeState.diagnosticFilters}
    />
  );
}
