import { describe, expect, it } from "vitest";
import { projectOrdinaryLogFields } from "./ordinary-log-projection";

describe("ordinary path projection", () => {
  it.each([
    "/api/v4/trainings/TRN8b3Qp6/guided-journeys/GJ4m9Xs2",
    "/api/v4/projects/PRJ6f8K2/experiences/EXP7v2Nc5",
    "/api/v4/trainings/TRN3q6Wp8/properties/PROP9k2Ls5",
    "/api/v3/projects/PRJ2x8Kd4/blueprints/BP7m3Qv9/policies/POL5r1Ts6",
    "/api/v3/envs/ENV9r4Tk2/actions/getextended",
    "/sales/SAL4p8Mx2/participants",
    "/v4/ZXQ8f2Lm5/CHD4p7Nv1",
  ])("does not leak unrecognized route segments: %s", (path) => {
    const projected = projectOrdinaryLogFields({ path });
    for (const segment of path.split("/").filter((part) => /\d/.test(part) && !/^v[34]$/.test(part))) {
      expect(projected.path).not.toContain(segment);
    }
    expect(projected.path).toMatch(/^\/(?:api\/)?v[34]\/(?:\[REDACTED_ROUTE\]|[a-z-]+(?:\/\[REDACTED_ROUTE\])?)$|^\/\[REDACTED_ROUTE\]$/);
  });

  it("preserves safe static allowlisted roots", () => {
    expect(projectOrdinaryLogFields({ path: "/api/v4/oauth/token" }).path).toBe("/api/v4/oauth/token");
    expect(projectOrdinaryLogFields({ path: "/api/v3/envs/actions/getextended" }).path).toBe("/api/v3/envs/actions/getextended");
  });

  it("never projects provider identifier keys, including under externalIds", () => {
    const projected = projectOrdinaryLogFields({
      customerId: "customer-portal-1", examAttemptId: "attempt-portal-1",
      environmentId: "MicaOrbit", trainingId: "CobaltRiver", participantId: "CedarComet",
      projectId: "AmberHarbor", blueprintId: "JadePinnacle", policyId: "SilverGrove",
      regionId: "MarbleVale", experienceId: "IndigoBrook", teamId: "SaffronPeak",
      externalIds: {
        environmentId: "MicaOrbit", environmentExternalId: "CobaltRiver", trainingId: "CedarComet",
        participantId: "AmberHarbor", projectId: "JadePinnacle", blueprintId: "SilverGrove",
        policyId: "MarbleVale", regionId: "IndigoBrook", experienceId: "SaffronPeak", teamId: "VioletMeadow",
        customerId: "customer-portal-1", examAttemptId: "attempt-portal-1",
      },
    });
    expect(projected).toEqual({
      customerId: "customer-portal-1", examAttemptId: "attempt-portal-1",
      externalIds: { customerId: "customer-portal-1", examAttemptId: "attempt-portal-1" },
    });
  });

  it.each([
    "/projects/MicaOrbit/blueprints/CobaltRiver", "/guided-journey/CedarComet",
    "/trainings/AmberHarbor/participants", "/envs/JadePinnacle/actions/extend",
    "/sales/SilverGrove/participants", "/experiences/MarbleVale", "/unrecognised/IndigoBrook",
  ])("redacts opaque non-versioned CloudShare paths: %s", (path) => {
    expect(projectOrdinaryLogFields({ path }).path).toMatch(/\[REDACTED_ROUTE\]$/);
  });
});
