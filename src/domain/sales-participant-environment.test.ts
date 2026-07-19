import { expect, it } from "vitest";
import { projectSalesParticipantEnvironment, projectSalesParticipantRosterEnvironment } from "./sales-participant-environment";
it("maps only exact documented v3 environment status codes", () => {
  expect(projectSalesParticipantEnvironment(7, new Date("2026-07-19T10:00:00Z"))).toMatchObject({ dimension: "cloudshare_environment", value: "Taking a Snapshot", source: "cloudshare_v3_environment" });
  expect(projectSalesParticipantEnvironment(6, new Date())).toMatchObject({ value: null, source: "not_observed" });
});

it("keeps the documented v4 Sales roster environment state distinct from v3 observation", () => {
  expect(projectSalesParticipantRosterEnvironment("Deleted", new Date("2026-07-19T10:00:00Z"))).toEqual({ dimension: "cloudshare_environment", value: "Deleted", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-19T10:00:00.000Z" });
});
