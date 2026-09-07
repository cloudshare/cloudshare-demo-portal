import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CandidateExamCard,
  CandidateCohortSessionOptions,
  getCandidateExamCardImmediateActionReason,
  getTakeExamAvailabilitySummary,
  PublishedExamCardHeader,
} from "./candidate-home";
import {
  candidateHomeAccountActionsStyle,
  candidateHomeAccountPanelStyle,
  candidateHomeHeaderIntroStyle,
  candidateHomeHeaderStyle,
  publishedExamActionGroupStyle,
  publishedExamActionRowStyle,
  publishedExamDescriptionStyle,
  publishedExamDurationPillsStyle,
  publishedExamHeaderStyle,
  publishedExamScheduleFieldStyle,
  publishedExamTitleRowStyle,
} from "./candidate-home-layout";

describe("candidate home layout", () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/London";
  });

  afterAll(() => {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
      return;
    }

    process.env.TZ = originalTimezone;
  });

  it("lets the signed-in panel stack instead of overlapping the Candidate Home heading", () => {
    expect(candidateHomeHeaderStyle.flexWrap).toBe("wrap");
    expect(candidateHomeHeaderIntroStyle).toMatchObject({
      flex: "1 1 28rem",
      minWidth: 0,
    });
    expect(candidateHomeAccountActionsStyle).toMatchObject({
      flex: "0 1 18rem",
      minWidth: 0,
      maxWidth: "100%",
    });
  });

  it("keeps the signed-in panel within its responsive header column", () => {
    expect(candidateHomeAccountActionsStyle.justifyItems).toBe("stretch");
    expect(candidateHomeAccountPanelStyle).toMatchObject({
      width: "100%",
      minWidth: 0,
      boxSizing: "border-box",
    });
  });

  it("keeps published Exam duration pills aligned with the title when descriptions are long", () => {
    expect(publishedExamHeaderStyle).toMatchObject({
      display: "grid",
      gap: "0.5rem",
    });
    expect(publishedExamTitleRowStyle).toMatchObject({
      display: "flex",
      justifyContent: "space-between",
      flexWrap: "wrap",
    });
    expect(publishedExamDescriptionStyle).toMatchObject({
      maxWidth: "68rem",
    });
    expect(publishedExamDurationPillsStyle).toMatchObject({
      justifyContent: "flex-end",
      flex: "1 1 auto",
      minWidth: 0,
      maxWidth: "100%",
    });

    const html = renderToStaticMarkup(
      createElement(PublishedExamCardHeader, {
        title: "Linux Environment with xRDP v2",
        description:
          "This deliberately long description mirrors a real Exam description and must sit below the title row instead of pushing duration pills beneath itself.",
        runtimeLimit: "20160 minute runtime limit",
        openWindow: "20160 minute open window",
      }),
    );
    expect(html.indexOf("Linux Environment with xRDP v2")).toBeLessThan(
      html.indexOf("20160 minute runtime limit"),
    );
    expect(html.indexOf("20160 minute open window")).toBeLessThan(
      html.indexOf("This deliberately long description"),
    );
  });

  it("renders each Exam as a candidate-facing action card with details on the back", () => {
    const html = renderToStaticMarkup(
      createElement(CandidateExamCard, {
        exam: {
          id: "exam-1",
          title: "Linux Environment with xRDP v2",
          description: "Validate remote environment workflows.",
          timeLimitMinutes: 90,
          storageLeaseMinutes: 180,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: true,
          individualSchedulingEnabled: true,
          availableCohortSessions: [],
        },
        attemptedSessionIds: new Set<string>(),
        scheduleDraft: "",
        scheduleFeedback: null,
        submittingExamId: null,
        submittingSessionId: null,
        onScheduleDraftChange: () => undefined,
        onSchedule: () => undefined,
        onStartCohortSession: () => undefined,
      }),
    );

    expect((html.match(/<summary/g) ?? []).length).toBe(0);
    expect(html).toContain("How you can take it");
    expect(html).toContain("Schedule a start time");
    expect(html).toContain("Exam details");
    expect(html).toContain("Back to exam");
    expect(html).toContain("Guided Journey scoring");
    expect(html).toContain("Schedule date and time");
    expect(html).toContain("Schedule exam");
    expect(html).not.toContain("Browse");
    expect(html).not.toContain("Start a shared cohort session");
  });

  it("keeps owned attempt actions out of the published Exam catalogue card", () => {
    const html = renderToStaticMarkup(
      createElement(CandidateExamCard, {
        exam: {
          id: "exam-1",
          title: "Linux Environment with xRDP v2",
          description: "Validate remote environment workflows.",
          timeLimitMinutes: 90,
          storageLeaseMinutes: 180,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: true,
          individualSchedulingEnabled: false,
          availableCohortSessions: [],
        },
        attemptedSessionIds: new Set<string>(),
        scheduleDraft: "",
        scheduleFeedback: null,
        submittingExamId: null,
        submittingSessionId: null,
        onScheduleDraftChange: () => undefined,
        onSchedule: () => undefined,
        onStartCohortSession: () => undefined,
      }),
    );

    expect(html).toContain("Not available right now");
    expect(html).not.toContain("Score available");
    expect(html).not.toContain("View score");
    expect(html).not.toContain("Current attempt");
  });

  it("keeps long Exam descriptions on the details face instead of the card front", () => {
    const description =
      "This long description belongs on the back of the card so the catalogue keeps a consistent front-face layout.";
    const html = renderToStaticMarkup(
      createElement(CandidateExamCard, {
        exam: {
          id: "exam-1",
          title: "Linux Environment with xRDP v2",
          description,
          timeLimitMinutes: 90,
          storageLeaseMinutes: 180,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: true,
          individualSchedulingEnabled: true,
          availableCohortSessions: [],
        },
        attemptedSessionIds: new Set<string>(),
        scheduleDraft: "",
        scheduleFeedback: null,
        submittingExamId: null,
        submittingSessionId: null,
        onScheduleDraftChange: () => undefined,
        onSchedule: () => undefined,
        onStartCohortSession: () => undefined,
      }),
    );

    expect(html.indexOf(description)).toBeGreaterThan(html.indexOf("EXAM DETAILS"));
  });

  it("identifies immediately available catalogue starts without using owned attempt state", () => {
    const exam = {
      id: "exam-2",
      title: "Ready exam",
      description: "",
      timeLimitMinutes: 90,
      storageLeaseMinutes: null,
      openPeriodMinutes: 120,
      scoreRetrievalEnabled: false,
      individualSchedulingEnabled: true,
      availableCohortSessions: [
        {
          id: "session-1",
          name: "Morning Cohort",
          admissionStartsAt: "2026-07-09T10:00:00.000Z",
          admissionEndsAt: "2026-07-09T12:00:00.000Z",
        },
      ],
    };
    expect(
      getCandidateExamCardImmediateActionReason({
        exam,
      }),
    ).toBe("available-now:exam-2:session-1");
    expect(
      getCandidateExamCardImmediateActionReason({
        exam: {
          ...exam,
          availableCohortSessions: [],
        },
      }),
    ).toBeNull();
  });

  it("renders the action side first when only scheduling is available", () => {
    expect(
      renderToStaticMarkup(createElement(CandidateExamCard, {
        exam: {
          id: "exam-1",
          title: "Individual exam",
          description: "",
          timeLimitMinutes: 90,
          storageLeaseMinutes: null,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: false,
          individualSchedulingEnabled: true,
          availableCohortSessions: [],
        },
        scheduleDraft: "",
        scheduleFeedback: null,
        submittingExamId: null,
        submittingSessionId: null,
        attemptedSessionIds: new Set<string>(),
        onScheduleDraftChange: () => undefined,
        onSchedule: () => undefined,
        onStartCohortSession: () => undefined,
      })),
    ).toContain("Schedule a start time");
  });

  it("keeps published Exam scheduling actions aligned to the right edge", () => {
    expect(publishedExamActionRowStyle).toMatchObject({
      display: "flex",
      justifyContent: "space-between",
      alignItems: "end",
      flexWrap: "wrap",
    });
    expect(publishedExamScheduleFieldStyle).toMatchObject({
      display: "grid",
      flex: "1 1 22rem",
      maxWidth: "44rem",
    });
    expect(publishedExamActionGroupStyle).toMatchObject({
      display: "flex",
      justifyContent: "flex-end",
      marginLeft: "auto",
    });
  });

  it("summarizes available sessions without exposing delivery-mode implementation details", () => {
    expect(
      getTakeExamAvailabilitySummary({
        availableCohortSessionCount: 2,
        individualSchedulingEnabled: true,
        primaryActionLabel: null,
        primaryActionDisabled: false,
      }),
    ).toBe("2 start times available now");
    expect(
      getTakeExamAvailabilitySummary({
        availableCohortSessionCount: 0,
        individualSchedulingEnabled: true,
        primaryActionLabel: null,
        primaryActionDisabled: false,
      }),
    ).toBe("Schedule a start time");
    expect(
      getTakeExamAvailabilitySummary({
        availableCohortSessionCount: 0,
        individualSchedulingEnabled: false,
        primaryActionLabel: null,
        primaryActionDisabled: false,
      }),
    ).toBe("Not available right now");
  });

  it("summarizes completed scored attempts as an available current-attempt action", () => {
    expect(
      getTakeExamAvailabilitySummary({
        availableCohortSessionCount: 0,
        individualSchedulingEnabled: false,
        primaryActionLabel: "View score",
        primaryActionDisabled: false,
      }),
    ).toBe("Score available");
  });

  it("renders immediately available starts without exposing delivery-mode implementation details", () => {
    const html = renderToStaticMarkup(
      createElement(CandidateCohortSessionOptions, {
        sessions: [
          {
            id: "cohort-session-1",
            name: "Morning Cohort",
            admissionStartsAt: "2026-07-05T08:30:00.000Z",
            admissionEndsAt: "2026-07-05T12:00:00.000Z",
          },
          {
            id: "cohort-session-2",
            name: "Afternoon Cohort",
            admissionStartsAt: "2026-07-05T13:00:00.000Z",
            admissionEndsAt: null,
          },
        ],
        attemptedSessionIds: new Set<string>(),
        currentAttemptStatus: null,
        submittingSessionId: null,
        onStart: () => undefined,
      }),
    );

    expect(html).toContain("Available now");
    expect(html).toContain("Ready option 1");
    expect(html).toContain("Ready option 2");
    expect(html).toContain("Available until 2026-07-05 13:00");
    expect((html.match(/Start exam/g) ?? []).length).toBe(2);
    expect(html).not.toContain("Start a shared cohort session");
    expect(html).not.toContain("Morning Cohort");
    expect(html).not.toContain("Afternoon Cohort");
    expect(html).not.toContain("Cohort");
    expect(html).not.toContain("Guided Journey aggregate progress");
    expect(html).not.toContain("This Cohort Exam Session / CloudShare Experience");
    expect(html).not.toContain("avgExploredRate");
  });
});
