import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/candidate/register/route";
import type { Logger } from "@/observability/logger";

const { mockGetServices } = vi.hoisted(() => ({
  mockGetServices: vi.fn(),
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
  getPortalSessionServices: mockGetServices,
  getCandidateRegistrationServices: mockGetServices,
}));

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePortalUsers() {
  const users = new Map<string, {
    id: string;
    customerId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    passwordHash: string;
    role: "admin" | "candidate";
  }>();

  return {
    findByEmail: vi.fn(async (email: string) => users.get(email.trim().toLowerCase()) ?? null),
    findCustomerBySlug: vi.fn(async (slug: string) =>
      slug === "helios-cx"
        ? { id: "customer-helios", slug: "helios-cx", name: "Helios CX" }
        : null,
    ),
    createUser: vi.fn(async (input) => {
      const record = {
        id: `user-${users.size + 1}`,
        customerId: input.customerId,
        email: input.email.trim().toLowerCase(),
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        passwordHash: input.passwordHash,
        role: input.role,
      } as const;
      users.set(record.email, record);
      return record;
    }),
  };
}

describe("candidate registration route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a Candidate from native form POST data and redirects to login", async () => {
    const portalUsers = makePortalUsers();
    mockGetServices.mockReturnValue({
      ensurePortalSeeded: vi.fn(),
      portalUsers,
      logger: makeLogger(),
      diagnosticRecorder: undefined,
    });

    const body = new URLSearchParams({
      firstName: "Asha",
      lastName: "Patel",
      email: "candidate@helioscx.demo",
      password: "correct-horse-battery-staple",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/candidate/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(portalUsers.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "customer-helios",
        email: "candidate@helioscx.demo",
        firstName: "Asha",
        lastName: "Patel",
        role: "candidate",
      }),
    );
  });
});
