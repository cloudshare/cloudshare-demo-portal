/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminConsole } from "./admin-console";
import {
  AdminCohortExamSessionsFeature,
  CohortSessionMonitoringList,
  CohortSessionWorkspacePanel,
} from "./admin-cohort-exam-sessions";
import {
  buildAdminNavigationHref,
  type AdminNavigationIntent,
} from "./admin-shell-route";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }) }));

type WorkspaceProps = ComponentProps<typeof CohortSessionWorkspacePanel>;
type Session = WorkspaceProps["session"];

const shellNavigationHref = (intent: AdminNavigationIntent) => buildAdminNavigationHref(intent);

const session: Session = {
  session: {
    id: "cohort-session-1",
    name: "September Admin Cohort",
    admissionStartsAt: "2026-09-01T09:00:00.000Z",
    admissionEndsAt: "2026-09-30T17:00:00.000Z",
    capacity: 25,
    status: "published",
    cloudShareExperienceId: "experience-1",
  },
  inheritedContext: {
    project: { id: "project-1", name: "Project Atlas" },
    blueprint: { id: "blueprint-1", name: "Blueprint Aurora" },
    snapshot: { id: "snapshot-1", name: "Snapshot Echo" },
    policy: { id: "policy-1", name: "Policy Orbit" },
    allowedRegions: [],
    instructor: { id: "instructor-1", name: "Jordan Lee" },
    scoreRetrievalEnabled: false,
    timeLimitMinutes: 90,
  },
};

