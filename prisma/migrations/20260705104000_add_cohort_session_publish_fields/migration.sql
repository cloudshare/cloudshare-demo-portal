ALTER TABLE "CohortExamSession" ADD COLUMN "cloudShareTrainingId" TEXT;
ALTER TABLE "CohortExamSession" ADD COLUMN "cloudShareExperienceId" TEXT;
ALTER TABLE "CohortExamSession" ADD COLUMN "cloudShareTeamId" TEXT;
ALTER TABLE "CohortExamSession" ADD COLUMN "publishedAt" DATETIME;
ALTER TABLE "CohortExamSession" ADD COLUMN "lastPublishError" TEXT;
ALTER TABLE "CohortExamSession" ADD COLUMN "lastPublishCorrelationId" TEXT;

CREATE INDEX "CohortExamSession_cloudShareTrainingId_idx" ON "CohortExamSession"("cloudShareTrainingId");
