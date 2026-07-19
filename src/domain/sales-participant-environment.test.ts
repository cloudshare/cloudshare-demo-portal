import { expect, it } from "vitest";
import { projectSalesParticipantEnvironment } from "./sales-participant-environment";
it("maps only exact documented v3 environment status codes", () => {
  expect(projectSalesParticipantEnvironment(7, new Date("2026-07-19T10:00:00Z"))).toMatchObject({ dimension: "cloudshare_environment", value: "Taking a Snapshot", source: "cloudshare_v3_environment" });
  expect(projectSalesParticipantEnvironment(6, new Date())).toMatchObject({ value: null, source: "not_observed" });
});
