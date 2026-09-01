import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  buildEnterSalesTrialOfferingBlockedPage,
  handleEnterSalesTrialOffering,
} from "@/api/sales-trial-enrollment";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { createPrismaSalesTrialEnrollmentRepository } from "@/persistence/prisma-sales-trial-enrollment-repository";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";
import { handleEndSalesTrialOffering } from "@/api/sales-trial-offerings";
import { salesTrialEndingDeps } from "@/api/sales-trial-ending-reconciliation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ offeringId: string }> },
) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  const offeringId = (await params).offeringId;

  if (!session || session.role !== "sales_trial_participant") {
    const correlationId = randomUUID();
    const customerId = session?.customerId ?? null;
    await Promise.allSettled([
      services.diagnosticRecorder?.record({
        source: "sales-trial-enter-route",
        operation: "sales_trial.offering.enter.denied",
        outcome: "failure",
        level: "warn",
        customerId,
        actor: session ? { type: "portal_session" } : { type: "anonymous" },
        subject: { type: "sales_trial_offering", id: offeringId },
        correlationId,
        message:
          "Sales Trial offering entry denied before launch because the portal session was missing or not authorized.",
        details: {
          integrationSurface: "portal.sales_trial",
          failureMode: "unauthorized_portal_session",
        },
      }),
      services.audit?.write({
        id: randomUUID(),
        occurredAt: new Date(),
        customerId,
        actorType: session ? "portal_session" : "anonymous",
        actorId: null,
        actorEmail: null,
        action: "sales_trial.offering.enter.denied",
        subjectType: "sales_trial_offering",
        subjectId: offeringId,
        outcome: "denied",
        correlationId,
        details: {
          operation: "sales_trial.offering.enter.denied",
          integrationSurface: "portal.sales_trial",
          failureMode: "unauthorized_portal_session",
        },
        error: "Unauthorized.",
      }),
    ]);
    return new NextResponse("Unauthorized.", {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const response = await handleEnterSalesTrialOffering(
    {
      offerings: createPrismaSalesTrialOfferingRepository(services.prisma),
      enrollments: createPrismaSalesTrialEnrollmentRepository(services.prisma),
      connections: services.cloudshareConnections,
      deliveryFactory: {
        forConnection: (connection) =>
          createCloudShareSalesDelivery(
            services.cloudshareClientFactory.forConnection(connection),
          ),
      },
      diagnostics: services.diagnosticRecorder,
      audit: services.audit,
      reconcileEnding: ({ customerId, offeringId, actor }) =>
        handleEndSalesTrialOffering(salesTrialEndingDeps(services), {
          customerId,
          id: offeringId,
          actor,
        }).then(() => undefined),
    },
    {
      customerId: session.customerId,
      offeringId,
      participant: {
        userId: session.userId,
        email: session.email,
        firstName: session.firstName ?? "",
        lastName: session.lastName ?? "",
      },
      actor: {
        type: "sales_trial_participant",
        id: session.userId,
        email: session.email,
      },
    },
  );

  if (response.status >= 400) {
    return new NextResponse(
      buildEnterSalesTrialOfferingBlockedPage({
        offeringId,
        status: response.status,
        message: response.body?.error ?? "This Sales Trial launch is unavailable.",
      }),
      {
        status: response.status,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
      },
    );
  }

  return new NextResponse(null, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      location: response.redirect ?? "/sales-trial",
    },
  });
}
