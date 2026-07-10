/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CohortSessionMonitoringList,
  CohortSessionWorkspacePanel,
} from "./admin-console";

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
