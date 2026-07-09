import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CandidateExamCard,
  CandidateCohortSessionOptions,
  CandidateAttemptStatusFilterButtons,
  getCandidateExamCardTakeExamAutoOpenReason,
  getDefaultCandidateExamCardPanelState,
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
  publishedExamDisclosureBodyStyle,
  publishedExamDisclosureSummaryStyle,
  publishedExamDescriptionStyle,
  publishedExamDurationPillsStyle,
  publishedExamHeaderStyle,
  publishedExamScheduleFieldStyle,
  publishedExamTitleRowStyle,
} from "./candidate-home-layout";

describe("candidate home layout", () => {
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

  it("renders candidate attempt status filters with live and history counts", () => {
    const html = renderToStaticMarkup(
      createElement(CandidateAttemptStatusFilterButtons, {
        filters: [
          { filter: "live", label: "Live", count: 2 },
          { filter: "scheduled", label: "Scheduled / ready", count: 1 },
          { filter: "in_progress", label: "In progress", count: 1 },
          { filter: "suspended", label: "Suspended", count: 0 },
          { filter: "completed", label: "Completed", count: 3 },
          { filter: "expired", label: "Expired", count: 1 },
        ],
        activeFilter: "live",
        onFilterChange: () => undefined,
      }),
    );

    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("Live");
    expect(html).toContain("Scheduled / ready");
    expect(html).toContain("Completed");
    expect(html).toContain("Expired");
    expect(html).toContain(">3<");
  });

  it("keeps Exam card disclosures visibly split between Browse and Take exam", () => {
    expect(publishedExamDisclosureSummaryStyle).toMatchObject({
      display: "flex",
      justifyContent: "space-between",
      flexWrap: "wrap",
      cursor: "pointer",
    });
    expect(publishedExamDisclosureBodyStyle).toMatchObject({
      display: "grid",
      gap: "0.9rem",
      marginTop: "1rem",
      paddingTop: "1rem",
    });

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
        attempt: null,
        attemptedSessionIds: new Set<string>(),
        nowMs: Date.parse("2026-07-09T10:00:00.000Z"),
        scheduleDraft: "",
        scheduleFeedback: null,
        submittingExamId: null,
        submittingSessionId: null,
        onScheduleDraftChange: () => undefined,
        onSchedule: () => undefined,
        onCurrentAttemptAction: () => undefined,
        onStartCohortSession: () => undefined,
      }),
    );

    expect((html.match(/<summary/g) ?? []).length).toBe(2);
    expect(html).toContain("Browse");
    expect(html).toContain("Take exam");
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("Guided Journey scoring");
    expect(html).toContain("Schedule an individual start time");
    expect(html).not.toContain("Schedule date and time");
  });

  it("opens Take exam by default when the Candidate can act immediately", () => {
    expect(
      getDefaultCandidateExamCardPanelState({
        exam: {
          id: "exam-1",
          title: "Cohort exam",
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
        },
        attempt: null,
        nowMs: Date.parse("2026-07-09T10:00:00.000Z"),
      }),
    ).toEqual({
      browseOpen: false,
      takeExamOpen: true,
    });

    expect(
      getDefaultCandidateExamCardPanelState({
        exam: {
          id: "exam-2",
          title: "Resume exam",
          description: "",
          timeLimitMinutes: 90,
          storageLeaseMinutes: null,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: false,
          individualSchedulingEnabled: true,
          availableCohortSessions: [],
        },
        attempt: {
          id: "attempt-1",
          examId: "exam-2",
          scheduledFor: "2026-07-09T09:30:00.000Z",
          status: "suspended",
        },
        nowMs: Date.parse("2026-07-09T10:00:00.000Z"),
      }),
    ).toEqual({
      browseOpen: false,
      takeExamOpen: true,
    });
  });

  it("returns a new auto-open reason when a ready attempt becomes enterable", () => {
    const exam = {
      id: "exam-2",
      title: "Ready exam",
      description: "",
      timeLimitMinutes: 90,
      storageLeaseMinutes: null,
      openPeriodMinutes: 120,
      scoreRetrievalEnabled: false,
      individualSchedulingEnabled: true,
      availableCohortSessions: [],
    };
    const attempt = {
      id: "attempt-1",
      examId: "exam-2",
      scheduledFor: "2026-07-09T10:00:00.000Z",
      status: "ready" as const,
    };

    expect(
      getCandidateExamCardTakeExamAutoOpenReason({
        exam,
        attempt,
        nowMs: Date.parse("2026-07-09T09:59:00.000Z"),
      }),
    ).toBeNull();
    expect(
      getCandidateExamCardTakeExamAutoOpenReason({
        exam,
        attempt,
        nowMs: Date.parse("2026-07-09T10:00:00.000Z"),
      }),
    ).toBe("attempt:attempt-1:Enter exam");
  });

  it("keeps Browse open by default when there is no immediately startable or resumable action", () => {
    expect(
      getDefaultCandidateExamCardPanelState({
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
        attempt: {
          id: "attempt-1",
          examId: "exam-1",
          scheduledFor: "2026-07-09T13:00:00.000Z",
          status: "ready",
        },
        nowMs: Date.parse("2026-07-09T10:00:00.000Z"),
      }),
    ).toEqual({
      browseOpen: true,
      takeExamOpen: false,
    });
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
    ).toBe("2 sessions ready to start");
    expect(
      getTakeExamAvailabilitySummary({
        availableCohortSessionCount: 0,
        individualSchedulingEnabled: true,
        primaryActionLabel: null,
        primaryActionDisabled: false,
      }),
    ).toBe("Schedule an individual start time");
    expect(
      getTakeExamAvailabilitySummary({
        availableCohortSessionCount: 0,
        individualSchedulingEnabled: false,
        primaryActionLabel: null,
        primaryActionDisabled: false,
      }),
    ).toBe("No ways to take this Exam right now.");
  });

  it("summarizes completed scored attempts as an available current-attempt action", () => {
    expect(
      getTakeExamAvailabilitySummary({
        availableCohortSessionCount: 0,
        individualSchedulingEnabled: false,
        primaryActionLabel: "View score",
        primaryActionDisabled: false,
      }),
    ).toBe("Score available to view");
  });

  it("renders available Cohort Exam Sessions as options on the parent Exam card", () => {
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

    expect(html).toContain("Start a shared cohort session");
    expect(html).toContain("Morning Cohort");
    expect(html).toContain("Afternoon Cohort");
    expect(html).toContain("Closes 2026-07-05 13:00");
    expect((html.match(/Start exam/g) ?? []).length).toBe(2);
    expect(html).not.toContain("Guided Journey aggregate progress");
    expect(html).not.toContain("This Cohort Exam Session / CloudShare Experience");
    expect(html).not.toContain("avgExploredRate");
  });
});
