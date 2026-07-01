-- Persist the manually authored CloudShare Experience open period.
ALTER TABLE "Exam" ADD COLUMN "openPeriodMinutes" INTEGER NOT NULL DEFAULT 0;

UPDATE "Exam"
SET "openPeriodMinutes" = COALESCE("storageLeaseMinutes", "timeLimitMinutes")
WHERE "openPeriodMinutes" = 0;
