ALTER TABLE "ExamAttempt" ADD COLUMN "cohortSessionId" TEXT;

CREATE INDEX "ExamAttempt_cohortSessionId_createdAt_idx" ON "ExamAttempt"("cohortSessionId", "createdAt");
