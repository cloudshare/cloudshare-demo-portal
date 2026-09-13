CREATE TABLE "SalesParticipantLaunchOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "salesDemoSessionId" TEXT NOT NULL,
  "salesSessionParticipantId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "safeReason" TEXT,
  "occurredAt" DATETIME NOT NULL,
  "revision" INTEGER NOT NULL,
  CONSTRAINT "SalesParticipantLaunchOperation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesParticipantLaunchOperation_customerId_salesDemoSessionId_fkey" FOREIGN KEY ("customerId", "salesDemoSessionId") REFERENCES "SalesDemoSession" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesParticipantLaunchOperation_customerId_salesSessionParticipantId_fkey" FOREIGN KEY ("customerId", "salesSessionParticipantId") REFERENCES "SalesSessionParticipant" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SalesParticipantLaunchOperation_customerId_salesDemoSessionId_salesSessionParticipantId_occurredAt_idx" ON "SalesParticipantLaunchOperation"("customerId", "salesDemoSessionId", "salesSessionParticipantId", "occurredAt");
CREATE INDEX "SalesParticipantLaunchOperation_customerId_salesDemoSessionId_occurredAt_idx" ON "SalesParticipantLaunchOperation"("customerId", "salesDemoSessionId", "occurredAt");
