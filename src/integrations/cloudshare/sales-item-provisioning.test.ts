import { describe, expect, it, vi } from "vitest";
import { createCloudShareSalesItemProvisioningValidator, SalesItemProvisioningValidationError } from "./sales-item-provisioning";

const item = { id: "item-1", customerId: "certalis", name: "Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active", archivedAt: null, createdAt: new Date(), updatedAt: new Date() } as const;

describe("Sales Item provisioning revalidation", () => {
  it("blocks a Demo Item whose current default Snapshot no longer supports its selected Region", async () => {
    const values: Record<string, unknown> = {
      "/projects/project-1/blueprints": [{ id: "bp-1", name: "Blueprint" }],
      "/projects/project-1/blueprints/bp-1": { id: "bp-1", name: "Blueprint", createFromVersions: [{ id: "snapshot-1", name: "Default", isDefault: true, regions: ["region-2"] }] },
      "/projects/project-1/policies": [{ id: "policy-1", name: "Policy" }],
      "/projects/project-1/policies/policy-1": { id: "policy-1", name: "Policy", storageLeaseMinutes: 60 },
    };
    const requestV3Detailed = vi.fn(async (spec: { path: string; method: string; schema: { parse(value: unknown): unknown } }) => ({ data: spec.schema.parse(values[spec.path]), request: { method: spec.method, path: spec.path }, response: { status: 200, body: values[spec.path] } }));
    const validator = createCloudShareSalesItemProvisioningValidator({ requestV3Detailed } as never);
    await expect(validator.revalidate(item)).rejects.toBeInstanceOf(SalesItemProvisioningValidationError);
  });
});
