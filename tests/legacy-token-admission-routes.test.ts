import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as admitCandidateWithLegacyToken } from "../app/api/candidate/admit/route";
import { GET as resumeLegacyCandidateSession } from "../app/api/candidate/session/route";

const { mockGetServices } = vi.hoisted(() => ({
  mockGetServices: vi.fn(),
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

describe("legacy token candidate admission routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServices.mockImplementation(() => {
      throw new Error("legacy token candidate admission composition should not be used");
    });
  });

  it("quarantines token admission without reaching legacy token auth composition", async () => {
    const response = await admitCandidateWithLegacyToken(
      new Request("http://localhost/api/candidate/admit", {
        method: "POST",
        body: JSON.stringify({ token: "legacy-token" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: {
        code: "legacy_token_candidate_admission_retired",
        message: "The retired token-based Candidate admission API is no longer active.",
        replacements: {
          login: "POST /api/auth/login",
          session: "GET /api/auth/session",
          catalog: "GET /api/candidate/exams",
        },
      },
    });
    expect(mockGetServices).not.toHaveBeenCalled();
  });

  it("quarantines legacy candidate session resume without reaching token session stores", async () => {
    const response = await resumeLegacyCandidateSession();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: {
        code: "legacy_token_candidate_admission_retired",
        message: "The retired token-based Candidate admission API is no longer active.",
        replacements: {
          login: "POST /api/auth/login",
          session: "GET /api/auth/session",
          catalog: "GET /api/candidate/exams",
        },
      },
    });
    expect(mockGetServices).not.toHaveBeenCalled();
  });
});
