-- Prevent concurrent Candidate joins from creating multiple ExamAttempts for
-- the same published Cohort Exam Session. SQLite permits multiple NULL values,
-- so Individual Exam Delivery attempts remain unaffected.
CREATE UNIQUE INDEX "ExamAttempt_candidateId_cohortSessionId_key"
ON "ExamAttempt"("candidateId", "cohortSessionId");

-- Serialize Candidate/Exam admission decisions so concurrent Individual and
-- Cohort joins evaluate the same availability-window rule against current data.
CREATE TABLE "ExamAttemptAdmissionLock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "candidateId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ExamAttemptAdmissionLock_candidateId_examId_key"
ON "ExamAttemptAdmissionLock"("candidateId", "examId");
