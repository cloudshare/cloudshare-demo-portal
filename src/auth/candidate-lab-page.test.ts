import { describe, expect, it, vi } from "vitest";
import CandidateLabPage from "../../app/candidate/lab/page";

vi.mock("@/web/candidate-lab-shell", () => ({
  CandidateLabShell: ({
    examAttemptId,
    initialAttemptStatus,
  }: {
    examAttemptId: string;
    initialAttemptStatus: string;
  }) => ({
    type: "CandidateLabShell",
    props: { examAttemptId, initialAttemptStatus },
  }),
}));

describe("candidate lab page", () => {
  it("renders the lab shell with candidate navigation controls", async () => {
    const page = await CandidateLabPage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
        attemptStatus: "in_progress",
      }),
    });

    expect(page).toMatchObject({
      props: {
        examAttemptId: "ea-1",
        initialAttemptStatus: "in_progress",
      },
    });
  });

  it("defaults unknown attempt statuses to ready", async () => {
    const page = await CandidateLabPage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
        attemptStatus: "unknown",
      }),
    });

    expect(page).toMatchObject({
      props: {
        initialAttemptStatus: "ready",
      },
    });
  });
});
