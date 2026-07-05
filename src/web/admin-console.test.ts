import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AdminCandidateRosterPanel,
  AdminConsole,
  CohortSessionDraftOnlyNotice,
  CohortSessionAuthoringPanel,
  ExamAuthoringSelectionSummary,
  ExamCatalogRowActions,
  ExamCatalogLoadingOverlay,
  getDeliveryAvailabilityAuthoringOptions,
  getDuplicateExamResourceTupleWarning,
  normalizeAdminLocalDateTime,
} from "./admin-console";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("AdminConsole", () => {
  it("renders Exams as the default admin work area and keeps CloudShare Connection out of the landing page", () => {
    const html = renderToStaticMarkup(createElement(AdminConsole, { email: "admin@helioscx.demo" }));

    expect(html).toContain("Exam Catalog");
    expect(html).toContain("Create Exam");
    expect(html).not.toContain("Save CloudShare Connection");
  });

  it("groups primary admin navigation around Exams, Candidates, Support, and Configuration", () => {
    const html = renderToStaticMarkup(createElement(AdminConsole, { email: "admin@helioscx.demo" }));

    expect(html).toContain("Exams");
    expect(html).toContain("Candidates");
    expect(html).toContain("Support");
    expect(html).toContain("Configuration");
    expect(html).not.toContain("Event Log");
    expect(html).not.toContain("Resources");
  });

  it("renders CloudShare Connection setup under Configuration", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "configuration",
      }),
    );

    expect(html).toContain("Save CloudShare Connection");
    expect(html).toContain("Test connection");
    expect(html).toContain("API ID");
  });

  it("groups support-oriented surfaces under Support", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "support",
        initialSupportView: "monitoring",
      }),
    );

    expect(html).toContain("Support workflows");
    expect(html).toContain("Session Monitoring");
    expect(html).toContain("Support Diagnostics");
    expect(html).toContain("Audit Trail");
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
        initialTab: "support",
        initialSupportView: "monitoring",
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
        initialTab: "support",
        initialSupportView: "diagnostics",
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
        initialTab: "support",
        initialSupportView: "diagnostics",
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
        initialTab: "support",
        initialSupportView: "diagnostics",
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
        initialTab: "support",
        initialSupportView: "audit",
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

  it("renders the manually authored Exam open period field on the focused Exam create surface", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
        initialExamView: "create",
      }),
    );

    expect(html).toContain("Open period (minutes)");
    expect(html).toContain("CloudShare Experience duration from scheduled start");
    expect(html).toContain("defaults to the Policy runtime lease");
    expect(html).toContain("Time limit follows the selected CloudShare Policy runtime lease.");
    expect(html).not.toContain("defaults from Policy storage retention");
  });

  it("renders Exam delivery availability on the focused Exam create surface", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
        initialExamView: "create",
      }),
    );

    expect(html).toContain("Delivery availability");
    expect(html).toContain("Individual Exam");
    expect(html).toContain("Cohort Exam");
    expect(html).toContain("Individual + Cohort Exam");
  });

  it("allows authoring every documented Exam delivery availability", () => {
    expect(getDeliveryAvailabilityAuthoringOptions("individual")).toEqual([
      { value: "individual", label: "Individual Exam", disabled: false },
      { value: "cohort", label: "Cohort Exam", disabled: false },
      { value: "both", label: "Individual + Cohort Exam", disabled: false },
    ]);

    expect(getDeliveryAvailabilityAuthoringOptions("both")).toEqual([
      { value: "individual", label: "Individual Exam", disabled: false },
      { value: "cohort", label: "Cohort Exam", disabled: false },
      { value: "both", label: "Individual + Cohort Exam", disabled: false },
    ]);
  });

  it("summarises selected authoring resources by object name, not Blueprint description", () => {
    const html = renderToStaticMarkup(
      createElement(ExamAuthoringSelectionSummary, {
        selectedProject: { id: "project-1", name: "Helios Exams 1" },
        selectedBlueprint: {
          id: "blueprint-1",
          name: "Linux Environment with xRDP v2",
          description: "Long Blueprint description should stay out of the summary.",
        },
        defaultSnapshot: {
          id: "snapshot-1",
          name: "Update guided journey",
          isDefault: true,
          regionIds: ["region-1"],
        },
        selectedAllowedRegions: [{ id: "region-1", name: "useast", friendlyName: "US East (Miami)" }],
        selectedPolicy: {
          id: "policy-1",
          name: "10 mins run time - 2 days storage - Always on",
          runtimeLeaseMinutes: 10,
          storageLeaseMinutes: 2880,
        },
        deliveryAvailability: "individual",
      }),
    );

    expect(html).toContain("Project: Helios Exams 1");
    expect(html).toContain("Blueprint: Linux Environment with xRDP v2");
    expect(html).toContain("Snapshot: Update guided journey");
    expect(html).toContain("Allowed Regions: US East (Miami)");
    expect(html).toContain("Policy: 10 mins run time - 2 days storage - Always on");
    expect(html).toContain("Delivery: Individual Exam");
    expect(html).not.toContain("Long Blueprint description");
  });

  it("marks the current Exam catalog subnav control as disabled and non-actionable", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
      }),
    );

    expect(html).toContain("Catalog overview");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("cursor:default");
  });

  it("keeps the Exam Catalog overview list-only without inline authoring or Cohort Session create controls", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
      }),
    );

    expect(html).toContain("Current Exam Catalog");
    expect(html).toContain("Create Exam");
    expect(html).not.toContain("Project-first Exam authoring");
    expect(html).not.toContain("Session name");
    expect(html).not.toContain("Create Draft Cohort Session");
  });

  it("renders only individual Exam actions for individual Exam catalog rows", () => {
    const draftIndividualHtml = renderToStaticMarkup(
      createElement(ExamCatalogRowActions, {
        exam: { id: "exam-draft", status: "draft", deliveryAvailability: "individual" },
        loading: false,
        editingExamId: null,
        onEdit: vi.fn(),
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onManageCohortSessions: vi.fn(),
      }),
    );

    expect(draftIndividualHtml).toContain("Edit Exam");
    expect(draftIndividualHtml).toContain("Publish Exam");
    expect(draftIndividualHtml).not.toContain("Manage Cohort Sessions");
    expect(draftIndividualHtml).not.toContain("Cohort Sessions unavailable");

    const publishedIndividualHtml = renderToStaticMarkup(
      createElement(ExamCatalogRowActions, {
        exam: { id: "exam-published", status: "published", deliveryAvailability: "individual" },
        loading: false,
        editingExamId: null,
        onEdit: vi.fn(),
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onManageCohortSessions: vi.fn(),
      }),
    );

    expect(publishedIndividualHtml).toContain("Unpublish Exam");
    expect(publishedIndividualHtml).not.toContain("Manage Cohort Sessions");
    expect(publishedIndividualHtml).not.toContain("Cohort Sessions unavailable");
  });

  it("keeps cohort-only catalog rows focused on Cohort Session management", () => {
    const cohortHtml = renderToStaticMarkup(
      createElement(ExamCatalogRowActions, {
        exam: { id: "exam-cohort", status: "draft", deliveryAvailability: "cohort" },
        loading: false,
        editingExamId: null,
        onEdit: vi.fn(),
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onManageCohortSessions: vi.fn(),
      }),
    );

    expect(cohortHtml).toContain("Manage Cohort Sessions");
    expect(cohortHtml).toContain("Exam setup is draft");
    expect(cohortHtml).toContain("Publish the individual Cohort Sessions after opening this Exam.");
    expect(cohortHtml).not.toContain("Edit Exam");
    expect(cohortHtml).not.toContain("Publish Exam");
    expect(cohortHtml).not.toContain("Unpublish Exam");
    expect(cohortHtml).not.toContain("Cohort Sessions unavailable");
  });

  it("keeps individual Exam lifecycle actions for mixed-delivery catalog rows", () => {
    const draftBothHtml = renderToStaticMarkup(
      createElement(ExamCatalogRowActions, {
        exam: { id: "exam-both-draft", status: "draft", deliveryAvailability: "both" },
        loading: false,
        editingExamId: null,
        onEdit: vi.fn(),
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onManageCohortSessions: vi.fn(),
      }),
    );

    expect(draftBothHtml).toContain("Manage Cohort Sessions");
    expect(draftBothHtml).toContain("Edit Exam");
    expect(draftBothHtml).toContain("Publish Exam");

    const bothHtml = renderToStaticMarkup(
      createElement(ExamCatalogRowActions, {
        exam: { id: "exam-both", status: "published", deliveryAvailability: "both" },
        loading: false,
        editingExamId: null,
        onEdit: vi.fn(),
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onManageCohortSessions: vi.fn(),
      }),
    );

    expect(bothHtml).toContain("Delivery: Individual + Cohort Exam");
    expect(bothHtml).toContain("Manage Cohort Sessions");
    expect(bothHtml).toContain("Unpublish Exam");
    expect(bothHtml).not.toContain("Publish Exam");
    expect(bothHtml).not.toContain("Cohort Sessions unavailable");
  });

  it("warns when an Exam authoring tuple duplicates another Exam", () => {
    const warning = getDuplicateExamResourceTupleWarning({
      exams: [
        {
          id: "exam-duplicate-resource-tuple",
          title: "Helios CX Admin Foundations",
          description: "",
          timeLimitMinutes: 60,
          openPeriodMinutes: 60,
          scoreRetrievalEnabled: false,
          deliveryAvailability: "individual",
          status: "draft",
          publishedAt: null,
          projectId: "project-1",
          projectName: "Project",
          blueprintId: "blueprint-1",
          blueprintName: "Blueprint",
          snapshotId: "snapshot-1",
          snapshotName: "Snapshot",
          allowedRegions: [],
          policyId: "policy-1",
          policyName: "Policy",
          instructorName: "Instructor",
        },
      ],
      currentExamId: null,
      projectId: "project-1",
      blueprintId: "blueprint-1",
      snapshotId: "snapshot-1",
      policyId: "policy-1",
      deliveryAvailability: "individual",
    });

    expect(warning).toContain("Another Exam already uses this Project");
    expect(warning).toContain("Helios CX Admin Foundations");
    expect(warning).toContain("exam-dup");
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

  it("renders Cohort Exam Sessions as detailed entries distinct from the create action", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionAuthoringPanel, {
        examId: "exam-1",
        deliveryAvailability: "cohort",
        form: { name: "", admissionStartsAt: "", admissionEndsAt: "", capacity: "" },
        sessions: [
          {
            session: {
              id: "session-1",
              name: "September Admin Cohort",
              admissionStartsAt: "2026-09-01T09:00:00.000Z",
              admissionEndsAt: "2026-09-30T17:00:00.000Z",
              capacity: 25,
              status: "published",
              cloudShareTrainingId: "EX123",
              cloudShareExperienceId: "EX123",
            },
            inheritedContext: {
              project: { id: "project-1", name: "Project" },
              blueprint: { id: "blueprint-1", name: "Blueprint" },
              snapshot: { id: "snapshot-1", name: "Snapshot" },
              policy: { id: "policy-1", name: "Policy" },
              allowedRegions: [],
              instructor: { id: "instructor-1", name: "Instructor" },
              scoreRetrievalEnabled: false,
              timeLimitMinutes: 60,
            },
          },
        ],
        loading: false,
        onChange: vi.fn(),
        onCreate: vi.fn(),
        onSelect: vi.fn(),
      }),
    );

    expect(html).toContain("Create Draft Cohort Session");
    expect(html).toContain("Existing Cohort Sessions");
    expect(html).toContain("September Admin Cohort");
    expect(html).toContain("Status: Published");
    expect(html).toContain("Admission opens:");
    expect(html).toContain("Admission closes:");
    expect(html).toContain("Capacity: 25");
    expect(html).toContain("CloudShare Experience: EX123");
    expect(html).toContain("Open Session");
  });

  it("states that candidate admission remains disabled for Cohort Exam Sessions", () => {
    const html = renderToStaticMarkup(createElement(CohortSessionDraftOnlyNotice));

    expect(html).toContain("Candidate admission remains disabled in this slice.");
  });

  it("renders admin-visible publish reconciliation wording for Cohort Exam Sessions", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionAuthoringPanel, {
        examId: "exam-1",
        deliveryAvailability: "both",
        form: { name: "", admissionStartsAt: "", admissionEndsAt: "", capacity: "" },
        sessions: [
          {
            session: {
              id: "cohort-session-1",
              name: "July Admin Cohort",
              admissionStartsAt: "2026-07-05T09:00:00.000Z",
              admissionEndsAt: null,
              capacity: null,
              status: "publish_reconciliation_required",
            },
            inheritedContext: {
              project: { id: "project-1", name: "Project" },
              blueprint: { id: "blueprint-1", name: "Blueprint" },
              snapshot: { id: "snapshot-1", name: "Snapshot" },
              policy: { id: "policy-1", name: "Policy" },
              allowedRegions: [],
              instructor: { id: "instructor-1", name: "Instructor" },
              scoreRetrievalEnabled: false,
              timeLimitMinutes: 60,
            },
          },
        ],
        loading: false,
        onChange: vi.fn(),
        onCreate: vi.fn(),
        onSelect: vi.fn(),
      }),
    );

    expect(html).toContain("July Admin Cohort · Publish reconciliation required");
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
        initialTab: "support",
        initialSupportView: "diagnostics",
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
