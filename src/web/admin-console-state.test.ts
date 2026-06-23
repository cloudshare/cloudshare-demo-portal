import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  ADMIN_TABS,
  beginLatestOnlyRequest,
  buildAdminConsoleHref,
  buildCorrelationDiagnosticsHref,
  buildMonitoringHistoryQueryString,
  buildExamAttemptDiagnosticsNavigation,
  buildDiagnosticLogQueryString,
  mergeMonitoringHistoryPage,
  buildWebhookCallbackUrl,
  getAdminTabLabel,
  getAllowedRegionValidationMessage,
  getExamAuthoringMode,
  getCompatibleRegions,
  normaliseDiagnosticLogFilters,
  parseAdminConsoleRouteState,
  type DiagnosticLogFilters,
  isAdminSessionExpiredStatus,
  isLatestOnlyResponse,
  reconcileAllowedRegionIds,
  shouldShowCandidateProvisioning,
  shouldClearAdminBannerOnTabChange,
} from "./admin-console-state";
import type { AdminMonitoringView } from "@/domain/admin-monitoring";

describe("latest-only request coordination", () => {
  it("increments the active request id for each new request", () => {
    expect(beginLatestOnlyRequest(0)).toBe(1);
    expect(beginLatestOnlyRequest(1)).toBe(2);
  });

  it("treats only the active request response as current", () => {
    expect(isLatestOnlyResponse(2, 2)).toBe(true);
    expect(isLatestOnlyResponse(2, 1)).toBe(false);
  });

  it("switches Session Monitoring drilldown actions to Support Diagnostics with the ExamAttempt filter applied", () => {
    expect(
      buildExamAttemptDiagnosticsNavigation(
        {
          source: "runtime",
          outcome: "failure",
        },
        "  attempt-a  ",
      ),
    ).toEqual({
      tab: "diagnostics",
      filters: {
        source: "runtime",
        outcome: "failure",
        examAttemptId: "attempt-a",
      },
      pageOffset: 0,
      href: "/admin?tab=diagnostics&examAttemptId=attempt-a&outcome=failure&source=runtime",
    });
  });
});

describe("getExamAuthoringMode", () => {
  it("treats a new draft as fully editable", () => {
    expect(getExamAuthoringMode(null)).toEqual({
      isEditingDraft: false,
      provisioningLocked: false,
      tupleChangeHint: null,
    });
  });

  it("locks the provisioning tuple while editing an existing draft", () => {
    expect(getExamAuthoringMode("exam-1")).toEqual({
      isEditingDraft: true,
      provisioningLocked: true,
      tupleChangeHint:
        "Project, Blueprint, and Snapshot are locked while editing a draft. Policy and allowed Regions can still be changed.",
    });
  });
});

describe("admin tab model", () => {
  it("treats Candidate provisioning as its own admin context", () => {
    expect(ADMIN_TABS).toContain("candidates");
    expect(ADMIN_TABS).toContain("monitoring");
    expect(getAdminTabLabel("candidates")).toBe("Candidates");
    expect(getAdminTabLabel("monitoring")).toBe("Session Monitoring");
    expect(ADMIN_TABS).toContain("diagnostics");
    expect(ADMIN_TABS).not.toContain("support");
    expect(getAdminTabLabel("diagnostics")).toBe("Support Diagnostics");
    expect(shouldShowCandidateProvisioning("diagnostics")).toBe(false);
    expect(shouldShowCandidateProvisioning("candidates")).toBe(true);
    expect(shouldShowCandidateProvisioning("connection")).toBe(false);
    expect(shouldShowCandidateProvisioning("exams")).toBe(false);
    expect(shouldShowCandidateProvisioning("monitoring")).toBe(false);
    expect(shouldShowCandidateProvisioning("audit")).toBe(false);
    expect(shouldShowCandidateProvisioning("events")).toBe(false);
    expect(shouldShowCandidateProvisioning("support")).toBe(false);
    expect(shouldShowCandidateProvisioning("resources")).toBe(false);
  });

  it("clears dismissible admin banners only when changing tabs", () => {
    expect(shouldClearAdminBannerOnTabChange("candidates", "exams")).toBe(true);
    expect(shouldClearAdminBannerOnTabChange("candidates", "candidates")).toBe(false);
  });
});

