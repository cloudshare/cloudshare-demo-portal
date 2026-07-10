import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AdminCandidateRosterPanel,
  AdminConsole,
  CloudShareConnectionTestWarning,
  CohortSessionDraftOnlyNotice,
  CohortSessionAuthoringPanel,
  CohortSessionWorkspacePanel,
  ExamWorkspaceBreadcrumbs,
  ExamAuthoringSelectionSummary,
  ExamCatalogRowActions,
  ExamCatalogLoadingOverlay,
  getDeliveryAvailabilityAuthoringOptions,
  getDuplicateExamResourceTupleWarning,
  formatCohortSessionDateTime,
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

  it("renders CloudShare test failures as a connection-action warning with diagnostics link", () => {
    const html = renderToStaticMarkup(
      createElement(CloudShareConnectionTestWarning, {
        warning:
          "CloudShare is returning a 429 error for the current request. This is likely CloudShare rate limiting or abuse protection blocking the request. Check whether this public IP needs CloudShare allow-list or abuse-list review before retrying by contacting support@cloudshare.com.",
        correlationId: "corr-rate-limit",
      }),
    );

    expect(html).toContain("CloudShare is returning a 429 error");
    expect(html).toContain("support@cloudshare.com");
    expect(html).toContain("public IP");
    expect(html).toContain("Support Diagnostics");
    expect(html).toContain("/admin?tab=support&amp;view=diagnostics&amp;correlationId=corr-rate-limit");
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
    expect(html).not.toContain("Monitor current exam attempt state, then open Support Diagnostics for the forensic trace.");
  });

  it("reopens on the Diagnostic Log tab when route state links to an exam attempt investigation", () => {
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
    expect(html).toContain("Filtered to exam attempt ID");
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

    expect(html).toContain("Exam attempt ID");
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
    expect(html).not.toContain("Individual + Cohort Exam");
  });

  it("does not offer the legacy combined delivery mode while authoring Exams", () => {
    expect(getDeliveryAvailabilityAuthoringOptions("individual")).toEqual([
      { value: "individual", label: "Individual Exam", disabled: false },
      { value: "cohort", label: "Cohort Exam", disabled: false },
    ]);

    expect(getDeliveryAvailabilityAuthoringOptions("both")).toEqual([
      { value: "individual", label: "Individual Exam", disabled: false },
      { value: "cohort", label: "Cohort Exam", disabled: false },
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

  it("renders the exam workspace navigation as breadcrumb-style context instead of a primary action", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
      }),
    );

    expect(html).toContain('aria-label="Exam workspace"');
    expect(html).toContain("<nav");
    expect(html).toContain("<ol");
    expect(html).toContain("Catalog overview");
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("disabled=\"\"");
  });

  it("keeps the Exam Catalog overview list-only without inline authoring or Cohort Session create controls", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
      }),
    );

    expect(html).toContain("Current Exam Catalog");
    expect(html).toContain("Archived Exams");
    expect(html).toContain("Create Exam");
    expect(html).not.toContain("Project-first Exam authoring");
    expect(html).not.toContain("Session name");
    expect(html).not.toContain("Create Draft Cohort Session");
  });

  it("labels archived Individual Exams as history and support records instead of active catalog entries", () => {
    const html = renderToStaticMarkup(
      createElement(ExamCatalogRowActions, {
        exam: {
          id: "exam-archived",
          status: "archived",
          deliveryAvailability: "individual",
        },
        loading: false,
        editingExamId: null,
        onEdit: vi.fn(),
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onArchive: vi.fn(),
        onManageCohortSessions: vi.fn(),
      }),
    );

    expect(html).toContain("Archived for history and support review.");
    expect(html).not.toContain("Archive Exam");
  });

  it("hides the global Create Exam action while managing Cohort Sessions for a focused Exam", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
        initialExamView: "sessions",
      }),
    );

    expect(html).not.toContain(">Create Exam<");
  });

  it("hides the global Create Exam action while viewing a focused Cohort Session workspace", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
        initialExamView: "session",
      }),
    );

    expect(html).not.toContain(">Create Exam<");
  });

  it("keeps Guided Journey aggregate progress out of the regular Exam workspace", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
        initialExamView: "edit",
      }),
    );

    expect(html).not.toContain("Guided Journey aggregate progress");
    expect(html).not.toContain("This Cohort Exam Session / CloudShare Experience");
  });

  it("shows the focused session name in exam workspace breadcrumbs", () => {
    const html = renderToStaticMarkup(
      createElement(ExamWorkspaceBreadcrumbs, {
        examView: "session",
        focusedExamTitle: "Windows Boxes",
        focusedSessionName: "July Cohort Session",
        onNavigateToCatalog: vi.fn(),
        onNavigateToSessions: vi.fn(),
      }),
    );

    expect(html).toContain("Catalog overview");
    expect(html).toContain("Cohort Sessions: Windows Boxes");
    expect(html).toContain("July Cohort Session");
    expect(html).toContain('aria-current="page"');
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
    expect(publishedIndividualHtml).toContain("Archive Exam");
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
    expect(cohortHtml).not.toContain("Archive Exam");
    expect(cohortHtml).not.toContain("Cohort Sessions unavailable");

    const publishedCohortHtml = renderToStaticMarkup(
      createElement(ExamCatalogRowActions, {
        exam: { id: "exam-cohort-published", status: "published", deliveryAvailability: "cohort" },
        loading: false,
        editingExamId: null,
        onEdit: vi.fn(),
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onArchive: vi.fn(),
        onManageCohortSessions: vi.fn(),
      }),
    );

    expect(publishedCohortHtml).toContain("Manage Cohort Sessions");
    expect(publishedCohortHtml).toContain("Archive Exam");
    expect(publishedCohortHtml).not.toContain("Unpublish Exam");
    expect(publishedCohortHtml).not.toContain("Publish Exam");

    const blockedCohortHtml = renderToStaticMarkup(
      createElement(ExamCatalogRowActions, {
        exam: { id: "exam-cohort-active", status: "published", deliveryAvailability: "cohort" },
        loading: false,
        editingExamId: null,
        hasActiveCohortSessions: true,
        onEdit: vi.fn(),
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onArchive: vi.fn(),
        onManageCohortSessions: vi.fn(),
      }),
    );

    expect(blockedCohortHtml).toContain("disabled");
    expect(blockedCohortHtml).toContain("Retire all Cohort Exam Sessions first.");
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
    expect(bothHtml).toContain("Archive Exam");
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
    expect(html).not.toContain("September Admin Cohort · Published");
    expect(html).not.toContain("Status: Published");
    expect(html).toContain("grid-template-columns:repeat(auto-fill, minmax(16rem, 20rem))");
    expect(html).toContain("justify-content:start");
    expect(html).toContain("Published");
    expect(html).toContain("Admission opens");
    expect(html).toContain("2026-09-01T09:00Z");
    expect(html).toContain("Admission closes");
    expect(html).toContain("2026-09-30T17:00Z");
    expect(html).toContain("Capacity");
    expect(html).toContain(">25<");
    expect(html).toContain("CloudShare Experience ID");
    expect(html).toContain("EX123");
    expect(html).toContain("View session details");
  });

  it("states that candidate admission remains disabled for Cohort Exam Sessions", () => {
    const html = renderToStaticMarkup(createElement(CohortSessionDraftOnlyNotice));

    expect(html).toContain("Published Cohort Exam Sessions admit Candidates");
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

    expect(html).toContain("Publish reconciliation required");
    expect(html).not.toContain("July Admin Cohort · Publish reconciliation required");
  });

  it("renders the focused Cohort Exam Session workspace as a themed summary card with compact details", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionWorkspacePanel, {
        examTitle: "Helios CX Admin Foundations",
        session: {
          session: {
            id: "cohort-session-1",
            name: "September Admin Cohort",
            admissionStartsAt: "2026-09-01T09:00:00.000Z",
            admissionEndsAt: "2026-09-30T17:00:00.000Z",
            capacity: 25,
            status: "draft",
            cloudShareTrainingId: "TRN-123",
            cloudShareExperienceId: "EXP-123",
            cloudShareTeamId: "TEAM-123",
            publishedAt: "2026-08-30T12:30:00.000Z",
          },
          inheritedContext: {
            project: { id: "project-1", name: "Project Atlas" },
            blueprint: { id: "blueprint-1", name: "Blueprint Aurora" },
            snapshot: { id: "snapshot-1", name: "Snapshot Echo" },
            policy: { id: "policy-1", name: "Policy Orbit" },
            allowedRegions: [
              { id: "region-1", name: "useast" },
              { id: "region-2", name: "euwest" },
            ],
            instructor: { id: "instructor-1", name: "Jordan Lee" },
            scoreRetrievalEnabled: true,
            timeLimitMinutes: 90,
          },
        },
        loading: false,
        onBack: vi.fn(),
        onPublish: vi.fn(),
      }),
    );

    expect(html).toContain("Cohort Exam Session workspace");
    expect(html).toContain("September Admin Cohort");
    expect(html).not.toContain("Status: Draft");
    expect(html).toContain("Draft");
    expect(html).toContain("Admission opens");
    expect(html).toContain("2026-09-01T09:00Z");
    expect(html).toContain("Admission closes");
    expect(html).toContain("2026-09-30T17:00Z");
    expect(html).toContain("Capacity");
    expect(html).toContain("25");
    expect(html).toContain("CloudShare training ID");
    expect(html).toContain("TRN-123");
    expect(html).toContain("CloudShare Experience ID");
    expect(html).toContain("EXP-123");
    expect(html).not.toContain("CloudShare Team ID");
    expect(html).not.toContain("TEAM-123");
    expect(html).toContain("Published at");
    expect(html).toContain("2026-08-30T12:30Z");
    expect(html).toContain("Project");
    expect(html).toContain("Project Atlas");
    expect(html).toContain("Allowed Regions");
    expect(html).toContain("useast, euwest");
    expect(html).toContain("Guided Journey score retrieval");
    expect(html).toContain("Enabled");
    expect(html).toContain("Publish Cohort Session");
  });

  it("collapses duplicate CloudShare IDs in Cohort Session summaries and workspace details", () => {
    const listHtml = renderToStaticMarkup(
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

    const workspaceHtml = renderToStaticMarkup(
      createElement(CohortSessionWorkspacePanel, {
        examTitle: "Helios CX Admin Foundations",
        session: {
          session: {
            id: "cohort-session-1",
            name: "September Admin Cohort",
            admissionStartsAt: "2026-09-01T09:00:00.000Z",
            admissionEndsAt: "2026-09-30T17:00:00.000Z",
            capacity: 25,
            status: "draft",
            cloudShareTrainingId: "EX123",
            cloudShareExperienceId: "EX123",
          },
          inheritedContext: {
            project: { id: "project-1", name: "Project Atlas" },
            blueprint: { id: "blueprint-1", name: "Blueprint Aurora" },
            snapshot: { id: "snapshot-1", name: "Snapshot Echo" },
            policy: { id: "policy-1", name: "Policy Orbit" },
            allowedRegions: [{ id: "region-1", name: "useast" }],
            instructor: { id: "instructor-1", name: "Jordan Lee" },
            scoreRetrievalEnabled: true,
            timeLimitMinutes: 90,
          },
        },
        loading: false,
        onBack: vi.fn(),
        onPublish: vi.fn(),
      }),
    );

    expect(listHtml).toContain("CloudShare Experience ID");
    expect(listHtml).not.toContain("CloudShare training ID");
    expect(workspaceHtml).toContain("CloudShare Experience ID");
    expect(workspaceHtml).not.toContain("CloudShare training ID");
  });

  it("keeps distinct CloudShare training and Experience IDs visible and wraps long values in detail cells", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionWorkspacePanel, {
        examTitle: "Helios CX Admin Foundations",
        session: {
          session: {
            id: "cohort-session-1",
            name: "September Admin Cohort",
            admissionStartsAt: "2026-09-01T09:00:00.000Z",
            admissionEndsAt: "2026-09-30T17:00:00.000Z",
            capacity: 25,
            status: "draft",
            cloudShareTrainingId: "TRN-1234567890-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            cloudShareExperienceId: "EXP-1234567890-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
          },
          inheritedContext: {
            project: { id: "project-1", name: "Project Atlas" },
            blueprint: { id: "blueprint-1", name: "Blueprint Aurora" },
            snapshot: { id: "snapshot-1", name: "Snapshot Echo" },
            policy: { id: "policy-1", name: "Policy Orbit" },
            allowedRegions: [{ id: "region-1", name: "useast" }],
            instructor: { id: "instructor-1", name: "Jordan Lee" },
            scoreRetrievalEnabled: true,
            timeLimitMinutes: 90,
          },
        },
        loading: false,
        onBack: vi.fn(),
        onPublish: vi.fn(),
      }),
    );

    expect(html).toContain("CloudShare training ID");
    expect(html).toContain("TRN-1234567890-ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(html).toContain("CloudShare Experience ID");
    expect(html).toContain("EXP-1234567890-ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("renders session monitoring counts, portal attempts, CloudShare participants, and diagnostics links on the focused workspace", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionWorkspacePanel, {
        examTitle: "Helios CX Admin Foundations",
        session: {
          session: {
            id: "cohort-session-1",
            name: "September Admin Cohort",
            admissionStartsAt: "2026-09-01T09:00:00.000Z",
            admissionEndsAt: "2026-09-30T17:00:00.000Z",
            capacity: 25,
            status: "published",
            cloudShareTrainingId: "EX123",
            cloudShareExperienceId: "EX123",
          },
          inheritedContext: {
            project: { id: "project-1", name: "Project Atlas" },
            blueprint: { id: "blueprint-1", name: "Blueprint Aurora" },
            snapshot: { id: "snapshot-1", name: "Snapshot Echo" },
            policy: { id: "policy-1", name: "Policy Orbit" },
            allowedRegions: [{ id: "region-1", name: "useast" }],
            instructor: { id: "instructor-1", name: "Jordan Lee" },
            scoreRetrievalEnabled: true,
            timeLimitMinutes: 90,
          },
        },
        mode: "monitoring",
        detail: {
          summary: {
            activeCount: 2,
            inProgressCount: 2,
            completedCount: 1,
            problemCount: 1,
            portalAttemptCount: 2,
            cloudShareParticipantCount: 3,
            derivedFrom: "portal_and_cloudshare",
          },
          portalAttempts: [
            {
              id: "attempt-1",
              candidateId: "candidate-1",
              candidateName: "Casey Rivera",
              candidateEmail: "casey@helioscx.demo",
              status: "in_progress",
              scheduledFor: "2026-09-01T09:00:00.000Z",
              createdAt: "2026-09-01T09:00:00.000Z",
              trainingId: "EX123",
              experienceId: "EX123",
              environmentExternalId: "env-1",
              environmentId: "env-1",
              participantId: "student-1",
              problemReasons: ["Portal suspended; CloudShare participation still inProgress."],
              diagnosticFilters: { examAttemptId: "attempt-1" },
            },
          ],
          cloudShareParticipants: {
            status: "available",
            trainingId: "EX123",
            readError: null,
            correlationId: "corr-1",
            participants: [
              {
                email: "casey@helioscx.demo",
                firstName: "Casey",
                lastName: "Rivera",
                displayName: "Casey Rivera",
                studentId: "student-1",
                environmentId: "env-1",
                environmentStatus: "Ready",
                participationStatus: "inProgress",
                firstJoinedAt: "2026-09-01T09:10:00.000Z",
                matchedExamAttemptId: "attempt-1",
                problemReasons: ["Portal suspended; CloudShare participation still inProgress."],
                diagnosticFilters: {
                  examAttemptId: "attempt-1",
                  candidateEmail: "casey@helioscx.demo",
                  externalId: "env-1",
                },
              },
              {
                email: "taylor@helioscx.demo",
                firstName: "Taylor",
                lastName: "Ng",
                displayName: "Taylor Ng",
                studentId: "student-2",
                environmentId: "env-2",
                environmentStatus: "Running",
                participationStatus: "inProgress",
                firstJoinedAt: "2026-09-01T09:12:00.000Z",
                matchedExamAttemptId: null,
                problemReasons: ["CloudShare participant has no matching portal attempt."],
                diagnosticFilters: {
                  candidateEmail: "taylor@helioscx.demo",
                  externalId: "env-2",
                },
              },
            ],
          },
          guidedJourneyAggregate: {
            status: "available",
            experienceId: "EX123",
            readError: null,
            correlationId: "corr-aggregate-1",
            progress: {
              avgExploredRate: 0.45,
              avgInProgressRate: 0.2,
              avgNotStartedRate: 0.1,
              avgPassedRate: 0.2,
              avgFailedRate: 0.05,
              avgNotInitiatedRate: 0,
              aggSectionStatuses: [
                {
                  sectionNumber: 0,
                  title: "Check pfSense WAN Interface",
                  status: "explored",
                  avgExploredRate: 0.6,
                  avgInProgressRate: 0.1,
                  avgNotStartedRate: 0.3,
                  avgPassedRate: 0.4,
                  avgFailedRate: 0,
                  avgNotInitiatedRate: 0,
                  avgTimeSpentSeconds: 338.24936349999996,
                },
              ],
            },
          },
          diagnostics: {
            session: { examId: "exam-1", externalId: "EX123" },
            cloudShareRead: {
              correlationId: "corr-1",
              operation: "cohort_exam_session.monitor.read_participants",
            },
            guidedJourneyAggregateRead: {
              correlationId: "corr-aggregate-1",
              operation: "cohort_exam_session.guided_journey_aggregate.read",
            },
          },
        },
        loading: false,
        onBack: vi.fn(),
        onPublish: vi.fn(),
      }),
    );

    expect(html).toContain("Session monitoring");
    expect(html).toContain("Session diagnostics");
    expect(html).toContain("Session exam attempts");
    expect(html).not.toContain("Portal ExamAttempts");
    expect(html).toContain("CloudShare participants");
    expect(html).toContain("Guided Journey aggregate progress");
    expect(html).toContain("This Cohort Exam Session / CloudShare Experience");
    expect(html).toContain("Explored");
    expect(html).toContain("45%");
    expect(html).toContain("Passed");
    expect(html).toContain("20%");
    expect(html).toContain("Aggregate progress diagnostics");
    expect(html).toContain("Counts are derived from session exam attempts and the CloudShare participant read");
    expect(html).toContain("Problems");
    expect(html).toContain("Needs attention only counts actionable runtime contradictions, missing correlations, or an unavailable participant read.");
    expect(html).toContain("It is not a count of diagnostic errors.");
    expect(html).toContain(
      'title="State mismatch warnings, missing-match warnings, or CloudShare participant-check failures."',
    );
    expect(html).toContain(
      'title="Rows from Certalis portal state: Candidates who have an ExamAttempt for this Cohort Exam Session."',
    );
    expect(html).toContain(
      'title="Rows returned by CloudShare for the shared Experience/training used by this Cohort Exam Session."',
    );
    expect(html).toContain(
      'title="Open Support Diagnostics filtered to the CloudShare participant-list check for this Cohort Exam Session."',
    );
    expect(html).toContain("Rows below with reconciliation warnings: 3 total");
    expect(html).toContain("1 session exam attempt row");
    expect(html).toContain("2 CloudShare participant rows");
    expect(html).toContain("Casey Rivera");
    expect(html).toContain("Participant check diagnostics");
    expect(html).not.toContain("CloudShare read diagnostics");
    expect(html).toContain("Attempt diagnostics");
    expect(html).toContain("No session exam attempt");
    expect(html).not.toContain("No portal ExamAttempt");
    expect(html).toContain("Portal suspended; CloudShare participation still inProgress.");
    expect(html).toContain("CloudShare participant has no matching portal attempt.");
    expect(html).toContain("/admin?tab=support&amp;view=diagnostics&amp;examId=exam-1&amp;externalId=EX123");
    expect(html).toContain("/admin?tab=support&amp;view=diagnostics&amp;examAttemptId=attempt-1");
  });

  it("renders a degraded CloudShare participant read state without hiding the session workspace", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionWorkspacePanel, {
        examTitle: "Helios CX Admin Foundations",
        session: {
          session: {
            id: "cohort-session-1",
            name: "September Admin Cohort",
            admissionStartsAt: "2026-09-01T09:00:00.000Z",
            admissionEndsAt: "2026-09-30T17:00:00.000Z",
            capacity: 25,
            status: "published",
            cloudShareTrainingId: "EX123",
            cloudShareExperienceId: "EX123",
          },
          inheritedContext: {
            project: { id: "project-1", name: "Project Atlas" },
            blueprint: { id: "blueprint-1", name: "Blueprint Aurora" },
            snapshot: { id: "snapshot-1", name: "Snapshot Echo" },
            policy: { id: "policy-1", name: "Policy Orbit" },
            allowedRegions: [{ id: "region-1", name: "useast" }],
            instructor: { id: "instructor-1", name: "Jordan Lee" },
            scoreRetrievalEnabled: true,
            timeLimitMinutes: 90,
          },
        },
        mode: "monitoring",
        detail: {
          summary: {
            activeCount: 1,
            inProgressCount: 0,
            completedCount: 0,
            problemCount: 2,
            portalAttemptCount: 1,
            cloudShareParticipantCount: 0,
            derivedFrom: "portal_and_cloudshare",
          },
          portalAttempts: [],
          cloudShareParticipants: {
            status: "unavailable",
            trainingId: "EX123",
            readError: "CloudShare participant read failed for this Cohort Exam Session.",
            correlationId: "corr-1",
            participants: [],
          },
          guidedJourneyAggregate: {
            status: "unavailable",
            experienceId: "EX123",
            readError: "Aggregate Guided Journey progress is unavailable for this Cohort Exam Session / CloudShare Experience.",
            correlationId: "corr-aggregate-1",
            progress: null,
          },
          diagnostics: {
            session: { examId: "exam-1", externalId: "EX123" },
            cloudShareRead: {
              correlationId: "corr-1",
              operation: "cohort_exam_session.monitor.read_participants",
            },
            guidedJourneyAggregateRead: {
              correlationId: "corr-aggregate-1",
              operation: "cohort_exam_session.guided_journey_aggregate.read",
            },
          },
        },
        loading: false,
        onBack: vi.fn(),
        onPublish: vi.fn(),
      }),
    );

    expect(html).toContain("CloudShare participant read unavailable");
    expect(html).toContain("CloudShare participant read failed for this Cohort Exam Session.");
    expect(html).toContain("Needs attention only counts actionable runtime contradictions, missing correlations, or an unavailable participant read.");
    expect(html).toContain("The CloudShare participant read unavailable panel below also contributes to Problems.");
    expect(html).toContain("Correlation ID:");
    expect(html).toContain("corr-1");
    expect(html).toContain("/admin?tab=support&amp;view=diagnostics&amp;correlationId=corr-1");
    expect(html).toContain("Aggregate Guided Journey progress unavailable");
    expect(html).toContain("corr-aggregate-1");
    expect(html).toContain("/admin?tab=support&amp;view=diagnostics&amp;correlationId=corr-aggregate-1");
  });

  it("renders the aggregate section as disabled when the parent Exam does not retrieve Guided Journey scores", () => {
    const html = renderToStaticMarkup(
      createElement(CohortSessionWorkspacePanel, {
        examTitle: "Helios CX Admin Foundations",
        session: {
          session: {
            id: "cohort-session-1",
            name: "September Admin Cohort",
            admissionStartsAt: "2026-09-01T09:00:00.000Z",
            admissionEndsAt: "2026-09-30T17:00:00.000Z",
            capacity: 25,
            status: "published",
            cloudShareTrainingId: "EX123",
            cloudShareExperienceId: "EX123",
          },
          inheritedContext: {
            project: { id: "project-1", name: "Project Atlas" },
            blueprint: { id: "blueprint-1", name: "Blueprint Aurora" },
            snapshot: { id: "snapshot-1", name: "Snapshot Echo" },
            policy: { id: "policy-1", name: "Policy Orbit" },
            allowedRegions: [{ id: "region-1", name: "useast" }],
            instructor: { id: "instructor-1", name: "Jordan Lee" },
            scoreRetrievalEnabled: false,
            timeLimitMinutes: 90,
          },
        },
        mode: "monitoring",
        detail: {
          summary: {
            activeCount: 0,
            inProgressCount: 0,
            completedCount: 0,
            problemCount: 0,
            portalAttemptCount: 0,
            cloudShareParticipantCount: 0,
            derivedFrom: "portal_and_cloudshare",
          },
          portalAttempts: [],
          cloudShareParticipants: {
            status: "available",
            trainingId: "EX123",
            readError: null,
            correlationId: null,
            participants: [],
          },
          guidedJourneyAggregate: {
            status: "disabled",
            experienceId: "EX123",
            readError: null,
            correlationId: null,
            progress: null,
          },
          diagnostics: {
            session: { examId: "exam-1", externalId: "EX123" },
          },
        },
        loading: false,
        onBack: vi.fn(),
        onPublish: vi.fn(),
      }),
    );

    expect(html).toContain("Guided Journey aggregate progress");
    expect(html).toContain("Enable Guided Journey score retrieval on the parent Exam to view shared Experience aggregate progress.");
    expect(html).not.toContain("Aggregate progress diagnostics");
  });

  it("formats Cohort Exam Session timestamps in ISO-style UTC minutes", () => {
    expect(formatCohortSessionDateTime("2026-07-05T09:00:00.000Z")).toBe("2026-07-05T09:00Z");
    expect(formatCohortSessionDateTime(null)).toBe("-");
    expect(formatCohortSessionDateTime("not-a-date")).toBe("not-a-date");
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
