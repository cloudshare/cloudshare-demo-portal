import { expect, it } from "vitest";
import { isProjectableSalesParticipantRosterEnvironment, projectSalesParticipantEnvironment, projectSalesParticipantRosterEnvironment } from "./sales-participant-environment";
it("maps only exact documented v3 environment status codes", () => {
  expect(projectSalesParticipantEnvironment(7, new Date("2026-07-19T10:00:00Z"))).toMatchObject({ dimension: "cloudshare_environment", value: "Taking a Snapshot", source: "cloudshare_v3_environment" });
  expect(projectSalesParticipantEnvironment(6, new Date())).toMatchObject({ value: null, source: "not_observed" });
});

it("keeps the documented v4 Sales roster environment state distinct from v3 observation", () => {
  expect(projectSalesParticipantRosterEnvironment("Deleted", new Date("2026-07-19T10:00:00Z"))).toEqual({ dimension: "cloudshare_environment", value: "Deleted", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-19T10:00:00.000Z" });
});

it.each([
  ["FutureAllocationScheduled", "Future allocation scheduled"],
  ["AllocationScheduledNoRun", "Allocation scheduled (not running)"],
  ["Ready", "Ready"],
  ["Suspended", "Suspended"],
  ["Archived", "Archived"],
  ["Deleted", "Deleted"],
  ["Publishing", "Publishing"],
  ["Preparing", "Preparing"],
  ["CreationFailed", "Creation Failed"],
  ["InGrace", "In grace"],
  ["Stopping", "Stopping"],
  ["EditingNetworks", "Editing networks"],
] as const)("projects documented v4 roster state %s as %s", (status, value) => {
  expect(isProjectableSalesParticipantRosterEnvironment(status)).toBe(true);
  expect(projectSalesParticipantRosterEnvironment(status, new Date("2026-07-19T10:00:00Z"))).toMatchObject({ value, source: "cloudshare_v4_sales_participant_roster" });
});

it("does not treat an unknown roster state as a documented display value", () => {
  expect(isProjectableSalesParticipantRosterEnvironment("Unknown")).toBe(false);
  expect(isProjectableSalesParticipantRosterEnvironment("toString")).toBe(false);
  expect(isProjectableSalesParticipantRosterEnvironment("__proto__")).toBe(false);
});
