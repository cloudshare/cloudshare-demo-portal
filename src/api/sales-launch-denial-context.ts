import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesParticipantLaunchLink } from "@/domain/sales-participant-launch-link";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesSessionParticipantRepository } from "@/domain/sales-session-participant";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import { createCloudShareSalesDelivery, type SalesDelivery, type SalesProContact } from "@/integrations/cloudshare/sales-delivery";
import { projectCloudShareFailureContext, projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";

export interface SalesLaunchDenialContext {
  readonly salesPros: readonly SalesProContact[];
  readonly invitation: { readonly status: "sent" | "notSent"; readonly lastInvitedAt: string | null; readonly invitedBy: string | null };
}
export interface SalesLaunchDenialContextResolver { resolve(link: SalesParticipantLaunchLink, correlationId: string): Promise<SalesLaunchDenialContext | null>; }

export function createSalesLaunchDenialContextResolver(deps: {
  readonly sessions: Pick<SalesDemoSessionRepository, "findById">;
  readonly participants: SalesSessionParticipantRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly cloudshare: Pick<CloudShareClientFactory, "forConnection">;
  readonly deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): Pick<SalesDelivery, "listSalesPros"> };
  readonly diagnostics?: DiagnosticRecorder;
}): SalesLaunchDenialContextResolver {
  return { async resolve(link, correlationId) {
    const session = await deps.sessions.findById?.(link.customerId, link.salesDemoSessionId);
    const participant = session ? (await deps.participants.list(link.customerId, session.id)).find((row) => row.id === link.salesSessionParticipantId) : undefined;
    if (!session || !participant) return null;
    const fallback = [{ name: session.salesProDisplayName, email: session.salesProEmail, type: "mainSalesPro" as const }];
    let salesPros: readonly SalesProContact[] = fallback;
    try {
      const connection = await deps.connections.findByCustomerId(link.customerId);
      if (!connection) throw new Error("CloudShare Connection unavailable");
      const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery(deps.cloudshare.forConnection(connection, { scope: "customer_default", correlationId, reason: "unanchored_support_read" }));
      const result = await delivery.listSalesPros(session.cloudShareSalesExperienceId);
      salesPros = result.salesPros.length > 0 ? result.salesPros : fallback;
    } catch (error) {
      const provider = error && typeof error === "object" && "context" in error ? (error as { context?: Record<string, unknown> }).context : undefined;
      const evidence = projectCloudShareFailureEvidence(error) ?? projectCloudShareFailureContext(provider);
      const oauthFailure = evidence?.request === null && evidence.response === null;
      const status = typeof provider?.responseStatus === "number" ? provider.responseStatus : typeof provider?.status === "number" ? provider.status : undefined;
      await deps.diagnostics?.record({ source: "sales-participant-launch", operation: "sales.demo_session.participant_launch.recovery_contacts", outcome: "failure", customerId: link.customerId, actor: { type: "anonymous" }, subject: { type: "sales_session_participant", id: participant.id }, message: "Sales launch recovery contacts fell back to the persisted main Sales Pro.", correlationId, ...(evidence ? { request: evidence.request as Record<string, unknown> | null, response: evidence.response as Record<string, unknown> | null } : {}), details: { integrationSurface: typeof provider?.integrationSurface === "string" ? provider.integrationSurface : "cloudshare.v4.sales.sales_pros", failureMode: provider?.failureMode ?? (status !== undefined ? "http_failure" : error instanceof Error ? error.name : "provider_failure"), ...(oauthFailure && status !== undefined ? { status } : {}) } });
    }
    return { salesPros, invitation: { status: participant.invitationStatus, lastInvitedAt: participant.lastInvitedAt?.toISOString() ?? null, invitedBy: participant.invitedBy } };
  } };
}
