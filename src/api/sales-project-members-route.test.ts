import { describe, expect, it, vi } from "vitest";
import { createSalesProjectMemberSourceFactory } from "./sales-project-members-route";

describe("Sales Project-members route composition", () => {
  it("passes the dedicated preflight reason to the Customer client", () => {
    const forConnection = vi.fn().mockReturnValue({});
    const services = { cloudshareClientFactory: { forConnection } } as never;
    const connection = { customerId: "customer-a" } as never;

    createSalesProjectMemberSourceFactory(services).forConnection(connection);

    expect(forConnection).toHaveBeenCalledWith(connection, { scope: "customer_default", reason: "sales_project_member_preflight" });
  });
});