describe("diagnostic log filter state", () => {
  it("normalises filter input for a stable diagnostic query", () => {
    const filters: DiagnosticLogFilters = normaliseDiagnosticLogFilters({
      examAttemptId: "  attempt-1  ",
      examId: " exam-1 ",
      candidateEmail: " Candidate@HeliosCX.demo ",
      operation: " exam_attempt.resume ",
      outcome: "failure",
      source: " runtime ",
      integrationSurface: " cloudshare.v4.environment ",
      correlationId: " corr-1 ",
      externalId: " env-123 ",
      from: " 2026-06-21T10:00 ",
      to: " 2026-06-21T11:00 ",
    });

    expect(filters).toEqual({
      examAttemptId: "attempt-1",
      examId: "exam-1",
      candidateEmail: "candidate@helioscx.demo",
      operation: "exam_attempt.resume",
      outcome: "failure",
      source: "runtime",
      integrationSurface: "cloudshare.v4.environment",
      correlationId: "corr-1",
      externalId: "env-123",
      from: "2026-06-21T10:00",
      to: "2026-06-21T11:00",
    });
  });

  it("serialises only active filters plus bounded page parameters", () => {
    const query = buildDiagnosticLogQueryString(
      {
        examAttemptId: "attempt-1",
        candidateEmail: "candidate@helioscx.demo",
        outcome: "failure",
        source: "runtime",
        externalId: "env-123",
      },
      { limit: 50, offset: 100 },
    );

    expect(query).toBe(
      "?examAttemptId=attempt-1&candidateEmail=candidate%40helioscx.demo&outcome=failure&source=runtime&externalId=env-123&limit=50&offset=100",
    );
  });

  it("builds an admin diagnostics URL that makes the diagnostic log the primary investigation surface", () => {
    expect(
      buildAdminConsoleHref({
        tab: "diagnostics",
        diagnosticFilters: {
          examAttemptId: "attempt-1",
          candidateEmail: "Candidate@HeliosCX.demo",
          correlationId: "corr-1",
        },
      }),
    ).toBe(
      "/admin?tab=diagnostics&examAttemptId=attempt-1&candidateEmail=candidate%40helioscx.demo&correlationId=corr-1",
    );
    expect(buildCorrelationDiagnosticsHref(" corr-9 ")).toBe(
      "/admin?tab=diagnostics&correlationId=corr-9",
    );
  });

  it("parses admin route state so linked investigations reopen on the diagnostics tab with filters applied", () => {
    expect(
      parseAdminConsoleRouteState({
        tab: "diagnostics",
        examAttemptId: " attempt-9 ",
        candidateEmail: " Candidate@HeliosCX.demo ",
        correlationId: [" corr-99 "],
        outcome: "failure",
      }),
    ).toEqual({
      tab: "diagnostics",
      diagnosticFilters: {
        examAttemptId: "attempt-9",
        candidateEmail: "candidate@helioscx.demo",
        correlationId: "corr-99",
        outcome: "failure",
      },
    });

    expect(parseAdminConsoleRouteState({ tab: "monitoring", examAttemptId: "attempt-9" })).toEqual({
      tab: "monitoring",
      diagnosticFilters: {},
    });
  });
});

describe("monitoring history state", () => {
  function makeMonitoringView(partial: Partial<AdminMonitoringView> = {}): AdminMonitoringView {
    return {
      summary: {
        scheduled: 1,
        ready: 0,
        inProgress: 0,
        suspended: 0,
        completed: 2,
        expired: 1,
      },
      currentAttempts: {
        scheduled: [],
        ready: [],
        inProgress: [],
        suspended: [],
      },
      history: [],
      historyPage: {
        limit: 2,
        offset: 0,
        returned: 0,
        total: 3,
        hasMore: false,
        nextOffset: null,
      },
      ...partial,
    };
  }

  it("serialises bounded terminal-history paging parameters for the monitoring API", () => {
    expect(buildMonitoringHistoryQueryString({ limit: 25, offset: 50 })).toBe(
      "?historyLimit=25&historyOffset=50",
    );
  });

  it("merges the next completed and expired history page without duplicating attempts", () => {
    const merged = mergeMonitoringHistoryPage(
      makeMonitoringView({
        history: [
          {
            id: "attempt-3",
            examId: "exam-3",
            examTitle: "Helios Advanced",
            candidateId: "candidate-3",
            candidateName: "Jordan Park",
            candidateEmail: "jordan@helioscx.demo",
            status: "completed",
            scheduledFor: "2026-06-21T12:00:00.000Z",
            createdAt: "2026-06-20T12:00:00.000Z",
            trainingId: null,
            experienceId: null,
            environmentExternalId: null,
            participantId: null,
            scoreRetrievalEnabled: false,
            timeline: [],
          },
        ],
        historyPage: {
          limit: 2,
          offset: 0,
          returned: 1,
          total: 3,
          hasMore: true,
          nextOffset: 1,
        },
      }),
      makeMonitoringView({
        history: [
          {
            id: "attempt-3",
            examId: "exam-3",
            examTitle: "Helios Advanced",
            candidateId: "candidate-3",
            candidateName: "Jordan Park",
            candidateEmail: "jordan@helioscx.demo",
            status: "completed",
            scheduledFor: "2026-06-21T12:00:00.000Z",
            createdAt: "2026-06-20T12:00:00.000Z",
            trainingId: null,
            experienceId: null,
            environmentExternalId: null,
            participantId: null,
            scoreRetrievalEnabled: false,
            timeline: [],
          },
          {
            id: "attempt-2",
            examId: "exam-2",
            examTitle: "Helios Operations",
            candidateId: "candidate-2",
            candidateName: "Casey Rivera",
            candidateEmail: "casey@helioscx.demo",
            status: "expired",
            scheduledFor: "2026-06-21T11:00:00.000Z",
            createdAt: "2026-06-20T11:00:00.000Z",
            trainingId: null,
            experienceId: null,
            environmentExternalId: null,
            participantId: null,
            scoreRetrievalEnabled: false,
            timeline: [],
          },
        ],
        historyPage: {
          limit: 2,
          offset: 1,
          returned: 2,
          total: 3,
          hasMore: false,
          nextOffset: null,
        },
      }),
    );

    expect(merged.history.map((attempt) => attempt.id)).toEqual(["attempt-3", "attempt-2"]);
    expect(merged.historyPage).toEqual({
      limit: 2,
      offset: 1,
      returned: 2,
      total: 3,
      hasMore: false,
      nextOffset: null,
    });
  });
});

