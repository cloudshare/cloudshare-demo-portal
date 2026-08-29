import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sales Trial Offering publish route composition", () => {
  it("passes CloudShare delivery, validator, and project-member factories into publication", () => {
    const routeSource = readFileSync(
      "app/api/sales/trial-offerings/[id]/publish/route.ts",
      "utf8",
    );

    expect(routeSource).toContain("deliveryFactory");
    expect(routeSource).toContain("itemProvisioningValidatorFactory");
    expect(routeSource).toContain("projectMemberSourceFactory");
    expect(routeSource).toContain("createCloudShareSalesDelivery");
    expect(routeSource).toContain("createCloudShareSalesItemProvisioningValidator");
    expect(routeSource).toContain("createCloudShareProjectMemberSource");
  });
});
