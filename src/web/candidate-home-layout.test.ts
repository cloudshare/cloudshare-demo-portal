import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CandidateCohortSessionOptions,
  CandidateAttemptStatusFilterButtons,
  CandidatePublishedExamScheduleShell,
  getAvailableSessionsSummary,
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

  it("keeps published Exam scheduling collapsed by default without mounting scheduling fields", () => {
    const html = renderToStaticMarkup(
      createElement(
        CandidatePublishedExamScheduleShell,
        { examCount: 2 },
        createElement("p", null, "Schedule date and time"),
      ),
    );

    expect(html).toContain("<details");
    expect(html).not.toContain("<details open=\"\"");
    expect(html).toContain("Browse and schedule");
    expect(html).toContain("2 published Exams");
    expect(html).toContain("Browse scheduling options");
    expect(html).not.toContain("Schedule date and time");
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
      getAvailableSessionsSummary({
        availableCohortSessionCount: 2,
        individualSchedulingEnabled: true,
      }),
    ).toBe("2 ready to start");
    expect(
      getAvailableSessionsSummary({
        availableCohortSessionCount: 0,
        individualSchedulingEnabled: true,
      }),
    ).toBe("Individual scheduling available");
    expect(
      getAvailableSessionsSummary({
        availableCohortSessionCount: 0,
        individualSchedulingEnabled: false,
      }),
    ).toBe("No sessions available right now");
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
  });
});
