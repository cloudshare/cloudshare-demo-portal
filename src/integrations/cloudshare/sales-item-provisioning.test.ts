import { describe, expect, it, vi } from "vitest";
import { createCloudShareSalesItemProvisioningValidator, SalesItemProvisioningReadError, SalesItemProvisioningValidationError } from "./sales-item-provisioning";

const item = { id: "item-1", customerId: "certalis", name: "Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active", archivedAt: null, createdAt: new Date(), updatedAt: new Date() } as const;

describe("Sales Item provisioning revalidation", () => {
  it("blocks an Item whose current default Snapshot no longer supports its selected Region", async () => {
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

  it("wraps partial v3 resource reads with the typed cause and completed evidence", async () => {
    const values: Record<string, unknown> = {
      "/projects/project-1/blueprints": [{ id: "bp-1", name: "Blueprint" }],
      "/projects/project-1/blueprints/bp-1": { id: "bp-1", name: "Blueprint", createFromVersions: [{ id: "snapshot-1", name: "Default", isDefault: true, regions: ["region-1"] }] },
      "/projects/project-1/policies": [{ id: "policy-1", name: "Policy" }],
    };
    const cause = new Error("policy detail transport failed");
    const requestV3Detailed = vi.fn(async (spec: { path: string; method: string; schema: { parse(value: unknown): unknown } }) => {
      if (spec.path === "/projects/project-1/policies/policy-1") throw cause;
      return { data: spec.schema.parse(values[spec.path]), request: { method: spec.method, path: spec.path }, response: { status: 200, body: values[spec.path] } };
    });
    const validator = createCloudShareSalesItemProvisioningValidator({ requestV3Detailed } as never);
    await expect(validator.revalidate(item)).rejects.toMatchObject({ name: "SalesItemProvisioningReadError", cause, completedReads: expect.arrayContaining([expect.objectContaining({ integrationSurface: "cloudshare.v3.projects.blueprints" })]) } satisfies Partial<SalesItemProvisioningReadError>);
  });
});
