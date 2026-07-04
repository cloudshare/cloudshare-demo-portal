import { describe, expect, it, vi } from "vitest";
import {
  handleGetAdminCandidateDetail,
  handleGetAdminCandidateRoster,
  type AdminCandidateHandlerDeps,
} from "./admin-candidates";
import type {
  AdminCandidateRecord,
  AdminCandidateRepository,
} from "@/domain/admin-candidates";
import type { DiagnosticLogEntry, DiagnosticLogRepository } from "@/domain/diagnostic-log";
import type { Logger } from "@/observability/logger";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeCandidate(
  partial: Partial<AdminCandidateRecord> = {},
): AdminCandidateRecord {
  return {
    id: "candidate-1",
    customerId: "customer-1",
    email: "casey@helioscx.demo",
    firstName: "Casey",
    lastName: "Rivera",
    role: "candidate",
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
    attempts: [
      {
        id: "attempt-1",
        customerId: "customer-1",
        candidateId: "candidate-1",
        examId: "exam-1",
        examTitle: "Helios Cloud Admin",
        status: "completed",
        scheduledFor: new Date("2026-06-19T10:00:00.000Z"),
        createdAt: new Date("2026-06-18T10:00:00.000Z"),
        updatedAt: new Date("2026-06-19T11:00:00.000Z"),
        scoreRetrievalEnabled: true,
      },
    ],
    ...partial,
  };
}

function makeScoreDiagnostic(
  partial: Partial<DiagnosticLogEntry> = {},
): DiagnosticLogEntry {
  return {
    id: "diag-score",
    occurredAt: new Date("2026-06-19T11:05:00.000Z"),
    level: "info",
    source: "runtime",
    operation: "exam_attempt.score.retrieve",
    outcome: "success",
    customerId: "customer-1",
    actor: null,
    subject: { type: "exam_attempt", id: "attempt-1" },
    message: "Guided Journey score retrieved",
    correlationId: "corr-1",
    candidateEmail: "casey@helioscx.demo",
    examId: "exam-1",
    examAttemptId: "attempt-1",
    externalIds: null,
    request: null,
    response: {
      scoreAvailable: true,
      percentComplete: 82,
      stepsCompleted: 9,
      stepsTotal: 11,
    },
    details: null,
    ...partial,
  };
}

function makeRawCloudShareScoreDiagnostic(): DiagnosticLogEntry {
  return makeScoreDiagnostic({
    response: {
      status: 200,
      body: {
        exploredRate: 0.25,
        inProgressRate: 0,
        notStartedRate: 0.75,
        passedRate: 0,
        failedRate: 1,
        notInitiatedRate: 0,
        sectionStatuses: [
          { number: 0, name: "Last section", status: "notStarted" },
          { number: 0, name: "Check pfSense WAN Interface", status: "explored" },
          { number: 1, name: "Check the LAN interface", status: "notStarted" },
          { number: 2, name: "Section Name 3", status: "notStarted" },
        ],
      },
    },
  });
}

function makeDeps(input: {
  readonly candidates?: AdminCandidateRecord[];
  readonly detailCandidate?: AdminCandidateRecord | null;
  readonly diagnosticsByAttemptId?: Record<string, DiagnosticLogEntry[]>;
} = {}): AdminCandidateHandlerDeps {
  const candidates = input.candidates ?? [makeCandidate()];
  const candidateRepository: AdminCandidateRepository = {
    listByCustomerId: vi.fn().mockResolvedValue(candidates),
    findByCustomerIdAndCandidateId: vi
      .fn()
      .mockResolvedValue(input.detailCandidate === undefined ? candidates[0] : input.detailCandidate),
  };
  const diagnostics: DiagnosticLogRepository = {
    append: vi.fn(),
    query: vi.fn().mockImplementation(async (query) => {
      if (!query.examAttemptId) {
        return [];
      }
      return input.diagnosticsByAttemptId?.[query.examAttemptId] ?? [];
    }),
  };

  return {
    candidates: candidateRepository,
    diagnostics,
    logger: makeLogger(),
  };
}

