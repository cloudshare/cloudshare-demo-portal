import { describe, expect, it } from "vitest";
import {
  createDraftExam,
  DraftExamValidationError,
  ExamNotFoundError,
  publishExam,
  unpublishExam,
  updateDraftExam,
  type CreateDraftExamInput,
} from "./exam-catalog";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";

function makeInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-1",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on certification exam.",
    timeLimitMinutes: 90,
    storageLeaseMinutes: 2880,
    openPeriodMinutes: 720,
    scoreRetrievalEnabled: true,
    projectId: "project-1",
    projectName: "Helios CX Project",
    blueprintId: "bp-1",
    blueprintName: "Helios Exam Blueprint",
    snapshotId: "snap-1",
    snapshotName: "Default Snapshot",
    allowedRegions: [{ id: "region-1", name: "EU West" }],
    policyId: "policy-1",
    policyName: "Standard Exam Policy",
    instructorId: "instructor-seeded",
    instructorName: "Seeded CloudShare Instructor",
    ...overrides,
  };
}

describe("createDraftExam", () => {
  it("creates and persists a draft exam with the selected provisioning tuple", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const now = new Date("2026-06-14T12:00:00.000Z");

    const exam = await createDraftExam(
      { repository, now: () => now, newId: () => "exam-1" },
      makeInput(),
    );

    expect(exam).toEqual({
      id: "exam-1",
      customerId: "customer-1",
      title: "Helios CloudShare Fundamentals",
      description: "Hands-on certification exam.",
      timeLimitMinutes: 90,
      storageLeaseMinutes: 2880,
      openPeriodMinutes: 720,
      scoreRetrievalEnabled: true,
      deliveryAvailability: "individual",
      status: "draft",
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      projectId: "project-1",
      projectName: "Helios CX Project",
      blueprintId: "bp-1",
      blueprintName: "Helios Exam Blueprint",
      snapshotId: "snap-1",
      snapshotName: "Default Snapshot",
      allowedRegions: [{ id: "region-1", name: "EU West" }],
      policyId: "policy-1",
      policyName: "Standard Exam Policy",
      instructorId: "instructor-seeded",
      instructorName: "Seeded CloudShare Instructor",
    });

    await expect(repository.findById("exam-1")).resolves.toEqual(exam);
  });

  it("allows an empty description for a draft exam", async () => {
    const repository = createInMemoryExamCatalogRepository();

    const exam = await createDraftExam(
      { repository, now: () => new Date("2026-06-14T12:00:00.000Z"), newId: () => "exam-1" },
      makeInput({ description: "   " }),
    );

    expect(exam.description).toBe("");
  });

  it("rejects invalid exam metadata before anything is persisted", async () => {
    const repository = createInMemoryExamCatalogRepository();

    await expect(
      createDraftExam(
        { repository, newId: () => "exam-1" },
        makeInput({ title: "  ", timeLimitMinutes: 0 }),
      ),
    ).rejects.toBeInstanceOf(DraftExamValidationError);

    await expect(repository.listByCustomerId("customer-1")).resolves.toEqual([]);
  });

  it("rejects an empty allowed Region set before anything is persisted", async () => {
    const repository = createInMemoryExamCatalogRepository();

    await expect(
      createDraftExam(
        { repository, newId: () => "exam-1" },
        makeInput({ allowedRegions: [] }),
      ),
    ).rejects.toBeInstanceOf(DraftExamValidationError);

    await expect(repository.listByCustomerId("customer-1")).resolves.toEqual([]);
  });
});

