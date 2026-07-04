import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AdminCandidateRosterPanel,
  AdminConsole,
  CohortSessionAuthoringPanel,
  ExamCatalogLoadingOverlay,
  normalizeAdminLocalDateTime,
} from "./admin-console";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("AdminConsole", () => {
  it("renders Support Diagnostics as the primary support navigation label", () => {
    const html = renderToStaticMarkup(createElement(AdminConsole, { email: "admin@helioscx.demo" }));

    expect(html).toContain("Support Diagnostics");
    expect(html).not.toContain("Support Workbench");
    expect(html).toContain("Session Monitoring");
  });

  it("does not render legacy Event Log or Resources as admin navigation tabs", () => {
    const html = renderToStaticMarkup(createElement(AdminConsole, { email: "admin@helioscx.demo" }));

    expect(html).toContain("Exam Catalog");
    expect(html).toContain("Support Diagnostics");
    expect(html).not.toContain("Event Log");
    expect(html).not.toContain("Resources");
  });

  it("renders the admin navigation as a balanced responsive tab grid", () => {
    const html = renderToStaticMarkup(createElement(AdminConsole, { email: "admin@helioscx.demo" }));

    expect(html).toContain("grid-template-columns:repeat(auto-fit, minmax(10.5rem, 1fr))");
    expect(html).toContain("width:100%");
    expect(html).toContain("text-align:center");
  });

  it("renders an obvious active admin tab without the extra workflow context panel", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "monitoring",
      }),
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Session Monitoring");
    expect(html).toContain("Support Diagnostics");
    expect(html).not.toContain("Active workflow");
    expect(html).not.toContain("Monitor current ExamAttempt state, then open Support Diagnostics for the forensic trace.");
  });

  it("reopens on the Diagnostic Log tab when route state links to an ExamAttempt investigation", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "diagnostics",
        initialDiagnosticFilters: {
          examAttemptId: "attempt-42",
          correlationId: "corr-42",
        },
      }),
    );

    expect(html).toContain("This is the primary support workflow.");
    expect(html).toContain("Filtered to ExamAttempt ID");
    expect(html).toContain("attempt-42");
  });

  it("reopens on the Diagnostic Log tab when route state links from a correlation-based support action", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "diagnostics",
        initialDiagnosticFilters: {
          correlationId: "corr-42",
        },
      }),
    );

    expect(html).toContain("This is the primary support workflow.");
    expect(html).toContain("Filtered to correlation ID");
    expect(html).toContain("corr-42");
  });

  it("renders diagnostics filters as a grouped investigative panel", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "diagnostics",
      }),
    );

    expect(html).toContain("Investigative filters");
    expect(html).toContain("Investigation thread");
    expect(html).toContain("Event details");
    expect(html).toContain("Apply Filters");
    expect(html).toContain("Refresh Page");
  });

  it("renders audit trail filters with apply, clear, and refresh actions", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "audit",
      }),
    );

    expect(html).toContain("ExamAttempt ID");
    expect(html).toContain("Action");
    expect(html).toContain("Actor email");
    expect(html).toContain("Subject type");
    expect(html).toContain("Subject ID");
    expect(html).toContain("Exam ID");
    expect(html).toContain("Apply Filters");
    expect(html).toContain("Clear Filters");
    expect(html).toContain("Refresh Page");
  });

  it("renders the manually authored Exam open period field", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
      }),
    );

    expect(html).toContain("Open period (minutes)");
    expect(html).toContain("CloudShare Experience duration from scheduled start");
    expect(html).toContain("defaults to the Policy runtime lease");
    expect(html).toContain("Time limit follows the selected CloudShare Policy runtime lease.");
    expect(html).not.toContain("defaults from Policy storage retention");
  });

  it("renders Exam delivery availability and draft Cohort Exam Session controls", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
      }),
    );

    expect(html).toContain("Delivery availability");
    expect(html).toContain("Individual Exam Delivery only");
    expect(html).toContain("Cohort Exam Sessions only");
    expect(html).toContain("Individual and Cohort delivery");
    expect(html).toContain("Draft Cohort Exam Sessions");
  });

  it("does not render draft Cohort Exam Session form controls for individual-only Exams", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionAuthoringPanel, {
        examId: "exam-1",
        deliveryAvailability: "individual",
        form: { name: "", admissionStartsAt: "", admissionEndsAt: "", capacity: "" },
        sessions: [],
        loading: false,
        onChange: vi.fn(),
        onCreate: vi.fn(),
        onSelect: vi.fn(),
      }),
    );

    expect(html).toContain("Draft Cohort Exam Sessions");
    expect(html).toContain("Cohort Exam Sessions are unavailable for individual-only Exams.");
    expect(html).not.toContain("Create Draft Cohort Session");
    expect(html).not.toContain("Admission opens");
  });

  it("renders draft Cohort Exam Session form controls for cohort-capable Exams", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionAuthoringPanel, {
        examId: "exam-1",
        deliveryAvailability: "both",
        form: { name: "", admissionStartsAt: "", admissionEndsAt: "", capacity: "" },
        sessions: [],
        loading: false,
        onChange: vi.fn(),
        onCreate: vi.fn(),
        onSelect: vi.fn(),
      }),
    );

    expect(html).toContain("Create Draft Cohort Session");
    expect(html).toContain("Admission opens");
  });

  it("normalizes admin datetime-local values before draft Cohort Exam Session POST", () => {
    expect(normalizeAdminLocalDateTime("2026-07-05T09:00")).toBe(
      new Date("2026-07-05T09:00").toISOString(),
    );
    expect(normalizeAdminLocalDateTime("")).toBeNull();
  });

  it("renders an Exam Catalog busy overlay that freezes the authoring surface while resources load", () => {
    const html = renderToStaticMarkup(createElement(ExamCatalogLoadingOverlay));

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading Exam Catalog resources");
    expect(html).toContain("portal-spinner");
    expect(html).toContain("position:absolute");
    expect(html).toContain("inset:0");
    expect(html).toContain("align-items:flex-start");
    expect(html).toContain("justify-items:center");
    expect(html).toContain("flex-wrap:wrap");
    expect(html).toContain("max-width:min(100%, 22rem)");
  });

  it("renders Support Diagnostics without legacy workbench or support-log controls", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "diagnostics",
      }),
    );

    expect(html).toContain("The correlated diagnostic log");
    expect(html).not.toContain("Legacy/raw support traces");
    expect(html).not.toContain("Load Recent Webhook Diagnostics");
    expect(html).not.toContain("Recent Webhook Diagnostics");
    expect(html).not.toContain("Load Full Support Log");
    expect(html).not.toContain("Support Log");
    expect(html).not.toContain("support-workbench");
  });

  it("renders candidate roster rows, score evidence, and selected candidate ExamAttempts", () => {
    const candidate = {
      id: "candidate-1",
      email: "casey@helioscx.demo",
      firstName: "Casey",
      lastName: "Rivera",
      name: "Casey Rivera",
      createdAt: "2026-06-18T09:00:00.000Z",
      attemptSummary: {
        scheduled: 1,
        ready: 0,
        inProgress: 0,
        suspended: 0,
        completed: 1,
        expired: 0,
        total: 2,
      },
      latestAttempt: {
        id: "attempt-2",
        examId: "exam-1",
        examTitle: "Helios Cloud Admin",
        status: "scheduled" as const,
        scheduledFor: "2026-06-20T10:00:00.000Z",
        createdAt: "2026-06-18T10:00:00.000Z",
        updatedAt: "2026-06-18T12:00:00.000Z",
        completedAt: null,
        scoreRetrievalEnabled: false,
        score: null,
      },
      latestScore: {
        scoreAvailable: true,
        percentComplete: 82,
        stepsCompleted: 9,
        stepsTotal: 11,
        retrievedAt: "2026-06-19T11:05:00.000Z",
      },
      attempts: [
        {
          id: "attempt-1",
          examId: "exam-1",
          examTitle: "Helios Cloud Admin",
          status: "completed" as const,
          scheduledFor: "2026-06-19T10:00:00.000Z",
          createdAt: "2026-06-18T10:00:00.000Z",
          updatedAt: "2026-06-19T11:00:00.000Z",
          completedAt: "2026-06-19T11:00:00.000Z",
          scoreRetrievalEnabled: true,
          score: {
            scoreAvailable: true,
            percentComplete: 82,
            stepsCompleted: 9,
            stepsTotal: 11,
            retrievedAt: "2026-06-19T11:05:00.000Z",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(AdminCandidateRosterPanel, {
        candidates: [candidate],
        selectedCandidate: candidate,
        loading: false,
        onOpenCandidate: vi.fn(),
      }),
    );

    expect(html).toContain("Candidate roster");
    expect(html).toContain("Casey Rivera");
    expect(html).toContain("casey@helioscx.demo");
    expect(html).toContain("2 total | 1 scheduled | 1 completed");
    expect(html).toContain("82% (9/11 steps)");
    expect(html).toContain("Candidate exam history");
    expect(html).toContain("attempt-1");
  });

  it("renders Guided Journey pass and fail rates in candidate history when available", () => {
    const candidate = {
      id: "candidate-1",
      email: "casey@helioscx.demo",
      firstName: "Casey",
      lastName: "Rivera",
      name: "Casey Rivera",
      createdAt: "2026-06-18T09:00:00.000Z",
      attemptSummary: {
        scheduled: 0,
        ready: 0,
        inProgress: 0,
        suspended: 0,
        completed: 1,
        expired: 0,
        total: 1,
      },
      latestAttempt: null,
      latestScore: {
        scoreAvailable: true,
        percentComplete: 25,
        stepsCompleted: 1,
        stepsTotal: 4,
        passedRate: 0,
        failedRate: 1,
        retrievedAt: "2026-06-19T11:05:00.000Z",
      },
      attempts: [
        {
          id: "attempt-1",
          examId: "exam-1",
          examTitle: "Linux Environment with xRDP v2",
          status: "completed" as const,
          scheduledFor: "2026-06-19T10:00:00.000Z",
          createdAt: "2026-06-18T10:00:00.000Z",
          updatedAt: "2026-06-19T11:00:00.000Z",
          completedAt: "2026-06-19T11:00:00.000Z",
          scoreRetrievalEnabled: true,
          score: {
            scoreAvailable: true,
            percentComplete: 25,
            stepsCompleted: 1,
            stepsTotal: 4,
            passedRate: 0,
            failedRate: 1,
            retrievedAt: "2026-06-19T11:05:00.000Z",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(AdminCandidateRosterPanel, {
        candidates: [candidate],
        selectedCandidate: candidate,
        loading: false,
        onOpenCandidate: vi.fn(),
      }),
    );

    expect(html).toContain("Linux Environment with xRDP v2");
    expect(html).toContain("0% passed, 100% failed (1/4 steps)");
  });
});
