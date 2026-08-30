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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ offeringId: string }> },
) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);

  if (!session || session.role !== "sales_trial_participant") {
    return new NextResponse("Unauthorized.", {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const offeringId = (await params).offeringId;
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
