CREATE TABLE "SalesParticipantOperationState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "salesSessionParticipantId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "correlationId" TEXT,
  "resultMetadata" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "SalesParticipantOperationState_customerId_salesSessionParticipantId_fkey" FOREIGN KEY ("customerId", "salesSessionParticipantId") REFERENCES "SalesSessionParticipant"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesParticipantOperationState_customerId_salesSessionParticipantId_capability_key" ON "SalesParticipantOperationState"("customerId", "salesSessionParticipantId", "capability");
CREATE INDEX "SalesParticipantOperationState_customerId_salesSessionParticipantId_idx" ON "SalesParticipantOperationState"("customerId", "salesSessionParticipantId");
