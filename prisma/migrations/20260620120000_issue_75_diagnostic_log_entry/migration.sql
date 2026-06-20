-- CreateTable
CREATE TABLE "DiagnosticLogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurredAt" DATETIME NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "customerId" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "message" TEXT NOT NULL,
    "correlationId" TEXT,
    "candidateEmail" TEXT,
    "examId" TEXT,
    "examAttemptId" TEXT,
    "externalIdsJson" TEXT,
    "requestJson" TEXT,
    "responseJson" TEXT,
    "detailsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DiagnosticLogEntry_customerId_occurredAt_idx" ON "DiagnosticLogEntry"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "DiagnosticLogEntry_examAttemptId_idx" ON "DiagnosticLogEntry"("examAttemptId");

-- CreateIndex
CREATE INDEX "DiagnosticLogEntry_candidateEmail_idx" ON "DiagnosticLogEntry"("candidateEmail");

-- CreateIndex
CREATE INDEX "DiagnosticLogEntry_correlationId_idx" ON "DiagnosticLogEntry"("correlationId");

