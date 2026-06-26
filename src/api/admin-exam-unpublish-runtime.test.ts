import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder, type DiagnosticRecorder } from "@/domain/diagnostic-log";
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { unpublishAdminExamRuntime } from "./admin-exam-unpublish-runtime";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDiagnostics(): {
  recorder: DiagnosticRecorder;
  repository: ReturnType<typeof createInMemoryDiagnosticLogRepository>;
} {
  const repository = createInMemoryDiagnosticLogRepository();
  const recorder = createDiagnosticRecorder({
    repository,
    secrets: [],
  });
  return { recorder, repository };
}

function makeExamInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-1",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on certification exam.",
    timeLimitMinutes: 240,
    scoreRetrievalEnabled: false,
    projectId: "project-1",
    projectName: "Helios CX Project",
    blueprintId: "bp-1",
    blueprintName: "Helios Exam Blueprint",
    snapshotId: "snap-1",
    snapshotName: "Default Snapshot",
    allowedRegions: [
      { id: "region-1", name: "EU West" },
      { id: "region-2", name: "US East" },
    ],
    policyId: "policy-1",
    policyName: "Standard Exam Policy",
    instructorId: "instructor-1",
    instructorName: "Helios Service Account",
    ...overrides,
  };
}

async function seedPublishedExam(
  repository: ReturnType<typeof createInMemoryExamCatalogRepository>,
): Promise<void> {
  await createDraftExam(
    {
      repository,
      now: () => new Date("2026-06-14T12:00:00.000Z"),
      newId: () => "exam-1",
    },
    makeExamInput(),
  );
  await publishExam(
    { repository, now: () => new Date("2026-06-14T12:30:00.000Z") },
    { customerId: "customer-1", examId: "exam-1" },
  );
}

describe("admin Exam unpublish runtime", () => {
  it("unpublishes a published Exam and records diagnostics", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const diagnostics = makeDiagnostics();
    await seedPublishedExam(repository);

    const response = await unpublishAdminExamRuntime(
      {
        repository,
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
        now: () => new Date("2026-06-14T12:45:00.000Z"),
      },
      {
        customerId: "customer-1",
        actor: { type: "admin", id: "admin-1", email: "admin@helioscx.demo" },
        examId: "exam-1",
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      exam: {
        id: "exam-1",
        status: "draft",
        publishedAt: null,
        updatedAt: new Date("2026-06-14T12:45:00.000Z"),
      },
    });
    await expect(
      diagnostics.repository.query({
        customerId: "customer-1",
        examId: "exam-1",
        operation: "exam.unpublish",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        customerId: "customer-1",
        actor: { type: "admin", id: "admin-1", email: "admin@helioscx.demo" },
        subject: { type: "exam", id: "exam-1" },
        examId: "exam-1",
        level: "info",
        operation: "exam.unpublish",
        outcome: "success",
        message: "Exam unpublished",
        details: { changedFields: ["status", "publishedAt"] },
      }),
    ]);
  });

  it("returns 404 when the Exam is not found for the Customer", async () => {
    const repository = createInMemoryExamCatalogRepository();

    const response = await unpublishAdminExamRuntime(
      {
        repository,
        logger: makeLogger(),
      },
      { customerId: "customer-1", examId: "missing-exam" },
    );

    expect(response).toEqual({
      status: 404,
      body: { error: "Exam missing-exam was not found for customer customer-1" },
    });
  });

  it("does not fail unpublish when diagnostic recording fails", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const logger = makeLogger();
    const diagnostics = {
      record: vi.fn().mockRejectedValue(new Error("diagnostics offline")),
    } satisfies DiagnosticRecorder;
    await seedPublishedExam(repository);

    const response = await unpublishAdminExamRuntime(
      {
        repository,
        diagnostics,
        logger,
        now: () => new Date("2026-06-14T12:45:00.000Z"),
      },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      exam: { id: "exam-1", status: "draft", publishedAt: null },
    });
    expect(logger.warn).toHaveBeenCalledWith("admin exam diagnostic recording failed", {
      operation: "exam.unpublish",
      error: "diagnostics offline",
    });
  });
});
