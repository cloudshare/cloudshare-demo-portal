CREATE TABLE "SalesParticipantAddCommand" (
  "customerId" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "status" INTEGER,
  "resultJson" TEXT,
  "correlationId" TEXT,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("customerId", "commandId")
);
CREATE UNIQUE INDEX "SalesParticipantAddCommand_customerId_sessionId_commandId_key" ON "SalesParticipantAddCommand"("customerId", "sessionId", "commandId");
CREATE INDEX "SalesParticipantAddCommand_customerId_sessionId_createdAt_idx" ON "SalesParticipantAddCommand"("customerId", "sessionId", "createdAt");
