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

describe("Sales Trial Offering unpublish route composition", () => {
  it("passes diagnostics and the audit writer into unpublication", () => {
    const routeSource = readFileSync(
      "app/api/sales/trial-offerings/[id]/unpublish/route.ts",
      "utf8",
    );

    expect(routeSource).toContain("diagnostics: services.diagnosticRecorder");
    expect(routeSource).toContain("audit: services.audit");
  });
});
