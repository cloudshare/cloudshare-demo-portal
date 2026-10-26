import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
import type { Services } from "@/composition";
import { handleEndSalesTrialOffering } from "@/api/sales-trial-offerings";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { createCloudShareSalesEnvironmentModule } from "@/integrations/cloudshare/environment-observation";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";
import { createSalesTrialCloudShareObserver } from "@/api/sales-trial-cloudshare-diagnostics";

export function salesTrialEndingDeps(services: Services) {
  return {
    offerings: createPrismaSalesTrialOfferingRepository(services.prisma),
    items: createPrismaItemRepository(services.prisma),
    connections: services.cloudshareConnections,
    deliveryFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0], options?: Parameters<typeof services.cloudshareClientFactory.forConnection>[1]) =>
      createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection, options)) },
    salesEnvironmentFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0], options?: Parameters<typeof services.cloudshareClientFactory.forConnection>[1]) =>
      createCloudShareSalesEnvironmentModule(services.cloudshareClientFactory.forConnection(connection, options)) },
    cloudshareObserver: ({ customerId, actor, correlationId, offeringId }: { customerId: string; actor: import("@/domain/diagnostic-log").DiagnosticActor; correlationId: string; offeringId: string }) => {
      const observer = createSalesTrialCloudShareObserver({ diagnostics: services.diagnosticRecorder, customerId, actor, correlationId, source: "sales-trial-offerings", subject: { type: "sales_trial_offering", id: offeringId }, externalIds: { offeringId } });
      return observer;
    },
    diagnostics: services.diagnosticRecorder,
    audit: services.audit,
  };
}

export async function reconcileEndingSalesTrialOfferings(services: Services, customerId?: string): Promise<void> {
  const deps = salesTrialEndingDeps(services);
  const offerings = await deps.offerings.listEnding?.(customerId) ?? [];
  for (const offering of offerings) {
    await handleEndSalesTrialOffering(deps, {
      customerId: offering.customerId,
      id: offering.id,
      actor: { type: "system" },
    });
  }
}