describe("Cohort Exam Session monitoring interactions", () => {
  it("filters contributing rows from a summary widget and clears the filter", async () => {
    const user = userEvent.setup();
    render(
      <CohortSessionWorkspacePanel
        mode="monitoring"
        examTitle="Helios Foundations"
        session={session}
        loading={false}
        onBack={vi.fn()}
        onPublish={vi.fn()}
        getNavigationHref={shellNavigationHref}
        detail={{
          summary: { activeCount: 1, inProgressCount: 1, completedCount: 1, problemCount: 0, portalAttemptCount: 2, cloudShareParticipantCount: 2, derivedFrom: "portal_and_cloudshare" },
          portalAttempts: [
            { id: "attempt-active", candidateId: "candidate-active", candidateName: "Active Casey", candidateEmail: "active@helioscx.demo", status: "in_progress", scheduledFor: null, createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: null, environmentId: null, participantId: null, summaryContributions: ["active", "in_progress"], problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-active" } },
            { id: "attempt-complete", candidateId: "candidate-complete", candidateName: "Completed Riley", candidateEmail: "completed@helioscx.demo", status: "completed", scheduledFor: null, createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: null, environmentId: null, participantId: null, summaryContributions: ["completed"], problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-complete" } },
          ],
          cloudShareParticipants: { status: "available", trainingId: "experience-1", readError: null, correlationId: null, participants: [
            { email: "active@helioscx.demo", firstName: "Active", lastName: "Casey", displayName: "Active Casey", studentId: "participant-active", environmentId: "environment-active", environmentStatus: "Running", participationStatus: "inProgress", firstJoinedAt: null, matchedExamAttemptId: "attempt-active", summaryContributions: ["active", "in_progress"], problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-active" } },
            { email: "completed@helioscx.demo", firstName: "Completed", lastName: "Riley", displayName: "Completed Riley", studentId: "participant-complete", environmentId: "environment-complete", environmentStatus: "Archived", participationStatus: "completed", firstJoinedAt: null, matchedExamAttemptId: "attempt-complete", summaryContributions: ["completed"], problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-complete" } },
            { email: "suspended@helioscx.demo", firstName: "Suspended", lastName: "Jordan", displayName: "Suspended Jordan", studentId: "participant-suspended", environmentId: "environment-suspended", environmentStatus: "Suspended", participationStatus: "inProgress", firstJoinedAt: null, matchedExamAttemptId: null, summaryContributions: [], problemReasons: [], diagnosticFilters: { candidateEmail: "suspended@helioscx.demo" } },
          ] },
          guidedJourneyAggregate: { status: "disabled", experienceId: "experience-1", readError: null, correlationId: null, progress: null },
          diagnostics: { session: { examId: "exam-1", externalId: "experience-1" } },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Active.*1/ }));
    expect(screen.getAllByText("Active Casey")).toHaveLength(2);
    expect(screen.queryByText("Completed Riley")).toBeNull();
    expect(screen.queryByText("Suspended Jordan")).toBeNull();
    expect(screen.getByRole("button", { name: "Clear summary filter" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear summary filter" }));
    expect(screen.getAllByText("Completed Riley")).toHaveLength(2);
  });

  it("filters Problems to rows with actionable reconciliation reasons only", async () => {
    const user = userEvent.setup();
    render(
      <CohortSessionWorkspacePanel
        mode="monitoring"
        examTitle="Helios Foundations"
        session={session}
        loading={false}
        onBack={vi.fn()}
        onPublish={vi.fn()}
        getNavigationHref={shellNavigationHref}
        detail={{
          summary: { activeCount: 1, inProgressCount: 1, completedCount: 0, problemCount: 1, needsAttentionCount: 1, portalAttemptCount: 2, cloudShareParticipantCount: 2, derivedFrom: "portal_and_cloudshare" },
          portalAttempts: [
            { id: "attempt-problem", candidateId: "candidate-problem", candidateName: "Problem Casey", candidateEmail: "problem@helioscx.demo", status: "in_progress", scheduledFor: null, createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: null, environmentId: null, participantId: null, reconciliation: "needs_attention", problemReasons: ["Portal has an attempt but no matching CloudShare participant."], diagnosticFilters: { examAttemptId: "attempt-problem" } },
            { id: "attempt-normal", candidateId: "candidate-normal", candidateName: "Normal Riley", candidateEmail: "normal@helioscx.demo", status: "in_progress", scheduledFor: null, createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: null, environmentId: null, participantId: null, problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-normal" } },
          ],
          cloudShareParticipants: { status: "available", trainingId: "experience-1", readError: null, correlationId: null, participants: [
            { email: "problem@helioscx.demo", firstName: "Problem", lastName: "Casey", displayName: "Problem Casey", studentId: "participant-problem", environmentId: "environment-problem", environmentStatus: "Error", participationStatus: "inProgress", firstJoinedAt: null, matchedExamAttemptId: "attempt-problem", reconciliation: "needs_attention", problemReasons: ["CloudShare environment is in a non-terminal problem state."], diagnosticFilters: { examAttemptId: "attempt-problem" } },
            { email: "normal@helioscx.demo", firstName: "Normal", lastName: "Riley", displayName: "Normal Riley", studentId: "participant-normal", environmentId: "environment-normal", environmentStatus: "Running", participationStatus: "inProgress", firstJoinedAt: null, matchedExamAttemptId: "attempt-normal", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-normal" } },
          ] },
          guidedJourneyAggregate: { status: "disabled", experienceId: "experience-1", readError: null, correlationId: null, progress: null },
          diagnostics: { session: { examId: "exam-1", externalId: "experience-1" } },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Needs attention.*1/ }));
    expect(screen.getAllByText("Problem Casey")).toHaveLength(2);
    expect(screen.queryByText("Normal Riley")).toBeNull();
    expect(screen.getByText("CloudShare environment is in a non-terminal problem state.")).toBeTruthy();
  });

  it("presents a rate-limited participant roster refresh without treating portal attempts as reconciliation problems", () => {
    render(
      <CohortSessionWorkspacePanel
        mode="monitoring"
        examTitle="Helios Foundations"
        session={session}
        loading={false}
        onBack={vi.fn()}
        onPublish={vi.fn()}
        getNavigationHref={shellNavigationHref}
        detail={{
          summary: { activeCount: 1, inProgressCount: 1, completedCount: 0, problemCount: 0, needsAttentionCount: 0, portalAttemptCount: 1, cloudShareParticipantCount: 0, derivedFrom: "portal_and_cloudshare" },
          portalAttempts: [{ id: "attempt-rate-limited", candidateId: "candidate-rate-limited", candidateName: "Casey Rivera", candidateEmail: "casey@helioscx.demo", status: "in_progress", scheduledFor: null, createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: null, environmentId: null, participantId: null, reconciliation: "unknown", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-rate-limited" } }],
          cloudShareParticipants: { status: "rate_limited", trainingId: "experience-1", readError: "CloudShare rate limited the participant roster refresh for this Cohort Exam Session.", correlationId: "corr-rate-limited-roster", retryAfterSeconds: 45, participants: [] },
          guidedJourneyAggregate: { status: "disabled", experienceId: "experience-1", readError: null, correlationId: null, progress: null },
          diagnostics: { session: { examId: "exam-1", externalId: "experience-1" }, cloudShareRead: { correlationId: "corr-rate-limited-roster", operation: "cohort_exam_session.monitor.read_participants" } },
        }}
      />,
    );

    expect(screen.getAllByText("CloudShare participant roster refresh is rate limited")).toHaveLength(1);
    expect(screen.getByText(/Retry after 45 seconds/)).toBeTruthy();
    expect(screen.getByText("Current CloudShare state is unavailable because participant monitoring is temporarily throttled; no reconciliation conclusion is available.")).toBeTruthy();
    expect(screen.getAllByText("corr-rate-limited-roster")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Participant check diagnostics" }).getAttribute("href")).toBe(
      "/admin?tab=support&view=diagnostics&operation=cohort_exam_session.monitor.read_participants&correlationId=corr-rate-limited-roster",
    );
    expect(screen.queryByText("Portal has an attempt but no matching CloudShare participant.")).toBeNull();
    expect(screen.getByRole("button", { name: /Needs attention.*0/ })).toBeTruthy();
  });

  it("filters state observations in both tables and clears the summary filter", async () => {
    const user = userEvent.setup();
    render(
      <CohortSessionWorkspacePanel
        mode="monitoring"
        examTitle="Helios Foundations"
        session={session}
        loading={false}
        onBack={vi.fn()}
        onPublish={vi.fn()}
        detail={{
          summary: { activeCount: 2, inProgressCount: 2, completedCount: 0, problemCount: 0, stateObservationCount: 2, portalAttemptCount: 2, cloudShareParticipantCount: 2, derivedFrom: "portal_and_cloudshare" },
          portalAttempts: [
            { id: "attempt-observed", candidateId: "candidate-observed", candidateName: "Observed Casey", candidateEmail: "observed@helioscx.demo", status: "in_progress", scheduledFor: null, createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: null, environmentId: null, participantId: null, reconciliation: "state_observation", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-observed" } },
            { id: "attempt-normal", candidateId: "candidate-normal", candidateName: "Normal Riley", candidateEmail: "normal@helioscx.demo", status: "in_progress", scheduledFor: null, createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: null, environmentId: null, participantId: null, reconciliation: "normal", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-normal" } },
          ],
          cloudShareParticipants: { status: "available", trainingId: "experience-1", readError: null, correlationId: null, participants: [
            { email: "observed@helioscx.demo", firstName: "Observed", lastName: "Casey", displayName: "Observed Casey", studentId: "participant-observed", environmentId: "environment-observed", environmentStatus: "Starting", participationStatus: "inProgress", firstJoinedAt: null, matchedExamAttemptId: "attempt-observed", reconciliation: "state_observation", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-observed" } },
            { email: "normal@helioscx.demo", firstName: "Normal", lastName: "Riley", displayName: "Normal Riley", studentId: "participant-normal", environmentId: "environment-normal", environmentStatus: "Running", participationStatus: "inProgress", firstJoinedAt: null, matchedExamAttemptId: "attempt-normal", reconciliation: "normal", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-normal" } },
          ] },
          guidedJourneyAggregate: { status: "disabled", experienceId: "experience-1", readError: null, correlationId: null, progress: null },
          diagnostics: { session: { examId: "exam-1", externalId: "experience-1" } },
        }}
      />,
    );

    const stateObservationsFilter = screen.getByRole("button", { name: /State observations.*2/ });
    expect(stateObservationsFilter.getAttribute("style")).toContain("background: rgb(239, 246, 255)");
    expect(screen.getByRole("button", { name: /Needs attention.*0/ }).getAttribute("style")).not.toContain("background: rgb(239, 246, 255)");

    await user.click(stateObservationsFilter);
    expect(screen.getAllByText("Observed Casey")).toHaveLength(2);
    expect(screen.queryByText("Normal Riley")).toBeNull();
    expect(screen.getAllByText("State observation: checking again on the next refresh")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Clear summary filter" }));
    expect(screen.getAllByText("Normal Riley")).toHaveLength(2);
  });

  it("explains when the state observations filter has no matching rows", async () => {
    const user = userEvent.setup();
    render(
      <CohortSessionWorkspacePanel
        mode="monitoring"
        examTitle="Helios Foundations"
        session={session}
        loading={false}
        onBack={vi.fn()}
        onPublish={vi.fn()}
        detail={{
          summary: { activeCount: 1, inProgressCount: 1, completedCount: 0, problemCount: 0, stateObservationCount: 0, portalAttemptCount: 1, cloudShareParticipantCount: 1, derivedFrom: "portal_and_cloudshare" },
          portalAttempts: [{ id: "attempt-normal", candidateId: "candidate-normal", candidateName: "Normal Riley", candidateEmail: "normal@helioscx.demo", status: "in_progress", scheduledFor: null, createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: null, environmentId: null, participantId: null, reconciliation: "normal", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-normal" } }],
          cloudShareParticipants: { status: "available", trainingId: "experience-1", readError: null, correlationId: null, participants: [{ email: "normal@helioscx.demo", firstName: "Normal", lastName: "Riley", displayName: "Normal Riley", studentId: "participant-normal", environmentId: "environment-normal", environmentStatus: "Running", participationStatus: "inProgress", firstJoinedAt: null, matchedExamAttemptId: "attempt-normal", reconciliation: "normal", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-normal" } }] },
          guidedJourneyAggregate: { status: "disabled", experienceId: "experience-1", readError: null, correlationId: null, progress: null },
          diagnostics: { session: { examId: "exam-1", externalId: "experience-1" } },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /State observations.*0/ }));
    expect(screen.getAllByText("No rows need a second state observation check on this refresh.")).toHaveLength(2);
  });

  it("opens a Cohort Exam Session monitoring detail from the Support list", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    render(
      <CohortSessionMonitoringList
        sessions={[{ exam: { id: "exam-1", title: "Helios Foundations" } as never, session }]}
        onOpen={onOpen}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open monitoring" }));

    expect(onOpen).toHaveBeenCalledWith("exam-1", "cohort-session-1");
  });

  it("moves from the Catalog workspace into Support Session Monitoring", async () => {
    const user = userEvent.setup();
    const onOpenMonitoring = vi.fn();

    render(
      <CohortSessionWorkspacePanel
        examTitle="Helios Foundations"
        session={session}
        loading={false}
        onBack={vi.fn()}
        onPublish={vi.fn()}
        onOpenMonitoring={onOpenMonitoring}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open in Session Monitoring" }));

    expect(onOpenMonitoring).toHaveBeenCalledOnce();
    expect(screen.queryByText("Session exam attempts")).toBeNull();
  });

  it("keeps Cohort diagnostics links scoped to the selected session and emits a shell navigation intent", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <CohortSessionWorkspacePanel
        mode="monitoring"
        examTitle="Helios Foundations"
        session={session}
        loading={false}
        onBack={vi.fn()}
        onPublish={vi.fn()}
        getNavigationHref={shellNavigationHref}
        onNavigate={onNavigate}
        detail={{
          summary: { activeCount: 0, inProgressCount: 0, completedCount: 0, problemCount: 0, portalAttemptCount: 0, cloudShareParticipantCount: 0, derivedFrom: "portal_and_cloudshare" },
          portalAttempts: [],
          cloudShareParticipants: { status: "available", trainingId: "experience-1", readError: null, correlationId: null, participants: [] },
          guidedJourneyAggregate: { status: "disabled", experienceId: "experience-1", readError: null, correlationId: null, progress: null },
          diagnostics: { session: { examId: "exam-1", externalId: "experience-1" } },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Session diagnostics" }).getAttribute("href")).toBe(
      "/admin?tab=support&view=diagnostics&examId=exam-1&externalId=experience-1",
    );
    await user.click(screen.getByRole("link", { name: "Session diagnostics" }));
    expect(onNavigate).toHaveBeenCalledWith({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: { examId: "exam-1", externalId: "experience-1" },
    });
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const exam = {
  id: "exam-1", title: "Helios Foundations", description: "Shared practice lab", timeLimitMinutes: 90,
  openPeriodMinutes: 120, scoreRetrievalEnabled: false, deliveryAvailability: "cohort", status: "published",
  publishedAt: "2026-09-01T00:00:00.000Z", projectId: "project-1", projectName: "Project Atlas",
  blueprintId: "blueprint-1", blueprintName: "Blueprint Aurora", snapshotId: "snapshot-1", snapshotName: "Snapshot Echo",
  allowedRegions: [], policyId: "policy-1", policyName: "Policy Orbit", instructorName: "Jordan Lee",
};

const cohortDetail = {
  session,
  monitoring: {
    summary: { activeCount: 1, inProgressCount: 1, completedCount: 0, problemCount: 0, portalAttemptCount: 1, cloudShareParticipantCount: 1, derivedFrom: "portal_and_cloudshare" },
    portalAttempts: [{ id: "attempt-1", candidateId: "candidate-1", candidateName: "Casey Rivera", candidateEmail: "casey@helioscx.demo", status: "in_progress", scheduledFor: "2026-09-01T09:00:00.000Z", createdAt: "2026-09-01T09:00:00.000Z", trainingId: "experience-1", experienceId: "experience-1", environmentExternalId: "environment-1", environmentId: "environment-1", participantId: "participant-1", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-1" } }],
    cloudShareParticipants: { status: "available", trainingId: "experience-1", readError: null, correlationId: null, participants: [{ email: "casey@helioscx.demo", firstName: "Casey", lastName: "Rivera", displayName: "Casey Rivera", studentId: "participant-1", environmentId: "environment-1", environmentStatus: "Running", participationStatus: "inProgress", firstJoinedAt: "2026-09-01T09:05:00.000Z", matchedExamAttemptId: "attempt-1", problemReasons: [], diagnosticFilters: { examAttemptId: "attempt-1" } }] },
    guidedJourneyAggregate: { status: "disabled", experienceId: "experience-1", readError: null, correlationId: null, progress: null },
    diagnostics: { session: { examId: "exam-1", externalId: "experience-1" } },
  },
};

function installAdminConsoleFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/auth/session") return json({});
    if (url === "/api/admin/cloudshare") return json({ hasConnection: true, connectedAt: null, verifiedAt: null, webhookPath: null });
    if (url === "/api/admin/exams") return json({ activeExams: [exam], archivedExams: [] });
    if (url === "/api/admin/exams/exam-1/cohort-sessions") return json({ sessions: [session] });
    if (url === "/api/admin/exams/exam-1/cohort-sessions/cohort-session-1") return json(cohortDetail);
    if (url.startsWith("/api/admin/monitoring")) return json({ monitoring: { summary: { scheduled: 0, ready: 0, inProgress: 0, suspended: 0, completed: 0, expired: 0, total: 0 }, currentAttempts: { scheduled: [], ready: [], inProgress: [], suspended: [] }, history: [], historyPage: { limit: 25, offset: 0, total: 0, hasMore: false, nextOffset: null } } });
    if (url.startsWith("/api/admin/diagnostics")) return json({ entries: [], page: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null } });
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AdminConsole Cohort Exam Session monitoring path", () => {
  it("keeps the current Support destination semantic when its submenu is collapsed", async () => {
    const user = userEvent.setup();
    installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialTab="support" initialSupportView="diagnostics" />);

    const supportSummary = screen.getByText("Support", { selector: "summary" });
    const diagnosticsLink = screen.getByRole("link", { name: "Support Diagnostics" });
    expect(diagnosticsLink.getAttribute("aria-current")).toBe("page");
    expect(supportSummary.getAttribute("aria-current")).toBeNull();

    await user.click(supportSummary);
    expect(supportSummary.getAttribute("aria-current")).toBe("page");
    expect(diagnosticsLink.getAttribute("aria-current")).toBeNull();

    await user.click(supportSummary);
    expect(supportSummary.getAttribute("aria-current")).toBeNull();
    expect(diagnosticsLink.getAttribute("aria-current")).toBe("page");
  });

  it("clears the Cohort delivery branch when entering new Exam authoring", async () => {
    const user = userEvent.setup();
    installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialDeliveryView="cohort" />);

    await user.click(await screen.findByRole("button", { name: "Create Exam" }));
    expect(routerPush).toHaveBeenCalledWith("/admin?tab=exams&view=create");
  });

  it("preserves the Cohort delivery branch through session detail and breadcrumb navigation", async () => {
    const user = userEvent.setup();
    const replaceState = vi.spyOn(window.history, "replaceState");
    installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialDeliveryView="cohort" />);

    await user.click(await screen.findByRole("button", { name: "Manage Cohort Sessions" }));
    expect(routerPush).toHaveBeenCalledWith("/admin?tab=exams&view=sessions&examId=exam-1&delivery=cohort");
    await user.click(await screen.findByRole("button", { name: "View session details" }));
    expect(replaceState).toHaveBeenCalledWith(window.history.state, "", "/admin?tab=exams&view=sessions&examId=exam-1&returnFocus=cohort-session-1&delivery=cohort");
    expect(routerPush).toHaveBeenCalledWith("/admin?tab=exams&view=session&examId=exam-1&sessionId=cohort-session-1&returnFocus=cohort-session-1&delivery=cohort");
    await user.click(screen.getByRole("button", { name: "Back to Cohort Sessions" }));
    expect(routerPush).toHaveBeenCalledWith("/admin?tab=exams&view=sessions&examId=exam-1&returnFocus=cohort-session-1&delivery=cohort");
    replaceState.mockRestore();
  });

  it("restores queue focus after the route remounts with its Session origin", async () => {
    installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialExamView="sessions" initialExamId="exam-1" initialReturnFocusSessionId="cohort-session-1" initialDeliveryView="cohort" />);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "View session details" })));
  });

  it("restores Support Monitoring queue focus after the route remounts", async () => {
    installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialTab="support" initialSupportView="monitoring" initialReturnFocusSessionId="cohort-session-1" initialDeliveryView="cohort" />);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open monitoring" })));
  });

  it("uses workspace focus when a stale Support return origin is outside the Cohort queue", async () => {
    installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialTab="support" initialSupportView="monitoring" initialReturnFocusSessionId="cohort-session-1" initialDeliveryView="individual" />);

    const workspace = document.querySelector<HTMLElement>("[data-route-focus]");
    await waitFor(() => expect(document.activeElement).toBe(workspace));
  });

  it("carries the Session focus origin through the detail breadcrumb return", async () => {
    const onNavigate = vi.fn();
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [exam], archivedExams: [] });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return json({ sessions: [session] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    render(<AdminCohortExamSessionsFeature active examView="session" focusedExamId="exam-1" focusedCohortSessionId="cohort-session-1" returnFocusSessionId="cohort-session-1" supportMonitoringActive={false} fetchAdmin={fetchAdmin} onNavigate={onNavigate} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    await userEvent.click(await screen.findByRole("button", { name: "Cohort Sessions: Helios Foundations" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ tab: "exams", examView: "sessions", examId: "exam-1", returnFocusSessionId: "cohort-session-1" });
  });

  it("falls back to workspace focus when a remounted queue no longer has its Session origin", async () => {
    installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialExamView="sessions" initialExamId="exam-1" initialReturnFocusSessionId="missing-session" initialDeliveryView="cohort" />);

    const workspace = document.querySelector<HTMLElement>("[data-route-focus]");
    await waitFor(() => expect(document.activeElement).toBe(workspace));
  });

  it("falls back to workspace focus when the return route parent Exam was deleted", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/admin/exams") return json({ activeExams: [], archivedExams: [] });
      if (String(input) === "/api/auth/session") return json({});
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchAdmin);
    render(<AdminConsole email="admin@helioscx.demo" initialExamView="sessions" initialExamId="missing-exam" initialReturnFocusSessionId="missing-session" initialDeliveryView="cohort" />);

    const workspace = document.querySelector<HTMLElement>("[data-route-focus]");
    await waitFor(() => expect(document.activeElement).toBe(workspace));
    expect(fetchAdmin.mock.calls.some(([url]) => String(url).includes("/cohort-sessions"))).toBe(false);
  });

  it("falls back to workspace focus when the return route catalog request fails", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/admin/exams") return new Response(JSON.stringify({ error: "catalog unavailable" }), { status: 503 });
      if (String(input) === "/api/auth/session") return json({});
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchAdmin);
    render(<AdminConsole email="admin@helioscx.demo" initialExamView="sessions" initialExamId="exam-1" initialReturnFocusSessionId="session-1" initialDeliveryView="cohort" />);

    const workspace = document.querySelector<HTMLElement>("[data-route-focus]");
    await waitFor(() => expect(document.activeElement).toBe(workspace));
    expect(await screen.findByText("catalog unavailable")).toBeTruthy();
  });

  it("navigates Catalog to Support detail and then scoped diagnostics through the real AdminConsole handlers", async () => {
    const user = userEvent.setup();
    const fetchMock = installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" />);

    await user.click(await screen.findByRole("button", { name: "Manage Cohort Sessions" }));
    await user.click(await screen.findByRole("button", { name: "View session details" }));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/exams/exam-1/cohort-sessions/cohort-session-1")).toHaveLength(0);
    fetchMock.mockClear();
    await user.click(await screen.findByRole("button", { name: "Open in Session Monitoring" }));
    expect(await screen.findByText("Cohort Exam Session monitoring")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to Cohort Sessions" }));
    await user.click(screen.getByRole("button", { name: "Cohort Exam Sessions" }));
    await user.click(await screen.findByRole("button", { name: "Open monitoring" }));

    expect(await screen.findByText("Cohort Exam Session monitoring")).toBeTruthy();
    expect(screen.getAllByText("Casey Rivera")).toHaveLength(2);
    expect(screen.getByText("Environment: running")).toBeTruthy();
    expect(routerPush).toHaveBeenCalledWith("/admin?tab=support&examId=exam-1&sessionId=cohort-session-1&delivery=cohort");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/exams/exam-1/cohort-sessions")).toHaveLength(0);

    await user.click(screen.getByRole("link", { name: "Session diagnostics" }));
    expect(await screen.findByText("Investigative filters")).toBeTruthy();
    expect(routerPush).toHaveBeenCalledWith("/admin?tab=support&view=diagnostics&examId=exam-1&externalId=experience-1");
  });

  it("reads each cohort-session list once after the admin chooses the Cohort branch", async () => {
    const user = userEvent.setup();
    const fetchMock = installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialTab="support" initialSupportView="monitoring" />);

    await user.click(await screen.findByRole("button", { name: "Cohort Exam Sessions" }));
    await screen.findByRole("button", { name: "Open monitoring" });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/exams/exam-1/cohort-sessions")).toHaveLength(1);
  });

  it("coalesces the cohort-session read for a cold focused Support deep link", async () => {
    const fetchMock = installAdminConsoleFetchMock();
    render(
      <AdminConsole
        email="admin@helioscx.demo"
        initialTab="support"
        initialSupportView="monitoring"
        initialExamId="exam-1"
        initialCohortSessionId="cohort-session-1"
      />,
    );

    expect(await screen.findByText("Cohort Exam Session monitoring")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/exams/exam-1/cohort-sessions")).toHaveLength(1);
  });

  it("defers the focused list read until the catalog confirms its Exam and reads it once", async () => {
    let resolveCatalog: ((response: Response) => void) | undefined;
    const catalogResponse = new Promise<Response>((resolve) => { resolveCatalog = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return catalogResponse;
      if (url === "/api/auth/session") return json({});
      if (url === "/api/admin/cloudshare") return json({ hasConnection: true, connectedAt: null, verifiedAt: null, webhookPath: null });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return json({ sessions: [session] });
      if (url === "/api/admin/exams/exam-1/cohort-sessions/cohort-session-1") return json(cohortDetail);
      if (url.startsWith("/api/admin/monitoring")) return json({ monitoring: { summary: { scheduled: 0, ready: 0, inProgress: 0, suspended: 0, completed: 0, expired: 0, total: 0 }, currentAttempts: { scheduled: [], ready: [], inProgress: [], suspended: [] }, history: [], historyPage: { limit: 25, offset: 0, total: 0, hasMore: false, nextOffset: null } } });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole email="admin@helioscx.demo" initialTab="support" initialExamId="exam-1" initialCohortSessionId="cohort-session-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/exams", undefined));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/exams/exam-1/cohort-sessions")).toHaveLength(0);
    await act(async () => resolveCatalog?.(json({ activeExams: [exam], archivedExams: [] })));
    expect(await screen.findByText("Cohort Exam Session monitoring")).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/exams/exam-1/cohort-sessions")).toHaveLength(1));
  });
});

describe("AdminCohortExamSessionsFeature seam", () => {
  it("owns focused-session loading, lifecycle errors, and shell navigation intents", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const draftSession = {
      ...session,
      session: { ...session.session, status: "draft" as const, cloudShareExperienceId: null },
    };
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [exam], archivedExams: [] });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return json({ sessions: [draftSession] });
      if (url.endsWith("/publish") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "CloudShare publishing is unavailable", correlationId: "corr-publish" }), { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <AdminCohortExamSessionsFeature
        active
        examView="session"
        focusedExamId="exam-1"
        focusedCohortSessionId="cohort-session-1"
        supportMonitoringActive={false}
        fetchAdmin={fetchAdmin}
        onNavigate={onNavigate}
        getNavigationHref={shellNavigationHref}
        catalog={null}
        onCohortActivityChange={vi.fn()}
      />,
    );

    await screen.findByText("Cohort Exam Session workspace");
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/exams/exam-1/cohort-sessions");
    await user.click(screen.getByRole("button", { name: "Open in Session Monitoring" }));
    expect(onNavigate).toHaveBeenCalledWith({
      tab: "support", supportView: "monitoring", examId: "exam-1", cohortSessionId: "cohort-session-1",
    });
    await user.click(screen.getByRole("button", { name: "Publish Cohort Session" }));
    expect((await screen.findByRole("alert")).textContent).toContain("CloudShare publishing is unavailable");
    expect(screen.getByRole("alert").textContent).toContain("corr-publish");
    expect(screen.getByRole("link", { name: "corr-publish" }).getAttribute("href")).toBe(
      "/admin?tab=support&view=diagnostics&correlationId=corr-publish",
    );
  });

  it("warms generic Monitoring on initial Support entry and reveals the cached branch without a second request", async () => {
    const user = userEvent.setup();
    const fetchMock = installAdminConsoleFetchMock();
    render(<AdminConsole email="admin@helioscx.demo" initialTab="support" initialSupportView="monitoring" />);

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/monitoring?historyLimit=25&historyOffset=0")).toHaveLength(1));
    expect(screen.queryByText(/Session Monitoring is the current-state operations surface/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Individual Exam Delivery" }));
    expect(await screen.findByText(/Session Monitoring is the current-state operations surface/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/monitoring?historyLimit=25&historyOffset=0")).toHaveLength(1);
  });

  it("keeps the newest focused monitoring response when a stale Cohort refresh resolves late", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    let resolveSecond: ((response: Response) => void) | undefined;
    const secondSession = { ...session, session: { ...session.session, id: "cohort-session-2", name: "October Admin Cohort" } };
    const fetchAdmin = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return Promise.resolve(json({ activeExams: [exam], archivedExams: [] }));
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return Promise.resolve(json({ sessions: [session, secondSession] }));
      if (url.endsWith("cohort-session-1")) return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      if (url.endsWith("cohort-session-2")) return new Promise<Response>((resolve) => { resolveSecond = resolve; });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const view = render(<AdminCohortExamSessionsFeature active examView="catalog" focusedExamId="exam-1" focusedCohortSessionId="cohort-session-1" supportMonitoringActive fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    await waitFor(() => expect(resolveFirst).toBeDefined());
    view.rerender(<AdminCohortExamSessionsFeature active examView="catalog" focusedExamId="exam-1" focusedCohortSessionId="cohort-session-2" supportMonitoringActive fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);
    await waitFor(() => expect(resolveSecond).toBeDefined());
    await act(async () => resolveSecond?.(json({ monitoring: { ...cohortDetail.monitoring, summary: { ...cohortDetail.monitoring.summary, activeCount: 2 } } })));
    expect(await screen.findByText("2")).toBeTruthy();
    await act(async () => resolveFirst?.(json({ monitoring: { ...cohortDetail.monitoring, summary: { ...cohortDetail.monitoring.summary, activeCount: 1 } } })));
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows only durable stale recovery when a listed Session detail returns 404", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [exam], archivedExams: [] });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return json({ sessions: [session] });
      if (url.endsWith("cohort-session-1")) return new Response(JSON.stringify({ error: "gone" }), { status: 404 });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    render(<AdminCohortExamSessionsFeature active examView="catalog" focusedExamId="exam-1" focusedCohortSessionId="cohort-session-1" supportMonitoringActive fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    expect(await screen.findByText("This route target is no longer available.")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("The requested Cohort Exam Session is no longer available.");
    expect(screen.queryByText("Failed to load Cohort Exam Session detail")).toBeNull();
    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 30_000)).toBe(false);
    setIntervalSpy.mockRestore();
  });

  it("does not request Sessions for a deleted Exam deep link", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [], archivedExams: [] });
      throw new Error(`Unexpected child fetch: ${url}`);
    });
    render(<AdminCohortExamSessionsFeature active examView="session" focusedExamId="missing-exam" focusedCohortSessionId="missing-session" supportMonitoringActive={false} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    expect(await screen.findByText("This route target is no longer available.")).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(fetchAdmin).toHaveBeenCalledTimes(1);
  });

  it("does not start focused monitoring polling before the catalog validates its parent Exam", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/admin/exams") return json({ activeExams: [], archivedExams: [] });
      throw new Error(`Unexpected child fetch: ${String(input)}`);
    });
    render(<AdminCohortExamSessionsFeature active examView="catalog" focusedExamId="missing-exam" focusedCohortSessionId="missing-session" supportMonitoringActive fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    expect(await screen.findByText("This route target is no longer available.")).toBeTruthy();
    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 30_000)).toBe(false);
    setIntervalSpy.mockRestore();
  });

  it("restores focus to the Session control that opened a detail route", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [exam], archivedExams: [] });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return json({ sessions: [session] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const onNavigate = vi.fn();
    const view = render(<AdminCohortExamSessionsFeature active examView="sessions" focusedExamId="exam-1" focusedCohortSessionId={null} supportMonitoringActive={false} fetchAdmin={fetchAdmin} onNavigate={onNavigate} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);
    const origin = await screen.findByRole("button", { name: "View session details" });
    await userEvent.click(origin);
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ returnFocusSessionId: "cohort-session-1" }));
    view.rerender(<AdminCohortExamSessionsFeature active examView="session" focusedExamId="exam-1" focusedCohortSessionId="cohort-session-1" returnFocusSessionId="cohort-session-1" supportMonitoringActive={false} fetchAdmin={fetchAdmin} onNavigate={onNavigate} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Back to Cohort Sessions" }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ returnFocusSessionId: "cohort-session-1" }));
    view.rerender(<AdminCohortExamSessionsFeature active examView="sessions" focusedExamId="exam-1" focusedCohortSessionId={null} returnFocusSessionId="cohort-session-1" supportMonitoringActive={false} fetchAdmin={fetchAdmin} onNavigate={onNavigate} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "View session details" })));
  });

  it("keeps a failed Session list actionable without claiming the Session was deleted", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [exam], archivedExams: [] });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    render(<AdminCohortExamSessionsFeature active examView="session" focusedExamId="exam-1" focusedCohortSessionId="missing-session" supportMonitoringActive={false} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    expect((await screen.findByRole("alert")).textContent).toContain("temporary failure");
    expect(screen.queryByText("This route target is no longer available.")).toBeNull();
  });

  it("does not read or poll focused monitoring detail until the Session list validates the target", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [exam], archivedExams: [] });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    render(<AdminCohortExamSessionsFeature active examView="catalog" focusedExamId="exam-1" focusedCohortSessionId="cohort-session-1" supportMonitoringActive fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    expect((await screen.findByRole("alert")).textContent).toContain("temporary failure");
    expect(fetchAdmin).toHaveBeenCalledTimes(2);
    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 30_000)).toBe(false);
    setIntervalSpy.mockRestore();
  });

  it("keeps a failed focused Cohort refresh dismissible", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [exam], archivedExams: [] });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return json({ sessions: [session] });
      if (url.endsWith("cohort-session-1")) return new Response(JSON.stringify({ error: "Cohort detail is unavailable" }), { status: 503 });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const user = userEvent.setup();
    render(<AdminCohortExamSessionsFeature active examView="catalog" focusedExamId="exam-1" focusedCohortSessionId="cohort-session-1" supportMonitoringActive fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Cohort detail is unavailable");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the shared Exam Catalog loading overlay while a Cohort detail route resolves its parent Exam", async () => {
    let resolveCatalog: ((response: Response) => void) | undefined;
    const fetchAdmin = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/exams") return new Promise<Response>((resolve) => { resolveCatalog = resolve; });
      if (url === "/api/admin/exams/exam-1/cohort-sessions") return Promise.resolve(json({ sessions: [session] }));
      throw new Error(`Unexpected fetch: ${url}`);
    });
    render(<AdminCohortExamSessionsFeature active examView="session" focusedExamId="exam-1" focusedCohortSessionId="cohort-session-1" supportMonitoringActive={false} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} getNavigationHref={shellNavigationHref} onCohortActivityChange={vi.fn()} catalog={null} />);

    expect(await screen.findByText("Loading Exam Catalog resources")).toBeTruthy();
    await act(async () => resolveCatalog?.(json({ activeExams: [exam], archivedExams: [] })));
  });
});
