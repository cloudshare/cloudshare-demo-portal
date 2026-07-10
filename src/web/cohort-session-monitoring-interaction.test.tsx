/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  AdminConsole,
  CohortSessionMonitoringList,
  CohortSessionWorkspacePanel,
} from "./admin-console";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }) }));

type WorkspaceProps = ComponentProps<typeof CohortSessionWorkspacePanel>;
type Session = WorkspaceProps["session"];

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

  it("keeps Cohort diagnostics links scoped to the selected session", () => {
    render(
      <CohortSessionWorkspacePanel
        mode="monitoring"
        examTitle="Helios Foundations"
        session={session}
        loading={false}
        onBack={vi.fn()}
        onPublish={vi.fn()}
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
    expect(routerPush).toHaveBeenCalledWith("/admin?tab=support&examId=exam-1&sessionId=cohort-session-1");
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

  it("does not repeat a completed focused list read when the catalog response arrives later", async () => {
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

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/exams/exam-1/cohort-sessions")).toHaveLength(1));
    await act(async () => resolveCatalog?.(json({ activeExams: [exam], archivedExams: [] })));
    expect(await screen.findByText("Cohort Exam Session monitoring")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/exams/exam-1/cohort-sessions")).toHaveLength(1);
  });
});
