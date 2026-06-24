import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleGetAdminExamAttemptDiagnosticDrilldown } from "@/api/admin-exam-attempt-diagnostics";
import type { AdminExamAttemptDiagnosticContextRecord } from "@/domain/admin-exam-attempt-diagnostics";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";

export async function GET(
  _request: Request,
  context: { params: Promise<{ examAttemptId: string }> },
) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { examAttemptId } = await context.params;
  const response = await handleGetAdminExamAttemptDiagnosticDrilldown(
    {
      contexts: services.adminExamAttemptDiagnosticContexts,
      diagnostics: services.diagnostics,
      logger: services.logger,
      refreshEnvironmentStatus: (drilldownContext) =>
        refreshCloudShareEnvironmentStatus(services, drilldownContext),
    },
    { customerId: session.customerId, examAttemptId },
  );

  return NextResponse.json(response.body, { status: response.status });
}

async function refreshCloudShareEnvironmentStatus(
  services: ReturnType<typeof getServices>,
  context: AdminExamAttemptDiagnosticContextRecord,
): Promise<void> {
  const environmentExternalId = context.environmentExternalId ?? context.environmentId;
  if (!environmentExternalId) {
    return;
  }

  const connection = await services.cloudshareConnections.findByCustomerId(context.customerId);
  if (!connection) {
    await services.diagnosticRecorder.record({
      source: "admin-diagnostics",
      level: "warn",
      operation: "cloudshare.environment.reconcile",
      outcome: "failure",
      customerId: context.customerId,
      candidateEmail: context.candidateEmail,
      examId: context.examId,
      examAttemptId: context.attemptId,
      message: "CloudShare environment status refresh skipped: missing CloudShare Connection",
      externalIds: { environmentExternalId },
      details: {
        integrationSurface: "cloudshare.v3.env",
        refreshedBy: "admin_exam_attempt_diagnostics",
        reason: "missing_cloudshare_connection",
      },
    });
    return;
  }

  const source = createCloudShareEnvironmentSource(
    services.cloudshareClientFactory.forConnection(connection),
  );
  const snapshot = await source.getEnvironmentState(environmentExternalId);
  const observedAt = new Date();
  if (snapshot) {
    await services.environments.save({
      environmentExternalId,
      status: snapshot.status,
      observedAt,
    });
  }

  await services.diagnosticRecorder.record({
    source: "admin-diagnostics",
    operation: "cloudshare.environment.reconcile",
    outcome: "success",
    customerId: context.customerId,
    candidateEmail: context.candidateEmail,
    examId: context.examId,
    examAttemptId: context.attemptId,
    actor: { type: "admin", id: null, email: null },
    subject: { type: "exam_attempt", id: context.attemptId },
    message: snapshot
      ? "CloudShare environment status refreshed"
      : "CloudShare environment status refresh found no environment",
    externalIds: {
      environmentExternalId,
      ...(snapshot?.status ? { environmentStatus: snapshot.status } : {}),
    },
    request: {
      method: "GET",
      path: "/api/v3/envs/{envId}",
    },
    response: {
      status: snapshot ? 200 : 404,
      body: snapshot ? { status: snapshot.status } : null,
    },
    details: {
      integrationSurface: "cloudshare.v3.env",
      refreshedBy: "admin_exam_attempt_diagnostics",
      observedAt: observedAt.toISOString(),
    },
  });
}
