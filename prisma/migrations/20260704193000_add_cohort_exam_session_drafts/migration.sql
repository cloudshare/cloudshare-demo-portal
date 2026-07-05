ALTER TABLE "Exam" ADD COLUMN "deliveryAvailability" TEXT NOT NULL DEFAULT 'individual';

CREATE TABLE "CohortExamSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "admissionStartsAt" DATETIME NOT NULL,
    "admissionEndsAt" DATETIME,
    "capacity" INTEGER,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CohortExamSession_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CohortExamSession_customerId_examId_status_idx" ON "CohortExamSession"("customerId", "examId", "status");
CREATE INDEX "CohortExamSession_examId_createdAt_idx" ON "CohortExamSession"("examId", "createdAt");
