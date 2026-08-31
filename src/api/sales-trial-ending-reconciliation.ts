import type { Services } from "@/composition";
import { handleEndSalesTrialOffering } from "@/api/sales-trial-offerings";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { createCloudShareSalesEnvironmentSource } from "@/integrations/cloudshare/sales-environment";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";

export function salesTrialEndingDeps(services: Services) {
  return {
    offerings: createPrismaSalesTrialOfferingRepository(services.prisma),
    items: { findById: async () => null },
    connections: services.cloudshareConnections,
    deliveryFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0]) =>
      createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection)) },
    salesEnvironmentFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0]) =>
      createCloudShareSalesEnvironmentSource(services.cloudshareClientFactory.forConnection(connection)) },
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
