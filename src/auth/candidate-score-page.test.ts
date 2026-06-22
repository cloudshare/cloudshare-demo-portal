import { describe, expect, it, vi } from "vitest";
import CandidateScorePage from "../../app/candidate/score/page";

vi.mock("@/web/score-display", () => ({
  ScoreDisplay: ({ examAttemptId }: { examAttemptId: string }) => ({
    type: "ScoreDisplay",
    props: { examAttemptId },
  }),
}));

describe("candidate score page", () => {
  it("renders the completion shell without duplicating top-level attempt metadata", async () => {
    const page = await CandidateScorePage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
      }),
    });

    expect(page).toMatchObject({
      type: "main",
      props: {
        children: [
          expect.objectContaining({
            type: "h1",
            props: expect.objectContaining({
              children: "Session complete",
            }),
          }),
          {
            type: expect.any(Function),
            props: {
              examAttemptId: "ea-1",
            },
          },
        ],
      },
    });
  });

  it("renders the missing-attempt message when no exam attempt id is present", async () => {
    const page = await CandidateScorePage({
      searchParams: Promise.resolve({}),
    });

    expect(page).toMatchObject({
      type: "main",
      props: {
        children: [
          expect.objectContaining({
            type: "h1",
            props: expect.objectContaining({
              children: "Session complete",
            }),
          }),
          expect.objectContaining({
            type: "p",
            props: expect.objectContaining({
              children: "Missing examAttemptId.",
            }),
          }),
        ],
      },
    });
  });
});