describe("publishExam", () => {
  it("publishes an existing draft exam", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const createdAt = new Date("2026-06-14T12:00:00.000Z");
    const publishedAt = new Date("2026-06-14T12:30:00.000Z");

    await createDraftExam(
      { repository, now: () => createdAt, newId: () => "exam-1" },
      makeInput(),
    );

    const published = await publishExam(
      { repository, now: () => publishedAt },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(published.status).toBe("published");
    expect(published.publishedAt).toEqual(publishedAt);
    expect(published.updatedAt).toEqual(publishedAt);
  });

  it("fails when the exam does not exist for the customer", async () => {
    const repository = createInMemoryExamCatalogRepository();

    await expect(
      publishExam(
        { repository, now: () => new Date("2026-06-14T12:30:00.000Z") },
        { customerId: "customer-1", examId: "missing" },
      ),
    ).rejects.toBeInstanceOf(ExamNotFoundError);
  });
});

describe("updateDraftExam", () => {
  it("updates an existing draft exam and keeps it as a draft", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const createdAt = new Date("2026-06-14T12:00:00.000Z");
    const updatedAt = new Date("2026-06-14T13:15:00.000Z");

    await createDraftExam(
      { repository, now: () => createdAt, newId: () => "exam-1" },
      makeInput(),
    );

    const updated = await updateDraftExam(
      { repository, now: () => updatedAt },
      {
        examId: "exam-1",
        customerId: "customer-1",
        title: "Helios Blueprint Exam",
        description: "Updated description.",
        timeLimitMinutes: 120,
        storageLeaseMinutes: 1440,
        openPeriodMinutes: 360,
        scoreRetrievalEnabled: false,
        allowedRegions: [{ id: "region-2", name: "US East" }],
        policyId: "policy-2",
        policyName: "Extended Exam Policy",
      },
    );

    expect(updated).toMatchObject({
      id: "exam-1",
      status: "draft",
      title: "Helios Blueprint Exam",
      description: "Updated description.",
      timeLimitMinutes: 120,
      storageLeaseMinutes: 1440,
      openPeriodMinutes: 360,
      scoreRetrievalEnabled: false,
      allowedRegions: [{ id: "region-2", name: "US East" }],
      policyId: "policy-2",
      policyName: "Extended Exam Policy",
    });
    expect(updated.updatedAt).toEqual(updatedAt);
    expect(updated.createdAt).toEqual(createdAt);
    expect(updated.publishedAt).toBeNull();
  });

  it("rejects updates to published exams", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const createdAt = new Date("2026-06-14T12:00:00.000Z");

    await createDraftExam(
      { repository, now: () => createdAt, newId: () => "exam-1" },
      makeInput(),
    );
    await publishExam(
      { repository, now: () => new Date("2026-06-14T12:30:00.000Z") },
      { customerId: "customer-1", examId: "exam-1" },
    );

    await expect(
      updateDraftExam(
        { repository, now: () => new Date("2026-06-14T13:15:00.000Z") },
        {
          examId: "exam-1",
          customerId: "customer-1",
          title: "Helios Blueprint Exam",
          description: "Updated description.",
          timeLimitMinutes: 120,
          storageLeaseMinutes: 1440,
          openPeriodMinutes: 360,
          scoreRetrievalEnabled: false,
          allowedRegions: [{ id: "region-2", name: "US East" }],
          policyId: "policy-2",
          policyName: "Extended Exam Policy",
        },
      ),
    ).rejects.toThrow("Only draft exams can be edited.");
  });
});

describe("unpublishExam", () => {
  it("returns a published exam to draft status", async () => {
    const repository = createInMemoryExamCatalogRepository();
    const createdAt = new Date("2026-06-14T12:00:00.000Z");

    await createDraftExam(
      { repository, now: () => createdAt, newId: () => "exam-1" },
      makeInput(),
    );
    await publishExam(
      { repository, now: () => new Date("2026-06-14T12:30:00.000Z") },
      { customerId: "customer-1", examId: "exam-1" },
    );

    const unpublished = await unpublishExam(
      { repository, now: () => new Date("2026-06-14T13:00:00.000Z") },
      { customerId: "customer-1", examId: "exam-1" },
    );

    expect(unpublished.status).toBe("draft");
    expect(unpublished.publishedAt).toBeNull();
  });
});
