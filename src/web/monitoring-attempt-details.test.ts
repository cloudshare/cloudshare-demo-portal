import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMonitoringAttemptDetailFields,
  MonitoringAttemptDetails,
} from "./monitoring-attempt-details";
import type { MonitoringAttemptView } from "@/domain/admin-monitoring";

const BASE_ATTEMPT: MonitoringAttemptView = {
  id: "attempt-1",
  examId: "exam-1",
  examTitle: "Helios CX Analyst",
  candidateId: "candidate-1",
  candidateName: "Casey Rivera",
  candidateEmail: "candidate@helioscx.demo",
  examOpenPeriodMinutes: 90,
  status: "ready",
  scheduledFor: "2026-06-21T09:00:00.000Z",
  createdAt: "2026-06-20T09:00:00.000Z",
  trainingId: "exp-shared",
  experienceId: "exp-shared",
  environmentExternalId: "env-1",
  participantId: "participant-1",
  scoreRetrievalEnabled: true,
  timeline: [],
};

describe("buildMonitoringAttemptDetailFields", () => {
  it("shows ExamAttempt ID, Exam ID, and a deduped Experience ID when CloudShare training and experience IDs match", () => {
    expect(buildMonitoringAttemptDetailFields(BASE_ATTEMPT)).toEqual([
      { label: "ExamAttempt ID", value: "attempt-1" },
      { label: "Exam ID", value: "exam-1" },
      { label: "Experience ID", value: "exp-shared" },
      { label: "Environment", value: "env-1" },
      { label: "Participant ID", value: "participant-1" },
    ]);
  });

  it("retains both Experience ID and Training ID when they are distinct", () => {
    expect(
      buildMonitoringAttemptDetailFields({
        ...BASE_ATTEMPT,
        trainingId: "training-77",
        experienceId: "experience-88",
      }),
    ).toEqual([
      { label: "ExamAttempt ID", value: "attempt-1" },
      { label: "Exam ID", value: "exam-1" },
      { label: "Experience ID", value: "experience-88" },
      { label: "Training ID", value: "training-77" },
      { label: "Environment", value: "env-1" },
      { label: "Participant ID", value: "participant-1" },
    ]);
  });
});

describe("MonitoringAttemptDetails", () => {
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTimezone;
  });

  it("renders the monitoring identifiers and the Support Diagnostics action label", () => {
    const html = renderToStaticMarkup(
      createElement(MonitoringAttemptDetails, {
        attempt: BASE_ATTEMPT,
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html).toContain("Candidate");
    expect(html).toContain("candidate@helioscx.demo");
    expect(html).toContain("ExamAttempt ID");
    expect(html).toContain("attempt-1");
    expect(html).toContain("Exam ID");
    expect(html).toContain("exam-1");
    expect(html).toContain("Experience ID");
    expect(html).toContain("exp-shared");
    expect(html).not.toContain("Training ID: exp-shared");
    expect(html).toContain("Open in Support Diagnostics");
    expect(html).not.toContain("Open support drilldown");
    expect(html).not.toContain("Scheduled (UTC)");
    expect(html).not.toContain("Open window (UTC)");
  });

  it("renders latest interaction as ancillary monitoring detail", () => {
    process.env.TZ = "Europe/London";

    const html = renderToStaticMarkup(
      createElement(MonitoringAttemptDetails, {
        attempt: {
          ...BASE_ATTEMPT,
          timeline: [
            {
              id: "diag-earlier",
              kind: "diagnostic",
              occurredAt: "2026-06-21T09:05:00.000Z",
              level: "info",
              source: "runtime",
              operation: "exam_attempt.enter",
              outcome: "success",
              message: "Exam entered",
            },
            {
              id: "diag-latest",
              kind: "diagnostic",
              occurredAt: "2026-06-21T09:11:30.000Z",
              level: "info",
              source: "runtime",
              operation: "exam_attempt.heartbeat.receive",
              outcome: "success",
              message: "Heartbeat received",
            },
          ],
        },
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html).toContain("Last interaction");
    expect(html).toContain("2026-06-21 10:11:30");
    expect(html).not.toContain("2026-06-21T09:11:30.000Z");
    expect(html).not.toContain("2026-06-21 09:11:30");
  });
});
