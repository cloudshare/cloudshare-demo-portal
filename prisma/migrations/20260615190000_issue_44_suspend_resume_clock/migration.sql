-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledFor" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamAttempt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabLaunch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examAttemptId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "participantEmail" TEXT,
    "trainingId" TEXT,
    "experienceId" TEXT NOT NULL,
    "environmentExternalId" TEXT,
    "environmentId" TEXT,
    "loginUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabLaunch_examAttemptId_fkey" FOREIGN KEY ("examAttemptId") REFERENCES "ExamAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamClock" (
    "examAttemptId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "elapsedAtPauseMs" INTEGER NOT NULL,
    "startedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamClock_examAttemptId_fkey" FOREIGN KEY ("examAttemptId") REFERENCES "ExamAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EnvironmentRecord" (
    "environmentExternalId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ExamAttempt_candidateId_createdAt_idx" ON "ExamAttempt"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "ExamAttempt_examId_createdAt_idx" ON "ExamAttempt"("examId", "createdAt");

-- CreateIndex
CREATE INDEX "ExamAttempt_customerId_candidateId_idx" ON "ExamAttempt"("customerId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "LabLaunch_examAttemptId_key" ON "LabLaunch"("examAttemptId");

-- CreateIndex
CREATE INDEX "LabLaunch_candidateId_createdAt_idx" ON "LabLaunch"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "LabLaunch_trainingId_idx" ON "LabLaunch"("trainingId");

-- CreateIndex
CREATE INDEX "LabLaunch_environmentExternalId_idx" ON "LabLaunch"("environmentExternalId");
