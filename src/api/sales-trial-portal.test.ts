import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, type PortalUserProvisioningStore } from "@/auth";
import {
  handleSalesTrialLogin,
  handleSalesTrialSelfRegistration,
} from "./sales-trial-portal";

function makeProvisioningStore(overrides: Partial<PortalUserProvisioningStore>): PortalUserProvisioningStore {
  return {
    findByEmail: vi.fn().mockResolvedValue(null),
    findCustomerBySlug: vi.fn().mockResolvedValue(null),
    findSalesTrialCustomer: vi.fn().mockResolvedValue(null),
    createUser: vi.fn(),
    ...overrides,
  };
}

describe("Sales Trial self-registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
        users: makeProvisioningStore({
          findSalesTrialCustomer: vi.fn().mockResolvedValue({
            id: "certalis-customer",
            slug: "certalis-sales",
            name: "Certalis",
            workspace: "sales",
          }),
          createUser,
        }),
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

  it("rejects an existing Certalis identity without exposing its role", async () => {
    const createUser = vi.fn();
    const result = await handleSalesTrialSelfRegistration(
      {
        users: makeProvisioningStore({
          findSalesTrialCustomer: vi.fn().mockResolvedValue({
            id: "certalis-customer",
            slug: "certalis-sales",
            name: "Certalis",
            workspace: "sales",
          }),
          findByEmail: vi.fn().mockResolvedValue({
            id: "sales-admin-1",
            customerId: "certalis-customer",
            email: "visitor@example.test",
            passwordHash: "hash",
            role: "admin",
            workspace: "sales",
          }),
          createUser,
        }),
      },
      { body: { firstName: "Ari", lastName: "Visitor", email: "visitor@example.test", password: "safe-password" } },
    );

    expect(result).toEqual({
      status: 409,
      body: { error: "A Sales Trial account with that email already exists." },
    });
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("Sales Trial sign in", () => {
  it("creates a Sales Trial session only for the persisted Sales Customer and does not expose the customer id", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const passwordHash = await hashPassword("safe-password");

    const response = await handleSalesTrialLogin(
      {
        users: makeProvisioningStore({
          findSalesTrialCustomer: vi.fn().mockResolvedValue({
            id: "customer-certalis",
            slug: "certalis",
            name: "Certalis",
            workspace: "sales",
          }),
          findByEmail: vi.fn(async (_email, scope) =>
            scope?.customerId === "customer-certalis" &&
              scope.role === "sales_trial_participant"
              ? {
                  id: "trial-participant-1",
                  customerId: "customer-certalis",
                  email: "visitor@example.test",
                  firstName: "Ari",
                  lastName: "Visitor",
                  passwordHash,
                  role: "sales_trial_participant" as const,
                  workspace: "sales" as const,
                }
              : null,
          ),
        }),
        sessions: {
          save,
          findById: vi.fn(),
          deleteById: vi.fn(),
        },
        now: () => 1_700_000_000_000,
        newSessionId: () => "sales-trial-session-1",
      },
      {
        body: {
          email: "visitor@example.test",
          password: "safe-password",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      session: {
        email: "visitor@example.test",
        firstName: "Ari",
        lastName: "Visitor",
        role: "sales_trial_participant",
      },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sales-trial-session-1",
        customerId: "customer-certalis",
        role: "sales_trial_participant",
        workspace: "sales",
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("customer-certalis");
  });

  it("fails closed instead of authenticating the same email from another Customer", async () => {
    const response = await handleSalesTrialLogin(
      {
        users: makeProvisioningStore({
          findSalesTrialCustomer: vi.fn().mockResolvedValue({
            id: "customer-certalis",
            slug: "certalis",
            name: "Certalis",
            workspace: "sales",
          }),
          findByEmail: vi.fn().mockResolvedValue(null),
        }),
        sessions: {
          save: vi.fn(),
          findById: vi.fn(),
          deleteById: vi.fn(),
        },
      },
      {
        body: {
          email: "visitor@example.test",
          password: "safe-password",
        },
      },
    );

    expect(response).toEqual({
      status: 401,
      body: { error: "Invalid email or password" },
    });
  });
});
