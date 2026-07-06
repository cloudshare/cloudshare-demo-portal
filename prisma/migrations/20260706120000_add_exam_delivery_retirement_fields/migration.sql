ALTER TABLE "Exam" ADD COLUMN "archivedAt" DATETIME;

ALTER TABLE "CohortExamSession" ADD COLUMN "admissionClosedAt" DATETIME;
ALTER TABLE "CohortExamSession" ADD COLUMN "retiredAt" DATETIME;
