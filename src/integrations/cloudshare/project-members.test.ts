import { describe, expect, it, vi } from "vitest";
import { createCloudShareProjectMemberSource } from "./project-members";

describe("CloudShare Project member source", () => {
  it("reads only active members for one Project through the GUI v3 contract", async () => {
    const requestV3Detailed = vi.fn(async (spec: { method: string; path: string; query: Record<string, string>; schema: { parse(value: unknown): unknown } }) => ({
      data: spec.schema.parse({ Rows: [{ Email: "rep@certalis.demo", FirstName: "Sales", LastName: "Rep" }] }),
      request: { method: spec.method, path: spec.path, query: spec.query },
      response: { status: 200, body: { Rows: [{ Email: "rep@certalis.demo", FirstName: "Sales", LastName: "Rep" }] } },
    }));

    const result = await createCloudShareProjectMemberSource({ requestV3Detailed } as never).listActiveProjectMembers("project-1");

    expect(requestV3Detailed).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET", path: "/users",
      query: { projectUsers: "true", status: "active", projectId: "project-1", getRows: "true" },
    }));
    expect(result.members).toEqual([{ email: "rep@certalis.demo", displayName: "Sales Rep" }]);
    expect(result.request).toMatchObject({ query: { projectId: "project-1" } });
  });
});