describe("admin session expiry", () => {
  it("treats admin API 401 responses as expired sessions", () => {
    expect(isAdminSessionExpiredStatus(401)).toBe(true);
    expect(isAdminSessionExpiredStatus(403)).toBe(false);
    expect(isAdminSessionExpiredStatus(500)).toBe(false);
    expect(ADMIN_SESSION_EXPIRED_MESSAGE).toContain("session has expired");
  });
});

describe("webhook callback URL", () => {
  it("combines the public base URL and per-Customer webhook path", () => {
    expect(
      buildWebhookCallbackUrl(
        "https://example.trycloudflare.com/",
        "/api/webhooks/cloudshare/token-123",
      ),
    ).toBe("https://example.trycloudflare.com/api/webhooks/cloudshare/token-123");
  });

  it("returns null until both values are present", () => {
    expect(buildWebhookCallbackUrl("", "/api/webhooks/cloudshare/token-123")).toBeNull();
    expect(buildWebhookCallbackUrl("https://example.test", null)).toBeNull();
  });
});

describe("allowed Region selection state", () => {
  const regions = [
    { id: "region-1", name: "eu-west", friendlyName: "EU West" },
    { id: "region-2", name: "us-east", friendlyName: "US East" },
    { id: "region-3", name: "ap-south", friendlyName: "AP South" },
  ];

  it("filters compatible Regions to the default Snapshot deployment set", () => {
    expect(
      getCompatibleRegions(regions, {
        id: "snap-1",
        name: "Default Snapshot",
        isDefault: true,
        regionIds: ["region-1", "region-2"],
      }),
    ).toEqual([
      { id: "region-1", name: "eu-west", friendlyName: "EU West" },
      { id: "region-2", name: "us-east", friendlyName: "US East" },
    ]);
  });

  it("does not fall back to global Regions when the default Snapshot has no deployed Regions", () => {
    expect(
      getCompatibleRegions(regions, {
        id: "snap-1",
        name: "Default Snapshot",
        isDefault: true,
        regionIds: [],
      }),
    ).toEqual([]);
  });

  it("drops selected Regions that are no longer supported after a tuple change", () => {
    const compatibleRegions = getCompatibleRegions(regions, {
      id: "snap-1",
      name: "Default Snapshot",
      isDefault: true,
      regionIds: ["region-2"],
    });

    expect(reconcileAllowedRegionIds(["region-1", "region-2"], compatibleRegions)).toEqual([
      "region-2",
    ]);
  });

  it("requires at least one compatible Region before an exam can be saved", () => {
    expect(getAllowedRegionValidationMessage([], regions)).toBe(
      "Select at least one allowed Region from the Blueprint default Snapshot.",
    );
    expect(getAllowedRegionValidationMessage(["region-1"], [])).toBe(
      "The selected Blueprint default Snapshot is not deployed to any Regions yet.",
    );
    expect(getAllowedRegionValidationMessage(["region-1"], regions)).toBeNull();
  });
});
