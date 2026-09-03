import { describe, expect, it } from "vitest";
import { projectOrdinaryLogFields } from "./ordinary-log-projection";

describe("ordinary path projection", () => {
  it.each([
    "/api/v4/trainings/training-secret/guided-journeys/journey-secret",
    "/api/v4/projects/project-secret/experiences/experience-secret",
    "/api/v4/trainings/training-secret/properties/student-secret",
    "/api/v3/projects/project-secret/blueprints/blueprint-secret/policies/policy-secret",
    "/api/v3/envs/environment-secret/actions/getextended",
    "/sales/sales-secret/participants",
    "/v4/secret-marker-unknown-route",
  ])("does not leak unrecognized route segments: %s", (path) => {
    const projected = projectOrdinaryLogFields({ path });
    expect(projected.path).not.toContain("secret");
    expect(projected.path).toMatch(/^\/(?:api\/)?v[34]\/(?:\[REDACTED_ROUTE\]|[a-z-]+(?:\/\[REDACTED_ROUTE\])?)$|^\/sales\/\[REDACTED_ROUTE\]$/);
  });

  it("preserves safe static allowlisted roots", () => {
    expect(projectOrdinaryLogFields({ path: "/api/v4/oauth/token" }).path).toBe("/api/v4/oauth/token");
    expect(projectOrdinaryLogFields({ path: "/api/v3/envs/actions/getextended" }).path).toBe("/api/v3/envs/actions/getextended");
  });
});
