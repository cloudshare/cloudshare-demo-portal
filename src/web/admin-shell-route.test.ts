import { describe, expect, it } from "vitest";
import {
  ADMIN_TABS,
  buildAdminConsoleHref,
  buildAdminNavigationHref,
  createCorrelationDiagnosticsNavigationIntent,
  createExamAttemptDiagnosticsNavigationIntent,
  getAdminTabLabel,
  normaliseDiagnosticLogFilters,
  parseAdminConsoleRouteState,
  shouldClearAdminBannerOnTabChange,
  type DiagnosticLogFilters,
} from "./admin-shell-route";

describe("admin shell navigation intents", () => {
  it("keeps an ExamAttempt investigation on the existing scoped Support Diagnostics URL", () => {
    const intent = createExamAttemptDiagnosticsNavigationIntent("  attempt-a  ");
    expect(intent).toEqual({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: { examAttemptId: "attempt-a" },
    });
    expect(buildAdminNavigationHref(intent)).toBe(
      "/admin?tab=support&view=diagnostics&examAttemptId=attempt-a",
    );
  });

  it("does not retain unrelated diagnostic filters when opening an ExamAttempt investigation", () => {
    const intent = createExamAttemptDiagnosticsNavigationIntent("attempt-a");
    const href = buildAdminNavigationHref(intent);
    expect(href).not.toContain("correlationId=");
    expect(href).not.toContain("candidateEmail=");
    expect(href).not.toContain("source=");
  });

  it("preserves a Cohort Exam Session selection when opening Support Session Monitoring", () => {
    const href = buildAdminConsoleHref({
      tab: "support", supportView: "monitoring", examId: "exam-1", cohortSessionId: "cohort-session-1",
    });
    expect(href).toBe("/admin?tab=support&examId=exam-1&sessionId=cohort-session-1");
    expect(parseAdminConsoleRouteState({ tab: "support", examId: "exam-1", sessionId: "cohort-session-1" }))
      .toMatchObject({ tab: "support", supportView: "monitoring", examId: "exam-1", cohortSessionId: "cohort-session-1" });
  });
});

describe("admin shell tab and URL model", () => {
  it("groups admin work areas around the unchanged four tabs", () => {
    expect(ADMIN_TABS).toEqual(["exams", "candidates", "support", "configuration"]);
    expect(getAdminTabLabel("exams")).toBe("Exams");
    expect(getAdminTabLabel("candidates")).toBe("Candidates");
    expect(getAdminTabLabel("support")).toBe("Support");
    expect(getAdminTabLabel("configuration")).toBe("Configuration");
    expect(ADMIN_TABS).not.toContain("monitoring" as never);
    expect(ADMIN_TABS).not.toContain("diagnostics" as never);
    expect(ADMIN_TABS).not.toContain("events");
    expect(ADMIN_TABS).not.toContain("resources");
  });

  it("defaults to Exams and maps legacy URLs to their current shell routes", () => {
    expect(parseAdminConsoleRouteState({})).toEqual({
      tab: "exams", examView: "catalog", supportView: "monitoring", diagnosticFilters: {},
    });
    expect(parseAdminConsoleRouteState({ tab: "connection" })).toMatchObject({ tab: "configuration" });
    expect(parseAdminConsoleRouteState({ tab: "events" })).toMatchObject({ tab: "exams" });
    expect(parseAdminConsoleRouteState({ tab: "resources" })).toMatchObject({ tab: "exams" });
    expect(parseAdminConsoleRouteState({ tab: "monitoring" })).toMatchObject({ tab: "support", supportView: "monitoring" });
    expect(parseAdminConsoleRouteState({ tab: "diagnostics" })).toMatchObject({ tab: "support", supportView: "diagnostics" });
    expect(parseAdminConsoleRouteState({ tab: "audit" })).toMatchObject({ tab: "support", supportView: "audit" });
  });

  it("serialises focused Exam and Cohort Session routes without changing their URL shapes", () => {
    expect(buildAdminConsoleHref({ tab: "exams", examView: "create" })).toBe("/admin?tab=exams&view=create");
    expect(buildAdminConsoleHref({ tab: "exams", examView: "edit", examId: "exam-1" })).toBe("/admin?tab=exams&view=edit&examId=exam-1");
    expect(buildAdminConsoleHref({ tab: "exams", examView: "sessions", examId: "exam-1" })).toBe("/admin?tab=exams&view=sessions&examId=exam-1");
    expect(buildAdminConsoleHref({
      tab: "exams", examView: "session", examId: "exam-1", cohortSessionId: "cohort-session-1",
    })).toBe("/admin?tab=exams&view=session&examId=exam-1&sessionId=cohort-session-1");
  });

  it("clears dismissible banners only when changing tabs", () => {
    expect(shouldClearAdminBannerOnTabChange("candidates", "exams")).toBe(true);
    expect(shouldClearAdminBannerOnTabChange("candidates", "candidates")).toBe(false);
  });
});

