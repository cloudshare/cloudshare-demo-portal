import { describe, expect, it } from "vitest";
import { getPortalHomePath } from "./portal-session";

describe("portal workspace routing", () => {
  it("routes an existing-role Certalis Sales Admin to the Sales workspace from Customer configuration", () => {
    expect(
      getPortalHomePath({
        sessionId: "session-certalis",
        userId: "admin-certalis",
        customerId: "customer-certalis",
        email: "sales-admin@certalis.demo",
        role: "admin",
        workspace: "sales",
        issuedAtMs: 1_700_000_000_000,
      }),
    ).toBe("/sales");
  });

  it("preserves the Helios certification administration route", () => {
    expect(
      getPortalHomePath({
        sessionId: "session-helios",
        userId: "admin-helios",
        customerId: "customer-helios",
        email: "admin@helioscx.demo",
        role: "admin",
        workspace: "certification",
        issuedAtMs: 1_700_000_000_000,
      }),
    ).toBe("/admin");
  });

  it("routes a Sales Trial participant to the Sales Trial shell", () => {
    expect(
      getPortalHomePath({
        sessionId: "session-sales-trial",
        userId: "trial-user-1",
        customerId: "customer-certalis",
        email: "visitor@example.test",
        role: "sales_trial_participant",
        workspace: "sales",
        issuedAtMs: 1_700_000_000_000,
      }),
    ).toBe("/sales-trial");
  });
});
