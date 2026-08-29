import { describe, expect, it, vi } from "vitest";
import { handleSalesTrialSelfRegistration } from "./sales-trial-portal";

describe("Sales Trial self-registration", () => {
  it("creates a Sales Trial participant in the persisted Sales Customer without CloudShare access", async () => {
    const createUser = vi.fn().mockResolvedValue({
      id: "trial-participant-1",
      customerId: "certalis-customer",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      passwordHash: "hash",
      role: "sales_trial_participant",
      workspace: "sales",
    });
    const result = await handleSalesTrialSelfRegistration(
      {
        users: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findSalesTrialCustomer: vi.fn().mockResolvedValue({
            id: "certalis-customer",
            slug: "certalis-sales",
            name: "Certalis",
            workspace: "sales",
          }),
          createUser,
        },
      },
      {
        body: {
          firstName: "Ari",
          lastName: "Visitor",
          email: "visitor@example.test",
          password: "safe-password",
        },
      },
    );

    expect(result).toEqual({
      status: 201,
      body: {
        participant: {
          email: "visitor@example.test",
          firstName: "Ari",
          lastName: "Visitor",
          role: "sales_trial_participant",
        },
      },
    });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "certalis-customer",
        role: "sales_trial_participant",
      }),
    );
  });
});