describe("admin shell diagnostic routes", () => {
  it("normalises filter input for stable route state", () => {
    const filters: DiagnosticLogFilters = normaliseDiagnosticLogFilters({
      examAttemptId: "  attempt-1  ", examId: " exam-1 ", candidateEmail: " Candidate@HeliosCX.demo ",
      operation: " exam_attempt.resume ", outcome: "failure", source: " runtime ",
      integrationSurface: " cloudshare.v4.environment ", correlationId: " corr-1 ", externalId: " env-123 ",
      from: " 2026-06-21T10:00 ", to: " 2026-06-21T11:00 ",
    });
    expect(filters).toEqual({
      examAttemptId: "attempt-1", examId: "exam-1", candidateEmail: "candidate@helioscx.demo",
      operation: "exam_attempt.resume", outcome: "failure", source: "runtime",
      integrationSurface: "cloudshare.v4.environment", correlationId: "corr-1", externalId: "env-123",
      from: "2026-06-21T10:00", to: "2026-06-21T11:00",
    });
  });

  it("serialises Support Diagnostics investigation links", () => {
    expect(buildAdminConsoleHref({
      tab: "support", supportView: "diagnostics",
      diagnosticFilters: { examAttemptId: "attempt-1", candidateEmail: "Candidate@HeliosCX.demo", correlationId: "corr-1" },
    })).toBe("/admin?tab=support&view=diagnostics&examAttemptId=attempt-1&candidateEmail=candidate%40helioscx.demo&correlationId=corr-1");
    const intent = createCorrelationDiagnosticsNavigationIntent(" corr-9 ");
    expect(intent).toEqual({ tab: "support", supportView: "diagnostics", diagnosticFilters: { correlationId: "corr-9" } });
    expect(buildAdminNavigationHref(intent)).toBe("/admin?tab=support&view=diagnostics&correlationId=corr-9");
  });

  it("parses linked diagnostics into the correct Support context", () => {
    expect(parseAdminConsoleRouteState({
      tab: "diagnostics", examAttemptId: " attempt-9 ", candidateEmail: " Candidate@HeliosCX.demo ",
      correlationId: [" corr-99 "], outcome: "failure",
    })).toEqual({
      tab: "support", examView: "catalog", supportView: "diagnostics",
      diagnosticFilters: { examAttemptId: "attempt-9", candidateEmail: "candidate@helioscx.demo", correlationId: "corr-99", outcome: "failure" },
    });
    expect(parseAdminConsoleRouteState({ tab: "monitoring", examAttemptId: "attempt-9" })).toEqual({
      tab: "support", examView: "catalog", supportView: "monitoring", diagnosticFilters: {},
    });
  });

  it("round-trips attempt and correlation investigations to Support Diagnostics", () => {
    expect(parseAdminConsoleRouteState({ tab: "diagnostics", examAttemptId: "attempt-41" }))
      .toMatchObject({ tab: "support", supportView: "diagnostics", diagnosticFilters: { examAttemptId: "attempt-41" } });
    expect(parseAdminConsoleRouteState({ tab: "diagnostics", correlationId: "corr-41" }))
      .toMatchObject({ tab: "support", supportView: "diagnostics", diagnosticFilters: { correlationId: "corr-41" } });
  });
});
