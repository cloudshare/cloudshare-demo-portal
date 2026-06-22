import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExamAttemptDiagnosticDrilldown } from "./exam-attempt-diagnostic-drilldown";
import type { ExamAttemptDiagnosticDrilldownReadModel } from "@/api/admin-exam-attempt-diagnostics";

const DRILLDOWN: ExamAttemptDiagnosticDrilldownReadModel = {
  timelineSource: "diagnostic_log_entry",
  timelinePage: {
    limit: 500,
    returned: 1,
    hasMore: false,
  },
  candidate: {
    id: "candidate-1",
    email: "candidate@helioscx.demo",
    firstName: "Casey",
    lastName: "Rivera",
  },
  exam: {
    id: "exam-1",
    title: "Helios CX Analyst",
    status: "published",
    scoreRetrievalEnabled: true,
  },
  attempt: {
    id: "attempt-1",
    status: "suspended",
    scheduledFor: "2026-06-21T09:00:00.000Z",
    createdAt: "2026-06-20T09:00:00.000Z",
  },
  cloudShare: {
    trainingId: "training-1",
    experienceId: null,
    environmentExternalId: null,
    environmentId: null,
    participantId: "participant-1",
    participantEmail: "candidate@helioscx.demo",
  },
  timeline: [
    {
      id: "diag-1",
      occurredAt: "2026-06-21T10:00:00.000Z",
      level: "warn",
      source: "runtime",
      operation: "exam_attempt.schedule",
      outcome: "failure",
      message: "CloudShare scheduling failed",
      integrationSurface: "cloudshare.v4.training",
      correlationId: "corr-1",
      candidateEmail: "candidate@helioscx.demo",
      examId: "exam-1",
      examAttemptId: "attempt-1",
      externalIds: { trainingId: "training-1" },
      request: { method: "POST", path: "/api/candidate/schedule" },
      response: { status: 502 },
      details: {
        responseBody: {
          loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
        },
      },
      requestResponseSummary: "POST /api/candidate/schedule -> HTTP 502",
    },
  ],
};

describe("ExamAttemptDiagnosticDrilldown", () => {
  it("renders the context summary and scoring flag", () => {
    const html = renderToStaticMarkup(
      createElement(ExamAttemptDiagnosticDrilldown, {
        drilldown: DRILLDOWN,
        loading: false,
        error: null,
        onClose: () => {},
      }),
    );

    expect(html).toContain("Context summary");
    expect(html).toContain("candidate@helioscx.demo");
    expect(html).toContain("Helios CX Analyst");
    expect(html).toContain("Attempt status:</strong> suspended");
    expect(html).toContain("Scoring:</strong> Enabled");
  });

  it("renders missing optional CloudShare IDs as Unavailable instead of a broken blank value", () => {
    const html = renderToStaticMarkup(
      createElement(ExamAttemptDiagnosticDrilldown, {
        drilldown: DRILLDOWN,
        loading: false,
        error: null,
        onClose: () => {},
      }),
    );

    expect(html).toContain("Experience ID:</strong> Unavailable");
    expect(html).toContain("Environment external ID:</strong> Unavailable");
    expect(html).toContain("Environment ID:</strong> Unavailable");
  });

  it("renders expandable timeline details and retains admin-only loginUrl evidence", () => {
    const html = renderToStaticMarkup(
      createElement(ExamAttemptDiagnosticDrilldown, {
        drilldown: DRILLDOWN,
        loading: false,
        error: null,
        onClose: () => {},
      }),
    );

    expect(html).toContain("<details");
    expect(html).toContain("Request / response:</strong> POST /api/candidate/schedule -&gt; HTTP 502");
    expect(html).toContain("https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence");
  });

  it("renders stable timeline entry ids derived from DiagnosticLogEntry ids", () => {
    const html = renderToStaticMarkup(
      createElement(ExamAttemptDiagnosticDrilldown, {
        drilldown: DRILLDOWN,
        loading: false,
        error: null,
        onClose: () => {},
      }),
    );

    expect(html).toContain('id="exam-attempt-diagnostic-entry-diag-1"');
    expect(html).toContain('data-timeline-entry-id="diag-1"');
  });

  it("renders a truncation notice for oversized structured detail payloads", () => {
    const html = renderToStaticMarkup(
      createElement(ExamAttemptDiagnosticDrilldown, {
        drilldown: {
          ...DRILLDOWN,
          timeline: [
            {
              ...DRILLDOWN.timeline[0],
              details: { largePayload: "x".repeat(12_500) },
            },
          ],
        },
        loading: false,
        error: null,
        onClose: () => {},
      }),
    );

    expect(html).toContain("Detail output truncated in the drilldown view");
    expect(html).toContain("... truncated");
  });

  it("shows when the drilldown timeline is capped and older rows remain filtered elsewhere", () => {
    const html = renderToStaticMarkup(
      createElement(ExamAttemptDiagnosticDrilldown, {
        drilldown: {
          ...DRILLDOWN,
          timelinePage: {
            limit: 500,
            returned: 500,
            hasMore: true,
          },
        },
        loading: false,
        error: null,
        onClose: () => {},
      }),
    );

    expect(html).toContain("Showing the first 500 timeline entries.");
  });
});
