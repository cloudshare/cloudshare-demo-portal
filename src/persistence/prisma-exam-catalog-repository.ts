import type { PrismaClient } from "@prisma/client";
import type { Exam, ExamRepository } from "@/domain/exam-catalog";

export function createPrismaExamCatalogRepository(prisma: PrismaClient): ExamRepository {
  return {
    async save(exam: Exam): Promise<void> {
      await prisma.exam.upsert({
        where: { id: exam.id },
        update: serialize(exam),
        create: serialize(exam),
      });
    },
    async findById(id: string): Promise<Exam | null> {
      const row = await prisma.exam.findUnique({ where: { id } });
      return row ? hydrate(row) : null;
    },
    async listByCustomerId(customerId: string): Promise<Exam[]> {
      const rows = await prisma.exam.findMany({
        where: { customerId },
        orderBy: [{ createdAt: "desc" }],
      });
      return rows.map(hydrate);
    },
  };
}

function serialize(exam: Exam) {
  return {
    id: exam.id,
    customerId: exam.customerId,
    title: exam.title,
    description: exam.description,
    timeLimitMinutes: exam.timeLimitMinutes,
    storageLeaseMinutes: exam.storageLeaseMinutes ?? null,
    openPeriodMinutes: exam.openPeriodMinutes,
    scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
    status: exam.status,
    publishedAt: exam.publishedAt,
    createdAt: exam.createdAt,
    updatedAt: exam.updatedAt,
    projectId: exam.projectId,
    projectName: exam.projectName,
    blueprintId: exam.blueprintId,
    blueprintName: exam.blueprintName,
    snapshotId: exam.snapshotId,
    snapshotName: exam.snapshotName,
    allowedRegionsJson: JSON.stringify(exam.allowedRegions),
    policyId: exam.policyId,
    policyName: exam.policyName,
    instructorId: exam.instructorId,
    instructorName: exam.instructorName,
    deliveryAvailability: exam.deliveryAvailability ?? "individual",
  };
}

function hydrate(row: {
  id: string;
  customerId: string;
  title: string;
  description: string;
  timeLimitMinutes: number;
  storageLeaseMinutes: number | null;
  openPeriodMinutes: number;
  scoreRetrievalEnabled: boolean;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  projectId: string;
  projectName: string;
  blueprintId: string;
  blueprintName: string;
  snapshotId: string;
  snapshotName: string;
  allowedRegionsJson: string;
  policyId: string;
  policyName: string;
  instructorId: string;
  instructorName: string;
  deliveryAvailability?: string | null;
}): Exam {
  return {
    id: row.id,
    customerId: row.customerId,
    title: row.title,
    description: row.description,
    timeLimitMinutes: row.timeLimitMinutes,
    storageLeaseMinutes: row.storageLeaseMinutes,
    openPeriodMinutes: row.openPeriodMinutes,
    scoreRetrievalEnabled: row.scoreRetrievalEnabled,
    status: row.status as Exam["status"],
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    projectId: row.projectId,
    projectName: row.projectName,
    blueprintId: row.blueprintId,
    blueprintName: row.blueprintName,
    snapshotId: row.snapshotId,
    snapshotName: row.snapshotName,
    allowedRegions: JSON.parse(row.allowedRegionsJson) as Exam["allowedRegions"],
    policyId: row.policyId,
    policyName: row.policyName,
    instructorId: row.instructorId,
    instructorName: row.instructorName,
    deliveryAvailability: (row.deliveryAvailability ?? "individual") as Exam["deliveryAvailability"],
  };
}
