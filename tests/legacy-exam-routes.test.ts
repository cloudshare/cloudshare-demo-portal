import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getEligibleExams } from "../app/api/exams/eligible/route";
import { POST as bookLegacyExam } from "../app/api/exams/book/route";

const { mockGetServices } = vi.hoisted(() => ({
  mockGetServices: vi.fn(),
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

describe("legacy simulator exam routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServices.mockImplementation(() => {
      throw new Error("legacy simulator composition should not be used");
    });
  });

  it("quarantines the retired eligibility route without reaching Genesys composition", async () => {
    const response = await getEligibleExams();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: {
        code: "legacy_simulator_exam_flow_retired",
        message: "The retired simulator exam booking API is no longer active.",
        replacements: {
          catalog: "GET /api/candidate/exams",
          scheduling: "POST /api/candidate/exams",
        },
      },
    });
    expect(mockGetServices).not.toHaveBeenCalled();
  });

  it("quarantines the retired booking route without invoking the legacy booking flow", async () => {
    const response = await bookLegacyExam();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: {
        code: "legacy_simulator_exam_flow_retired",
        message: "The retired simulator exam booking API is no longer active.",
        replacements: {
          catalog: "GET /api/candidate/exams",
          scheduling: "POST /api/candidate/exams",
        },
      },
    });
    expect(mockGetServices).not.toHaveBeenCalled();
  });
});
