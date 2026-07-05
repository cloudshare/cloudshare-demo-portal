-- Prevent concurrent Candidate joins from creating multiple ExamAttempts for
-- the same published Cohort Exam Session. SQLite permits multiple NULL values,
-- so Individual Exam Delivery attempts remain unaffected.
CREATE UNIQUE INDEX "ExamAttempt_candidateId_cohortSessionId_key"
ON "ExamAttempt"("candidateId", "cohortSessionId");