describe("admin candidate handlers", () => {
  it("returns a Customer-scoped candidate roster with attempt summary and persisted score evidence", async () => {
    const deps = makeDeps({
      candidates: [
        makeCandidate({
          attempts: [
            makeCandidate().attempts[0],
            {
              ...makeCandidate().attempts[0],
              id: "attempt-2",
              status: "scheduled",
              scheduledFor: new Date("2026-06-20T10:00:00.000Z"),
              updatedAt: new Date("2026-06-18T12:00:00.000Z"),
              scoreRetrievalEnabled: false,
            },
          ],
        }),
      ],
      diagnosticsByAttemptId: {
        "attempt-1": [makeScoreDiagnostic()],
      },
    });

    const response = await handleGetAdminCandidateRoster(deps, {
      customerId: "customer-1",
      query: { search: "casey" },
    });

    expect(response.status).toBe(200);
    expect(deps.candidates.listByCustomerId).toHaveBeenCalledWith("customer-1", {
      search: "casey",
    });
    expect(deps.diagnostics.query).toHaveBeenCalledWith({
      customerId: "customer-1",
      examAttemptId: "attempt-1",
      limit: 500,
    });
    expect(deps.diagnostics.query).toHaveBeenCalledWith({
      customerId: "customer-1",
      examAttemptId: "attempt-2",
      limit: 500,
    });
    expect(response.body).toEqual({
      candidates: [
        expect.objectContaining({
          id: "candidate-1",
          email: "casey@helioscx.demo",
          name: "Casey Rivera",
          attemptSummary: {
            scheduled: 1,
            ready: 0,
            inProgress: 0,
            suspended: 0,
            completed: 1,
            expired: 0,
            total: 2,
          },
          latestAttempt: expect.objectContaining({
            id: "attempt-2",
            status: "scheduled",
          }),
          latestScore: {
            scoreAvailable: true,
            percentComplete: 82,
            stepsCompleted: 9,
            stepsTotal: 11,
            retrievedAt: "2026-06-19T11:05:00.000Z",
          },
        }),
      ],
    });
  });

  it("returns candidate detail with ExamAttempts and persisted score evidence", async () => {
    const deps = makeDeps({
      detailCandidate: makeCandidate(),
      diagnosticsByAttemptId: {
        "attempt-1": [makeScoreDiagnostic()],
      },
    });

    const response = await handleGetAdminCandidateDetail(deps, {
      customerId: "customer-1",
      candidateId: "candidate-1",
    });

    expect(response.status).toBe(200);
    expect(deps.candidates.findByCustomerIdAndCandidateId).toHaveBeenCalledWith(
      "customer-1",
      "candidate-1",
    );
    expect(response.body).toEqual({
      candidate: expect.objectContaining({
        id: "candidate-1",
        name: "Casey Rivera",
        attempts: [
          expect.objectContaining({
            id: "attempt-1",
            examTitle: "Helios Cloud Admin",
            status: "completed",
            score: {
              scoreAvailable: true,
              percentComplete: 82,
              stepsCompleted: 9,
              stepsTotal: 11,
              retrievedAt: "2026-06-19T11:05:00.000Z",
            },
          }),
        ],
      }),
    });
  });

  it("normalizes raw CloudShare Guided Journey diagnostics into score evidence", async () => {
    const deps = makeDeps({
      detailCandidate: makeCandidate(),
      diagnosticsByAttemptId: {
        "attempt-1": [makeRawCloudShareScoreDiagnostic()],
      },
    });

    const response = await handleGetAdminCandidateDetail(deps, {
      customerId: "customer-1",
      candidateId: "candidate-1",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      candidate: expect.objectContaining({
        attempts: [
          expect.objectContaining({
            id: "attempt-1",
            status: "completed",
            score: {
              scoreAvailable: true,
              percentComplete: 25,
              stepsCompleted: 1,
              stepsTotal: 4,
              passedRate: 0,
              failedRate: 1,
              retrievedAt: "2026-06-19T11:05:00.000Z",
            },
          }),
        ],
      }),
    });
  });

  it("returns 404 when candidate detail is outside the admin Customer scope", async () => {
    const response = await handleGetAdminCandidateDetail(
      makeDeps({ detailCandidate: null }),
      {
        customerId: "customer-1",
        candidateId: "candidate-other",
      },
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "candidate not found" });
  });
});
