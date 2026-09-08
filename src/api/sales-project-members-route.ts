import type { getServices } from "@/composition";
import { createCloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";

export function createSalesProjectMemberSourceFactory(services: ReturnType<typeof getServices>) {
  return { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0]) => createCloudShareProjectMemberSource(services.cloudshareClientFactory.forConnection(connection, { scope: "customer_default", reason: "sales_project_member_preflight" })) };
}
