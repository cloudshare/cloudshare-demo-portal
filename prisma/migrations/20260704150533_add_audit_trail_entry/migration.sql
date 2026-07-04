-- CreateTable
CREATE TABLE "AuditTrailEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurredAt" DATETIME NOT NULL,
    "customerId" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "outcome" TEXT NOT NULL,
    "candidateId" TEXT,
    "candidateEmail" TEXT,
    "examId" TEXT,
    "examAttemptId" TEXT,
    "correlationId" TEXT,
    "detailsJson" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AuditTrailEntry_customerId_occurredAt_idx" ON "AuditTrailEntry"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_examAttemptId_idx" ON "AuditTrailEntry"("examAttemptId");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_examId_idx" ON "AuditTrailEntry"("examId");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_candidateEmail_idx" ON "AuditTrailEntry"("candidateEmail");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_actorEmail_idx" ON "AuditTrailEntry"("actorEmail");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_subjectType_subjectId_idx" ON "AuditTrailEntry"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditTrailEntry_correlationId_idx" ON "AuditTrailEntry"("correlationId");
