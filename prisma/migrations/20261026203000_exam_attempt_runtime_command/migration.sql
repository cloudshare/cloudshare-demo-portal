CREATE TABLE "ExamAttemptRuntimeCommand" (
  "examAttemptId" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  CONSTRAINT "ExamAttemptRuntimeCommand_examAttemptId_fkey" FOREIGN KEY ("examAttemptId") REFERENCES "ExamAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExamAttemptRuntimeCommand_commandId_key" ON "ExamAttemptRuntimeCommand"("commandId");
